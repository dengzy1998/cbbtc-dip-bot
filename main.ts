// Dip-buy bot for the make.fun btc-race-24h bars-replay competition.
//
// Strategy, in one paragraph: cbBTC trades minute by minute against USDC
// with a round trip costing about 26 bps in fees, slippage and price impact,
// while 1-minute noise is only ~7 bps, so the bot trades rarely and only
// for the multi-hour swings. It buys the whole cash balance when the close
// falls at least 1.2% below the highest close of the previous 120 bars (a
// sharp dip off a 2-hour high), then sells everything when the close
// recovers 1.0% above the entry close, when it falls 1.0% below the highest
// close since entry (a trailing stop), or after 480 bars held. It never
// opens a new position in the last 120 bars of the window, so it is never
// forced to sell a just-opened position at the final close. Long only, one
// position, no leverage, no randomness, no wall clock: every decision is
// integer arithmetic on closes.
//
// On the published dev window (2026-11-17 14:44 UTC to 2026-11-18 14:44
// UTC, BTC -2.8% overall) this made about +$12 on $1,000 in three round
// trips, while every kit baseline lost money. The race window is unseen,
// so nothing about that result is a promise: the same rules either catch
// a swing there or sit in cash.

import { runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
// Bars of history a dip is measured against (2 hours of 1-minute bars).
const LOOKBACK_BARS = 120;
// Buy when the close is at least this far below the 120-bar high, in bps.
const DIP_BPS = 120n;
// Sell when the close is at least this far above the entry close, in bps.
const RECOVER_BPS = 100n;
// Trailing stop: sell when the close is at least this far below the
// highest close since entry, in bps.
const STOP_BPS = 100n;
// Give up on a position after this many bars held.
const HOLD_MAX_BARS = 480;
// Do not open a new position after this many tradable bars (the window is
// 1440 bars; the last 120 are left alone so no trade is forced shut).
const NO_BUY_AFTER_BARS = 1320;
// Orders are refused if the fill would move more than this from the latest
// close; a full-size fill normally moves ~10 bps, so 100 bps is ample.
const MAX_SLIPPAGE_BPS = 100;
// A buy must spend at least 1 USDC (1,000,000 quote units).
const MIN_NOTIONAL_QUOTE_UNITS = 1_000_000n;

// Closes seen so far, oldest first, not including the bar being answered.
const closes: bigint[] = [];
// Close of the bar on which the open buy was decided; set once the fill
// shows up as a position. Null while flat with no buy pending.
let pendingEntryClose: bigint | null = null;
// Entry close, highest close since entry, and seq of the entry decision.
let entryClose: bigint | null = null;
let peakClose: bigint | null = null;
let entrySeq: number | null = null;
// Tradable (non-warm-up) batches answered so far.
let tradableBars = 0;

function onBatch(state: BarsState, _batch: Batch): OrderInput[] {
  const close = state.close(SYMBOL);
  if (close === null) return [];
  if (state.warmingUp) {
    closes.push(close);
    return [];
  }

  tradableBars += 1;
  const holding = state.positions.get(SYMBOL);
  const qty = holding === undefined ? 0n : holding.qty;

  if (qty > 0n) {
    if (entryClose === null) {
      // The buy filled: anchor the trade on its decision close.
      entryClose = pendingEntryClose === null ? close : pendingEntryClose;
      peakClose = close > entryClose ? close : entryClose;
      entrySeq = state.seq;
      pendingEntryClose = null;
    }
    if (close > (peakClose as bigint)) peakClose = close;
    const recovered = close * 10000n >= (entryClose as bigint) * (10000n + RECOVER_BPS);
    const stopped = close * 10000n <= (peakClose as bigint) * (10000n - STOP_BPS);
    const stale = state.seq - (entrySeq as number) >= HOLD_MAX_BARS;
    if (recovered || stopped || stale) {
      entryClose = null;
      peakClose = null;
      entrySeq = null;
      return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
  } else {
    // Flat: a buy that never filled is dead; forget its entry price.
    pendingEntryClose = null;
    entryClose = null;
    peakClose = null;
    entrySeq = null;
    if (closes.length >= LOOKBACK_BARS
      && tradableBars <= NO_BUY_AFTER_BARS
      && state.cash > MIN_NOTIONAL_QUOTE_UNITS) {
      let high = closes[closes.length - LOOKBACK_BARS];
      for (let i = closes.length - LOOKBACK_BARS + 1; i < closes.length; i += 1) {
        if (closes[i] > high) high = closes[i];
      }
      if (close * 10000n <= high * (10000n - DIP_BPS)) {
        pendingEntryClose = close;
        entrySeq = state.seq;
        closes.push(close);
        // Spend all the cash, capped by the weight the caps allow (100%
        // of equity on this competition, so the whole balance in practice).
        const room = state.weightRoom(SYMBOL);
        const spend = state.cash < room ? state.cash : room;
        return [{
          side: 'buy', symbol: SYMBOL,
          notional_quote_units: spend,
          max_slippage_bps: MAX_SLIPPAGE_BPS,
        }];
      }
    }
  }

  closes.push(close);
  return [];
}

await runBars({ onBatch });
