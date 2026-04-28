import http from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_PATH = path.join(ROOT_DIR, "results", "isa-tiger-latest.json");
const STATIC_DASHBOARD_PATH = path.join(ROOT_DIR, "results", "isa-dashboard.html");
const DEFAULT_PORT = Number(process.env.PORT || 3010);

let refreshPromise = null;

function emptyPayload(message = "저장된 결과가 없습니다. 백테스트를 먼저 실행하세요.") {
  return {
    generatedAt: null,
    message,
    results: [
      {
        strategy: "isa-kodex",
        label: "ISA TIGER 418660 Strategy",
        type: "isa",
        scenarios: []
      }
    ]
  };
}

async function readLatestResults() {
  try {
    const text = await readFile(RESULTS_PATH, "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return emptyPayload();
    }
    throw error;
  }
}

async function runBacktest() {
  if (!refreshPromise) {
    refreshPromise = execFileAsync(
      process.execPath,
      ["src/cli.js", "run", "isa-kodex", "--save", "results/isa-tiger-latest.json"],
      {
        cwd: ROOT_DIR,
        maxBuffer: 32 * 1024 * 1024
      }
    )
      .then(() => readLatestResults())
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function sendHtml(response, html) {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(html);
}

function serializeForScript(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function renderAppHtml({ initialPayload = null, standalone = false } = {}) {
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>ISA TIGER 418660 Strategy Board</title>
    <style>
      :root {
        --bg: #f4efe6;
        --bg-accent: #e0ecf7;
        --paper: rgba(255, 252, 247, 0.88);
        --ink: #162133;
        --muted: #566174;
        --line: rgba(22, 33, 51, 0.12);
        --brand: #0f6c5c;
        --brand-2: #d86c31;
        --danger: #9d2f2f;
        --shadow: 0 20px 50px rgba(33, 39, 52, 0.12);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        color: var(--ink);
        font-family: "Bahnschrift", "Segoe UI Variable", "Trebuchet MS", sans-serif;
        background:
          radial-gradient(circle at top left, rgba(216, 108, 49, 0.14), transparent 28%),
          radial-gradient(circle at top right, rgba(15, 108, 92, 0.12), transparent 26%),
          linear-gradient(180deg, var(--bg-accent), var(--bg));
      }

      .shell {
        width: min(1240px, calc(100vw - 32px));
        margin: 24px auto 40px;
      }

      .hero,
      .panel,
      .card {
        background: var(--paper);
        backdrop-filter: blur(14px);
        border: 1px solid var(--line);
        box-shadow: var(--shadow);
      }

      .hero {
        border-radius: 28px;
        padding: 28px;
        overflow: hidden;
        position: relative;
      }

      .hero::after {
        content: "";
        position: absolute;
        right: -100px;
        top: -120px;
        width: 280px;
        height: 280px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(216, 108, 49, 0.18), transparent 65%);
      }

      .hero-grid,
      .rule-grid,
      .highlight-grid,
      .detail-grid {
        display: grid;
        gap: 16px;
      }

      .hero-grid {
        grid-template-columns: 2.2fr 1fr;
        position: relative;
        z-index: 1;
      }

      .eyebrow {
        color: var(--brand);
        font-size: 12px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        margin-bottom: 10px;
      }

      h1,
      h2,
      h3,
      p {
        margin: 0;
      }

      h1,
      h2 {
        font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", serif;
      }

      h1 {
        font-size: clamp(32px, 5vw, 56px);
        line-height: 0.98;
        margin-bottom: 14px;
      }

      h2 {
        font-size: 26px;
        margin-bottom: 12px;
      }

      .lede {
        max-width: 760px;
        color: var(--muted);
        font-size: 16px;
        line-height: 1.7;
      }

      .hero-stats {
        display: grid;
        gap: 12px;
      }

      .mini {
        border-radius: 18px;
        padding: 18px;
        background: rgba(255, 255, 255, 0.7);
        border: 1px solid var(--line);
      }

      .mini-label {
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
      }

      .mini-value {
        font-size: 28px;
        font-weight: 700;
        margin-top: 8px;
      }

      .toolbar {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: 18px;
        flex-wrap: wrap;
      }

      button,
      .segmented button {
        border: 0;
        cursor: pointer;
        font: inherit;
      }

      .action {
        padding: 12px 16px;
        border-radius: 999px;
        background: var(--ink);
        color: #fff8f0;
        transition: transform 140ms ease, opacity 140ms ease;
      }

      .action.secondary {
        background: rgba(22, 33, 51, 0.08);
        color: var(--ink);
      }

      .action:hover {
        transform: translateY(-1px);
      }

      .section {
        margin-top: 22px;
      }

      .panel {
        border-radius: 24px;
        padding: 22px;
      }

      .rule-grid,
      .highlight-grid {
        grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      }

      .card {
        border-radius: 22px;
        padding: 18px;
      }

      .card h3 {
        font-size: 18px;
        margin-bottom: 8px;
      }

      .card p {
        color: var(--muted);
        line-height: 1.6;
        font-size: 14px;
      }

      .highlight-card {
        min-height: 184px;
        display: grid;
        gap: 14px;
      }

      .pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(15, 108, 92, 0.1);
        color: var(--brand);
        font-size: 12px;
        font-weight: 700;
        width: fit-content;
      }

      .metric-strip {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
      }

      .metric-box {
        padding: 12px;
        border-radius: 16px;
        background: rgba(22, 33, 51, 0.05);
      }

      .metric-box .label {
        color: var(--muted);
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .metric-box .value {
        margin-top: 6px;
        font-size: 18px;
        font-weight: 700;
      }

      .detail-grid {
        grid-template-columns: 1.3fr 0.9fr;
      }

      .chart-wrap {
        border-radius: 24px;
        padding: 18px;
        background: linear-gradient(180deg, rgba(224, 236, 247, 0.58), rgba(255, 255, 255, 0.58));
        border: 1px solid var(--line);
      }

      .chart-header,
      .table-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        margin-bottom: 14px;
        flex-wrap: wrap;
      }

      .chart-meta {
        color: var(--muted);
        font-size: 13px;
      }

      .segmented {
        display: inline-flex;
        background: rgba(22, 33, 51, 0.08);
        border-radius: 999px;
        padding: 4px;
      }

      .segmented button {
        padding: 8px 12px;
        border-radius: 999px;
        background: transparent;
        color: var(--muted);
      }

      .segmented button.active {
        background: #fff;
        color: var(--ink);
        box-shadow: 0 8px 18px rgba(22, 33, 51, 0.08);
      }

      svg {
        width: 100%;
        height: auto;
        display: block;
      }

      .chart-line {
        fill: none;
        stroke: var(--brand);
        stroke-width: 3;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .chart-area {
        fill: url(#chartFill);
      }

      .chart-grid {
        stroke: rgba(22, 33, 51, 0.09);
        stroke-width: 1;
      }

      .selection-meta dl {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 12px 16px;
        margin: 0;
      }

      .selection-meta dt {
        color: var(--muted);
      }

      .selection-meta dd {
        margin: 0;
        font-weight: 700;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th,
      td {
        padding: 13px 12px;
        border-top: 1px solid var(--line);
        text-align: left;
        font-size: 14px;
      }

      th {
        color: var(--muted);
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      tr {
        cursor: pointer;
        transition: background 120ms ease;
      }

      tr:hover,
      tr.active {
        background: rgba(22, 33, 51, 0.05);
      }

      .good {
        color: var(--brand);
      }

      .bad {
        color: var(--danger);
      }

      .muted {
        color: var(--muted);
      }

      .status {
        min-height: 20px;
        color: var(--muted);
        font-size: 13px;
      }

      @media (max-width: 960px) {
        .hero-grid,
        .detail-grid {
          grid-template-columns: 1fr;
        }

        .metric-strip {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="hero">
        <div class="hero-grid">
          <div>
            <div class="eyebrow">ISA Strategy Dashboard</div>
            <h1>BULZ와 TIGER 418660 최신 전략을 브라우저에서 바로 확인</h1>
            <p class="lede">
              현재 저장된 <code>results/isa-tiger-latest.json</code>를 읽어 미국장 BULZ 전략과
              ISA의 Pure 3일 + 3단 익절, Strict 3일 + 3단 익절 결과를 한 화면에서 비교합니다.
              페이지 안에서 백테스트를 다시 돌려 최신 결과로 갱신할 수도 있습니다.
            </p>
            <div class="toolbar">
              <button id="refreshButton" class="action">백테스트 새로고침</button>
              <button id="reloadButton" class="action secondary">결과 다시 불러오기</button>
              <span id="status" class="status"></span>
            </div>
          </div>
          <div class="hero-stats">
            <div class="mini">
              <div class="mini-label">기준 포트</div>
              <div id="bestStrategy" class="mini-value">-</div>
            </div>
            <div class="mini">
              <div class="mini-label">세후 CAGR</div>
              <div id="bestCagr" class="mini-value">-</div>
            </div>
            <div class="mini">
              <div class="mini-label">마지막 갱신</div>
              <div id="generatedAt" class="mini-value" style="font-size:22px">-</div>
            </div>
          </div>
        </div>
      </section>

      <section class="section panel">
        <h2>최종 규칙</h2>
        <div class="rule-grid">
          <article class="card">
            <h3>ISA 납입</h3>
            <p>기존 ISA 1년 보유 중 상태에서 1,000만원 시작. 매달 21일 60만원 납입, 해지 지연 규칙 중에도 계속 납입합니다.</p>
          </article>
          <article class="card">
            <h3>미국장 규칙</h3>
            <p>BULZ가 SMA200 위에서 2거래일 연속 마감하면 진입하고, 다시 SMA200 아래로 내려오면 청산합니다.</p>
          </article>
          <article class="card">
            <h3>ISA 핵심</h3>
            <p>TQQQ 신호를 기준으로 TIGER 미국나스닥100레버리지(합성) 418660을 운용합니다. 최신 후보는 Pure 3일 + 3단 익절과 Strict 3일 + 3단 익절입니다.</p>
          </article>
          <article class="card">
            <h3>3단 익절</h3>
            <p>418660 진입 후 수익률이 +50%, +120%, +150%에 도달하면 각각 보유분의 33%, 남은 보유분의 75%, 전량을 익절해 TIGER 미국S&amp;P500으로 이동하고, 리스크 오프 시 함께 정리합니다.</p>
          </article>
        </div>
      </section>

      <section class="section panel">
        <div class="table-header">
          <div>
            <h2>핵심 카드</h2>
            <p class="muted">기준 / 세금 반영 시나리오와 장기 적립 벤치마크만 먼저 보여줍니다.</p>
          </div>
        </div>
        <div id="highlightGrid" class="highlight-grid"></div>
      </section>

      <section class="section detail-grid">
        <div class="panel">
          <div class="chart-header">
            <div>
              <h2 id="chartTitle">선택된 시나리오</h2>
              <div id="chartMeta" class="chart-meta">-</div>
            </div>
            <div class="segmented" id="metricSwitch">
              <button data-metric="nav" class="active">NAV</button>
              <button data-metric="value">자산가치</button>
              <button data-metric="principalContributed">납입원금</button>
            </div>
          </div>
          <div class="chart-wrap">
            <svg id="chart" viewBox="0 0 960 320" preserveAspectRatio="none"></svg>
          </div>
        </div>
        <aside class="panel selection-meta">
          <h2>선택 상세</h2>
          <dl id="selectionMeta"></dl>
        </aside>
      </section>

      <section class="section panel">
        <div class="table-header">
          <div>
            <h2>전체 시나리오</h2>
            <p class="muted">행을 클릭하면 우측 차트와 상세가 바뀝니다.</p>
          </div>
        </div>
        <div style="overflow:auto">
          <table>
            <thead>
              <tr>
                <th>시나리오</th>
                <th>CAGR</th>
                <th>MDD</th>
                <th>Ending</th>
                <th>Trades</th>
                <th>Exposure</th>
              </tr>
            </thead>
            <tbody id="scenarioTable"></tbody>
          </table>
        </div>
      </section>
    </main>

    <script>
      window.__BOOTSTRAP__ = ${serializeForScript(initialPayload)};
      window.__STANDALONE__ = ${standalone ? "true" : "false"};
    </script>
    <script>
      const state = {
        payload: window.__BOOTSTRAP__ || null,
        selectedId: null,
        metric: "nav"
      };

      const statusEl = document.getElementById("status");
      const highlightGrid = document.getElementById("highlightGrid");
      const scenarioTable = document.getElementById("scenarioTable");
      const chartEl = document.getElementById("chart");
      const chartTitle = document.getElementById("chartTitle");
      const chartMeta = document.getElementById("chartMeta");
      const selectionMeta = document.getElementById("selectionMeta");
      const refreshButton = document.getElementById("refreshButton");
      const reloadButton = document.getElementById("reloadButton");

      if (window.__STANDALONE__) {
        refreshButton.style.display = "none";
        reloadButton.textContent = "정적 파일 다시 렌더";
      }

      function formatPercent(value) {
        if (value === null || value === undefined || Number.isNaN(value)) return "-";
        return (value * 100).toFixed(2) + "%";
      }

      function formatCurrency(value) {
        if (value === null || value === undefined || Number.isNaN(value)) return "-";
        return Math.round(value).toLocaleString("ko-KR") + "원";
      }

      function formatCount(value) {
        if (value === null || value === undefined || Number.isNaN(value)) return "-";
        return String(value);
      }

      function formatDateTime(value) {
        if (!value) return "-";
        return new Date(value).toLocaleString("ko-KR", { hour12: false });
      }

      function classifyScenario(item) {
        const meta = item.meta || {};
        if (meta.benchmarkAsset === "kodex") return "단일 ISA TIGER 418660 적립";
        if (meta.benchmarkAsset === "qld") return "QLD 적립";

        const signal = meta.signalMode || {};
        if (signal.id === "dual-early") return "Early 3일";
        if (signal.id === "pure-200-3d-pt55") return "Pure 3일 + 익절";
        if (signal.id === "pure-200-3d") {
          return Array.isArray(signal.isaProfitTakeSteps) && signal.isaProfitTakeSteps.length > 0
            ? "Pure 3일 + 3단 익절"
            : "Pure 3일";
        }
        if (signal.id === "dual-strict-pt55") return "Strict 3일 + 익절";
        if (signal.id === "dual-strict") {
          return Array.isArray(signal.isaProfitTakeSteps) && signal.isaProfitTakeSteps.length > 0
            ? "Strict 3일 + 3단 익절"
            : "Strict 3일";
        }
        if (signal.id === "long-only") return "단순 보유";

        if (signal.mode === "sma200-entry") return "순수 SMA200";

        const base = signal.label || "Unknown";
        return signal.confirmationDays ? base + " " + signal.confirmationDays + "일" : base;
      }

      function executionLabel(item) {
        const meta = item.meta || {};
        if (meta.benchmarkAsset) return meta.taxMode === "taxed" ? "세금 반영" : "세금 미반영";
        if (meta.mode === "fair-value") return meta.taxMode === "taxed" ? "낙관적 / 세금 반영" : "낙관적 / 세금 미반영";
        if (meta.mode === "open" && Number(meta.slipRate || 0) === 0) return meta.taxMode === "taxed" ? "기준 / 세금 반영" : "기준 / 세금 미반영";
        return meta.taxMode === "taxed" ? "보수적 / 세금 반영" : "보수적 / 세금 미반영";
      }

      function displayName(item) {
        return classifyScenario(item) + " / " + executionLabel(item);
      }

      function scenarioId(item, index) {
        return item.meta?.scenarioLabel || (classifyScenario(item) + ":" + index);
      }

      function getScenarios() {
        return state.payload?.results?.[0]?.scenarios || [];
      }

      function getSelectedScenario() {
        const scenarios = getScenarios();
        return scenarios.find((item, index) => scenarioId(item, index) === state.selectedId) || scenarios[0] || null;
      }

      function buildHighlights(scenarios) {
        const picks = [];
        const findOne = (predicate) => scenarios.find(predicate);

        const pure = findOne((item) => (
          ["pure-200-3d", "pure-200-3d-pt55"].includes(item.meta?.signalMode?.id) &&
          item.meta?.mode === "open" &&
          Number(item.meta?.slipRate || 0) === 0 &&
          item.meta?.taxMode === "taxed"
        ));
        const strict = findOne((item) => (
          ["dual-strict", "dual-strict-pt55"].includes(item.meta?.signalMode?.id) &&
          item.meta?.mode === "open" &&
          Number(item.meta?.slipRate || 0) === 0 &&
          item.meta?.taxMode === "taxed"
        ));
        const longOnly = findOne((item) => item.meta?.signalMode?.id === "long-only" && item.meta?.mode === "open" && Number(item.meta?.slipRate || 0) === 0 && item.meta?.taxMode === "taxed");
        const kodexBench = findOne((item) => item.meta?.benchmarkAsset === "kodex" && item.meta?.taxMode === "taxed");
        const qldBench = findOne((item) => item.meta?.benchmarkAsset === "qld" && item.meta?.taxMode === "taxed");

        for (const item of [strict, pure, longOnly, kodexBench, qldBench]) {
          if (item) picks.push(item);
        }

        return picks;
      }

      function renderHighlights() {
        const cards = buildHighlights(getScenarios());
        highlightGrid.innerHTML = cards.map((item, index) => {
          const metrics = item.metrics || {};
          return \`
            <article class="card highlight-card" data-select-id="\${scenarioId(item, index)}">
              <div>
                <div class="pill">\${classifyScenario(item)}</div>
                <h3 style="margin-top:12px">\${executionLabel(item)}</h3>
                <p>\${item.meta?.startDate || "-"} ~ \${item.meta?.endDate || "-"}</p>
              </div>
              <div class="metric-strip">
                <div class="metric-box">
                  <div class="label">CAGR</div>
                  <div class="value">\${formatPercent(metrics.cagr)}</div>
                </div>
                <div class="metric-box">
                  <div class="label">MDD</div>
                  <div class="value \${(metrics.maxDrawdown || 0) < -0.4 ? "bad" : ""}">\${formatPercent(metrics.maxDrawdown)}</div>
                </div>
                <div class="metric-box">
                  <div class="label">Ending</div>
                  <div class="value" style="font-size:16px">\${formatCurrency(metrics.endingValue)}</div>
                </div>
              </div>
            </article>
          \`;
        }).join("");

        highlightGrid.querySelectorAll("[data-select-id]").forEach((el) => {
          el.addEventListener("click", () => {
            state.selectedId = el.dataset.selectId;
            renderDetail();
            renderTable();
          });
        });
      }

      function renderTable() {
        const scenarios = getScenarios();
        scenarioTable.innerHTML = scenarios.map((item, index) => {
          const id = scenarioId(item, index);
          const metrics = item.metrics || {};
          return \`
            <tr data-id="\${id}" class="\${id === state.selectedId ? "active" : ""}">
              <td>\${displayName(item)}</td>
              <td class="\${(metrics.cagr || 0) >= 0.2 ? "good" : ""}">\${formatPercent(metrics.cagr)}</td>
              <td class="\${(metrics.maxDrawdown || 0) <= -0.4 ? "bad" : ""}">\${formatPercent(metrics.maxDrawdown)}</td>
              <td>\${formatCurrency(metrics.endingValue)}</td>
              <td>\${formatCount(metrics.tradeCount)}</td>
              <td>\${formatPercent(metrics.marketExposure)}</td>
            </tr>
          \`;
        }).join("");

        scenarioTable.querySelectorAll("tr[data-id]").forEach((row) => {
          row.addEventListener("click", () => {
            state.selectedId = row.dataset.id;
            renderDetail();
            renderTable();
          });
        });
      }

      function buildPath(values, width, height, padding) {
        const filtered = values.filter((point) => point.value !== null && point.value !== undefined && Number.isFinite(point.value));
        if (filtered.length < 2) return { line: "", area: "" };

        const min = Math.min(...filtered.map((point) => point.value));
        const max = Math.max(...filtered.map((point) => point.value));
        const xStep = (width - padding * 2) / Math.max(1, filtered.length - 1);
        const yRange = max - min || 1;

        const points = filtered.map((point, index) => {
          const x = padding + index * xStep;
          const y = height - padding - ((point.value - min) / yRange) * (height - padding * 2);
          return [x, y];
        });

        const line = points.map((point, index) => (index === 0 ? "M" : "L") + point[0].toFixed(2) + " " + point[1].toFixed(2)).join(" ");
        const area = line + " L " + points[points.length - 1][0].toFixed(2) + " " + (height - padding).toFixed(2) + " L " + points[0][0].toFixed(2) + " " + (height - padding).toFixed(2) + " Z";
        return { line, area, min, max };
      }

      function renderChart(item) {
        if (!item) {
          chartEl.innerHTML = "";
          return;
        }

        const width = 960;
        const height = 320;
        const padding = 22;
        const series = (item.dailyValues || []).map((point) => ({
          date: point.date,
          value: point[state.metric]
        }));
        const path = buildPath(series, width, height, padding);

        const gridLines = [0.2, 0.4, 0.6, 0.8].map((ratio) => {
          const y = padding + (height - padding * 2) * ratio;
          return \`<line class="chart-grid" x1="\${padding}" y1="\${y}" x2="\${width - padding}" y2="\${y}" />\`;
        }).join("");

        chartEl.innerHTML = \`
          <defs>
            <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="rgba(15,108,92,0.32)"></stop>
              <stop offset="100%" stop-color="rgba(15,108,92,0.04)"></stop>
            </linearGradient>
          </defs>
          \${gridLines}
          <path class="chart-area" d="\${path.area}"></path>
          <path class="chart-line" d="\${path.line}"></path>
        \`;

        chartTitle.textContent = displayName(item);
        chartMeta.textContent = (item.meta?.startDate || "-") + " ~ " + (item.meta?.endDate || "-") + " · 현재 표시: " + (state.metric === "nav" ? "NAV" : state.metric === "value" ? "자산가치" : "납입원금");
      }

      function renderSelectionMeta(item) {
        if (!item) {
          selectionMeta.innerHTML = "";
          return;
        }

        const metrics = item.metrics || {};
        const rows = [
          ["CAGR", formatPercent(metrics.cagr)],
          ["MDD", formatPercent(metrics.maxDrawdown)],
          ["Ending value", formatCurrency(metrics.endingValue)],
          ["Trades", formatCount(metrics.tradeCount)],
          ["Win rate", formatPercent(metrics.winRate)],
          ["Exposure", formatPercent(metrics.marketExposure)],
          ["Principal", formatCurrency(metrics.principalContributed)],
          ["Net profit", formatCurrency(metrics.netProfit)],
          ["US tax", formatCurrency(metrics.annualTaxPaid)],
          ["ISA exit tax", formatCurrency(metrics.exitTaxPaid)]
        ];

        selectionMeta.innerHTML = rows.map(([dt, dd]) => \`<dt>\${dt}</dt><dd>\${dd}</dd>\`).join("");
      }

      function renderHeroSummary() {
        const scenarios = getScenarios();
        const baseTaxed = scenarios.filter((item) => item.meta?.taxMode === "taxed" && item.meta?.mode === "open" && Number(item.meta?.slipRate || 0) === 0 && !item.meta?.benchmarkAsset);
        const best = [...baseTaxed].sort((a, b) => (b.metrics?.cagr || -Infinity) - (a.metrics?.cagr || -Infinity))[0] || scenarios[0];

        document.getElementById("bestStrategy").textContent = best ? classifyScenario(best) : "-";
        document.getElementById("bestCagr").textContent = best ? formatPercent(best.metrics?.cagr) : "-";
        document.getElementById("generatedAt").textContent = formatDateTime(state.payload?.generatedAt);
      }

      function renderDetail() {
        const selected = getSelectedScenario();
        renderChart(selected);
        renderSelectionMeta(selected);
      }

      function render() {
        const scenarios = getScenarios();
        if (!state.selectedId && scenarios.length > 0) {
          state.selectedId = scenarioId(scenarios[0], 0);
        }
        renderHeroSummary();
        renderHighlights();
        renderTable();
        renderDetail();
      }

      async function loadResults() {
        if (window.__STANDALONE__) {
          statusEl.textContent = state.payload?.message || (state.payload ? "정적 대시보드를 열었습니다." : "임베드된 결과가 없습니다.");
          render();
          return;
        }

        statusEl.textContent = "결과 불러오는 중...";
        const response = await fetch("/api/results");
        const payload = await response.json();
        if (!payload.ok) {
          throw new Error(payload.error || "결과를 불러오지 못했습니다.");
        }
        state.payload = payload.data;
        statusEl.textContent = payload.data?.message || "결과를 불러왔습니다.";
        render();
      }

      async function refreshResults() {
        if (window.__STANDALONE__) {
          statusEl.textContent = "정적 HTML에서는 서버 새로고침을 할 수 없습니다. 다시 export 하세요.";
          return;
        }

        statusEl.textContent = "백테스트 실행 중...";
        const response = await fetch("/api/refresh", { method: "POST" });
        const payload = await response.json();
        if (!payload.ok) {
          throw new Error(payload.error || "백테스트 갱신에 실패했습니다.");
        }
        state.payload = payload.data;
        statusEl.textContent = payload.data?.message || "백테스트를 다시 돌렸습니다.";
        render();
      }

      document.getElementById("reloadButton").addEventListener("click", async () => {
        try {
          if (window.__STANDALONE__) {
            render();
            statusEl.textContent = "임베드된 결과를 다시 렌더했습니다.";
            return;
          }

          await loadResults();
        } catch (error) {
          statusEl.textContent = error.message;
        }
      });

      document.getElementById("refreshButton").addEventListener("click", async () => {
        try {
          await refreshResults();
        } catch (error) {
          statusEl.textContent = error.message;
        }
      });

      document.querySelectorAll("#metricSwitch button").forEach((button) => {
        button.addEventListener("click", () => {
          state.metric = button.dataset.metric;
          document.querySelectorAll("#metricSwitch button").forEach((item) => item.classList.remove("active"));
          button.classList.add("active");
          renderDetail();
        });
      });

      loadResults().catch((error) => {
        statusEl.textContent = error.message;
      });
    </script>
  </body>
</html>`;
}

async function handleApiResults(response) {
  try {
    const data = await readLatestResults();
    sendJson(response, 200, { ok: true, data });
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error.message });
  }
}

async function handleApiRefresh(response) {
  try {
    const data = await runBacktest();
    sendJson(response, 200, { ok: true, data });
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error.message });
  }
}

export function createAppServer() {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");

    if (request.method === "GET" && url.pathname === "/") {
      sendHtml(response, renderAppHtml());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/results") {
      await handleApiResults(response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/refresh") {
      await handleApiRefresh(response);
      return;
    }

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    sendJson(response, 404, { ok: false, error: "Not found" });
  });
}

export async function startServer({ port = DEFAULT_PORT } = {}) {
  const server = createAppServer();
  await new Promise((resolve) => {
    server.listen(port, "127.0.0.1", resolve);
  });
  console.log(`ISA dashboard: http://127.0.0.1:${port}`);
  return server;
}

export async function exportStaticDashboard() {
  const payload = await readLatestResults();
  const html = renderAppHtml({
    initialPayload: payload,
    standalone: true
  });
  await writeFile(STATIC_DASHBOARD_PATH, html, "utf8");
  console.log(`Static ISA dashboard: ${STATIC_DASHBOARD_PATH}`);
  return STATIC_DASHBOARD_PATH;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const isExportMode = process.argv.includes("--export-static");
  const runner = isExportMode ? exportStaticDashboard : startServer;
  runner().catch((error) => {
    console.error(`App error: ${error.message}`);
    process.exitCode = 1;
  });
}
