import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import yahooFinance from 'yahoo-finance2';

function parseCsvRows(raw) {
  const parsed = Papa.parse(raw, { header: true, skipEmptyLines: true });

  return parsed.data
    .map((row) => {
      const close = parseFloat(row.Close || row.close || 0);
      const adjClose = parseFloat(row['Adj Close'] || row.adjClose || row.Close || row.close || 0);
      const open = parseFloat(row.Open || row.open || close);
      const high = parseFloat(row.High || row.high || Math.max(open, close));
      const low = parseFloat(row.Low || row.low || Math.min(open, close));
      const factor = close === 0 ? 1 : adjClose / close;

      return {
        date: row.Date || row.date,
        open,
        high,
        low,
        close,
        adjClose,
        adjOpen: open * factor,
        adjHigh: high * factor,
        adjLow: low * factor,
      };
    })
    .filter((row) => !isNaN(row.adjClose) && row.adjClose > 0);
}

function resolveLocalCandidates(filename) {
  return [
    path.join(/* turbopackIgnore: true */ process.cwd(), 'public', 'data', filename),
    path.join(/* turbopackIgnore: true */ process.cwd(), '..', 'data', filename),
  ];
}

export function loadCSV(filename) {
  for (const filepath of resolveLocalCandidates(filename)) {
    if (!fs.existsSync(filepath)) continue;
    return parseCsvRows(fs.readFileSync(filepath, 'utf-8'));
  }

  return [];
}

async function loadCsvFromStaticAsset(filename, baseUrl) {
  if (!baseUrl) return [];

  const assetUrl = new URL(`/data/${filename}`, baseUrl).toString();
  const response = await fetch(assetUrl);
  if (!response.ok) return [];

  return parseCsvRows(await response.text());
}

export async function loadAndSyncData(symbol, options = {}) {
  const normalized = `${symbol}`.toLowerCase();
  const baseData = options.baseUrl
    ? await loadCsvFromStaticAsset(`us/${normalized}.csv`, options.baseUrl)
    : loadCSV(`us/${normalized}.csv`);

  const today = new Date().toISOString().split('T')[0];
  let lastDate = '2000-01-01';
  if (baseData.length > 0) {
    lastDate = baseData[baseData.length - 1].date;
  }

  if (lastDate >= today) {
    return baseData;
  }

  try {
    const YFClass = yahooFinance.default || yahooFinance;
    const yf = new YFClass();
    const historical = await yf.historical(symbol.toUpperCase(), {
      period1: lastDate,
      period2: new Date()
    });

    if (historical && historical.length > 0) {
      const dataMap = new Map(baseData.map((bar) => [bar.date, bar]));

      for (const row of historical) {
        const date = row.date.toISOString().split('T')[0];
        const close = row.close;
        const adjClose = row.adjClose || row.close;
        const open = row.open || close;
        const high = row.high || Math.max(open, close);
        const low = row.low || Math.min(open, close);
        const factor = close === 0 ? 1 : adjClose / close;

        if (adjClose > 0) {
          dataMap.set(date, { 
            date, 
            open, high, low, close, adjClose,
            adjOpen: open * factor,
            adjHigh: high * factor,
            adjLow: low * factor
          });
        }
      }

      return Array.from(dataMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    }
  } catch (err) {
    console.error(`[Data Sync Error] Failed to fetch live data for ${symbol}:`, err.message);
  }

  return baseData;
}
