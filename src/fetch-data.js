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
  { id: "tqqq", sourceSymbol: "tqqq.us", output: "us/tqqq.csv" },
  { id: "bulz", sourceSymbol: "bulz.us", output: "us/bulz.csv" },
  { id: "spym", sourceSymbol: "spym.us", output: "us/spym.csv" },
  { id: "sgov", sourceSymbol: "sgov.us", output: "us/sgov.csv" },
  { id: "qqq", sourceSymbol: "qqq.us", output: "us/qqq.csv" },
  { id: "qld", sourceSymbol: "qld.us", output: "us/qld.csv" }
];

const KR_SERIES = [
  {
    id: "kodex",
    shortCode: "409820",
    isuCd: "KR7409820008",
    name: "KODEX 미국나스닥100레버리지(합성 H)",
    output: "kr/kodex_nasdaq100_lev_h.csv"
  },
  {
    id: "tiger-sp500",
    shortCode: "360750",
    isuCd: "KR7360750004",
    name: "TIGER 미국S&P500",
    output: "kr/tiger_us_sp500.csv"
  },
  {
    id: "tiger-nasdaq100",
    shortCode: "133690",
    isuCd: "KR7133690008",
    name: "TIGER 미국나스닥100",
    output: "kr/tiger_us_nasdaq100.csv"
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
  console.log(`사용법

  node src/fetch-data.js all [options]
  node src/fetch-data.js us [options]
  node src/fetch-data.js kr [options]
  node src/fetch-data.js fx [options]

옵션

  --data-dir <path>   저장 폴더 (기본값: ./data)
  --start <date>      시작일 (기본값: 2000-01-01)
  --end <date>        종료일 (기본값: 오늘)
  --help              도움말 출력
`);
}

function compactDate(isoDate) {
  return String(isoDate).replace(/-/g, "");
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
    throw new Error(`요청 실패: ${response.status} ${response.statusText} / ${url}`);
  }

  return response.text();
}

async function fetchJson(url, init = {}) {
  const text = await fetchText(url, init);
  return JSON.parse(text);
}

function parseNumber(raw) {
  const value = String(raw || "").trim().replace(/,/g, "");
  if (!value || value === "." || value === "-") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchUsSeries(item, startDate) {
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(item.sourceSymbol)}&i=d`;
  const text = await fetchText(url);
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error(`${item.id}: 응답이 비어 있습니다.`);
  }

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const [date, open, high, low, close, volume] = splitCsvLine(lines[i]);
    if (!date || date < startDate) {
      continue;
    }

    const closeValue = parseNumber(close);
    if (closeValue === null) {
      continue;
    }

    rows.push({
      date,
      open: parseNumber(open) ?? closeValue,
      high: parseNumber(high) ?? closeValue,
      low: parseNumber(low) ?? closeValue,
      close: closeValue,
      adjClose: closeValue,
      volume: parseNumber(volume) ?? 0
    });
  }

  if (rows.length === 0) {
    throw new Error(`${item.id}: 내려받은 데이터가 없습니다.`);
  }

  return rows;
}

async function fetchFxSeries(startDate, endDate) {
  const url = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DEXKOUS";
  const text = await fetchText(url);
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error("USDKRW: 응답이 비어 있습니다.");
  }

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const [date, close] = splitCsvLine(lines[i]);
    if (!date || date < startDate || date > endDate) {
      continue;
    }

    const closeValue = parseNumber(close);
    if (closeValue === null) {
      continue;
    }

    rows.push({
      date,
      open: closeValue,
      high: closeValue,
      low: closeValue,
      close: closeValue,
      adjClose: closeValue,
      volume: 0
    });
  }

  if (rows.length === 0) {
    throw new Error("USDKRW: 내려받은 데이터가 없습니다.");
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
    throw new Error(`${item.id}: 네이버 일봉 데이터가 비어 있습니다.`);
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
    throw new Error(`${item.id}: 네이버 일봉 필터 결과가 비어 있습니다.`);
  }

  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

async function downloadUs(baseDir, startDate) {
  for (const item of US_SERIES) {
    const rows = await fetchUsSeries(item, startDate);
    const saved = await writePriceCsv(baseDir, item.output, rows);
    console.log(`저장 완료: ${saved} (${rows.length}행)`);
  }
}

async function downloadFx(baseDir, startDate, endDate) {
  const rows = await fetchFxSeries(startDate, endDate);
  const saved = await writePriceCsv(baseDir, "fx/usdkrw.csv", rows);
  console.log(`저장 완료: ${saved} (${rows.length}행)`);
}

async function downloadKr(baseDir, startDate, endDate) {
  for (const item of KR_SERIES) {
    const rows = await fetchKrxSeries(item, startDate, endDate);
    const saved = await writePriceCsv(baseDir, item.output, rows);
    console.log(`저장 완료: ${saved} (${rows.length}행)`);
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
    throw new Error(`지원하지 않는 대상입니다: ${target}`);
  }

  if (target === "all" || target === "us") {
    await downloadUs(dataDir, startDate);
  }
  if (target === "all" || target === "fx") {
    await downloadFx(dataDir, startDate, endDate);
  }
  if (target === "all" || target === "kr") {
    await downloadKr(dataDir, startDate, endDate);
  }
}

main().catch((error) => {
  console.error(`오류: ${error.message}`);
  process.exitCode = 1;
});
