function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_.()-]/g, "");
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

function parseDateCell(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return raw.slice(0, 10);
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`날짜 해석 실패: ${raw}`);
  }

  return parsed.toISOString().slice(0, 10);
}

function parseNumericCell(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.toLowerCase() === "null" || raw.toLowerCase() === "nan") {
    return null;
  }

  const parsed = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(parsed)) {
    throw new Error(`숫자 해석 실패: ${raw}`);
  }

  return parsed;
}

function buildHeaderMap(headerLine) {
  const headers = splitCsvLine(headerLine).map(normalizeHeader);
  const map = new Map();

  for (let i = 0; i < headers.length; i += 1) {
    const key = headers[i];

    if (["date", "datetime", "tradedate"].includes(key)) {
      map.set("date", i);
    } else if (["open", "openingprice", "startprice"].includes(key)) {
      map.set("open", i);
    } else if (["high", "highprice"].includes(key)) {
      map.set("high", i);
    } else if (["low", "lowprice"].includes(key)) {
      map.set("low", i);
    } else if (["close", "closingprice", "price"].includes(key)) {
      map.set("close", i);
    } else if (["adjclose", "adjustedclose", "adjustedclosingprice"].includes(key)) {
      map.set("adjClose", i);
    } else if (["volume", "tradingvolume"].includes(key)) {
      map.set("volume", i);
    }
  }

  if (!map.has("date") || !map.has("close")) {
    throw new Error("CSV 헤더에 최소한 Date와 Close 열이 필요합니다.");
  }

  return map;
}

export function parsePriceCsv(input) {
  const text = String(input || "").replace(/^\uFEFF/, "");
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    throw new Error("CSV 데이터가 비어 있습니다.");
  }

  const headerMap = buildHeaderMap(lines[0]);
  const records = [];
  const seenDates = new Set();

  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i]);
    const date = parseDateCell(cells[headerMap.get("date")]);
    if (!date) {
      continue;
    }

    if (seenDates.has(date)) {
      throw new Error(`중복 날짜가 있습니다: ${date}`);
    }

    const close = parseNumericCell(cells[headerMap.get("close")]);
    if (close === null || close <= 0) {
      continue;
    }

    const open = parseNumericCell(cells[headerMap.get("open")]) ?? close;
    const high = parseNumericCell(cells[headerMap.get("high")]) ?? Math.max(open, close);
    const low = parseNumericCell(cells[headerMap.get("low")]) ?? Math.min(open, close);
    const adjClose = parseNumericCell(cells[headerMap.get("adjClose")]) ?? close;
    const volume = parseNumericCell(cells[headerMap.get("volume")]) ?? 0;
    const factor = close === 0 ? 1 : adjClose / close;

    records.push({
      date,
      open,
      high,
      low,
      close,
      adjClose,
      adjOpen: open * factor,
      adjHigh: high * factor,
      adjLow: low * factor,
      volume
    });

    seenDates.add(date);
  }

  records.sort((a, b) => a.date.localeCompare(b.date));
  return records;
}
