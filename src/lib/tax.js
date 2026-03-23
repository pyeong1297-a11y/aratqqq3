export const US_FOREIGN_BASIC_DEDUCTION_KRW = 2_500_000;
export const US_FOREIGN_TAX_RATE = 0.22;
export const ISA_BASIC_DEDUCTION_KRW = 4_000_000;
export const ISA_TAX_RATE = 0.099;

export function createAverageCostTracker(initialShares = 0, initialCost = 0) {
  return {
    shares: initialShares,
    totalCost: initialCost
  };
}

export function buyIntoTracker(tracker, shares, totalCost) {
  if (shares <= 0 || totalCost <= 0) {
    return;
  }

  tracker.shares += shares;
  tracker.totalCost += totalCost;
}

export function sellFromTracker(tracker, shares, netProceeds) {
  if (shares <= 0 || tracker.shares <= 0) {
    return { realizedGain: 0, costBasis: 0 };
  }

  const avgCost = tracker.totalCost / tracker.shares;
  const costBasis = avgCost * shares;
  tracker.shares -= shares;
  tracker.totalCost -= costBasis;

  if (tracker.shares < 1e-12) {
    tracker.shares = 0;
    tracker.totalCost = 0;
  }

  return {
    realizedGain: netProceeds - costBasis,
    costBasis
  };
}

export function reduceTrackerByValue(tracker, removedShares) {
  if (removedShares <= 0 || tracker.shares <= 0) {
    return;
  }

  const ratio = Math.min(1, removedShares / tracker.shares);
  tracker.totalCost *= 1 - ratio;
  tracker.shares *= 1 - ratio;

  if (tracker.shares < 1e-12) {
    tracker.shares = 0;
    tracker.totalCost = 0;
  }
}

export function computeUsAnnualTax(realizedNetGainKrw) {
  return Math.max(0, realizedNetGainKrw - US_FOREIGN_BASIC_DEDUCTION_KRW) * US_FOREIGN_TAX_RATE;
}

export function computeIsaExitTax(endingValue, principal) {
  return Math.max(0, endingValue - principal - ISA_BASIC_DEDUCTION_KRW) * ISA_TAX_RATE;
}
