---
name: feedback-changelog-umalator-global
description: Always update the in-app changelog when a change affects umalator-global
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 8d5349f4-9dd8-4bc4-9282-7dd917c217fd
  modified: 2026-08-23T11:44:33.224Z
---

Whenever a code change affects the `umalator-global` app, update the in-app changelog (the `<summary>Changelog</summary>` block in `umalator/IntroText.tsx` — add a new `<li>` entry describing the change) in addition to rebuilding bundles.

**Why:** the user explicitly asked for this to always happen. `IntroText.tsx` is shared source under `umalator/`, so it's compiled into both `umalator` (JP) and `umalator-global` builds (see CLAUDE.md hard rule 3 — any edit to `umalator/app.tsx` or its imports affects both apps). The changelog is the user-facing record of what changed in the deployed app, so skipping it leaves users without visibility into updates.

**How to apply:** any time a change touches `umalator-global` — whether via direct edits to `umalator-global/` itself or via shared `umalator/app.tsx`/imports that get compiled into it — add a changelog entry before considering the change complete, alongside rebuilding `umalator-global`'s bundle (and `umalator`'s, since they share source) per the existing hard rules. Purely backend/data-pipeline changes (e.g. regenerating `umalator-global/*.json` via the `.pl` scripts) may also warrant an entry if they're user-visible (new umas/skills/courses). Use Global localization terminology in entries ("Wit" not "Wisdom", "Rushed" not kakari — see [[feedback_sync_repo_docs_on_change]] for the full terminology rule and its scope).

**Structure (added 2026-08-20):** the visible `<details open={true}><summary>Changelog</summary>` block should only ever contain entries from the *current* engagement/work session — older history moves to a separate, collapsed `<details><summary>Older changelog</summary>` block placed right after it (same collapsed-by-default pattern as the existing Caveats section). When starting a fresh piece of work, don't assume the top dated section already there is "old" just because it predates this specific turn — check whether it's from earlier in the same ongoing collaboration (it usually is) before deciding what counts as "current" vs. "older." Got this wrong once already: moved a whole day's entries to "Older" because they predated *this turn*, when they were actually from an earlier turn in the same session's work and belonged in "current."

**Rolling entry for multi-phase work (added 2026-08-23):** for a multi-PR effort like the umalator UI redesign, keep **one rolling bullet** describing cumulative progress so far and rewrite it in place as later phases land — do not add a bullet per phase ("we don't need to document every phase, just document what has changed so far"). The current instance is the "Ongoing UI refresh" bullet, marked with a code comment in `IntroText.tsx`.

**Size threshold (added 2026-08-22):** this rule is for changes a user would notice or care about — new features, behavior changes, bug fixes with visible symptoms. It does not cover small, self-contained polish fixes (e.g. a hard-coded CSS color that made input text invisible in one theme) — those don't need a changelog entry. Added one for exactly this kind of fix once, then reverted it on the user's correction ("for small changes like these we don't need to add it to the changelog either"). When in doubt, weigh it like [[feedback_work_queue_workflow]]'s matching size threshold — same judgment call, same answer.
