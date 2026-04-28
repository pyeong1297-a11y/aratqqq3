# Strategy Notes

## Final Scope

The runtime now keeps only these strategies or modes:

- `us-tqqq`
- `us-tqqq-growth`
- `us-tqqq-balance`
- `us-tqqq-defense`
- `us-snowball-basic`
- `us-bulz`
- `isa-kodex / pure-200-3d`
- `isa-kodex / dual-strict`

## Direct US Valuation

Direct US strategies are valued in `USD`.

- initial capital is interpreted in `USD`
- monthly contribution is interpreted in `USD`
- portfolio value does not multiply by `USDKRW`
- if monthly contribution is enabled, cycle-on deposits buy `SPYM`
- if monthly contribution is enabled, risk-off deposits buy `SGOV` or fallback `BIL`

## `us-tqqq`

- Asset: `TQQQ`
- Entry: `close > SMA200` for 3 consecutive US sessions
- Exit: `close < SMA200`
- Profit take: none
- Risk-off parking: `SGOV`, with `BIL` fallback before `SGOV` inception

Current reference result:

- period: `2010-02-11 ~ 2026-04-02`
- base / no tax
- ending value: `$4,631,933`
- total return: `4545.83%`
- CAGR: `26.85%`
- MDD: `-48.76%`

## `us-tqqq-growth`

- base rule: same as `us-tqqq`
- profit-take parking: `SPYM`
- steps:
  - `+100% @ 50%`
  - `+200% @ 100%`

Current reference result:

- period: `2010-02-11 ~ 2026-04-02`
- base / no tax
- ending value: `$5,825,158`
- total return: `5742.64%`
- CAGR: `28.67%`
- MDD: `-43.47%`

## `us-tqqq-balance`

- base rule: same as `us-tqqq`
- profit-take parking: `SPYM`
- steps:
  - `+50% @ 20%`
  - `+100% @ 50%`
  - `+200% @ 100%`

Current reference result:

- period: `2010-02-11 ~ 2026-04-02`
- base / no tax
- ending value: `$5,757,342`
- total return: `5674.62%`
- CAGR: `28.58%`
- MDD: `-40.72%`

## `us-tqqq-defense`

- base rule: same as `us-tqqq`
- profit-take parking: `SPYM`
- steps:
  - `+10% @ 10%`
  - `+25% @ 10%`
  - `+50% @ 10%`
  - `+100% @ 50%`
  - `+200% @ 50%`
  - `+300% @ 50%`

Current reference result:

- period: `2010-02-11 ~ 2026-04-02`
- base / no tax
- ending value: `$4,390,682`
- total return: `4303.86%`
- CAGR: `26.43%`
- MDD: `-38.72%`

## `us-snowball-basic`

- signal asset: `QQQ`
- execution asset: `TQQQ`
- signal reference: `QQQ` adjusted-close drawdown vs rolling `252`-session adjusted high
- dip buys:
  - `-10%`: target `20%` portfolio weight
  - `-22%`: target `70%` portfolio weight
  - `RSI14 <= 35`: add `10%` target weight on top of the active dip band
- profit takes:
  - `+15%`: sell `50%` of base shares
  - `+68%`: sell `35%` of base shares
  - `+350%`: full exit
- trend follow:
  - `TQQQ 5DMA > 220DMA`: invest remaining cash
  - `TQQQ 5DMA < 220DMA`: full exit
  - cooldown: `5` trading days after dead cross
- idle cash yield: `4.5%`

Current reference result:

- period: `2010-02-11 ~ 2026-04-02`
- base / no tax
- ending value: `$55,831,585`
- total return: `55731.59%`
- CAGR: `47.99%`
- MDD: `-53.11%`

## `us-bulz`

- Asset: `BULZ`
- Entry: `close > SMA200` for 2 consecutive US sessions
- Exit: `close < SMA200`
- Profit take: `+100%` full exit
- Profit-take parking: `SGOV`

Current reference result:

- period: `2021-08-18 ~ 2026-04-02`
- base / no tax
- ending value: `$834,260`
- total return: `736.76%`
- CAGR: `58.35%`
- MDD: `-35.03%`

## ISA Wrapper

ISA remains KRW-based.

- signal asset: `TQQQ`
- execution asset: `TIGER US Nasdaq100 Leverage (418660)`
- defensive parking inside ISA: synthetic cash with `3.5%` annual yield
- profit-take destination: `TIGER US S&P500`

Shared ISA profit take:

- `+50%`: sell `33%` into `TIGER US S&P500`
- `+120%`: sell `75%` of remaining into `TIGER US S&P500`
- `+150%`: sell all remaining into `TIGER US S&P500`

### `pure-200-3d`

- arm when `TQQQ close < SMA200`
- enter after `TQQQ close > SMA200` for 3 consecutive US sessions
- exit on `TQQQ close < SMA200`

Current reference result:

- period: `2021-08-18 ~ 2026-04-02`
- base / no tax
- ending value: `166,521,703 KRW`
- total return: `312.45%`
- CAGR: `35.88%`
- MDD: `-29.31%`

### `dual-strict`

- arm only after `TQQQ close < SMA200` and `close < SMA220`
- enter after `TQQQ close > SMA220` for 3 consecutive sessions and the last close is above `SMA200`
- default exit on `TQQQ close < SMA200`
- for the first 10 sessions after entry, only an `SMA220` break can force exit

Current reference result:

- period: `2021-08-18 ~ 2026-04-02`
- base / no tax
- ending value: `186,039,407 KRW`
- total return: `390.58%`
- CAGR: `41.08%`
- MDD: `-28.63%`
