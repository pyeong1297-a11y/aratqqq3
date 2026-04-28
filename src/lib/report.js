function pad(value, width) {
  const text = String(value);
  if (text.length >= width) {
    return text;
  }
  return `${" ".repeat(width - text.length)}${text}`;
}

export function formatMetricValue(kind, value, currency = "KRW") {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }

  if (kind === "percent") {
    return `${(value * 100).toFixed(2)}%`;
  }

  if (kind === "currency") {
    if (currency === "USD") {
      return `$${Math.round(value).toLocaleString("en-US")}`;
    }
    return `${Math.round(value).toLocaleString("ko-KR")} KRW`;
  }

  if (kind === "count") {
    return String(value);
  }

  if (kind === "days") {
    return `${value.toFixed(1)} d`;
  }

  return String(value);
}

export function printScenarioTable(rows) {
  const widths = {
    scenario: 38,
    totalReturn: 12,
    cagr: 10,
    mdd: 10,
    trades: 8,
    winRate: 10,
    exposure: 10,
    ending: 18
  };

  const header = [
    pad("Scenario", widths.scenario),
    pad("Total Return", widths.totalReturn),
    pad("CAGR", widths.cagr),
    pad("MDD", widths.mdd),
    pad("Trades", widths.trades),
    pad("Win Rate", widths.winRate),
    pad("Exposure", widths.exposure),
    pad("Ending Value", widths.ending)
  ].join("  ");

  console.log(header);
  console.log("-".repeat(header.length));

  for (const row of rows) {
    console.log(
      [
        pad(row.scenario, widths.scenario),
        pad(row.totalReturn, widths.totalReturn),
        pad(row.cagr, widths.cagr),
        pad(row.mdd, widths.mdd),
        pad(row.trades, widths.trades),
        pad(row.winRate, widths.winRate),
        pad(row.exposure, widths.exposure),
        pad(row.ending, widths.ending)
      ].join("  ")
    );
  }
}

export function printStrategyBlock(result) {
  const currency = result.meta.currency || "KRW";
  console.log("");
  console.log(`[${result.meta.scenarioLabel}]`);
  console.log(`- Period: ${result.meta.startDate} ~ ${result.meta.endDate}`);
  console.log(`- Total return: ${formatMetricValue("percent", result.metrics.totalReturn)}`);
  console.log(`- CAGR: ${formatMetricValue("percent", result.metrics.cagr)}`);
  console.log(`- MDD: ${formatMetricValue("percent", result.metrics.maxDrawdown)}`);
  console.log(`- Trades: ${formatMetricValue("count", result.metrics.tradeCount)}`);
  console.log(`- Win rate: ${formatMetricValue("percent", result.metrics.winRate)}`);
  console.log(`- Avg hold: ${formatMetricValue("days", result.metrics.avgHoldDays)}`);
  console.log(`- Market exposure: ${formatMetricValue("percent", result.metrics.marketExposure)}`);
  if (result.metrics.isaProfitTakeCount !== undefined) {
    console.log(`- ISA profit takes: ${formatMetricValue("count", result.metrics.isaProfitTakeCount)}`);
  }
  if (result.metrics.usProfitTakeCount !== undefined) {
    console.log(`- US profit takes: ${formatMetricValue("count", result.metrics.usProfitTakeCount)}`);
  } else if (result.metrics.profitTakeCount !== undefined) {
    console.log(`- Profit takes: ${formatMetricValue("count", result.metrics.profitTakeCount)}`);
  }
  if (result.metrics.spymFinalWeight !== undefined) {
    console.log(`- SPYM final weight: ${formatMetricValue("percent", result.metrics.spymFinalWeight)}`);
  }
  if (result.metrics.sgovHoldingRatio !== undefined) {
    console.log(`- SGOV holding ratio: ${formatMetricValue("percent", result.metrics.sgovHoldingRatio)}`);
  }
  if (result.metrics.cashHoldingRatio !== undefined) {
    console.log(`- Cash holding ratio: ${formatMetricValue("percent", result.metrics.cashHoldingRatio)}`);
  }
  if (result.metrics.dipEntryCount !== undefined) {
    console.log(`- Dip entries: ${formatMetricValue("count", result.metrics.dipEntryCount)}`);
  }
  if (result.metrics.gcEntryCount !== undefined) {
    console.log(`- GC entries: ${formatMetricValue("count", result.metrics.gcEntryCount)}`);
  }
  if (result.metrics.dcExitCount !== undefined) {
    console.log(`- DC exits: ${formatMetricValue("count", result.metrics.dcExitCount)}`);
  }
  if (result.metrics.annualTaxPaid !== undefined) {
    console.log(`- US tax paid: ${formatMetricValue("currency", result.metrics.annualTaxPaid, currency)}`);
  }
  if (result.metrics.exitTaxPaid !== undefined) {
    console.log(`- ISA exit tax paid: ${formatMetricValue("currency", result.metrics.exitTaxPaid, currency)}`);
  }
  if (result.metrics.principalContributed !== undefined) {
    console.log(`- Principal contributed: ${formatMetricValue("currency", result.metrics.principalContributed, currency)}`);
  }
  if (result.metrics.isaGrossContributed !== undefined) {
    console.log(`- Gross ISA contributions: ${formatMetricValue("currency", result.metrics.isaGrossContributed, currency)}`);
  }
  if (result.metrics.internalIsaFunding !== undefined) {
    console.log(`- Internal SGOV funding to ISA: ${formatMetricValue("currency", result.metrics.internalIsaFunding, currency)}`);
  }
  if (result.metrics.netProfit !== undefined) {
    console.log(`- Net profit vs contributions: ${formatMetricValue("currency", result.metrics.netProfit, currency)}`);
  }
  if (result.metrics.settledCash !== undefined) {
    console.log(`- Closed ISA net proceeds moved to USD: ${formatMetricValue("currency", result.metrics.settledCash, currency)}`);
  }
  console.log(`- Ending value: ${formatMetricValue("currency", result.metrics.endingValue, currency)}`);
}
