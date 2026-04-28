#!/usr/bin/env node

import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const DEFAULTS = {
  dataDir: "data",
  startDate: "2000-01-01",
  endDate: new Date().toISOString().slice(0, 10)
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36";

const US_SERIES = [
  { id: "tqqq", yahooSymbol: "TQQQ", output: "us/tqqq.csv" },
  { id: "qld", yahooSymbol: "QLD", output: "us/qld.csv" },
  { id: "bulz", yahooSymbol: "BULZ", output: "us/bulz.csv" },
  { id: "spym", yahooSymbol: "SPYM", output: "us/spym.csv" },
  { id: "sgov", yahooSymbol: "SGOV", output: "us/sgov.csv" },
  { id: "bil", yahooSymbol: "BIL", output: "us/bil.csv" },
  { id: "qqq", yahooSymbol: "QQQ", output: "us/qqq.csv" }
];

const KR_SERIES = [
  {
    id: "tiger-nasdaq100-lev",
    shortCode: "418660",
    output: "kr/tiger_us_nasdaq100_lev.csv"
  },
  {
    id: "ace-bigtech-top7-plus-lev",
    shortCode: "465610",
    output: "kr/ace_us_bigtech_top7_plus_lev.csv"
  },
  {
    id: "tiger-sp500",
    shortCode: "360750",
    output: "kr/tiger_us_sp500.csv"
  }
];

function parseArgs(argv) {
  const positional = [];
  const options = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }

    const [rawKey, inlineValue] = token.split("=", 2);
    const key = rawKey.slice(2);

    if (inlineValue !== undefined) {
      options[key] = inlineValue;
      continue;
    }

    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }

    options[key] = next;
    i += 1;
  }

  return { positional, options };
}

function printHelp() {
  console.log(`Usage
  node src/fetch-data.js all [options]
  node src/fetch-data.js us [options]
  node src/fetch-data.js kr [options]
  node src/fetch-data.js fx [options]

Options
  --data-dir <path>   Data directory (default: ./data)
  --start <date>      Start date (default: 2000-01-01)
  --end <date>        End date (default: today)
  --help              Show help
`);
}

function splitCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }
    current += ch;
  }

  cells.push(current);
  return cells;
}

function formatRow(row) {
  return [
    row.date,
    row.open,
    row.high,
    row.low,
    row.close,
    row.adjClose,
    row.volume
  ].join(",");
}

async function writePriceCsv(baseDir, relativePath, rows) {
  const fullPath = path.join(baseDir, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  const header = "Date,Open,High,Low,Close,Adj Close,Volume";
  const body = rows.map(formatRow);
  await writeFile(fullPath, `${[header, ...body].join("\n")}\n`, "utf8");
  return fullPath;
}

async function fetchText(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "user-agent": USER_AGENT,
      accept: "*/*",
      ...(init.headers || {})
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText} / ${url}`);
  }

  return response.text();
}

async function fetchJson(url, init = {}) {
  const text = await fetchText(url, init);
  return JSON.parse(text);
}

function parseNumber(raw) {
  const value = String(raw ?? "").trim().replace(/,/g, "");
  if (!value || value === "." || value === "-") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toUnixSeconds(date, endOfDay = false) {
  const suffix = endOfDay ? "T23:59:59Z" : "T00:00:00Z";
  return Math.floor(new Date(`${date}${suffix}`).getTime() / 1000);
}

async function fetchUsSeries(item, startDate, endDate) {
  const period1 = toUnixSeconds(startDate, false);
  const period2 = toUnixSeconds(endDate, true);
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(item.yahooSymbol)}` +
    `?period1=${period1}&period2=${period2}&interval=1d&includeAdjustedClose=true&events=div%2Csplits`;
  const payload = await fetchJson(url);
  const result = payload?.chart?.result?.[0];

  if (!result || payload?.chart?.error) {
    throw new Error(`${item.id}: Yahoo chart response is empty or invalid.`);
  }

  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const adjCloseSeries = result.indicators?.adjclose?.[0]?.adjclose || [];
  const rows = [];

  for (let i = 0; i < timestamps.length; i += 1) {
    const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
    if (date < startDate || date > endDate) {
      continue;
    }

    const closeValue = parseNumber(quote.close?.[i]);
    if (closeValue === null) {
      continue;
    }

    rows.push({
      date,
      open: parseNumber(quote.open?.[i]) ?? closeValue,
      high: parseNumber(quote.high?.[i]) ?? closeValue,
      low: parseNumber(quote.low?.[i]) ?? closeValue,
      close: closeValue,
      adjClose: parseNumber(adjCloseSeries[i]) ?? closeValue,
      volume: parseNumber(quote.volume?.[i]) ?? 0
    });
  }

  if (rows.length === 0) {
    throw new Error(`${item.id}: no price rows returned from Yahoo chart API.`);
  }

  return rows;
}

async function fetchFxSeries(startDate, endDate) {
  const period1 = toUnixSeconds(startDate, false);
  const period2 = toUnixSeconds(endDate, true);
  const url =
    "https://query1.finance.yahoo.com/v8/finance/chart/KRW%3DX" +
    `?period1=${period1}&period2=${period2}&interval=1d&includeAdjustedClose=true`;
  const payload = await fetchJson(url);
  const result = payload?.chart?.result?.[0];

  if (!result || payload?.chart?.error) {
    throw new Error("USDKRW: Yahoo chart response is empty or invalid.");
  }

  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const adjCloseSeries = result.indicators?.adjclose?.[0]?.adjclose || [];
  const rows = [];

  for (let i = 0; i < timestamps.length; i += 1) {
    const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
    if (date < startDate || date > endDate) {
      continue;
    }

    const closeValue = parseNumber(quote.close?.[i]);
    if (closeValue === null) {
      continue;
    }

    rows.push({
      date,
      open: parseNumber(quote.open?.[i]) ?? closeValue,
      high: parseNumber(quote.high?.[i]) ?? closeValue,
      low: parseNumber(quote.low?.[i]) ?? closeValue,
      close: closeValue,
      adjClose: parseNumber(adjCloseSeries[i]) ?? closeValue,
      volume: 0
    });
  }

  if (rows.length === 0) {
    throw new Error("USDKRW: no rows returned from Yahoo chart API.");
  }

  return rows;
}

async function fetchKrxSeries(item, startDate, endDate) {
  const url = `https://fchart.stock.naver.com/sise.nhn?symbol=${encodeURIComponent(
    item.shortCode
  )}&timeframe=day&count=6000&requestType=0`;
  const xmlText = await fetchText(url, {
    headers: {
      referer: "https://finance.naver.com/"
    }
  });

  const matches = [...xmlText.matchAll(/<item\s+data="([^"]+)"/g)];
  if (matches.length === 0) {
    throw new Error(`${item.id}: empty Naver chart response.`);
  }

  const rows = [];
  for (const match of matches) {
    const cells = match[1].split("|");
    const digits = String(cells[0] || "").replace(/[^\d]/g, "");
    if (digits.length !== 8) {
      continue;
    }

    const date = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
    if (date < startDate || date > endDate) {
      continue;
    }

    const close = parseNumber(cells[4]);
    if (close === null) {
      continue;
    }

    rows.push({
      date,
      open: parseNumber(cells[1]) ?? close,
      high: parseNumber(cells[2]) ?? close,
      low: parseNumber(cells[3]) ?? close,
      close,
      adjClose: close,
      volume: parseNumber(cells[5]) ?? 0
    });
  }

  if (rows.length === 0) {
    throw new Error(`${item.id}: no rows returned from Naver chart API.`);
  }

  rows.sort((left, right) => left.date.localeCompare(right.date));
  return rows;
}

async function downloadUs(baseDir, startDate, endDate) {
  for (const item of US_SERIES) {
    const rows = await fetchUsSeries(item, startDate, endDate);
    const saved = await writePriceCsv(baseDir, item.output, rows);
    console.log(`Saved: ${saved} (${rows.length} rows)`);
  }
}

async function downloadFx(baseDir, startDate, endDate) {
  const rows = await fetchFxSeries(startDate, endDate);
  const saved = await writePriceCsv(baseDir, "fx/usdkrw.csv", rows);
  console.log(`Saved: ${saved} (${rows.length} rows)`);
}

async function downloadKr(baseDir, startDate, endDate) {
  for (const item of KR_SERIES) {
    const rows = await fetchKrxSeries(item, startDate, endDate);
    const saved = await writePriceCsv(baseDir, item.output, rows);
    console.log(`Saved: ${saved} (${rows.length} rows)`);
  }
}

async function main() {
  const cwd = process.cwd();
  const { positional, options } = parseArgs(process.argv.slice(2));

  if (options.help || positional.length === 0) {
    printHelp();
    return;
  }

  const target = positional[0];
  const startDate = options.start || DEFAULTS.startDate;
  const endDate = options.end || DEFAULTS.endDate;
  const dataDir = path.resolve(cwd, options["data-dir"] || DEFAULTS.dataDir);

  if (!["all", "us", "kr", "fx"].includes(target)) {
    throw new Error(`Unsupported target: ${target}`);
  }

  if (target === "all" || target === "us") {
    await downloadUs(dataDir, startDate, endDate);
  }
  if (target === "all" || target === "fx") {
    await downloadFx(dataDir, startDate, endDate);
  }
  if (target === "all" || target === "kr") {
    await downloadKr(dataDir, startDate, endDate);
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
