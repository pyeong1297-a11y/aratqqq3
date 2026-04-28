# Data Format

## Directory Layout

```text
data/
  fx/
    usdkrw.csv
  kr/
    tiger_us_nasdaq100_lev.csv
    tiger_us_sp500.csv
  us/
    bil.csv
    bulz.csv
    qqq.csv
    sgov.csv
    spym.csv
    tqqq.csv
```

## CSV Schema

All price files use:

```csv
Date,Open,High,Low,Close,Adj Close,Volume
```

## Active Usage

- `data/us/tqqq.csv`
  - direct `us-tqqq`
  - direct `us-tqqq-growth`
  - direct `us-tqqq-balance`
  - direct `us-tqqq-defense`
  - direct `us-snowball-basic` execution asset
  - ISA signal asset
- `data/us/spym.csv`
  - profit-take parking for direct `TQQQ` variants
  - optional parking inside the ISA US sleeve
- `data/us/sgov.csv`
  - direct US risk-off parking after exits
  - defensive ISA US sleeve parking
- `data/us/bil.csv`
  - pre-`SGOV` parking proxy for direct `TQQQ` runs
- `data/us/bulz.csv`
  - direct `us-bulz`
  - US sleeve inside ISA rollover flow
- `data/us/qqq.csv`
  - direct `us-snowball-basic` signal asset
  - ISA fair-value helper
- `data/kr/tiger_us_nasdaq100_lev.csv`
  - ISA execution asset `418660`
- `data/kr/tiger_us_sp500.csv`
  - ISA profit-take destination
- `data/fx/usdkrw.csv`
  - required for ISA and KRW translation inside the ISA wrapper

## Validation

```bash
npm run check-data
```
