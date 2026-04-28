import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { DEFAULTS } from "../config.js";
import { loadRequiredData } from "../lib/data-loader.js";
import {
  average,
  calculateCagr,
  calculateMaxDrawdown,
  calculateSMA,
  calculateWinRate
} from "../lib/metrics.js";
import { buyWithCash, positionValue, sellShares } from "../lib/portfolio.js";
import {
  buyIntoTracker,
  createAverageCostTracker,
  reduceTrackerByValue,
  sellFromTracker
} from "../lib/tax.js";

function parseArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const [rawKey, inlineValue] = token.split("=", 2);
    const key = rawKey.slice(2);
    if (inlineValue !== undefined) {
      options[key] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }

    options[key] = next;
    index += 1;
  }

  return options;
}

function yearOf(date) {
  return Number(String(date).slice(0, 4));
}

function totalBuyCost(shares, fillPrice, feeRate) {
  return shares * fillPrice * (1 + feeRate);
}

function addRealizedGain(realizedByYear, date, gain) {
  const year = yearOf(date);
  realizedByYear.set(year, (realizedByYear.get(year) || 0) + gain);
}

function deductTaxFromPortfolio(state, amount, prices) {
  let remaining = amount;

  const drain = (assetKey, tracker, price) => {
    if (remaining <= 0) {
      return;
    }

    const shares = state[assetKey];
    if (shares <= 0 || price <= 0) {
      return;
    }

    const assetValue = shares * price;
    const removedValue = Math.min(assetValue, remaining);
    const removedShares = removedValue / price;

    state[assetKey] -= removedShares;
    reduceTrackerByValue(tracker, removedShares);
    remaining -= removedValue;
  };

  drain("sgovShares", state.sgovTracker, prices.sgovPrice);
  drain("spymShares", state.spymTracker, prices.spymPrice);
  drain("riskShares", state.riskTracker, prices.riskPrice);

  return amount - remaining;
}

function normalizeProfitTakeParking(profitTakeParking) {
  const raw = profitTakeParking || { spym: 1, sgov: 0 };
  const weights = {
    spym: Number.isFinite(raw.spym) ? Math.max(0, raw.spym) : 0,
    sgov: Number.isFinite(raw.sgov) ? Math.max(0, raw.sgov) : 0
  };
  const total = weights.spym + weights.sgov;

  if (total <= 0) {
    return { spym: 1, sgov: 0 };
  }

  return {
    spym: weights.spym / total,
    sgov: weights.sgov / total
  };
}

function buildSyntheticLeveragedBars(baseBars, leverage, startDate) {
  const startIndex = baseBars.findIndex((bar) => bar.date >= startDate);
  if (startIndex <= 0) {
    throw new Error(`Synthetic leveraged series start date is invalid: ${startDate}`);
  }

  const syntheticBars = [];
  let syntheticPrevClose = 100;
  let basePrevClose = baseBars[startIndex - 1].adjClose;

  const ensurePositive = (value) => Math.max(0.0001, value);

  for (let index = startIndex; index < baseBars.length; index += 1) {
    const bar = baseBars[index];
    const open = ensurePositive(
      syntheticPrevClose * (1 + leverage * (bar.adjOpen / basePrevClose - 1))
    );
    const highCandidate = ensurePositive(
      syntheticPrevClose * (1 + leverage * (bar.adjHigh / basePrevClose - 1))
    );
    const lowCandidate = ensurePositive(
      syntheticPrevClose * (1 + leverage * (bar.adjLow / basePrevClose - 1))
    );
    const close = ensurePositive(
      syntheticPrevClose * (1 + leverage * (bar.adjClose / basePrevClose - 1))
    );
    const high = Math.max(open, close, highCandidate, lowCandidate);
    const low = Math.min(open, close, highCandidate, lowCandidate);

    syntheticBars.push({
      date: bar.date,
      open,
      high,
      low,
      close,
      adjClose: close,
      adjOpen: open,
      adjHigh: high,
      adjLow: low,
      volume: bar.volume
    });

    syntheticPrevClose = close;
    basePrevClose = bar.adjClose;
  }

  return syntheticBars;
}

function intersectSeries(seriesMap) {
  const entries = Object.entries(seriesMap);
  const dateSets = entries.map(([, bars]) => new Set(bars.map((bar) => bar.date)));
  const commonDates = entries[0][1]
    .map((bar) => bar.date)
    .filter((date) => dateSets.every((set) => set.has(date)));

  return commonDates.map((date) => {
    const row = { date };
    for (const [key, bars] of entries) {
      row[key] = bars.find((bar) => bar.date === date);
    }
    return row;
  });
}

export function computeCalmar(cagr, maxDrawdown) {
  if (!Number.isFinite(cagr) || !Number.isFinite(maxDrawdown) || maxDrawdown >= 0) {
    return null;
  }
  return cagr / Math.abs(maxDrawdown);
}

function computeAnnualTax(realizedNetGain, basicDeduction, taxRate) {
  return Math.max(0, realizedNetGain - basicDeduction) * taxRate;
}

export function runTqqqQldStrategy({
  signalBars,
  riskBars,
  spymBars,
  sgovBars,
  initialCapital,
  confirmationDays,
  feeRate,
  slippageRate,
  profitTakeSteps,
  profitTakeParking,
  taxMode,
  taxRate,
  basicDeduction
}) {
  const timeline = intersectSeries({
    signal: signalBars,
    risk: riskBars,
    spym: spymBars,
    sgov: sgovBars
  });

  if (timeline.length < 200) {
    throw new Error("Common timeline is shorter than 200 trading days.");
  }

  const signalSma200 = calculateSMA(
    timeline.map((row) => row.signal.adjClose),
    200
  );
  const parkingWeights = normalizeProfitTakeParking(profitTakeParking);
  const state = {
    riskShares: 0,
    spymShares: 0,
    sgovShares: 0,
    riskTracker: createAverageCostTracker(),
    spymTracker: createAverageCostTracker(),
    sgovTracker: createAverageCostTracker()
  };

  let activeCycle = null;
  let aboveCount = 0;
  let annualTaxPaid = 0;
  let profitTakeCount = 0;
  let currentTaxYear = yearOf(timeline[0].date);
  const realizedByYear = new Map();
  const dailyValues = [];
  const trades = [];
  const events = [];

  const initialParking = buyWithCash(initialCapital, timeline[0].sgov.adjOpen, feeRate, slippageRate);
  state.sgovShares = initialParking.shares;
  buyIntoTracker(
    state.sgovTracker,
    initialParking.shares,
    totalBuyCost(initialParking.shares, initialParking.fillPrice, feeRate)
  );

  for (let index = 0; index < timeline.length; index += 1) {
    const row = timeline[index];
    const year = yearOf(row.date);
    const prices = {
      riskPrice: row.risk.adjClose,
      spymPrice: row.spym.adjClose,
      sgovPrice: row.sgov.adjClose
    };

    if (taxMode === "taxed" && year !== currentTaxYear) {
      const taxDue = computeAnnualTax(
        realizedByYear.get(currentTaxYear) || 0,
        basicDeduction,
        taxRate
      );
      if (taxDue > 0) {
        const deducted = deductTaxFromPortfolio(state, taxDue, prices);
        annualTaxPaid += deducted;
        events.push({
          date: row.date,
          type: "annual-tax",
          taxYear: currentTaxYear,
          amount: deducted
        });
      }
      currentTaxYear = year;
    }

    const sma = signalSma200[index];
    const cycleActive = activeCycle !== null;
    const above = sma !== null && row.signal.adjClose > sma;
    const below = sma !== null && row.signal.adjClose < sma;
    aboveCount = above ? aboveCount + 1 : 0;

    if (cycleActive && below) {
      let cash = 0;

      if (state.riskShares > 0) {
        const qty = state.riskShares;
        const sale = sellShares(qty, prices.riskPrice, feeRate, slippageRate);
        const basis = sellFromTracker(state.riskTracker, qty, sale.proceeds);
        addRealizedGain(realizedByYear, row.date, basis.realizedGain);
        cash += sale.proceeds;
        state.riskShares = 0;
      }

      if (state.spymShares > 0) {
        const qty = state.spymShares;
        const sale = sellShares(qty, prices.spymPrice, feeRate, slippageRate);
        const basis = sellFromTracker(state.spymTracker, qty, sale.proceeds);
        addRealizedGain(realizedByYear, row.date, basis.realizedGain);
        cash += sale.proceeds;
        state.spymShares = 0;
      }

      if (cash > 0) {
        const buy = buyWithCash(cash, prices.sgovPrice, feeRate, slippageRate);
        state.sgovShares += buy.shares;
        buyIntoTracker(
          state.sgovTracker,
          buy.shares,
          totalBuyCost(buy.shares, buy.fillPrice, feeRate)
        );
      }

      const endingValue =
        positionValue(state.riskShares, prices.riskPrice) +
        positionValue(state.spymShares, prices.spymPrice) +
        positionValue(state.sgovShares, prices.sgovPrice);
      trades.push({
        entryDate: activeCycle.entryDate,
        exitDate: row.date,
        holdDays: index - activeCycle.entryIndex,
        pnl: endingValue - activeCycle.startValue,
        returnPct: activeCycle.startValue > 0 ? endingValue / activeCycle.startValue - 1 : 0
      });
      activeCycle = null;
    } else if (cycleActive) {
      for (let stepIndex = 0; stepIndex < profitTakeSteps.length; stepIndex += 1) {
        const step = profitTakeSteps[stepIndex];
        if (activeCycle.profitFlags[stepIndex]) {
          continue;
        }
        if (row.risk.adjClose < activeCycle.entryPrice * (1 + step.threshold)) {
          continue;
        }

        const qty = state.riskShares * step.sellFraction;
        if (qty <= 0) {
          activeCycle.profitFlags[stepIndex] = true;
          continue;
        }

        const sale = sellShares(qty, prices.riskPrice, feeRate, slippageRate);
        const basis = sellFromTracker(state.riskTracker, qty, sale.proceeds);
        addRealizedGain(realizedByYear, row.date, basis.realizedGain);
        state.riskShares -= qty;

        const spymCash = sale.proceeds * parkingWeights.spym;
        if (spymCash > 0) {
          const buy = buyWithCash(spymCash, prices.spymPrice, feeRate, slippageRate);
          state.spymShares += buy.shares;
          buyIntoTracker(
            state.spymTracker,
            buy.shares,
            totalBuyCost(buy.shares, buy.fillPrice, feeRate)
          );
        }

        const sgovCash = sale.proceeds * parkingWeights.sgov;
        if (sgovCash > 0) {
          const buy = buyWithCash(sgovCash, prices.sgovPrice, feeRate, slippageRate);
          state.sgovShares += buy.shares;
          buyIntoTracker(
            state.sgovTracker,
            buy.shares,
            totalBuyCost(buy.shares, buy.fillPrice, feeRate)
          );
        }

        activeCycle.profitFlags[stepIndex] = true;
        profitTakeCount += 1;
      }
    } else if (sma !== null && aboveCount >= confirmationDays) {
      if (state.sgovShares > 0) {
        const sgovQty = state.sgovShares;
        const sgovSale = sellShares(sgovQty, prices.sgovPrice, feeRate, slippageRate);
        const basis = sellFromTracker(state.sgovTracker, sgovQty, sgovSale.proceeds);
        addRealizedGain(realizedByYear, row.date, basis.realizedGain);
        state.sgovShares = 0;

        const riskBuy = buyWithCash(sgovSale.proceeds, prices.riskPrice, feeRate, slippageRate);
        state.riskShares = riskBuy.shares;
        buyIntoTracker(
          state.riskTracker,
          riskBuy.shares,
          totalBuyCost(riskBuy.shares, riskBuy.fillPrice, feeRate)
        );
        activeCycle = {
          entryDate: row.date,
          entryIndex: index,
          entryPrice: row.risk.adjClose * (1 + slippageRate),
          startValue: positionValue(state.riskShares, prices.riskPrice),
          profitFlags: profitTakeSteps.map(() => false)
        };
      }
    }

    const value =
      positionValue(state.riskShares, prices.riskPrice) +
      positionValue(state.spymShares, prices.spymPrice) +
      positionValue(state.sgovShares, prices.sgovPrice);

    dailyValues.push({
      date: row.date,
      value,
      nav: value / initialCapital
    });
  }

  let endingValue = dailyValues[dailyValues.length - 1].value;
  if (taxMode === "taxed") {
    const finalTax = computeAnnualTax(
      realizedByYear.get(currentTaxYear) || 0,
      basicDeduction,
      taxRate
    );
    if (finalTax > 0) {
      const last = timeline[timeline.length - 1];
      const deducted = deductTaxFromPortfolio(
        state,
        finalTax,
        {
          riskPrice: last.risk.adjClose,
          spymPrice: last.spym.adjClose,
          sgovPrice: last.sgov.adjClose
        }
      );
      annualTaxPaid += deducted;
      endingValue -= deducted;
      events.push({
        date: last.date,
        type: "final-tax-liability",
        amount: deducted
      });
      dailyValues[dailyValues.length - 1].value = endingValue;
      dailyValues[dailyValues.length - 1].nav = endingValue / initialCapital;
    }
  }

  const metrics = {
    endingValue,
    totalReturn: endingValue / initialCapital - 1,
    cagr: calculateCagr(1, endingValue / initialCapital, dailyValues[0].date, dailyValues[dailyValues.length - 1].date),
    maxDrawdown: calculateMaxDrawdown(dailyValues.map((item) => item.nav)),
    tradeCount: trades.length,
    winRate: calculateWinRate(trades),
    avgHoldDays: average(trades.map((trade) => trade.holdDays)),
    annualTaxPaid,
    profitTakeCount
  };

  return {
    metrics,
    trades,
    events,
    dailyValues
  };
}

export function buildSteps(rawSteps) {
  return rawSteps.map((step) => ({
    threshold: step.threshold,
    sellFraction: step.sellFraction
  }));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const dataDir = path.resolve(cwd, options["data-dir"] || DEFAULTS.dataDir);
  const outputPath = path.resolve(
    cwd,
    String(options.output || "results/tqqq-qld-direct-study.json")
  );
  const taxRate = Number(options["tax-rate"] ?? 0.22);
  const basicDeduction = Number(options["tax-deduction"] ?? 2500);
  const datasets = await loadRequiredData(dataDir, {
    tqqq: "us/tqqq.csv",
    qqq: "us/qqq.csv",
    spym: "us/spym.csv",
    sgov: "us/sgov.csv"
  });

  const startDate = datasets.tqqq[0].date;
  const signalBars = datasets.tqqq.filter((bar) => bar.date >= startDate);
  const riskBars = buildSyntheticLeveragedBars(datasets.qqq, 2, startDate);
  const spymBars = datasets.spym.filter((bar) => bar.date >= startDate);
  const sgovBars = datasets.sgov.filter((bar) => bar.date >= startDate);
  const feeRate = 0.0025;
  const slippageRate = 0.0005;
  const initialCapital = 100_000;
  const plans = [
    {
      label: "tqqq-growth",
      profitTakeSteps: buildSteps([
        { threshold: 1.0, sellFraction: 0.5 },
        { threshold: 2.0, sellFraction: 1.0 }
      ])
    },
    {
      label: "tqqq-balance",
      profitTakeSteps: buildSteps([
        { threshold: 0.5, sellFraction: 0.2 },
        { threshold: 1.0, sellFraction: 0.5 },
        { threshold: 2.0, sellFraction: 1.0 }
      ])
    },
    {
      label: "tqqq-defense",
      profitTakeSteps: buildSteps([
        { threshold: 0.1, sellFraction: 0.1 },
        { threshold: 0.25, sellFraction: 0.1 },
        { threshold: 0.5, sellFraction: 0.1 },
        { threshold: 1.0, sellFraction: 0.5 },
        { threshold: 2.0, sellFraction: 0.5 },
        { threshold: 3.0, sellFraction: 0.5 }
      ])
    },
    {
      label: "aggressive-100/60-130/all",
      profitTakeSteps: buildSteps([
        { threshold: 1.0, sellFraction: 0.6 },
        { threshold: 1.3, sellFraction: 1.0 }
      ])
    },
    {
      label: "stable-30/25-65/all",
      profitTakeSteps: buildSteps([
        { threshold: 0.3, sellFraction: 0.25 },
        { threshold: 0.65, sellFraction: 1.0 }
      ])
    },
    {
      label: "current-80/30-100/70",
      profitTakeSteps: buildSteps([
        { threshold: 0.8, sellFraction: 0.3 },
        { threshold: 1.0, sellFraction: 0.7 }
      ])
    },
    {
      label: "no-pt",
      profitTakeSteps: []
    }
  ];

  const rows = [];
  for (const taxMode of ["none", "taxed"]) {
    for (const plan of plans) {
      for (const confirmationDays of [1, 2, 3, 4, 5]) {
        const result = runTqqqQldStrategy({
          signalBars,
          riskBars,
          spymBars,
          sgovBars,
          initialCapital,
          confirmationDays,
          feeRate,
          slippageRate,
          profitTakeSteps: plan.profitTakeSteps,
          profitTakeParking: { spym: 1, sgov: 0 },
          taxMode,
          taxRate,
          basicDeduction
        });

        rows.push({
          taxMode,
          plan: plan.label,
          confirmationDays,
          cagr: result.metrics.cagr,
          mdd: result.metrics.maxDrawdown,
          calmar: computeCalmar(result.metrics.cagr, result.metrics.maxDrawdown),
          totalReturn: result.metrics.totalReturn,
          endingValue: result.metrics.endingValue,
          tradeCount: result.metrics.tradeCount,
          winRate: result.metrics.winRate,
          avgHoldDays: result.metrics.avgHoldDays,
          profitTakeCount: result.metrics.profitTakeCount,
          annualTaxPaid: result.metrics.annualTaxPaid
        });
      }
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    assumptions: {
      model: "TQQQ signal + synthetic 2x QQQ execution + SPYM parking",
      startDate,
      endDate: signalBars.at(-1)?.date ?? null,
      initialCapital,
      feeRate,
      slippageRate,
      taxRate,
      basicDeduction,
      taxModes: ["none", "taxed"],
      confirmationDays: [1, 2, 3, 4, 5]
    },
    rows
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(rows, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
