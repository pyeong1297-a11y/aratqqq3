import path from "node:path";
import { access, constants, readFile } from "node:fs/promises";

import { parsePriceCsv } from "./csv.js";

async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function checkRequiredDataFiles(dataDir, fileMap) {
  const rows = [];
  let missingCount = 0;
  let emptyCount = 0;

  for (const [key, relativePath] of Object.entries(fileMap)) {
    const fullPath = path.join(dataDir, relativePath);
    const exists = await fileExists(fullPath);

    if (!exists) {
      rows.push({
        key,
        relativePath,
        status: "missing",
        detail: "파일 없음"
      });
      missingCount += 1;
      continue;
    }

    try {
      const text = await readFile(fullPath, "utf8");
      const bars = parsePriceCsv(text);
      if (bars.length === 0) {
        rows.push({
          key,
          relativePath,
          status: "empty",
          detail: "데이터 행 0개"
        });
        emptyCount += 1;
        continue;
      }

      rows.push({
        key,
        relativePath,
        status: "ok",
        detail: `${bars.length}행 / ${bars[0].date} ~ ${bars[bars.length - 1].date}`
      });
    } catch (error) {
      rows.push({
        key,
        relativePath,
        status: "invalid",
        detail: error.message
      });
    }
  }

  return {
    rows,
    missingCount,
    emptyCount
  };
}
