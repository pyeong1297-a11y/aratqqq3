import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { DEFAULTS, STRATEGIES } from "../config.js";
import { loadRequiredData } from "../lib/data-loader.js";
import { runUsQldStrategy } from "../lib/us-qld-strategy.js";

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
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

function toPct(value) { return Math.round(value * 10000) / 100; }
function round(value, digits = 6) { return Math.round(value * (10**digits)) / (10**digits); }

function computeCalmar(cagr, maxDrawdown) {
  if (!Number.isFinite(cagr) || !Number.isFinite(maxDrawdown) || maxDrawdown >= 0) return null;
  return cagr / Math.abs(maxDrawdown);
}

function cloneSignalMode(signalMode, profitTakeSteps) {
  return { ...signalMode, profitTakeSteps };
}

function logProgress(label, current, total) {
  if (current === total || current % 250 === 0) {
    console.log(`[${label}] ${current}/${total}`);
  }
}

function rankRows(rows, key) {
  return [...rows].sort((left, right) => (right[key] ?? -Infinity) - (left[key] ?? -Infinity));
}

function buildSteps(rawSteps) {
  return rawSteps.map(step => ({
    threshold: step.threshold,
    sellFraction: step.sellFraction
  }));
}

function formatStepKey(steps) {
  return steps.map(step => `${toPct(step.threshold)}:${toPct(step.sellFraction)}`).join("|");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const dataDir = path.resolve(cwd, options["data-dir"] || DEFAULTS.dataDir);
  const outputPath = path.resolve(cwd, String(options.output || "results/us-qld-pt-study.json"));
  const signalModeId = String(options.mode || "dual-strict");
  const initialCapital = Number(options["initial-capital"] || 100_000);
  
  const strategy = STRATEGIES["us-qld-dual"];
  const signalMode = strategy.signalModes.find(m => m.id === signalModeId);
  if (!signalMode) throw new Error(`Unknown mode: ${signalModeId}`);
  
  const requiredFiles = {
    tqqq: "us/tqqq.csv", qqq: "us/qqq.csv", qld: "us/qld.csv", spym: "us/spym.csv", sgov: "us/sgov.csv"
  };
  const datasets = await loadRequiredData(dataDir, requiredFiles);

  function evaluateCandidate(steps) {
    return runUsQldStrategy({
      name: strategy.name,
      signalBars: datasets.tqqq,
      qqqBars: datasets.qqq,
      qldBars: datasets.qld,
      spymBars: datasets.spym,
      sgovBars: datasets.sgov,
      initialCapital,
      signalMode: cloneSignalMode(signalMode, steps),
      feeRate: strategy.feeRate,
      annualCashYield: strategy.annualCashYield
    });
  }

  const coarseStep1Thresholds = [10, 20, 30, 40, 60, 80, 100];
  const coarseStep2Thresholds = [30, 50, 70, 90, 110, 130];
  const coarseStep1Sells = [10, 25, 40, 60, 80];
  const coarseStep2Sells = [100]; // Assume step 2 always sells remaining entirely
  
  let coarseCounter = 0;
  const coarseTotal = coarseStep1Thresholds.length * coarseStep2Thresholds.length * coarseStep1Sells.length;
  const coarseRows = [];

  for (const step1ThresholdPct of coarseStep1Thresholds) {
    for (const step2ThresholdPct of coarseStep2Thresholds) {
      if (step2ThresholdPct <= step1ThresholdPct) continue;
      for (const step1SellPct of coarseStep1Sells) {
        coarseCounter++;
        logProgress("coarse", coarseCounter, coarseTotal);
        
        const steps = buildSteps([
          { threshold: step1ThresholdPct / 100, sellFraction: step1SellPct / 100 },
          { threshold: step2ThresholdPct / 100, sellFraction: 1.0 }
        ]);
        
        const result = evaluateCandidate(steps);
        coarseRows.push({
          step1ThresholdPct, step2ThresholdPct, step1SellPct, step2SellPct: 100,
          cagr: result.metrics.cagr,
          mdd: result.metrics.maxDrawdown,
          calmar: computeCalmar(result.metrics.cagr, result.metrics.maxDrawdown)
        });
      }
    }
  }

  const bestCoarseByCagr = rankRows(coarseRows, "cagr")[0];
  const bestCoarseByCalmar = rankRows(coarseRows, "calmar")[0];

  const refineSeeds = new Map();
  for (const seed of [...rankRows(coarseRows, "cagr").slice(0, 3), ...rankRows(coarseRows, "calmar").slice(0, 3)]) {
    refineSeeds.set(formatStepKey(buildSteps([
      { threshold: seed.step1ThresholdPct / 100, sellFraction: seed.step1SellPct / 100 },
      { threshold: seed.step2ThresholdPct / 100, sellFraction: 1.0 }
    ])), seed);
  }

  const refinedRows = [];
  const seenRefined = new Set();
  let refinedTotal = 0;
  
  for (const seed of refineSeeds.values()) {
    const s1t = Math.floor((Math.min(150, seed.step1ThresholdPct + 10) - Math.max(5, seed.step1ThresholdPct - 10)) / 5) + 1;
    const s2t = Math.floor((Math.min(200, seed.step2ThresholdPct + 10) - Math.max(seed.step1ThresholdPct + 5, seed.step2ThresholdPct - 10)) / 5) + 1;
    const s1s = Math.floor((Math.min(95, seed.step1SellPct + 10) - Math.max(5, seed.step1SellPct - 10)) / 5) + 1;
    refinedTotal += s1t * s2t * s1s;
  }
  
  let refinedCounter = 0;
  for (const seed of refineSeeds.values()) {
    for (let step1ThresholdPct = Math.max(5, seed.step1ThresholdPct - 10); step1ThresholdPct <= Math.min(150, seed.step1ThresholdPct + 10); step1ThresholdPct += 5) {
      for (let step2ThresholdPct = Math.max(step1ThresholdPct + 5, seed.step2ThresholdPct - 10); step2ThresholdPct <= Math.min(200, seed.step2ThresholdPct + 10); step2ThresholdPct += 5) {
        for (let step1SellPct = Math.max(5, seed.step1SellPct - 10); step1SellPct <= Math.min(95, seed.step1SellPct + 10); step1SellPct += 5) {
          const rowKey = `${step1ThresholdPct}-${step2ThresholdPct}-${step1SellPct}-100`;
          if (seenRefined.has(rowKey)) continue;
          seenRefined.add(rowKey);
          
          refinedCounter++;
          logProgress("refined", refinedCounter, refinedTotal);
          
          const steps = buildSteps([
            { threshold: step1ThresholdPct / 100, sellFraction: step1SellPct / 100 },
            { threshold: step2ThresholdPct / 100, sellFraction: 1.0 }
          ]);
          const result = evaluateCandidate(steps);
          refinedRows.push({
            step1ThresholdPct, step2ThresholdPct, step1SellPct, step2SellPct: 100,
            cagr: result.metrics.cagr,
            mdd: result.metrics.maxDrawdown,
            calmar: computeCalmar(result.metrics.cagr, result.metrics.maxDrawdown)
          });
        }
      }
    }
  }

  const bestRefinedByCagr = rankRows(refinedRows, "cagr")[0];
  const bestRefinedByCalmar = rankRows(refinedRows, "calmar")[0];

  const payload = {
    bestCoarseByCagr,
    bestCoarseByCalmar,
    bestRefinedByCagr,
    bestRefinedByCalmar,
    topCagr: rankRows(refinedRows, "cagr").slice(0, 10),
    topCalmar: rankRows(refinedRows, "calmar").slice(0, 10)
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");

  console.log(JSON.stringify({
    mode: signalMode.id,
    bestCagr: bestRefinedByCagr,
    bestCalmar: bestRefinedByCalmar
  }, null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });
