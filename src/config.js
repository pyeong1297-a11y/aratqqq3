export const DEFAULTS = {
  dataDir: "data",
  initialCapital: 100_000_000
};

export const TAX_MODES = [
  { id: "none", label: "세금 미반영" },
  { id: "taxed", label: "세금 반영" }
];

export const STRATEGIES = {
  "us-tqqq": {
    type: "us",
    name: "us-tqqq",
    label: "미국 TQQQ 전략",
    riskSymbol: "tqqq",
    confirmationDays: 3,
    feeRate: 0.0025,
    slippageScenarios: [
      { id: "optimistic", label: "낙관적", slippageRate: 0.0 },
      { id: "base", label: "기준", slippageRate: 0.0005 },
      { id: "conservative", label: "보수적", slippageRate: 0.001 },
      { id: "stress", label: "스트레스", slippageRate: 0.002 }
    ],
    profitTakeSteps: [
      { threshold: 0.5, sellFraction: 0.2 },
      { threshold: 1.0, sellFraction: 0.5 },
      { threshold: 2.0, sellFraction: 0.5 },
      { threshold: 3.0, sellFraction: 0.5 }
    ]
  },
  "us-bulz": {
    type: "us",
    name: "us-bulz",
    label: "미국 BULZ 전략",
    riskSymbol: "bulz",
    confirmationDays: 2,
    feeRate: 0.0025,
    slippageScenarios: [
      { id: "optimistic", label: "낙관적", slippageRate: 0.0 },
      { id: "base", label: "기준", slippageRate: 0.0005 },
      { id: "conservative", label: "보수적", slippageRate: 0.001 },
      { id: "stress", label: "스트레스", slippageRate: 0.002 }
    ],
    profitTakeSteps: [
      { threshold: 0.5, sellFraction: 0.2 },
      { threshold: 1.0, sellFraction: 0.5 },
      { threshold: 2.0, sellFraction: 0.5 },
      { threshold: 3.0, sellFraction: 0.5 }
    ]
  },
  "isa-kodex": {
    type: "isa",
    name: "isa-kodex",
    label: "ISA KODEX 전략",
    confirmationDays: 1,
    annualCashYield: 0.035,
    feeRate: 0.00015,
    signalModes: [
      {
        id: "dual-early",
        label: "Dual 200/220 early",
        mode: "dual-min-entry",
        confirmationDays: 3
      },
      {
        id: "dual-strict",
        label: "Dual 200/220 strict",
        mode: "dual-both-entry",
        confirmationDays: 3,
        whipsawExitDays: 10,
        whipsawExitSma: 220
      },
      {
        id: "long-only",
        label: "Long-only leverage DCA",
        mode: "long-only",
        confirmationDays: 0
      }
    ],
    allocationModes: [
      {
        id: "risk-on-sp500",
        label: "Risk-on additions to TIGER S&P500",
        mode: "risk-on-additions-sp500",
        envelopePct: null
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
      { id: "optimistic", label: "낙관적", mode: "fair-value", slipRate: 0 },
      { id: "base", label: "기준", mode: "open", slipRate: 0 },
      { id: "conservative", label: "보수적", mode: "open", slipRate: 0.005 }
    ]
  }
};

const REQUIRED_FILES = {
  tqqq: "us/tqqq.csv",
  bulz: "us/bulz.csv",
  spym: "us/spym.csv",
  sgov: "us/sgov.csv",
  qqq: "us/qqq.csv",
  qld: "us/qld.csv",
  usdkrw: "fx/usdkrw.csv",
  kodex: "kr/kodex_nasdaq100_lev_h.csv",
  tigerSp500: "kr/tiger_us_sp500.csv",
  tigerNasdaq100: "kr/tiger_us_nasdaq100.csv"
};

export function getRequiredFiles(strategyName) {
  if (strategyName === "us-tqqq") {
    return {
      tqqq: REQUIRED_FILES.tqqq,
      spym: REQUIRED_FILES.spym,
      sgov: REQUIRED_FILES.sgov,
      usdkrw: REQUIRED_FILES.usdkrw
    };
  }

  if (strategyName === "us-bulz") {
    return {
      bulz: REQUIRED_FILES.bulz,
      spym: REQUIRED_FILES.spym,
      sgov: REQUIRED_FILES.sgov,
      usdkrw: REQUIRED_FILES.usdkrw
    };
  }

  if (strategyName === "isa-kodex") {
    return {
      tqqq: REQUIRED_FILES.tqqq,
      bulz: REQUIRED_FILES.bulz,
      spym: REQUIRED_FILES.spym,
        sgov: REQUIRED_FILES.sgov,
        qqq: REQUIRED_FILES.qqq,
        qld: REQUIRED_FILES.qld,
        usdkrw: REQUIRED_FILES.usdkrw,
        kodex: REQUIRED_FILES.kodex,
        tigerSp500: REQUIRED_FILES.tigerSp500
      };
  }

  if (strategyName === "all") {
    return REQUIRED_FILES;
  }

  throw new Error(`알 수 없는 전략입니다: ${strategyName}`);
}
