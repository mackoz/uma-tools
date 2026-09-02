# ADR-0016: the default CM preset's switchover is anchored to a fixed UTC instant, not each viewer's local midnight

**Status:** Accepted
**Date:** 2026-09-01 (UI-31, `umalator/racePresets.ts`, `presets.ts`, `umalator-global/presets.ts`)

## Context

`umalator`/`umalator-global`'s PRESET dropdown picks a default on first load
(`umalator/app.tsx`'s `DEFAULT_PRESET`). Before UI-31 this used a month-granular heuristic
(scan for the first preset whose calendar month had fully ended, step back one) that had no
relationship to when a Champions Meeting (CM) event actually runs — see
[docs/cm-presets.md](../cm-presets.md) for the full schedule and the bug this produced. UI-31
replaces it with the real CM schedule: prep opens at the daily server reset, two 2-day rounds,
a 1-day final round, and the default should switch to the next cup once the current one's
final-round window has closed.

`umalator-global` is public and viewed from every timezone. The question this ADR settles: when
the schedule says "switch to the next preset at midnight," whose midnight?

## Decision

**Anchor the switchover to a single fixed UTC instant** —
`start-day + 8 days @ 07:00 UTC` (midnight Pacific Daylight Time) — computed once and applied
identically for every viewer, rather than computing a separate local-midnight instant per
viewer's browser timezone.

`umalator/racePresets.ts` encodes the reset as one wall-clock hour
(`CM_RESET_LOCAL_HOUR = 15`) plus one UTC offset (`CM_RESET_UTC_OFFSET = -7`), and derives both
the event-start instant and the switchover instant from those same two constants, rather than
as independent numbers that could drift apart if one were corrected later without the other.

## Options considered

- **Viewer-local midnight** (`new Date(year, month, day + 8)` evaluated in the browser's own
  timezone). Simpler — no UTC offset constant needed — and keeps "the switchover happens on the
  same calendar day" true everywhere. Rejected: it means viewers in different timezones see the
  default preset flip at different *real* instants, up to ~24 hours apart for viewers on
  opposite sides of the date line. The actual game runs on one server schedule; a Tokyo viewer
  and a Los Angeles viewer are looking at the same CM event, and a default that flips at a
  different real moment for each doesn't reflect that.
- **Fixed UTC anchoring** (chosen). Every viewer flips at the same real instant, matching how
  the actual game server operates. The tradeoff is the DST consequence documented in
  [docs/cm-presets.md](../cm-presets.md#the-cm-event-schedule): once US Daylight Saving Time
  ends (2026-11-01), the fixed UTC switchover lands on the calendar day *before* the intended
  Pacific-local midnight for CM 21 onward. Accepted as a real, documented consequence of this
  choice rather than something to special-case away — a per-preset DST correction would
  reintroduce the "does this viewer's timezone match the reporting user's" problem this decision
  was trying to avoid in the first place.

## Consequences

- Every `umalator-global` viewer worldwide sees the same preset flip to the next cup at the same
  real moment, regardless of their own timezone.
- The reset-hour assumption (`CM_RESET_LOCAL_HOUR`/`CM_RESET_UTC_OFFSET`) is unverified against
  the actual game server — only "3 PM in the reporting user's timezone during PDT" is
  established. If that assumption is wrong, the whole schedule shifts uniformly, which is a
  one-place fix rather than a multi-constant reconciliation, because both the event-start and
  switchover instants derive from the same two constants.
- After DST ends, the switchover for CM 21 onward reads as 11:00 PM Pacific the evening before
  the "expected" midnight, until the constants are revisited (e.g. with a real DST-aware
  timezone calculation, if that precision is ever wanted) — documented in
  [docs/cm-presets.md](../cm-presets.md), not silently absorbed.
