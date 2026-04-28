import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import yahooFinance from 'yahoo-finance2';

// ─── Original Sync Loader (kept for fallback) ────────
export function loadCSV(filename) {
  const filepath = path.join(process.cwd(), '..', 'data', filename);
  if (!fs.existsSync(filepath)) return [];

  const raw = fs.readFileSync(filepath, 'utf-8');
  const parsed = Papa.parse(raw, { header: true, skipEmptyLines: true });

  return parsed.data.map(row => ({
    date: row.Date || row.date,
    adjClose: parseFloat(row['Adj Close'] || row.adjClose || row.Close || row.close || 0),
  })).filter(r => !isNaN(r.adjClose) && r.adjClose > 0);
}

// ─── Async Loader with Live Yahoo Finance Sync ───────
export async function loadAndSyncData(symbol) {
  // Load local CSV as base
  const baseData = loadCSV(`us/${symbol}.csv`);
  
  const today = new Date().toISOString().split('T')[0];
  let lastDate = '2000-01-01';
  if (baseData.length > 0) {
    lastDate = baseData[baseData.length - 1].date;
  }

  // If local data is already up to today, just return it
  if (lastDate >= today) {
    return baseData;
  }

  // Otherwise, fetch recent data from Yahoo Finance
  try {
    const YFClass = yahooFinance.default || yahooFinance;
    const yf = new YFClass();
    const historical = await yf.historical(symbol.toUpperCase(), {
      period1: lastDate,
      period2: new Date() // up to current time
    });

    if (historical && historical.length > 0) {
      // Merge by date to avoid duplicates
      const dataMap = new Map(baseData.map(b => [b.date, b]));
      
      for (const h of historical) {
        // h.date is a Date object in yahoo-finance2
        const d = h.date.toISOString().split('T')[0];
        // Use adjClose if available, otherwise close
        const ac = h.adjClose || h.close;
        if (ac > 0) {
          dataMap.set(d, { date: d, adjClose: ac });
        }
      }
      
      // Sort chronologically and return
      return Array.from(dataMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    }
  } catch (err) {
    console.error(`[Data Sync Error] Failed to fetch live data for ${symbol}:`, err.message);
  }

  // If fetch fails, fallback to base data
  return baseData;
}
