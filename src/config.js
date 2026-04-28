export const DEFAULTS = {
  dataDir: "data",
  initialCapital: 100_000_000
};

export const TAX_MODES = [
  { id: "none", label: "No tax" },
  { id: "taxed", label: "Taxed" }
];

const US_TQQQ_GROWTH_PROFIT_TAKE_STEPS = [
  { threshold: 1.0, sellFraction: 0.5 },
  { threshold: 2.0, sellFraction: 1.0 }
];
const US_TQQQ_BALANCE_PROFIT_TAKE_STEPS = [
  { threshold: 0.5, sellFraction: 0.2 },
  { threshold: 1.0, sellFraction: 0.5 },
  { threshold: 2.0, sellFraction: 1.0 }
];
const US_TQQQ_DEFENSE_PROFIT_TAKE_STEPS = [
  { threshold: 0.1, sellFraction: 0.1 },
  { threshold: 0.25, sellFraction: 0.1 },
  { threshold: 0.5, sellFraction: 0.1 },
  { threshold: 1.0, sellFraction: 0.5 },
  { threshold: 2.0, sellFraction: 0.5 },
  { threshold: 3.0, sellFraction: 0.5 }
];
const US_SNOWBALL_BASIC_SETTINGS = {
  startDate: "2010-02-11",
  dip1Weight: 0.2,
  dip2Weight: 0.7,
  bonusWeight: 0.1,
  dip1Drawdown: -0.1,
  dip2Drawdown: -0.22,
  stopDrawdown: -0.4,
  tp1Threshold: 0.15,
  tp2Threshold: 0.68,
  tp3Threshold: 3.5,
  qqqLookbackDays: 252,
  rsiPeriod: 14,
  rsiBonusThreshold: 35,
  gcShort: 5,
  gcLong: 220,
  cooldownDays: 5
};
const US_SNOWBALL_OPTIMIZED_SETTINGS = {
  ...US_SNOWBALL_BASIC_SETTINGS,
  dip1Drawdown: -0.11,
  dip2Drawdown: -0.22,
  tp1Threshold: 0.37,
  tp2Threshold: 0.87,
  tp3Threshold: 3.55,
  tp1SellFractionOfBase: 0.53,
  tp2SellFractionOfBase: 0.47
};
const US_SNOWBALL_ROUNDED_SETTINGS = {
  ...US_SNOWBALL_BASIC_SETTINGS,
  dip1Drawdown: -0.11,
  dip2Drawdown: -0.22,
  tp1Threshold: 0.35,
  tp2Threshold: 0.85,
  tp3Threshold: 3.55,
  tp1SellFractionOfBase: 0.50,
  tp2SellFractionOfBase: 0.50
};
const US_SNOWBALL_OPTIMIZED_DEFENSIVE_SETTINGS = {
  ...US_SNOWBALL_OPTIMIZED_SETTINGS,
  useSgovParking: true,
  postGoldCrossTp2Threshold: 1.0,
  postGoldCrossTp2SellFractionOfBase: 0.10
};
const US_SNOWBALL_OPTIMIZED_SGOV_SETTINGS = {
  ...US_SNOWBALL_OPTIMIZED_SETTINGS,
  useSgovParking: true
};
const US_TQQQ_PROFIT_TAKE_PARKING = { spym: 1 };
const US_BULZ_PROFIT_TAKE_STEPS = [{ threshold: 1.0, sellFraction: 1.0 }];
const US_BULZ_PROFIT_TAKE_PARKING = { sgov: 1 };
const ISA_OPTIMIZED_PROFIT_TAKE_STEPS = [
  { threshold: 0.5, sellFraction: 0.33, destination: "sp500" },
  { threshold: 1.2, sellFraction: 0.75, destination: "sp500" },
  { threshold: 1.5, sellFraction: 1.0, destination: "sp500" }
];

export const STRATEGIES = {
  "us-tqqq": {
    type: "us",
    name: "us-tqqq",
    label: "US TQQQ Baseline (SMA200 3-day confirmation, USD)",
    riskSymbol: "tqqq",
    confirmationDays: 3,
    valuationCurrency: "USD",
    feeRate: 0.0025,
    contributionPlan: {
      initialContribution: 100_000,
      legacyMonthlyContribution: 0
    },
    slippageScenarios: [
      { id: "optimistic", label: "Optimistic", slippageRate: 0.0 },
      { id: "base", label: "Base", slippageRate: 0.0005 },
      { id: "conservative", label: "Conservative", slippageRate: 0.001 },
      { id: "stress", label: "Stress", slippageRate: 0.002 }
    ],
    profitTakeSteps: [],
    profitTakeParking: { sgov: 1 }
  },
  "us-tqqq-growth": {
    type: "us",
    name: "us-tqqq-growth",
    label: "US TQQQ Growth PT (100/50 200/100, USD)",
    riskSymbol: "tqqq",
    confirmationDays: 3,
    valuationCurrency: "USD",
    feeRate: 0.0025,
    contributionPlan: {
      initialContribution: 100_000,
      legacyMonthlyContribution: 0
    },
    slippageScenarios: [
      { id: "optimistic", label: "Optimistic", slippageRate: 0.0 },
      { id: "base", label: "Base", slippageRate: 0.0005 },
      { id: "conservative", label: "Conservative", slippageRate: 0.001 },
      { id: "stress", label: "Stress", slippageRate: 0.002 }
    ],
    profitTakeSteps: US_TQQQ_GROWTH_PROFIT_TAKE_STEPS,
    profitTakeParking: US_TQQQ_PROFIT_TAKE_PARKING
  },
  "us-tqqq-balance": {
    type: "us",
    name: "us-tqqq-balance",
    label: "US TQQQ Balance PT (50/20 100/50 200/100, USD)",
    riskSymbol: "tqqq",
    confirmationDays: 3,
    valuationCurrency: "USD",
    feeRate: 0.0025,
    contributionPlan: {
      initialContribution: 100_000,
      legacyMonthlyContribution: 0
    },
    slippageScenarios: [
      { id: "optimistic", label: "Optimistic", slippageRate: 0.0 },
      { id: "base", label: "Base", slippageRate: 0.0005 },
      { id: "conservative", label: "Conservative", slippageRate: 0.001 },
      { id: "stress", label: "Stress", slippageRate: 0.002 }
    ],
    profitTakeSteps: US_TQQQ_BALANCE_PROFIT_TAKE_STEPS,
    profitTakeParking: US_TQQQ_PROFIT_TAKE_PARKING
  },
  "us-tqqq-defense": {
    type: "us",
    name: "us-tqqq-defense",
    label: "US TQQQ Defense PT (10/10 25/10 50/10 100/50 200/50 300/50, USD)",
    riskSymbol: "tqqq",
    confirmationDays: 3,
    valuationCurrency: "USD",
    feeRate: 0.0025,
    contributionPlan: {
      initialContribution: 100_000,
      legacyMonthlyContribution: 0
    },
    slippageScenarios: [
      { id: "optimistic", label: "Optimistic", slippageRate: 0.0 },
      { id: "base", label: "Base", slippageRate: 0.0005 },
      { id: "conservative", label: "Conservative", slippageRate: 0.001 },
      { id: "stress", label: "Stress", slippageRate: 0.002 }
    ],
    profitTakeSteps: US_TQQQ_DEFENSE_PROFIT_TAKE_STEPS,
    profitTakeParking: US_TQQQ_PROFIT_TAKE_PARKING
  },
  "us-bulz": {
    type: "us",
    name: "us-bulz",
    label: "US BULZ Strategy (+100% full exit -> SGOV, USD)",
    riskSymbol: "bulz",
    confirmationDays: 2,
    valuationCurrency: "USD",
    feeRate: 0.0025,
    contributionPlan: {
      initialContribution: 100_000,
      legacyMonthlyContribution: 0
    },
    slippageScenarios: [
      { id: "optimistic", label: "Optimistic", slippageRate: 0.0 },
      { id: "base", label: "Base", slippageRate: 0.0005 },
      { id: "conservative", label: "Conservative", slippageRate: 0.001 },
      { id: "stress", label: "Stress", slippageRate: 0.002 }
    ],
    profitTakeSteps: US_BULZ_PROFIT_TAKE_STEPS,
    profitTakeParking: US_BULZ_PROFIT_TAKE_PARKING
  },
  "us-snowball-basic": {
    type: "snowball-us",
    name: "us-snowball-basic",
    label: "US TQQQ Snowball Basic (QQQ 52w dip + TP + 5/220 GC/DC, USD)",
    riskSymbol: "tqqq",
    signalSymbol: "qqq",
    valuationCurrency: "USD",
    feeRate: 0.0025,
    annualCashYield: 0.045,
    contributionPlan: {
      initialContribution: 100_000,
      legacyMonthlyContribution: 0
    },
    executionScenarios: [
      { id: "pdf-base", label: "PDF base", slippagePerShare: 0.02 }
    ],
    settings: US_SNOWBALL_BASIC_SETTINGS
  },
  "us-snowball-optimized": {
    type: "snowball-us",
    name: "us-snowball-optimized",
    label: "US TQQQ Snowball Optimized (Default) (QQQ 52w dip + TP + 5/220 GC/DC, USD)",
    riskSymbol: "tqqq",
    signalSymbol: "qqq",
    valuationCurrency: "USD",
    feeRate: 0.0025,
    annualCashYield: 0.045,
    contributionPlan: {
      initialContribution: 100_000,
      legacyMonthlyContribution: 0
    },
    executionScenarios: [
      { id: "pdf-base", label: "PDF base", slippagePerShare: 0.02 }
    ],
    settings: US_SNOWBALL_OPTIMIZED_SETTINGS
  },
  "us-snowball-optimized-sgov": {
    type: "snowball-us",
    name: "us-snowball-optimized-sgov",
    label: "US TQQQ Snowball Optimized (SGOV Parking, USD)",
    riskSymbol: "tqqq",
    signalSymbol: "qqq",
    valuationCurrency: "USD",
    feeRate: 0.0025,
    annualCashYield: 0.045,
    contributionPlan: {
      initialContribution: 100_000,
      legacyMonthlyContribution: 0
    },
    executionScenarios: [
      { id: "pdf-base", label: "PDF base", slippagePerShare: 0.02 }
    ],
    settings: US_SNOWBALL_OPTIMIZED_SGOV_SETTINGS
  },
  "us-snowball-optimized-defensive": {
    type: "snowball-us",
    name: "us-snowball-optimized-defensive",
    label: "US TQQQ Snowball Optimized Defensive (GC TP2 100/10 + SGOV, USD)",
    riskSymbol: "tqqq",
    signalSymbol: "qqq",
    valuationCurrency: "USD",
    feeRate: 0.0025,
    annualCashYield: 0.045,
    contributionPlan: {
      initialContribution: 100_000,
      legacyMonthlyContribution: 0
    },
    executionScenarios: [
      { id: "pdf-base", label: "PDF base", slippagePerShare: 0.02 }
    ],
    settings: US_SNOWBALL_OPTIMIZED_DEFENSIVE_SETTINGS
  },
  "us-snowball-rounded": {
    type: "snowball-us",
    name: "us-snowball-rounded",
    label: "US TQQQ Snowball Rounded (QQQ 52w dip + TP + 5/220 GC/DC, USD)",
    riskSymbol: "tqqq",
    signalSymbol: "qqq",
    valuationCurrency: "USD",
    feeRate: 0.0025,
    annualCashYield: 0.03, // 세후 이자율 3.0% 반영
    contributionPlan: {
      initialContribution: 100_000,
      legacyMonthlyContribution: 0
    },
    executionScenarios: [
      { id: "pdf-base", label: "PDF base", slippagePerShare: 0.02 }
    ],
    settings: US_SNOWBALL_ROUNDED_SETTINGS
  },
  "us-qld-dual": {
    type: "us-qld",
    name: "us-qld-dual",
    label: "US QLD Dual (TQQQ Signal + QLD + SPYM PT)",
    annualCashYield: 0.045,
    feeRate: 0.0025,
    signalModes: [
      {
        id: "pure-200-3d",
        label: "Pure 200 / 3d + Calmar PT",
        mode: "sma200-entry",
        confirmationDays: 3,
        profitTakeSteps: [
          { threshold: 0.3, sellFraction: 0.25 },
          { threshold: 0.65, sellFraction: 1.0 }
        ]
      },
      {
        id: "dual-strict",
        label: "Dual 200/220 strict + Calmar PT",
        mode: "dual-both-entry",
        confirmationDays: 3,
        whipsawExitDays: 10,
        whipsawExitSma: 220,
        profitTakeSteps: [
          { threshold: 0.3, sellFraction: 0.25 },
          { threshold: 0.65, sellFraction: 1.0 }
        ]
      }
    ],
    contributionPlan: {
      initialContribution: 100_000,
      legacyMonthlyContribution: 0
    }
  },
  "isa-kodex": {
    type: "isa",
    name: "isa-kodex",
    label: "ISA TIGER 418660 Strategy",
    annualCashYield: 0.035,
    feeRate: 0.00015,
    signalModes: [
      {
        id: "pure-200-3d",
        label: "Pure 200 / 3d + 3-step PT",
        mode: "sma200-entry",
        confirmationDays: 3,
        isaProfitTakeSteps: ISA_OPTIMIZED_PROFIT_TAKE_STEPS
      },
      {
        id: "dual-strict",
        label: "Dual 200/220 strict + 3-step PT",
        mode: "dual-both-entry",
        confirmationDays: 3,
        whipsawExitDays: 10,
        whipsawExitSma: 220,
        isaProfitTakeSteps: ISA_OPTIMIZED_PROFIT_TAKE_STEPS
      }
    ],
    contributionPlan: {
      initialContribution: 10_000_000,
      legacyMonthlyContribution: 600_000,
      rolloverYearsFromStart: 2,
      renewalInitialContribution: 20_000_000,
      renewalAnnualContribution: 20_000_000,
      renewalAnnualContributionMonth: 1,
      renewalAnnualContributionDay: 2,
      renewalContributionLimit: 100_000_000
    },
    executionScenarios: [
      { id: "optimistic", label: "Optimistic", mode: "fair-value", slipRate: 0 },
      { id: "base", label: "Base", mode: "open", slipRate: 0 },
      { id: "conservative", label: "Conservative", mode: "open", slipRate: 0.005 }
    ]
  }
};

const REQUIRED_FILES = {
  tqqq: "us/tqqq.csv",
  bulz: "us/bulz.csv",
  spym: "us/spym.csv",
  sgov: "us/sgov.csv",
  bil: "us/bil.csv",
  qqq: "us/qqq.csv",
  usdkrw: "fx/usdkrw.csv",
  kodex: "kr/tiger_us_nasdaq100_lev.csv",
  tigerSp500: "kr/tiger_us_sp500.csv",
  qld: "us/qld.csv"
};

export function getRequiredFiles(strategyName) {
  if (strategyName === "us-qld-dual") {
    return {
      tqqq: REQUIRED_FILES.tqqq,
      qqq: REQUIRED_FILES.qqq,
      qld: REQUIRED_FILES.qld,
      spym: REQUIRED_FILES.spym,
      sgov: REQUIRED_FILES.sgov
    };
  }

  if (strategyName === "us-tqqq") {
    return {
      tqqq: REQUIRED_FILES.tqqq,
      spym: REQUIRED_FILES.spym,
      sgov: REQUIRED_FILES.sgov,
      bil: REQUIRED_FILES.bil
    };
  }

  if (strategyName === "us-tqqq-growth") {
    return {
      tqqq: REQUIRED_FILES.tqqq,
      spym: REQUIRED_FILES.spym,
      sgov: REQUIRED_FILES.sgov,
      bil: REQUIRED_FILES.bil
    };
  }

  if (strategyName === "us-tqqq-balance") {
    return {
      tqqq: REQUIRED_FILES.tqqq,
      spym: REQUIRED_FILES.spym,
      sgov: REQUIRED_FILES.sgov,
      bil: REQUIRED_FILES.bil
    };
  }

  if (strategyName === "us-tqqq-defense") {
    return {
      tqqq: REQUIRED_FILES.tqqq,
      spym: REQUIRED_FILES.spym,
      sgov: REQUIRED_FILES.sgov,
      bil: REQUIRED_FILES.bil
    };
  }

  if (strategyName === "us-bulz") {
    return {
      bulz: REQUIRED_FILES.bulz,
      spym: REQUIRED_FILES.spym,
      sgov: REQUIRED_FILES.sgov
    };
  }

  if (
    strategyName === "us-snowball-basic" ||
    strategyName === "us-snowball-optimized" ||
    strategyName === "us-snowball-optimized-sgov" ||
    strategyName === "us-snowball-optimized-defensive" ||
    strategyName === "us-snowball-rounded"
  ) {
    return {
      qqq: REQUIRED_FILES.qqq,
      tqqq: REQUIRED_FILES.tqqq,
      sgov: REQUIRED_FILES.sgov,
      bil: REQUIRED_FILES.bil
    };
  }

  if (strategyName === "isa-kodex") {
    return {
      tqqq: REQUIRED_FILES.tqqq,
      bulz: REQUIRED_FILES.bulz,
      spym: REQUIRED_FILES.spym,
      sgov: REQUIRED_FILES.sgov,
      qqq: REQUIRED_FILES.qqq,
      usdkrw: REQUIRED_FILES.usdkrw,
      kodex: REQUIRED_FILES.kodex,
      tigerSp500: REQUIRED_FILES.tigerSp500
    };
  }

  if (strategyName === "all") {
    return REQUIRED_FILES;
  }

  throw new Error(`Unknown strategy: ${strategyName}`);
}
