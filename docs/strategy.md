# Strategy Notes

## Final Scope

The runtime now keeps only these strategies or modes:

- `us-tqqq`
- `us-tqqq-growth`
- `us-tqqq-balance`
- `us-tqqq-defense`
- `us-snowball-basic`
- `us-snowball-optimized`
- `us-bulz`
- `isa-kodex / pure-200-3d`
- `isa-kodex / dual-strict`

Reference data was refreshed from Yahoo on `2026-04-29`.

- US symbols: through `2026-04-28`
- KR/FX symbols: through `2026-04-29`
- Reference execution: no slippage, `0.25%` trading fee

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

Current reference results:

- period: `2010-02-11 ~ 2026-04-28`
- base / no tax: ending value `$5,296,445`, total return `5209.69%`, CAGR `27.77%`, MDD `-48.65%`
- base / taxed: ending value `$2,830,615`, total return `2737.69%`, CAGR `22.93%`, MDD `-51.02%`

## `us-tqqq-growth`

- base rule: same as `us-tqqq`
- profit-take parking: `SPYM`
- steps:
  - `+100% @ 50%`
  - `+200% @ 100%`

Current reference results:

- period: `2010-02-11 ~ 2026-04-28`
- base / no tax: ending value `$6,688,709`, total return `6605.43%`, CAGR `29.62%`, MDD `-43.03%`
- base / taxed: ending value `$3,438,040`, total return `3346.64%`, CAGR `24.41%`, MDD `-49.04%`

## `us-tqqq-balance`

- base rule: same as `us-tqqq`
- profit-take parking: `SPYM`
- steps:
  - `+50% @ 20%`
  - `+100% @ 50%`
  - `+200% @ 100%`

Current reference results:

- period: `2010-02-11 ~ 2026-04-28`
- base / no tax: ending value `$6,619,522`, total return `6536.07%`, CAGR `29.54%`, MDD `-40.25%`
- base / taxed: ending value `$3,372,101`, total return `3280.53%`, CAGR `24.26%`, MDD `-46.40%`

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

Current reference results:

- period: `2010-02-11 ~ 2026-04-28`
- base / no tax: ending value `$5,062,643`, total return `4975.30%`, CAGR `27.42%`, MDD `-38.10%`
- base / taxed: ending value `$2,657,980`, total return `2564.62%`, CAGR `22.45%`, MDD `-43.75%`

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

Current reference results:

- period: `2010-02-11 ~ 2026-04-28`
- base / no tax: ending value `$99,322,564`, total return `99222.56%`, CAGR `53.08%`, MDD `-52.83%`
- base / taxed: ending value `$45,598,235`, total return `45498.24%`, CAGR `45.90%`, MDD `-52.83%`

## `us-snowball-optimized`

- base rule: same as `us-snowball-basic`
- optimized parameters:
  - dip1 drawdown: `-11%`
  - dip2 drawdown: `-22%`
  - TP1: `+37%`, sell `53%` of base shares
  - TP2: `+87%`, sell `47%` of base shares
  - TP3: `+355%`, full exit

Current reference results:

- period: `2010-02-11 ~ 2026-04-28`
- base / no tax: ending value `$148,843,792`, total return `148743.79%`, CAGR `56.94%`, MDD `-52.83%`
- base / taxed: ending value `$66,875,502`, total return `66775.50%`, CAGR `49.39%`, MDD `-52.83%`

## `us-bulz`

- Asset: `BULZ`
- Entry: `close > SMA200` for 2 consecutive US sessions
- Exit: `close < SMA200`
- Profit take: `+100%` full exit
- Profit-take parking: `SGOV`

Current reference results:

- period: `2021-08-18 ~ 2026-04-28`
- base / no tax: ending value `$1,013,691`, total return `916.23%`, CAGR `63.90%`, MDD `-34.64%`
- base / taxed: ending value `$755,543`, total return `657.43%`, CAGR `53.95%`, MDD `-39.67%`

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

Current reference results:

- period: `2021-08-18 ~ 2026-04-29`
- base / no tax: ending value `189,121,228 KRW`, total return `366.26%`, CAGR `38.80%`, MDD `-28.33%`
- base / taxed: ending value `168,337,515 KRW`, total return `308.76%`, CAGR `34.97%`, MDD `-28.09%`

### `dual-strict`

- arm only after `TQQQ close < SMA200` and `close < SMA220`
- enter after `TQQQ close > SMA220` for 3 consecutive sessions and the last close is above `SMA200`
- default exit on `TQQQ close < SMA200`
- for the first 10 sessions after entry, only an `SMA220` break can force exit

Current reference results:

- period: `2021-08-18 ~ 2026-04-29`
- base / no tax: ending value `206,945,845 KRW`, total return `427.44%`, CAGR `42.50%`, MDD `-27.09%`
- base / taxed: ending value `183,607,020 KRW`, total return `360.45%`, CAGR `38.43%`, MDD `-26.79%`
