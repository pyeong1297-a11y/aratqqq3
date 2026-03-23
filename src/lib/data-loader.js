import path from "node:path";
import { readFile } from "node:fs/promises";

import { parsePriceCsv } from "./csv.js";

export async function loadRequiredData(dataDir, fileMap) {
  const datasets = {};

  for (const [key, relativePath] of Object.entries(fileMap)) {
    const fullPath = path.join(dataDir, relativePath);

    let text;
    try {
      text = await readFile(fullPath, "utf8");
    } catch (error) {
      if (error && error.code === "ENOENT") {
        throw new Error(`데이터 파일이 없습니다: ${fullPath}`);
      }
      throw error;
    }

    const bars = parsePriceCsv(text);
    if (bars.length === 0) {
      throw new Error(`데이터 행이 없습니다: ${fullPath}`);
    }

    datasets[key] = bars;
  }

  return datasets;
}
