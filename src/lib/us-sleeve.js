import { calculateSMA, intersectBars } from "./metrics.js";
import { buyWithCash, positionValue, sellShares } from "./portfolio.js";
import {
  buyIntoTracker,
  computeUsAnnualTax,
  createAverageCostTracker,
  reduceTrackerByValue,
  sellFromTracker
} from "./tax.js";

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

function deductTaxFromPortfolio(engine, amount, prices) {
  let remaining = amount;
  const { state } = engine;

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

function closeActiveCycle(engine, trades, row, index) {
  if (!engine.activeCycle) {
    return;
  }

  const cycleEndValue = getUsValue(engine, row);
  const baseCapital = engine.activeCycle.startValue + engine.activeCycle.contributed;
  trades.push({
    entryDate: engine.activeCycle.entryDate,
    exitDate: row.date,
    holdDays: index - engine.activeCycle.entryIndex,
    pnl: cycleEndValue - baseCapital,
    returnPct: baseCapital <= 0 ? 0 : cycleEndValue / baseCapital - 1,
    sleeve: "bulz"
  });
  engine.activeCycle = null;
}

export function buildUsTimeline(riskBars, spymBars, sgovBars, fxBars) {
  return intersectBars({
    risk: riskBars,
    spym: spymBars,
    sgov: sgovBars,
    fx: fxBars
  });
}

export function createUsSleeve({
  timeline,
  mode,
  confirmationDays,
  feeRate,
  slippageRate,
  profitTakeSteps,
  taxMode
}) {
  return {
    timeline,
    mode,
    sma200: calculateSMA(
      timeline.map((row) => row.risk.adjClose),
      200
    ),
    confirmationDays,
    feeRate,
    slippageRate,
    profitTakeSteps,
    taxMode,
    aboveCount: 0,
    profitTakeCount: 0,
    annualTaxPaid: 0,
    realizedByYear: new Map(),
    currentTaxYear: timeline.length > 0 ? yearOf(timeline[0].date) : null,
    activeCycle: null,
    lastRow: null,
    state: {
      riskShares: 0,
      spymShares: 0,
      sgovShares: 0,
      riskTracker: createAverageCostTracker(),
      spymTracker: createAverageCostTracker(),
      sgovTracker: createAverageCostTracker()
    }
  };
}

export function getUsPrices(row) {
  const fxRate = row.fx.adjClose;
  return {
    riskPrice: row.risk.adjClose * fxRate,
    spymPrice: row.spym.adjClose * fxRate,
    sgovPrice: row.sgov.adjClose * fxRate
  };
}

export function getUsValue(engine, row = engine.lastRow) {
  if (!row) {
    return 0;
  }

  const prices = getUsPrices(row);
  return (
    positionValue(engine.state.riskShares, prices.riskPrice) +
    positionValue(engine.state.spymShares, prices.spymPrice) +
    positionValue(engine.state.sgovShares, prices.sgovPrice)
  );
}

export function getUsSgovValue(engine, row = engine.lastRow) {
  if (!row) {
    return 0;
  }

  return positionValue(engine.state.sgovShares, getUsPrices(row).sgovPrice);
}

export function isUsInvested(engine) {
  return engine.state.riskShares > 0 || engine.state.spymShares > 0;
}

export function isUsOut(engine) {
  return !isUsInvested(engine);
}

export function processUsTradingDate({ engine, row, index, trades, events }) {
  if (engine.mode === "long-only") {
    engine.lastRow = row;
    return;
  }

  const prices = getUsPrices(row);
  const year = yearOf(row.date);

  if (engine.taxMode === "taxed" && engine.currentTaxYear !== null && year !== engine.currentTaxYear) {
    const taxDue = computeUsAnnualTax(engine.realizedByYear.get(engine.currentTaxYear) || 0);
    if (taxDue > 0) {
      const deducted = deductTaxFromPortfolio(engine, taxDue, prices);
      engine.annualTaxPaid += deducted;
      events.push({
        date: row.date,
        type: "annual-tax",
        taxYear: engine.currentTaxYear,
        amount: deducted
      });
    }
    engine.currentTaxYear = year;
  }

  const sma = engine.sma200[index];
  const invested = isUsInvested(engine);
  const above = sma !== null && row.risk.adjClose > sma;
  const below = sma !== null && row.risk.adjClose < sma;

  engine.aboveCount = above ? engine.aboveCount + 1 : 0;

  if (invested && below) {
    let cash = 0;

    if (engine.state.riskShares > 0) {
      const sharesToSell = engine.state.riskShares;
      const sale = sellShares(sharesToSell, prices.riskPrice, engine.feeRate, engine.slippageRate);
      const basis = sellFromTracker(engine.state.riskTracker, sharesToSell, sale.proceeds);
      addRealizedGain(engine.realizedByYear, row.date, basis.realizedGain);
      cash += sale.proceeds;
      engine.state.riskShares = 0;
      events.push({
        date: row.date,
        type: "exit-bulz",
        price: sale.fillPrice,
        proceeds: sale.proceeds
      });
    }

    if (engine.state.spymShares > 0) {
      const sharesToSell = engine.state.spymShares;
      const sale = sellShares(sharesToSell, prices.spymPrice, engine.feeRate, engine.slippageRate);
      const basis = sellFromTracker(engine.state.spymTracker, sharesToSell, sale.proceeds);
      addRealizedGain(engine.realizedByYear, row.date, basis.realizedGain);
      cash += sale.proceeds;
      engine.state.spymShares = 0;
      events.push({
        date: row.date,
        type: "exit-spym",
        price: sale.fillPrice,
        proceeds: sale.proceeds
      });
    }

    const parking = buyWithCash(cash, prices.sgovPrice, engine.feeRate, engine.slippageRate);
    engine.state.sgovShares = parking.shares;
    buyIntoTracker(
      engine.state.sgovTracker,
      parking.shares,
      totalBuyCost(parking.shares, parking.fillPrice, engine.feeRate)
    );
    events.push({
      date: row.date,
      type: "enter-sgov",
      price: parking.fillPrice,
      shares: parking.shares
    });

    closeActiveCycle(engine, trades, row, index);
  } else if (invested && engine.activeCycle) {
    for (let stepIndex = 0; stepIndex < engine.profitTakeSteps.length; stepIndex += 1) {
      const step = engine.profitTakeSteps[stepIndex];
      if (engine.activeCycle.profitFlags[stepIndex]) {
        continue;
      }

      if (row.risk.adjClose >= engine.activeCycle.entryPriceUsd * (1 + step.threshold)) {
        const qty = engine.state.riskShares * step.sellFraction;
        if (qty <= 0) {
          engine.activeCycle.profitFlags[stepIndex] = true;
          continue;
        }

        const sale = sellShares(qty, prices.riskPrice, engine.feeRate, engine.slippageRate);
        const basis = sellFromTracker(engine.state.riskTracker, qty, sale.proceeds);
        addRealizedGain(engine.realizedByYear, row.date, basis.realizedGain);
        engine.state.riskShares -= qty;

        const buy = buyWithCash(sale.proceeds, prices.spymPrice, engine.feeRate, engine.slippageRate);
        engine.state.spymShares += buy.shares;
        buyIntoTracker(
          engine.state.spymTracker,
          buy.shares,
          totalBuyCost(buy.shares, buy.fillPrice, engine.feeRate)
        );

        engine.activeCycle.profitFlags[stepIndex] = true;
        engine.profitTakeCount += 1;
        events.push({
          date: row.date,
          type: "profit-take",
          threshold: step.threshold,
          soldShares: qty,
          riskFill: sale.fillPrice,
          spymFill: buy.fillPrice
        });
      }
    }
  } else if (!invested && sma !== null && engine.aboveCount >= engine.confirmationDays) {
    const sgovSale = sellShares(
      engine.state.sgovShares,
      prices.sgovPrice,
      engine.feeRate,
      engine.slippageRate
    );
    const basis = sellFromTracker(
      engine.state.sgovTracker,
      engine.state.sgovShares,
      sgovSale.proceeds
    );
    addRealizedGain(engine.realizedByYear, row.date, basis.realizedGain);

    const riskBuy = buyWithCash(sgovSale.proceeds, prices.riskPrice, engine.feeRate, engine.slippageRate);
    engine.state.sgovShares = 0;
    engine.state.riskShares = riskBuy.shares;
    engine.state.spymShares = 0;

    buyIntoTracker(
      engine.state.riskTracker,
      riskBuy.shares,
      totalBuyCost(riskBuy.shares, riskBuy.fillPrice, engine.feeRate)
    );

    engine.activeCycle = {
      entryDate: row.date,
      entryIndex: index,
      entryPriceUsd: row.risk.adjClose * (1 + engine.slippageRate),
      startValue: positionValue(engine.state.riskShares, prices.riskPrice),
      contributed: 0,
      profitFlags: engine.profitTakeSteps.map(() => false)
    };
    events.push({
      date: row.date,
      type: "entry-bulz",
      price: riskBuy.fillPrice,
      shares: riskBuy.shares
    });
  }

  engine.lastRow = row;
}

export function depositIntoUsSleeve({ engine, row, index, amountKrw, source, events }) {
  if (amountKrw <= 0) {
    return;
  }

  const prices = getUsPrices(row);

  if (engine.mode === "long-only" || isUsInvested(engine)) {
    const buy = buyWithCash(amountKrw, prices.riskPrice, engine.feeRate, engine.slippageRate);
    engine.state.riskShares += buy.shares;
    buyIntoTracker(
      engine.state.riskTracker,
      buy.shares,
      totalBuyCost(buy.shares, buy.fillPrice, engine.feeRate)
    );

    if (!engine.activeCycle) {
      engine.activeCycle = {
        entryDate: row.date,
        entryIndex: index,
        entryPriceUsd: row.risk.adjClose * (1 + engine.slippageRate),
        startValue: positionValue(engine.state.riskShares, prices.riskPrice),
        contributed: 0,
        profitFlags: engine.profitTakeSteps.map(() => false)
      };
    } else {
      engine.activeCycle.contributed += amountKrw;
    }

    events.push({
      date: row.date,
      type: "transfer-in-bulz",
      source,
      amount: amountKrw,
      price: buy.fillPrice,
      shares: buy.shares
    });
  } else {
    const buy = buyWithCash(amountKrw, prices.sgovPrice, engine.feeRate, engine.slippageRate);
    engine.state.sgovShares += buy.shares;
    buyIntoTracker(
      engine.state.sgovTracker,
      buy.shares,
      totalBuyCost(buy.shares, buy.fillPrice, engine.feeRate)
    );
    events.push({
      date: row.date,
      type: "transfer-in-sgov",
      source,
      amount: amountKrw,
      price: buy.fillPrice,
      shares: buy.shares
    });
  }

  engine.lastRow = row;
}

export function withdrawFromUsSgov({ engine, row, amountKrw, reason, events }) {
  if (amountKrw <= 0 || isUsInvested(engine)) {
    return 0;
  }

  const prices = getUsPrices(row);
  const netPerShare = prices.sgovPrice * (1 - engine.slippageRate) * (1 - engine.feeRate);
  if (netPerShare <= 0) {
    return 0;
  }

  const sharesToSell = Math.min(engine.state.sgovShares, amountKrw / netPerShare);
  if (sharesToSell <= 0) {
    return 0;
  }

  const sale = sellShares(sharesToSell, prices.sgovPrice, engine.feeRate, engine.slippageRate);
  const basis = sellFromTracker(engine.state.sgovTracker, sharesToSell, sale.proceeds);
  addRealizedGain(engine.realizedByYear, row.date, basis.realizedGain);
  engine.state.sgovShares -= sharesToSell;
  engine.lastRow = row;

  events.push({
    date: row.date,
    type: "fund-isa-from-sgov",
    reason,
    requestedAmount: amountKrw,
    amount: sale.proceeds,
    price: sale.fillPrice,
    shares: sharesToSell
  });

  return sale.proceeds;
}

export function finalizeUsTax(engine, events) {
  if (engine.taxMode !== "taxed" || !engine.lastRow || engine.currentTaxYear === null) {
    return 0;
  }

  const taxDue = computeUsAnnualTax(engine.realizedByYear.get(engine.currentTaxYear) || 0);
  if (taxDue <= 0) {
    return 0;
  }

  const deducted = deductTaxFromPortfolio(engine, taxDue, getUsPrices(engine.lastRow));
  engine.annualTaxPaid += deducted;
  events.push({
    date: engine.lastRow.date,
    type: "final-tax-liability",
    taxYear: engine.currentTaxYear,
    amount: deducted
  });

  return deducted;
}
