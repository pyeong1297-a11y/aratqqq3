import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { DEFAULTS } from "../config.js";
import { loadRequiredData } from "../lib/data-loader.js";
import {
  average,
  calculateCagr,
  calculateMaxDrawdown,
  calculateWinRate
} from "../lib/metrics.js";
import { buyWithCash, positionValue, sellShares } from "../lib/portfolio.js";
import { alignKrBars, findFirstTradingDateOnOrAfter } from "../lib/isa-helpers.js";
import { runUsStrategy } from "../lib/us-strategy.js";

function buildDateMap(rows) {
  return new Map(rows.map((row, index) => [row.date, { row, index }]));
}

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

function computeIsaExitTax(endingValue, principal, taxRate) {
  return Math.max(0, endingValue - principal) * taxRate;
}

function getValue(state, row) {
  return (
    positionValue(state.kodexShares, row.kodex.adjClose) +
    positionValue(state.sp500Shares, row.sp500.adjClose) +
    positionValue(state.cashShares, row.cash.adjClose)
  );
}

function closeCycle(activeCycle, trades, state, row, date, index) {
  if (!activeCycle) {
    return null;
  }

  const endValue = getValue(state, row);
  trades.push({
    entryDate: activeCycle.entryDate,
    exitDate: date,
    holdDays: index - activeCycle.entryIndex,
    pnl: endValue - activeCycle.startValue,
    returnPct: activeCycle.startValue > 0 ? endValue / activeCycle.startValue - 1 : 0
  });
  return null;
}

function applyEnter(state, row, feeRate) {
  if (state.cashShares <= 0) {
    return null;
  }

  const cashSale = sellShares(state.cashShares, row.cash.adjOpen, feeRate, 0);
  const buy = buyWithCash(cashSale.proceeds, row.kodex.adjOpen, feeRate, 0);
  state.cashShares = 0;
  state.kodexShares += buy.shares;
  return {
    type: "enter-kodex",
    tradePrice: buy.fillPrice,
    shares: buy.shares
  };
}

function applyProfitTake(state, row, feeRate, sellFraction) {
  if (state.kodexShares <= 0 || sellFraction <= 0) {
    return null;
  }

  const qty = state.kodexShares * sellFraction;
  const sale = sellShares(qty, row.kodex.adjOpen, feeRate, 0);
  const buy = buyWithCash(sale.proceeds, row.sp500.adjOpen, feeRate, 0);
  state.kodexShares -= qty;
  state.sp500Shares += buy.shares;

  return {
    type: "profit-take",
    sellFraction,
    soldShares: qty,
    kodexTradePrice: sale.fillPrice,
    sp500TradePrice: buy.fillPrice
  };
}

function applyExitAll(state, row, feeRate) {
  if (state.kodexShares <= 0 && state.sp500Shares <= 0) {
    return null;
  }

  let proceeds = 0;

  if (state.kodexShares > 0) {
    const sale = sellShares(state.kodexShares, row.kodex.adjOpen, feeRate, 0);
    proceeds += sale.proceeds;
    state.kodexShares = 0;
  }

  if (state.sp500Shares > 0) {
    const sale = sellShares(state.sp500Shares, row.sp500.adjOpen, feeRate, 0);
    proceeds += sale.proceeds;
    state.sp500Shares = 0;
  }

  const buy = buyWithCash(proceeds, row.cash.adjOpen, feeRate, 0);
  state.cashShares += buy.shares;
  return {
    type: "exit-all",
    cashShares: buy.shares
  };
}

function addOneDay(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function buildMappedActions(usEvents, krDates) {
  const balanceSellFractions = new Map([
    [0.5, 0.2],
    [1.0, 0.5],
    [2.0, 1.0]
  ]);

  const actionsByDate = new Map();
  const push = (date, action) => {
    const list = actionsByDate.get(date) || [];
    list.push(action);
    actionsByDate.set(date, list);
  };

  for (const event of usEvents) {
    if (!["entry-risk", "profit-take", "exit-risk"].includes(event.type)) {
      continue;
    }

    const krTradeDate = findFirstTradingDateOnOrAfter(krDates, addOneDay(event.date));
    if (!krTradeDate) {
      continue;
    }

    if (event.type === "entry-risk") {
      push(krTradeDate, { type: "enter" });
      continue;
    }

    if (event.type === "profit-take") {
      const sellFraction = balanceSellFractions.get(event.threshold);
      if (sellFraction) {
        push(krTradeDate, {
          type: "profit-take",
          threshold: event.threshold,
          sellFraction
        });
      }
      continue;
    }

    if (event.type === "exit-risk") {
      push(krTradeDate, { type: "exit-all" });
    }
  }

  return actionsByDate;
}

function runTigerMirrorStrategy({
  name,
  krTimeline,
  actionsByDate,
  initialCapital,
  feeRate,
  isaTaxRate
}) {
  const state = {
    cashShares: initialCapital / krTimeline[0].cash.adjOpen,
    kodexShares: 0,
    sp500Shares: 0
  };
  let activeCycle = null;

  const trades = [];
  const events = [];
  const dailyValues = [];

  for (let index = 0; index < krTimeline.length; index += 1) {
    const row = krTimeline[index];
    const actions = actionsByDate.get(row.date) || [];

    for (const action of actions) {
      if (action.type === "enter") {
        const entry = applyEnter(state, row, feeRate);
        if (entry) {
          activeCycle = activeCycle || {
            entryDate: row.date,
            entryIndex: index,
            startValue: getValue(state, row)
          };
          events.push({ date: row.date, ...entry });
        }
        continue;
      }

      if (action.type === "profit-take") {
        const pt = applyProfitTake(state, row, feeRate, action.sellFraction);
        if (pt) {
          events.push({
            date: row.date,
            threshold: action.threshold,
            ...pt
          });
        }
        continue;
      }

      if (action.type === "exit-all") {
        const exit = applyExitAll(state, row, feeRate);
        if (exit) {
          events.push({ date: row.date, ...exit });
          activeCycle = closeCycle(activeCycle, trades, state, row, row.date, index);
        }
      }
    }

    dailyValues.push({
      date: row.date,
      value: getValue(state, row)
    });
  }

  const preTaxEndingValue = dailyValues[dailyValues.length - 1].value;
  const exitTax = computeIsaExitTax(preTaxEndingValue, initialCapital, isaTaxRate);
  const endingValue = preTaxEndingValue - exitTax;
  dailyValues[dailyValues.length - 1].value = endingValue;

  const navSeries = dailyValues.map((item) => item.value / initialCapital);
  const metrics = {
    endingValue,
    totalReturn: endingValue / initialCapital - 1,
    cagr: calculateCagr(1, endingValue / initialCapital, dailyValues[0].date, dailyValues[dailyValues.length - 1].date),
    maxDrawdown: calculateMaxDrawdown(navSeries),
    tradeCount: trades.length,
    winRate: calculateWinRate(trades),
    avgHoldDays: average(trades.map((trade) => trade.holdDays)),
    exitTax
  };

  return {
    meta: {
      strategyName: name,
      startDate: dailyValues[0].date,
      endDate: dailyValues[dailyValues.length - 1].date
    },
    metrics,
    trades,
    events,
    dailyValues
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const dataDir = path.resolve(cwd, options["data-dir"] || DEFAULTS.dataDir);
  const outputPath = path.resolve(
    cwd,
    String(options.output || "results/isa-tiger-mirror-tqqq-balance-study.json")
  );
  const initialCapital = Number(options["initial-capital"] || 100_000_000);
  const isaTaxRate = Number(options["isa-tax-rate"] || 0.099);

  const datasets = await loadRequiredData(dataDir, {
    tqqq: "us/tqqq.csv",
    spym: "us/spym.csv",
    sgov: "us/sgov.csv",
    kodex: "kr/tiger_us_nasdaq100_lev.csv",
    tigerSp500: "kr/tiger_us_sp500.csv"
  });

  const krTimeline = alignKrBars(datasets.kodex, 0.035)
    .map((row) => ({
      ...row,
      sp500: datasets.tigerSp500.find((bar) => bar.date === row.date) || null
    }))
    .filter((row) => row.sp500 !== null);

  const krDates = krTimeline.map((row) => row.date);
  const periodStart = krTimeline[0].date;
  const periodEnd = krTimeline[krTimeline.length - 1].date;

  const usRiskBars = datasets.tqqq.filter(
    (bar) => bar.date >= periodStart && bar.date <= periodEnd
  );
  const usSpymBars = datasets.spym.filter(
    (bar) => bar.date >= periodStart && bar.date <= periodEnd
  );
  const usSgovBars = datasets.sgov.filter(
    (bar) => bar.date >= periodStart && bar.date <= periodEnd
  );

  const usBalance = runUsStrategy({
    name: "us-tqqq-balance",
    riskBars: usRiskBars,
    spymBars: usSpymBars,
    sgovBars: usSgovBars,
    parkingFallbackBars: null,
    fxBars: null,
    initialCapital: 100_000,
    contributionPlan: {
      initialContribution: 100_000,
      legacyMonthlyContribution: 0
    },
    confirmationDays: 3,
    feeRate: 0.0025,
    slippageRate: 0.0005,
    profitTakeSteps: [
      { threshold: 0.5, sellFraction: 0.2 },
      { threshold: 1.0, sellFraction: 0.5 },
      { threshold: 2.0, sellFraction: 1.0 }
    ],
    profitTakeParking: { spym: 1 },
    valuationCurrency: "USD",
    taxMode: "none"
  });

  const balanceActions = buildMappedActions(usBalance.events, krDates);
  const baseActions = new Map();
  for (const [date, actions] of balanceActions.entries()) {
    baseActions.set(
      date,
      actions.filter((action) => action.type !== "profit-take")
    );
  }

  const baseline = runTigerMirrorStrategy({
    name: "isa-tiger-follow-tqqq-3d",
    krTimeline,
    actionsByDate: baseActions,
    initialCapital,
    feeRate: 0.00015,
    isaTaxRate
  });
  const mirrored = runTigerMirrorStrategy({
    name: "isa-tiger-follow-tqqq-balance-sells",
    krTimeline,
    actionsByDate: balanceActions,
    initialCapital,
    feeRate: 0.00015,
    isaTaxRate
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    assumptions: {
      periodStart,
      periodEnd,
      initialCapital,
      isaTaxRate,
      feeRate: 0.00015,
      annualCashYield: 0.035,
      usSignalSource: "TQQQ balance strategy events",
      krExecution: "next KR trading day open",
      monthlyContribution: 0,
      rollover: false
    },
    strategies: [
      {
        id: "baseline",
        label: "Tiger follows TQQQ 3-day entries/exits only",
        metrics: baseline.metrics
      },
      {
        id: "mirrored-balance",
        label: "Tiger mirrors TQQQ balance partial sells and exits",
        metrics: mirrored.metrics
      }
    ]
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
