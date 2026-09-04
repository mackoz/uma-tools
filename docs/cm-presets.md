# CM presets and the default-preset schedule

`umalator`/`umalator-global`'s PRESET dropdown lists past and upcoming Champions Meeting (CM)
and League of Heroes (LOH) events, and picks one of them as the default shown on first load.
This page documents the event schedule that default is based on (UI-31), where the preset data
itself lives, and a couple of traps found while building it.

## The CM event schedule

Every CM event follows the same pattern, anchored to the daily server reset. All that's actually
established about the reset is "3 PM in the reporting user's timezone," observed during Pacific
Daylight Time — **this is an assumption, not verified against the actual game server**, encoded
in `umalator/racePresets.ts` as one wall-clock hour (`CM_RESET_LOCAL_HOUR = 15`) plus one UTC
offset (`CM_RESET_UTC_OFFSET = -7`, i.e. 22:00 UTC) rather than as independent constants, so
correcting it later only means changing two numbers in one place.

Worked example — Libra Cup 2, `date: '2026-08-25'`:

| Phase | Offset from start | PDT | UTC |
|---|---|---|---|
| Event start / prep opens | start | 8/25 3:00 PM | 8/25 22:00 |
| Round 1 | start +3d .. +5d | 8/28 3PM – 8/30 2:59 PM | 8/28 22:00 – 8/30 21:59 |
| Round 2 | start +5d .. +7d | 8/30 3PM – 9/1 2:59 PM | 8/30 22:00 – 9/1 21:59 |
| Final round | start +7d .. +8d | 9/1 3PM – 9/2 2:59 PM | 9/1 22:00 – 9/2 21:59 |
| Final-round roster lock-in | start +7d12h | 9/2 3:00 AM | 9/2 10:00 |
| **Default preset switches to the next cup** | **start-day +8d @ 00:00 local** | **9/2 12:00 AM** | **9/2 07:00** |

The switchover — when the dropdown's default moves on to the next cup — is anchored to a fixed
UTC instant (`start-day + 8 days @ 07:00 UTC`, i.e. midnight PDT), not to each viewer's own local
midnight. Every viewer worldwide flips at the same real instant, matching how the actual game
server works, rather than each viewer flipping at a different real instant depending on their
timezone. See [ADR-0016](adr/0016-cm-preset-schedule-fixed-utc-anchoring.md) for why that was
chosen over viewer-local midnight.

**Daylight Saving consequence.** US DST ends 2026-11-01. From CM 21 (Capricorn Cup 2,
`date: '2026-10-27'`) onward, the fixed-UTC switchover lands on the calendar day *before* the
final-round lock-in day in Pacific-local terms — e.g. CM 21's switchover is
`2026-11-04T07:00Z`, which is **2026-11-03 11:00 PM PST**, not midnight on the 4th. This is a
real consequence of anchoring to a fixed UTC instant rather than local wall-clock time, not a
bug — flagging it here so it isn't mistaken for one later.

**LOH** events use the same 8-day window as CM (`LOH_SCHEDULE_DAYS` in `racePresets.ts`,
currently equal to `CM_SCHEDULE_DAYS`). LOH's real schedule isn't documented anywhere in this
repo or known upstream; this is a named, visible assumption (an explicit `case` in
`racePresets.ts`'s `scheduleDays()`, not a fallthrough) rather than a silent default, and easy to
correct once someone actually knows LOH's cadence. In practice this has no visible effect today —
every LOH entry in the current JP preset list is historical.

## Default-preset selection rule

The active preset is the one with the smallest switchover that is still in the future. If every
preset's switchover has already passed (the whole list is stale), the rule falls back to the one
with the *largest* (most recent) switchover, rather than leaving the picker to fall off the end of
the list — this preserves the intent of a pre-UI-31 fix for the same problem (commit `8fc296c`).
Ties resolve to whichever entry appears first in the preset list.

This rule is deliberately independent of how `presets.ts` orders its entries — the pre-UI-31
logic silently depended on the list being sorted newest-first, which is easy to violate by
accident when hand-editing a list of 24+ entries.

**Known limitation, accepted as scoped:** the default only applies to a fresh profile. A
returning user's last-simulated state (`localStorage['umalator-settings']`) or a URL hash both
take priority over the schedule-derived default — see `umalator/app.tsx`'s `loadState()`. Rolling
a returning user forward once their saved preset has expired is out of scope for UI-31.

## Where the data lives

Preset data is **hand-maintained**, not pipeline output — there is no `master.mdb` generator for
future/upcoming events the way there is for `umas.json`/`skill_meta.json`/course data. It's the
same category as `tracknames.json` (see `CLAUDE.md`'s hard rule 1 and
[data-pipeline.md](data-pipeline.md)):

- **`presets.ts`** (repo root) — the JP dataset, 9 entries.
- **`umalator-global/presets.ts`** — the Global dataset, 24 entries.

Both are `.ts` modules, not JSON, holding a `satisfies readonly RawPreset[]`-checked array of
plain objects. This was a deliberate choice over JSON: `RawPreset`'s `season`/`ground`/`weather`/
`time` fields (defined in `umalator/racePresets.ts`) are literal string unions mirroring the
*member names* of `uma-skill-tools/RaceParameters.ts`'s `Season`/`GroundCondition`/`Weather`/
`Time` enums (`'Spring'`, `'Good'`, `'Sunny'`, `'Midday'`, ...), so a typo or a value that isn't a
real enum member is a compile-time `tsc` error pinpointing the exact line — see the `GroundCondition.Firm`
story below for why that guarantee matters. A plain JSON file can't offer this: `resolveJsonModule`
widens every JSON value to `string`, so even a *correct* `presets.json` could only be consumed via
an unchecked `as` cast. Being `.ts` also means the file can carry comments (the estimation
rationale below) next to the data they explain, and — because the file holds no runtime `enum`
import, only literal string types that are erased at compile time — it stays importable under
Vitest, so `umalator/racePresets.test.ts` validates the real files (every entry's enum-name
fields, and that every date parses) as part of `npm run test` (`vitest run`).

`umalator-global/build.mjs`'s `redirectData` esbuild plugin redirects a `presets.ts` import to
`umalator-global/presets.ts`, exactly like it already does for `umas.json`/`unreleased.json`.
`umalator/build.mjs` needs no equivalent — it has no redirect plugin, so `umalator/app.tsx`'s
`import rawPresets from '../presets.ts'` resolves to the repo-root JP file naturally, the same way
`'../skill_meta.json'` already does.

Values are the engine-canonical enum member names, never a UI's *display label* — this matters
because Global's `GroundSelect` relabels the `GroundCondition` scale:

| `GroundCondition` member | value | Global UI label | JP UI label |
|---|---|---|---|
| `Good` | 1 | Firm | 良 |
| `Yielding` | 2 | Good | 稍重 |
| `Soft` | 3 | Soft | 重 |
| `Heavy` | 4 | Heavy | 不良 |

so `ground: 'Good'` in `presets.ts` is not ambiguous with `ground: 'Yielding'` the way it would
be if the data stored Global's own label instead.

### The `GroundCondition.Firm` bug (fixed by UI-31)

Before UI-31, four Global preset entries (Aries Cup 2, Pisces Cup 2, Capricorn Cup 2, and Scorpio
Cup 2 — the last of which was the actual pre-fix default preset) used a literal
`ground: GroundCondition.Firm`. **`GroundCondition` has no `Firm` member** — the real scale is
the four rows in the table above. `tsc --noEmit` reported this as `TS2339` on all four lines, but
nothing in any build script ran `tsc` (there is no `tsc` step in any `build.mjs`), so the error
went unnoticed. At runtime, esbuild neither inlines nor errors on the nonexistent member — it
just evaluates `GroundCondition.Firm` to `undefined`. Immutable.js's `Record.get` then substitutes
the record's own default value, `GroundCondition.Good` (1) — which Global's `GroundSelect` labels
"Firm". **The displayed value was correct purely by accident.** Rewriting the data as the literal
string `'Good'`, validated by `satisfies`, both fixes the immediate bug and makes a recurrence a
compile-time error instead of a silent `undefined`.

### The `estimated` flag and the 21-day extrapolation

Global's second lap through the 12 zodiac cups (`Taurus Cup 2` onward) replays JP's *original
2022-2023 debut* course/condition selections for each cup, not JP's current rotation — confirmed
by cross-referencing Libra Cup 2 (course data: Hanshin Turf 1600m) against JP's original October
2022 Libra Cup run (also Hanshin Turf 1600m, an exact match), while JP's *current* Libra Cup uses
a completely different course. For lap-2 cups that hadn't been reached yet at data-entry time, the
course/conditions come from that same JP 2022-2023 debut run, and the `date` is a flat **21-day**
extrapolation forward from the last known real date (Libra Cup 2, 2026-08-25):

```
CM 18 Libra Cup 2       2026-08-25  (real)
CM 19 Scorpio Cup 2     2026-09-15  (was estimated; confirmed correct — flag removed)
CM 20 Sagittarius Cup 2 2026-10-06  (estimated: true)
CM 21 Capricorn Cup 2   2026-10-27  (estimated: true)
CM 22 Aquarius Cup 2    2026-11-17  (estimated: true)
CM 23 Pisces Cup 2      2026-12-08  (estimated: true)
CM 24 Aries Cup 2       2026-12-29  (estimated: true)
```

This 21-day cadence is a simplification, not a measured average — the real gaps between known
lap-2 cups vary from 11 to 31 days (Leo Cup 2 → Virgo Cup 2 was 11 days; Cancer Cup 2 → Leo Cup 2
was 31). Each `RawPreset` entry's optional `estimated: true` field marks which dates are this
extrapolation rather than an observed date; entries without the flag are confirmed. When Global's
list needs extending further, mark the new entries `estimated: true` and drop the flag once the
real date is confirmed (as happened for Scorpio Cup 2 here) — don't silently leave a stale
estimate unmarked.

### The JP dropdown's "CM undefined - undefined" labels

JP preset entries currently carry no `id`/`name` fields at all (unlike Global's), so the dropdown
option label — `'CM ' + p.id + ' - ' + p.name` in `umalator/app.tsx`'s `RacePresets` component —
renders literally as `"CM undefined - undefined"` for every JP entry. This predates UI-31 and is
tracked as its own ticket rather than fixed here; see the work queue for the current ticket id.
