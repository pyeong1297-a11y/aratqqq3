# Validation Checklist

## Data

- Required CSV files exist for the selected strategy
- Dates are sorted ascending
- There are no duplicate dates
- Direct `TQQQ` runs require `TQQQ`, `SPYM`, `SGOV`, `BIL`
- `us-snowball-basic` requires `QQQ`, `TQQQ`
- Direct `BULZ` runs require `BULZ`, `SPYM`, `SGOV`
- ISA runs additionally require `QQQ`, `USDKRW`, `TIGER 418660`, `TIGER US S&P500`

## Signals

- `close > SMA` and `close < SMA` conditions are applied exactly
- `us-tqqq` variants use `SMA200` with 3-day confirmation
- `us-bulz` uses `SMA200` with 2-day confirmation
- `us-snowball-basic` uses `QQQ` 52-week drawdown bands, `TQQQ RSI14`, and `TQQQ 5/220` crossovers
- `dual-strict` only arms after both `SMA200` and `SMA220` are broken
- `dual-strict` uses the 10-session `SMA220` whipsaw rule only right after entry

## Currency

- Direct US strategies are valued in `USD`
- Direct US strategies do not multiply portfolio value by `USDKRW`
- ISA remains KRW-based

## Profit Take

- `us-tqqq-growth`: `100/50 200/100`
- `us-tqqq-balance`: `50/20 100/50 200/100`
- `us-tqqq-defense`: `10/10 25/10 50/10 100/50 200/50 300/50`
- `us-snowball-basic`: `+15/50 +68/35 +350/full`
- `us-bulz`: `100/full -> SGOV`
- ISA shared 3-step PT: `50/33` then `120/75` then `150/full`

## Costs And Taxes

- Direct US fee: `0.25%`
- ISA fee: `0.015%`
- Direct US taxed scenario uses account-currency taxation units
- ISA taxed scenario remains KRW-based

## Interpretation

- Compare `CAGR`, `MDD`, `trade count`, `win rate`, and `exposure` together
- Do not compare direct US USD results against ISA KRW results without normalizing first
