// ─── Utility ─────────────────────────────────────────────
export function calcSMA(arr, period) {
  const result = new Array(arr.length).fill(null);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    if (i >= period) sum -= arr[i - period];
    if (i >= period - 1) result[i] = sum / period;
  }
  return result;
}

export function calcCAGR(startVal, endVal, startDate, endDate) {
  const years = (new Date(endDate) - new Date(startDate)) / (365.25 * 24 * 3600 * 1000);
  if (years <= 0 || startVal <= 0) return 0;
  return Math.pow(endVal / startVal, 1 / years) - 1;
}

export function calcMDD(values) {
  let peak = -Infinity, mdd = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    const dd = (v - peak) / peak;
    if (dd < mdd) mdd = dd;
  }
  return mdd;
}

// ─── TQQQ / BULZ Trend Strategy ──────────────────────────
export function runTrendStrategy({
  bars,           // [{ date, adjClose }] (Signal)
  tradeBars,      // [{ date, adjClose }] (Execution)
  parkingBars,    // SGOV
  profitBars,     // SPYM (for profit taking parking)
  confirmDays = 3,
  confirmDays2 = 4,
  smaPeriod = 200,
  profitTakeSteps = [],  // [{ threshold, sellFraction, spymRatio }]
  profitTakeEnabled = true,
  stopLossEnabled = false,
  stopLossThreshold = -0.05,
  splitEntry = false,    // 3일차 50% + 4일차 50%
  splitRefMode = 'max',  // 'max' | 'day2' (익절 기준가)
  startDate = '',
  endDate = '',
  initialCapital = 100_000,
  feeRate = 0.0025,
  monthlyDCA = 0,
  annualContributionLimit = 0, // 0 means no limit
}) {
  const closes = bars.map(b => b.adjClose);
  const sma = calcSMA(closes, smaPeriod);
  const N = bars.length;

  const buyP  = p => p * (1 + feeRate);
  const sellP = p => p * (1 - feeRate);

  let riskShares = 0;
  let profitShares = 0; // SPYM shares
  let sgovShares = 0;
  let sgovCostBasis = 0;
  let spymCostBasis = 0;
  let totalContributed = initialCapital;
  let currentYearContribution = initialCapital;
  let lastContributionMonth = -1;
  let lastContributionYear = -1;
  let hasInitialized = false;
  let streak = 0;

  let inPosition = false;
  let half1Done = false;
  let entry1Price = null;
  let entry2Price = null;
  let signalEntry1Price = null;
  let signalEntry2Price = null;
  let refPrice = null;
  let signalRefPrice = null;

  let bnhShares = 0;

  // TP state per cycle
  const tpDone = new Array(profitTakeSteps.length).fill(false);

  const equityCurve = [];
  const events = [];

  function getParkingPrice(i) {
    return parkingBars[Math.min(i, parkingBars.length - 1)]?.adjClose || 1;
  }
  function getProfitPrice(i) {
    if (!profitBars || profitBars.length === 0) return getParkingPrice(i);
    return profitBars[Math.min(i, profitBars.length - 1)]?.adjClose || 1;
  }

  const parkDates = parkingBars.map(b => b.date);
  const profitDates = (profitBars || []).map(b => b.date);

  function findPrice(dateBars, dates, targetDate) {
    let lo = 0, hi = dates.length - 1, ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (dates[mid] <= targetDate) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return dateBars[ans]?.adjClose || 1;
  }

  const actTradeBars = tradeBars || bars;
  const tradeDates = actTradeBars.map(b => b.date);

  for (let i = 0; i < N; i++) {
    const bar = bars[i];
    const signalPrice = bar.adjClose;
    const ma = sma[i];
    const date = bar.date;
    if (ma !== null) {
      const aboveMA = signalPrice > ma;
      streak = aboveMA ? streak + 1 : 0;
    }

    if (startDate && date < startDate) continue;
    if (endDate && date > endDate) break;

    const tradeP = findPrice(actTradeBars, tradeDates, date);
    const sgov = findPrice(parkingBars, parkDates, date);
    const spym = findPrice(profitBars || parkingBars, profitDates.length > 0 ? profitDates : parkDates, date);

    const currentDateObj = new Date(date);
    const currentMonth = currentDateObj.getMonth();
    const currentYear = currentDateObj.getFullYear();

    if (!hasInitialized) {
      sgovShares = initialCapital / buyP(sgov);
      sgovCostBasis = initialCapital;
      bnhShares = initialCapital / buyP(tradeP);
      lastContributionMonth = currentMonth;
      lastContributionYear = currentYear;
      hasInitialized = true;
    } else {
      // Monthly DCA Logic
      if (monthlyDCA > 0 && currentMonth !== lastContributionMonth) {
        // Check year reset for ISA limit
        if (currentYear !== lastContributionYear) {
          currentYearContribution = 0;
          lastContributionYear = currentYear;
        }

        let amountToContribute = monthlyDCA;
        if (annualContributionLimit > 0) {
          const remainingLimit = annualContributionLimit - currentYearContribution;
          amountToContribute = Math.min(monthlyDCA, remainingLimit);
        }

        if (amountToContribute > 0) {
          sgovShares += amountToContribute / buyP(sgov);
          sgovCostBasis += amountToContribute;
          totalContributed += amountToContribute;
          currentYearContribution += amountToContribute;
          
          // Also update B&H comparison
          bnhShares += amountToContribute / buyP(tradeP);
          
          events.push({ date, type: 'contribution', amount: amountToContribute });
        }
        lastContributionMonth = currentMonth;
      }
    }

    if (ma === null) {
      const val = riskShares * tradeP + profitShares * spym + sgovShares * sgov;
      const benchmarkVal = bnhShares * sellP(tradeP);
      equityCurve.push({ date, value: val, benchmark: benchmarkVal });
      continue;
    }

    const aboveMA = signalPrice > ma;

    // ── EXIT: MA break or Stop Loss
    let triggeredStopLoss = false;
    if (stopLossEnabled && inPosition && refPrice !== null && riskShares > 0) {
      const currentLoss = (tradeP - refPrice) / refPrice;
      if (currentLoss <= stopLossThreshold) {
        triggeredStopLoss = true;
      }
    }

    if (inPosition && (!aboveMA || triggeredStopLoss)) {
      if (riskShares > 0) {
        const proceeds = riskShares * sellP(tradeP);
        sgovShares += proceeds / buyP(sgov);
        sgovCostBasis += proceeds;
        const exitReason = triggeredStopLoss ? 'stoploss' : 'exit';
        events.push({ date, type: exitReason, price: tradeP });
        riskShares = 0;
      }
      if (profitShares > 0) {
        const proceeds = profitShares * sellP(spym);
        sgovShares += proceeds / buyP(sgov);
        sgovCostBasis += proceeds;
        profitShares = 0;
      }
      inPosition = false;
      half1Done = false;
      entry1Price = entry2Price = refPrice = null;
      signalEntry1Price = signalEntry2Price = signalRefPrice = null;
      tpDone.fill(false);
      streak = 0;
    }

    // ── PROFIT TAKE (only when signalRefPrice is set)
    if (profitTakeEnabled && inPosition && signalRefPrice !== null && riskShares > 0) {
      const gain = (signalPrice - signalRefPrice) / signalRefPrice;
      for (let t = 0; t < profitTakeSteps.length; t++) {
        const step = profitTakeSteps[t];
        if (!tpDone[t] && gain >= step.threshold) {
          // check all previous steps done
          const prevDone = t === 0 || tpDone[t - 1];
          if (prevDone) {
            const sell = riskShares * step.sellFraction;
            const proceeds = sell * sellP(tradeP);
            
            const stepSpymRatio = step.spymRatio !== undefined ? step.spymRatio : 1.0;
            const spymProceeds = proceeds * stepSpymRatio;
            const sgovProceeds = proceeds * (1 - stepSpymRatio);

            if (spymProceeds > 0 && profitBars?.length > 0) {
              profitShares += spymProceeds / buyP(spym);
              spymCostBasis += spymProceeds;
            } else if (spymProceeds > 0) {
              sgovShares += spymProceeds / buyP(sgov);
              sgovCostBasis += spymProceeds;
            }
            if (sgovProceeds > 0) {
              sgovShares += sgovProceeds / buyP(sgov);
              sgovCostBasis += sgovProceeds;
            }

            riskShares -= sell;
            tpDone[t] = true;
            events.push({ date, type: `tp${t + 1}`, price: tradeP, gain, proceeds });
          }
        }
      }
    }

    // ── ENTRY
    if (!splitEntry) {
      // Simple: enter all at once on confirmDays streak
      const canEnter = (!startDate || date >= startDate) && (!endDate || date <= endDate);
      if (!inPosition && streak === confirmDays && canEnter) {
        const totalVal = sgovShares * sellP(sgov);
        if (totalVal > 1) {
          riskShares += totalVal / buyP(tradeP);
          sgovShares = 0;
          sgovCostBasis = 0;
          refPrice = tradeP;
          signalRefPrice = signalPrice;
          inPosition = true;
          tpDone.fill(false);
          events.push({ date, type: 'entry', price: tradeP });
        }
      }
    } else {
      // Split entry
      const day1 = confirmDays;
      const day2 = confirmDays2;

      if (!inPosition && !half1Done && streak === day1) {
        const totalVal = sgovShares * sellP(sgov);
        const half = totalVal / 2;
        if (half > 1) {
          riskShares += half / buyP(tradeP);
          sgovShares -= half / sellP(sgov);
          sgovCostBasis /= 2;
          entry1Price = tradeP;
          signalEntry1Price = signalPrice;
          half1Done = true;
          inPosition = true;
          tpDone.fill(false);
          events.push({ date, type: 'entry-half1', price: tradeP });
        }
      } else if (inPosition && half1Done && entry2Price === null && streak === day2) {
        const totalVal = sgovShares * sellP(sgov);
        if (totalVal > 1) {
          riskShares += totalVal / buyP(tradeP);
          sgovShares = 0;
          sgovCostBasis = 0;
          entry2Price = tradeP;
          signalEntry2Price = signalPrice;
          refPrice = splitRefMode === 'max'
            ? Math.max(entry1Price, entry2Price)
            : entry2Price;
          signalRefPrice = splitRefMode === 'max'
            ? Math.max(signalEntry1Price, signalEntry2Price)
            : signalEntry2Price;
          events.push({ date, type: 'entry-half2', price: tradeP, refPrice });
        }
      } else if (inPosition && half1Done && entry2Price === null && !aboveMA) {
        // streak reset during split: cancel
      }
    }

    const val = riskShares * tradeP + profitShares * spym + sgovShares * sgov;
    const benchmarkVal = bnhShares * sellP(tradeP);
    equityCurve.push({ date, value: val, benchmark: benchmarkVal });
  }

  // ── Final status snapshot event (for UI: current position info)
  const lastDate = equityCurve[equityCurve.length - 1]?.date;
  if (lastDate) {
    const lastP   = findPrice(actTradeBars, tradeDates, lastDate);
    const lastSgov = findPrice(parkingBars, parkDates, lastDate);
    const lastSpym = findPrice(profitBars || parkingBars, profitDates.length > 0 ? profitDates : parkDates, lastDate);

    if (inPosition && riskShares > 0) {
      const unrealizedGain = refPrice ? (lastP - refPrice) / refPrice : 0;
      events.push({
        date: lastDate,
        type: 'status-holding',
        price: lastP,
        amount: riskShares * lastP,
        gain: unrealizedGain,
        shares: riskShares,
      });
    }
    // SGOV 이자 계산 (보유중이든 아니든 SGOV 잔고가 있으면)
    if (sgovShares > 0) {
      const sgovVal     = sgovShares * lastSgov;
      const sgovInterest = Math.max(0, sgovVal - sgovCostBasis);
      events.push({
        date: lastDate,
        type: 'status-sgov',
        price: lastSgov,
        amount: sgovVal,
        interest: sgovInterest,
        costBasis: sgovCostBasis,
      });
    }
    if (profitShares > 0) {
      const spymVal      = profitShares * lastSpym;
      const spymInterest = Math.max(0, spymVal - spymCostBasis);
      events.push({
        date: lastDate,
        type: 'status-spym',
        price: lastSpym,
        amount: spymVal,
        interest: spymInterest,
        costBasis: spymCostBasis,
      });
    }
  }

  const values = equityCurve.map(e => e.value);
  const bnhValues = equityCurve.map(e => e.benchmark);
  const cagr = calcCAGR(totalContributed, values[values.length - 1], equityCurve[0]?.date, equityCurve[equityCurve.length - 1]?.date);
  const mdd = calcMDD(values);
  const totalReturn = (values[values.length - 1] / totalContributed) - 1;
  const bnhCagr = calcCAGR(totalContributed, bnhValues[bnhValues.length - 1], equityCurve[0]?.date, equityCurve[equityCurve.length - 1]?.date);
  const bnhMdd = calcMDD(bnhValues);
  const bnhTotalReturn = (bnhValues[bnhValues.length - 1] / totalContributed) - 1;

  return {
    equityCurve,
    events,
    metrics: {
      finalValue: values[values.length - 1],
      cagr,
      mdd,
      totalReturn,
      startDate: equityCurve[0]?.date,
      endDate: equityCurve[equityCurve.length - 1]?.date,
      totalContributed,
      currentYearContribution,
    },
    benchmarkMetrics: {
      finalValue: bnhValues[bnhValues.length - 1],
      cagr: bnhCagr,
      mdd: bnhMdd,
      totalReturn: bnhTotalReturn,
    }
  };
}

// ─── Snowball Strategy ────────────────────────────────────
export function runSnowballStrategy({
  tqqqBars,
  qqqBars,
  sgovBars,
  bilBars,
  settings,
  initialCapital = 100_000,
  feeRate = 0.0025,
  annualCashYield = 0.045,
}) {
  const {
    dip1Drawdown = -0.11,
    dip2Drawdown = -0.22,
    dip1Weight = 0.20,
    dip2Weight = 0.70,
    bonusWeight = 0.10,
    tp1Threshold = 0.37,
    tp2Threshold = 0.87,
    tp3Threshold = 3.55,
    tp1SellFractionOfBase = 0.53,
    tp2SellFractionOfBase = 0.47,
    gcShort = 5,
    gcLong = 220,
    cooldownDays = 5,
    qqqLookbackDays = 252,
    rsiPeriod = 14,
    rsiBonusThreshold = 35,
    startDate = '',
    endDate = '',
  } = settings;

  const buyP  = p => p * (1 + feeRate);
  const sellP = p => p * (1 - feeRate);

  // 1. Build indicator maps from FULL QQQ history (for proper warmup)
  const tqqqMap = new Map(tqqqBars.map(b => [b.date, b]));
  const qqqMap  = new Map(qqqBars.map(b => [b.date, b]));
  const sgovMap = new Map([...bilBars, ...sgovBars].map(b => [b.date, b]));

  // Indicators on full QQQ history (1999~)
  const qqqAllDates = qqqBars.map(b => b.date).sort();
  const qqqAllCloses = qqqAllDates.map(d => qqqMap.get(d)?.adjClose || null);

  const qqqRollingHighs = new Array(qqqAllDates.length).fill(null);
  for (let i = 0; i < qqqAllDates.length; i++) {
    const start = Math.max(0, i - qqqLookbackDays + 1);
    let max = -Infinity;
    for (let j = start; j <= i; j++) if (qqqAllCloses[j]) max = Math.max(max, qqqAllCloses[j]);
    qqqRollingHighs[i] = max > 0 ? max : null;
  }

  function calcRSI(arr, period) {
    const rsi = new Array(arr.length).fill(null);
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i <= period && i < arr.length; i++) {
      const d = (arr[i] || 0) - (arr[i - 1] || 0);
      if (d > 0) avgGain += d; else avgLoss += Math.abs(d);
    }
    avgGain /= period; avgLoss /= period;
    if (period < arr.length) rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    for (let i = period + 1; i < arr.length; i++) {
      const d = (arr[i] || 0) - (arr[i - 1] || 0);
      avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
      rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return rsi;
  }
  
  // 2. Simulation loop
  let cash = initialCapital;
  let tqqqShares = 0;
  let tqqqCost = 0;
  let tpBaseShares = 0;
  let inTrend = false;
  let hasGoldCrossSinceDeadCross = false;
  let tp3LockActive = false;
  let tp1Done = false, tp2Done = false;
  let dip1Consumed = false, dip2Consumed = false, bonusConsumed = false;
  let cooldownUntilIndex = -1;

  const dailyYield = Math.pow(1 + annualCashYield, 1/252) - 1;
  const tqqqDateSet = new Set(tqqqBars.map(b => b.date));
  const allDates = qqqAllDates.filter(d => tqqqDateSet.has(d));
  
  const allTqqqCloses = allDates.map(d => tqqqMap.get(d)?.adjClose || 0);
  const smaShort = calcSMA(allTqqqCloses, gcShort);
  const smaLong = calcSMA(allTqqqCloses, gcLong);
  const rsiArr = calcRSI(allTqqqCloses, rsiPeriod);
  const rollingHighMap = new Map(qqqAllDates.map((d, i) => [d, qqqRollingHighs[i]]));

  const equityCurve = [];
  const events = [];
  let bnhShares = 0;
  let hasInitialized = false;

  for (let i = 0; i < allDates.length; i++) {
    const date = allDates[i];
    const tPrice = allTqqqCloses[i];
    const qPrice = qqqMap.get(date)?.adjClose || 0;
    const rHigh = rollingHighMap.get(date) || 0;
    const rsiVal = rsiArr[i];

    if (startDate && date < startDate) continue;
    if (endDate && date > endDate) break;

    if (!hasInitialized && tPrice > 0) {
      bnhShares = initialCapital / buyP(tPrice);
      cash = initialCapital;
      hasInitialized = true;
    }
    if (!hasInitialized) continue;

    // Daily yield
    if (i > 0) cash *= (1 + dailyYield);

    const drawdown = rHigh > 0 ? qPrice / rHigh - 1 : 0;
    const inCooldown = i <= cooldownUntilIndex;
    const goldCross = i > 0 && smaShort[i-1] <= smaLong[i-1] && smaShort[i] > smaLong[i];
    const deadCross = i > 0 && smaShort[i-1] >= smaLong[i-1] && smaShort[i] < smaLong[i];
    const currentEquity = cash + tqqqShares * tPrice;

    if (qPrice >= rHigh * (1 - 1e-9)) {
      dip1Consumed = false; dip2Consumed = false; bonusConsumed = false;
    }

    // Helpers
    const executeBuy = (amt, reason) => {
      const actualBuy = Math.min(cash, amt);
      if (actualBuy < 1) return;
      const fillShares = actualBuy / buyP(tPrice);
      tqqqShares += fillShares;
      tqqqCost += actualBuy;
      cash -= actualBuy;
      // ONLY set tpBaseShares if it was 0 (start of accumulation or trend)
      if (tpBaseShares === 0) tpBaseShares = tqqqShares;
      events.push({ date, type: reason, price: tPrice, amount: actualBuy });
    };

    const executeSell = (qty, reason) => {
      const actualSell = Math.min(tqqqShares, qty);
      if (actualSell < 0.0001) return;
      const avgCost = tqqqCost / tqqqShares;
      const amt = actualSell * sellP(tPrice);
      const profit = actualSell * (sellP(tPrice) - avgCost);
      tqqqShares -= actualSell;
      tqqqCost = Math.max(0, tqqqCost * (tqqqShares / (tqqqShares + actualSell)));
      cash += amt;
      events.push({ date, type: reason, price: tPrice, amount: amt, profit });
    };

    // 1. Dead Cross / TP3 checks.
    if (tqqqShares > 0 && deadCross) {
      const amt = tqqqShares * sellP(tPrice);
      const profit = amt - tqqqCost;
      cash += amt;
      events.push({ date, type: 'dc-exit', price: tPrice, amount: amt, profit });
      tqqqShares = 0; tqqqCost = 0;
      cooldownUntilIndex = i + cooldownDays;
      tp3LockActive = false;
      hasGoldCrossSinceDeadCross = false;
      dip1Consumed = false; dip2Consumed = false; bonusConsumed = false;
    }
    if (tqqqShares > 0 && !tp3LockActive) {
      const avgCost = tqqqCost / tqqqShares;
      if (tPrice >= avgCost * (1 + tp3Threshold)) {
        const amt = tqqqShares * sellP(tPrice);
        const profit = amt - tqqqCost;
        cash += amt;
        events.push({ date, type: 'tp3', price: tPrice, amount: amt, profit });
        tqqqShares = 0; tqqqCost = 0;
        tp3LockActive = true;
        dip1Consumed = false; dip2Consumed = false; bonusConsumed = false;
      }
    }

    // 2. Profit Taking
    if (tqqqShares > 0) {
      const avgCost = tqqqCost / tqqqShares;
      const gain = (tPrice - avgCost) / avgCost;
      if (!tp1Done && gain >= tp1Threshold) {
        executeSell(tpBaseShares * tp1SellFractionOfBase, 'tp1');
        tp1Done = true;
      }
      if (tp1Done && !tp2Done && gain >= tp2Threshold) {
        executeSell(tpBaseShares * tp2SellFractionOfBase, 'tp2');
        tp2Done = true;
      }
    }

    // 3. DIP Accumulation
    if (!inCooldown && drawdown !== null && !(hasGoldCrossSinceDeadCross && tqqqShares > 0)) {
      const currentWeight = currentEquity > 0 ? (tqqqShares * tPrice) / currentEquity : 0;
      if (drawdown <= dip1Drawdown && !dip1Consumed) {
        if (currentWeight < dip1Weight && cash > 0) executeBuy(currentEquity * dip1Weight - (tqqqShares * tPrice), 'dip1');
        dip1Consumed = true;
      }
      if (!tp3LockActive && drawdown <= dip2Drawdown && !dip2Consumed) {
        if (currentWeight < dip2Weight && cash > 0) executeBuy(currentEquity * dip2Weight - (tqqqShares * tPrice), 'dip2');
        dip2Consumed = true;
      }
      if (!tp3LockActive && drawdown <= dip1Drawdown && rsiVal !== null && rsiVal <= rsiBonusThreshold && !bonusConsumed) {
        executeBuy(currentEquity * bonusWeight, 'bonus');
        bonusConsumed = true;
      }
    }

    // 4. Gold Cross Entry
    if (goldCross && cash > 0 && !tp3LockActive && !hasGoldCrossSinceDeadCross && !inCooldown) {
      executeBuy(cash, 'gc-entry');
      hasGoldCrossSinceDeadCross = true;
    }

    const val = cash + tqqqShares * tPrice;
    const bnhVal = bnhShares * tPrice;
    equityCurve.push({ date, value: val, benchmark: bnhVal });
  }

  const values = equityCurve.map(p => p.value);
  const bnhValues = equityCurve.map(p => p.benchmark);
  const totalReturn = values[values.length - 1] / initialCapital - 1;
  const bnhTotalReturn = bnhValues[bnhValues.length - 1] / initialCapital - 1;
  const cagr = calcCAGR(initialCapital, values[values.length - 1], equityCurve[0].date, equityCurve[equityCurve.length - 1].date);
  const bnhCagr = calcCAGR(initialCapital, bnhValues[bnhValues.length - 1], equityCurve[0].date, equityCurve[equityCurve.length - 1].date);
  const mdd = calcMDD(values);
  const bnhMdd = calcMDD(bnhValues);

  if (events.length > 0) {
    const lastDate = allDates[allDates.length - 1];
    const lastTqqq = allTqqqCloses[allTqqqCloses.length - 1];
    const currentVal = values[values.length - 1];
    const unrealizedGain = tqqqShares > 0 ? (tqqqShares * lastTqqq - tqqqCost) : 0;

    if (tqqqShares > 0) {
      events.push({
        date: lastDate,
        type: 'status-holding',
        price: lastTqqq,
        amount: currentVal,
        profit: unrealizedGain,
        costBasis: tqqqCost,
        shares: tqqqShares,
      });
    }
  }

  return {
    equityCurve,
    events,
    metrics: {
      finalValue: values[values.length - 1],
      cagr,
      mdd,
      totalReturn,
      startDate: equityCurve[0]?.date,
      endDate: equityCurve[equityCurve.length - 1]?.date,
    },
    benchmarkMetrics: {
      finalValue: bnhValues[bnhValues.length - 1],
      cagr: bnhCagr,
      mdd: bnhMdd,
      totalReturn: bnhTotalReturn,
    }
  };
}
