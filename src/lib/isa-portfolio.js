import { buyWithCash, positionValue, sellShares } from "./portfolio.js";
import { resolveKodexTradePrice } from "./isa-helpers.js";

export function createIsaAccount(id, openedDate, phase) {
  return {
    id,
    openedDate,
    phase,
    principal: 0,
    cashShares: 0,
    kodexShares: 0,
    sp500Shares: 0
  };
}

export function isIsaInRisk(account) {
  return account.kodexShares > 0 || account.sp500Shares > 0;
}

export function getIsaAccountValue(account, row) {
  return (
    positionValue(account.kodexShares, row.kodex.adjClose) +
    positionValue(account.sp500Shares, row.sp500.adjClose) +
    positionValue(account.cashShares, row.cash.adjClose)
  );
}

function resolveSp500TradePrice(row, tradeSide, scenario) {
  const basePrice = row.sp500.adjOpen;
  return tradeSide === "buy"
    ? basePrice * (1 + scenario.slipRate)
    : basePrice * (1 - scenario.slipRate);
}

export function liquidateIsaAccount({
  account,
  row,
  prevKodexBar,
  qqqReturn,
  scenario,
  feeRate
}) {
  let proceeds = 0;
  let kodexTradePrice = null;

  if (account.kodexShares > 0) {
    kodexTradePrice = resolveKodexTradePrice({
      mode: scenario.mode,
      tradeSide: "sell",
      kodexBar: row.kodex,
      prevKodexBar,
      qqqReturn,
      slipRate: scenario.slipRate
    });
    const sale = sellShares(account.kodexShares, kodexTradePrice, feeRate, 0);
    proceeds += sale.proceeds;
    account.kodexShares = 0;
  }

  if (account.sp500Shares > 0) {
    const sp500TradePrice = resolveSp500TradePrice(row, "sell", scenario);
    const sale = sellShares(account.sp500Shares, sp500TradePrice, feeRate, 0);
    proceeds += sale.proceeds;
    account.sp500Shares = 0;
  }

  if (account.cashShares > 0) {
    const sale = sellShares(account.cashShares, row.cash.adjOpen, feeRate, 0);
    proceeds += sale.proceeds;
    account.cashShares = 0;
  }

  return { proceeds, kodexTradePrice };
}

export function enterIsaRiskPosition({
  account,
  row,
  prevKodexBar,
  qqqReturn,
  scenario,
  feeRate
}) {
  if (account.cashShares <= 0) {
    return null;
  }

  const cashSale = sellShares(account.cashShares, row.cash.adjOpen, feeRate, 0);
  const tradePrice = resolveKodexTradePrice({
    mode: scenario.mode,
    tradeSide: "buy",
    kodexBar: row.kodex,
    prevKodexBar,
    qqqReturn,
    slipRate: scenario.slipRate
  });
  const buy = buyWithCash(cashSale.proceeds, tradePrice, feeRate, 0);

  account.cashShares = 0;
  account.kodexShares = buy.shares;

  return {
    tradePrice,
    shares: buy.shares
  };
}

export function exitIsaRiskPosition({
  account,
  row,
  prevKodexBar,
  qqqReturn,
  scenario,
  feeRate
}) {
  if (account.kodexShares <= 0 && account.sp500Shares <= 0) {
    return null;
  }

  let proceeds = 0;
  let tradePrice = null;
  let sp500TradePrice = null;

  if (account.kodexShares > 0) {
    tradePrice = resolveKodexTradePrice({
      mode: scenario.mode,
      tradeSide: "sell",
      kodexBar: row.kodex,
      prevKodexBar,
      qqqReturn,
      slipRate: scenario.slipRate
    });
    const sale = sellShares(account.kodexShares, tradePrice, feeRate, 0);
    proceeds += sale.proceeds;
  }

  if (account.sp500Shares > 0) {
    sp500TradePrice = resolveSp500TradePrice(row, "sell", scenario);
    const sale = sellShares(account.sp500Shares, sp500TradePrice, feeRate, 0);
    proceeds += sale.proceeds;
  }

  const cashBuy = buyWithCash(proceeds, row.cash.adjOpen, feeRate, 0);

  account.kodexShares = 0;
  account.sp500Shares = 0;
  account.cashShares = cashBuy.shares;

  return {
    tradePrice,
    sp500TradePrice,
    cashShares: cashBuy.shares
  };
}

export function applyIsaContribution({
  account,
  amount,
  allocationTarget,
  row,
  prevKodexBar,
  qqqReturn,
  scenario,
  feeRate
}) {
  account.principal += amount;

  if (allocationTarget === "kodex") {
    const tradePrice = resolveKodexTradePrice({
      mode: scenario.mode,
      tradeSide: "buy",
      kodexBar: row.kodex,
      prevKodexBar,
      qqqReturn,
      slipRate: scenario.slipRate
    });
    const buy = buyWithCash(amount, tradePrice, feeRate, 0);
    account.kodexShares += buy.shares;

    return {
      allocation: "kodex",
      tradePrice,
      shares: buy.shares,
      endValue: positionValue(buy.shares, row.kodex.adjClose)
    };
  }

  if (allocationTarget === "sp500") {
    const tradePrice = resolveSp500TradePrice(row, "buy", scenario);
    const buy = buyWithCash(amount, tradePrice, feeRate, 0);
    account.sp500Shares += buy.shares;

    return {
      allocation: "sp500",
      tradePrice,
      shares: buy.shares,
      endValue: positionValue(buy.shares, row.sp500.adjClose)
    };
  }

  const shares = amount / row.cash.adjOpen;
  account.cashShares += shares;

  return {
    allocation: "cash",
    tradePrice: row.cash.adjOpen,
    shares,
    endValue: positionValue(shares, row.cash.adjClose)
  };
}
