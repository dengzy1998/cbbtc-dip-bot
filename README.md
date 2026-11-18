# cbBTC dip-buy bot

A bot for make.fun's "Race a BTC trading bot live for 24 hours"
(`btc-race-24h-20261118-1444`). It trades Coinbase Wrapped BTC (cbBTC)
against USDC, minute by minute, on paper money only.

## Strategy

A round trip costs about 26 bps in fees, slippage and price impact, while
1-minute noise is only ~7 bps, so the bot trades rarely and only for
multi-hour swings:

- **Buy** the whole cash balance when the close falls at least 1.2% below
  the highest close of the previous 120 bars (a sharp dip off a 2-hour
  high).
- **Sell** everything when the close recovers 1.0% above the entry close,
  when it falls 1.0% below the highest close since entry (trailing stop),
  or after 480 bars held.
- **Never** opens a new position in the last 120 bars of the window.

Long only, one position, no leverage, no randomness, no wall clock.

## Result on the dev window

On the published dev window (2026-11-17 14:44 UTC to 2026-11-18 14:44 UTC,
BTC -2.8% overall) this made about +$12 on $1,000 in three round trips,
while every kit baseline lost money. The race window is unseen, so that
result is no promise: the same rules either catch a swing there or sit in
cash.

## Run

```sh
python3 main.py   # speaks agent-fun/bars-replay/v1 on stdin/stdout
```

`vendor/makefun_bars.py` is a byte-identical copy of the kit's Python shim.
