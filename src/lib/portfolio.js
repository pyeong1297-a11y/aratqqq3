export function buyWithCash(cash, price, feeRate, slippageRate) {
  if (cash <= 0 || price <= 0) {
    return { shares: 0, fillPrice: price, feePaid: 0 };
  }

  const fillPrice = price * (1 + slippageRate);
  const costPerShare = fillPrice * (1 + feeRate);
  const shares = cash / costPerShare;
  const feePaid = shares * fillPrice * feeRate;

  return { shares, fillPrice, feePaid };
}

export function sellShares(shares, price, feeRate, slippageRate) {
  if (shares <= 0 || price <= 0) {
    return { proceeds: 0, fillPrice: price, feePaid: 0 };
  }

  const fillPrice = price * (1 - slippageRate);
  const gross = shares * fillPrice;
  const feePaid = gross * feeRate;
  const proceeds = gross - feePaid;

  return { proceeds, fillPrice, feePaid };
}

export function positionValue(shares, price) {
  return shares * price;
}
