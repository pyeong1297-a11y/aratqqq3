import yahooFinance from 'yahoo-finance2';

const QUOTE_FIELDS = [
  'symbol',
  'marketState',
  'quoteSourceName',
  'regularMarketPrice',
  'regularMarketChangePercent',
  'regularMarketTime',
  'regularMarketPreviousClose',
  'preMarketPrice',
  'preMarketChangePercent',
  'preMarketTime',
  'postMarketPrice',
  'postMarketChangePercent',
  'postMarketTime',
  'extendedMarketPrice',
  'extendedMarketChangePercent',
  'extendedMarketTime',
];

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function dateToIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function percentPointsToRatio(value) {
  return Number.isFinite(value) ? value / 100 : null;
}

function pickSessionQuote(quote) {
  const state = quote.marketState || 'CLOSED';

  if (state.startsWith('PRE') && Number.isFinite(quote.preMarketPrice)) {
    return {
      session: 'PRE',
      label: '프리장',
      price: quote.preMarketPrice,
      changePercent: percentPointsToRatio(quote.preMarketChangePercent),
      time: dateToIso(quote.preMarketTime),
    };
  }

  if (state === 'REGULAR' && Number.isFinite(quote.regularMarketPrice)) {
    return {
      session: 'REGULAR',
      label: '장중',
      price: quote.regularMarketPrice,
      changePercent: percentPointsToRatio(quote.regularMarketChangePercent),
      time: dateToIso(quote.regularMarketTime),
    };
  }

  if (state.startsWith('POST') && Number.isFinite(quote.postMarketPrice)) {
    return {
      session: 'POST',
      label: '애프터',
      price: quote.postMarketPrice,
      changePercent: percentPointsToRatio(quote.postMarketChangePercent),
      time: dateToIso(quote.postMarketTime),
    };
  }

  return {
    session: state,
    label: '종가',
    price: finiteOrNull(quote.regularMarketPrice),
    changePercent: percentPointsToRatio(quote.regularMarketChangePercent),
    time: dateToIso(quote.regularMarketTime),
  };
}

function normalizeQuote(quote) {
  if (!quote?.symbol) return null;
  const sessionQuote = pickSessionQuote(quote);
  if (!Number.isFinite(sessionQuote.price)) return null;

  return {
    symbol: quote.symbol,
    marketState: quote.marketState || null,
    quoteSourceName: quote.quoteSourceName || null,
    regularMarketPrice: finiteOrNull(quote.regularMarketPrice),
    regularMarketPreviousClose: finiteOrNull(quote.regularMarketPreviousClose),
    ...sessionQuote,
  };
}

export async function loadLiveQuotes(symbols) {
  try {
    const normalizedSymbols = symbols.map((symbol) => `${symbol}`.toUpperCase());
    const YFClass = yahooFinance.default || yahooFinance;
    const yf = new YFClass({ suppressNotices: ['yahooSurvey'] });
    const quotes = await yf.quote(normalizedSymbols, {
      return: 'object',
      fields: QUOTE_FIELDS,
    });

    return Object.fromEntries(
      normalizedSymbols
        .map((symbol) => [symbol.toLowerCase(), normalizeQuote(quotes[symbol])])
        .filter(([, quote]) => quote)
    );
  } catch (err) {
    console.error('[live-quotes]', err.message);
    return {};
  }
}
