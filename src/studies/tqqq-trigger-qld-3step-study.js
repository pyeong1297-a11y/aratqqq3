import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { DEFAULTS } from "../config.js";
import { loadRequiredData } from "../lib/data-loader.js";
import {
  buildSteps,
  computeCalmar,
  runTqqqTriggeredQldStrategy
} from "./tqqq-trigger-qld-direct-study.js";

function parseArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const [rawKey, inlineValue] = token.split("=", 2);
    const key = rawKey.slice(2);
    if (inlineValue !== undefined) {
      options[key] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }

    options[key] = next;
    index += 1;
  }

  return options;
}

function rankRows(rows, key) {
  return [...rows].sort(
    (left, right) =>
      (right[key] ?? Number.NEGATIVE_INFINITY) - (left[key] ?? Number.NEGATIVE_INFINITY) ||
      left.t1 - right.t1 ||
      left.p1 - right.p1 ||
      left.t2 - right.t2 ||
      left.p2 - right.p2 ||
      left.t3 - right.t3
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const dataDir = path.resolve(cwd, options["data-dir"] || DEFAULTS.dataDir);
  const outputPath = path.resolve(
    cwd,
    String(options.output || "results/tqqq-trigger-qld-3step-study.json")
  );

  const datasets = await loadRequiredData(dataDir, {
    tqqq: "us/tqqq.csv",
    qld: "us/qld.csv",
    spym: "us/spym.csv",
    sgov: "us/sgov.csv"
  });

  const startDate = datasets.tqqq[0].date;
  const signalBars = datasets.tqqq.filter((bar) => bar.date >= startDate);
  const riskBars = datasets.qld.filter((bar) => bar.date >= startDate);
  const spymBars = datasets.spym.filter((bar) => bar.date >= startDate);
  const sgovBars = datasets.sgov.filter((bar) => bar.date >= startDate);

  const run = (steps) =>
    runTqqqTriggeredQldStrategy({
      signalBars,
      riskBars,
      spymBars,
      sgovBars,
      initialCapital: 100_000,
      confirmationDays: 3,
      feeRate: 0.0025,
      slippageRate: 0.0005,
      profitTakeSteps: buildSteps(steps),
      profitTakeParking: { spym: 1, sgov: 0 },
      taxMode: "taxed",
      taxRate: 0.099,
      basicDeduction: 0
    });

  const baseline2Step = run([
    { threshold: 0.6, sellFraction: 0.2 },
    { threshold: 0.85, sellFraction: 1.0 }
  ]);

  const rows = [];
  const s1Thresholds = [20, 25, 30, 35, 40, 45, 50];
  const s1Sells = [5, 10, 15, 20];
  const s2Thresholds = [55, 60, 65, 70];
  const s2Sells = [15, 20, 25, 30, 35];
  const s3Thresholds = [80, 85, 90, 95, 100, 105];

  for (const t1 of s1Thresholds) {
    for (const p1 of s1Sells) {
      for (const t2 of s2Thresholds) {
        if (t2 <= t1) {
          continue;
        }
        for (const p2 of s2Sells) {
          for (const t3 of s3Thresholds) {
            if (t3 <= t2) {
              continue;
            }

            const result = run([
              { threshold: t1 / 100, sellFraction: p1 / 100 },
              { threshold: t2 / 100, sellFraction: p2 / 100 },
              { threshold: t3 / 100, sellFraction: 1.0 }
            ]);

            rows.push({
              t1,
              p1,
              t2,
              p2,
              t3,
              cagr: result.metrics.cagr,
              mdd: result.metrics.maxDrawdown,
              calmar: computeCalmar(result.metrics.cagr, result.metrics.maxDrawdown),
              tradeCount: result.metrics.tradeCount,
              winRate: result.metrics.winRate,
              profitTakeCount: result.metrics.profitTakeCount
            });
          }
        }
      }
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    assumptions: {
      model: "TQQQ trigger + real QLD + constrained 3-step sweep around practical growth zone",
      startDate,
      endDate: signalBars[signalBars.length - 1].date,
      tested: rows.length
    },
    baseline2Step: {
      t1: 60,
      p1: 20,
      t2: 85,
      p2: 100,
      cagr: baseline2Step.metrics.cagr,
      mdd: baseline2Step.metrics.maxDrawdown,
      calmar: computeCalmar(baseline2Step.metrics.cagr, baseline2Step.metrics.maxDrawdown),
      tradeCount: baseline2Step.metrics.tradeCount,
      winRate: baseline2Step.metrics.winRate,
      profitTakeCount: baseline2Step.metrics.profitTakeCount
    },
    bestByCagr: rankRows(rows, "cagr").slice(0, 20),
    bestByCalmar: rankRows(rows, "calmar").slice(0, 20)
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
