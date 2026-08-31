---
name: feedback-sync-repo-docs-on-change
description: "whenever code changes in mackoz/uma-tools or mackoz/uma-skill-tools, check README.md/CLAUDE.md/docs/*.md for claims the change affects and fix them in the same pass"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 8d5349f4-9dd8-4bc4-9282-7dd917c217fd
  modified: 2026-08-20T07:28:53.492Z
---

Whenever a code change is made in either repo — `mackoz/uma-tools` or `mackoz/uma-skill-tools`
(the engine submodule) — check whether that repo's own `README.md`, `CLAUDE.md`, or `docs/*.md`
files need syncing to match, and fix what's now false or incomplete in the same pass, not as a
later dedicated cleanup. This is a **different, complementary scope** from
[[feedback_keep_plans_docs_in_sync]], which is specifically about the `plans/` backlog/comparison
docs in the sibling `uma-tools-plans` repo — that memory covers analysis docs describing what the
code *used to do*; this one covers the repos' own in-tree docs describing what the code *does now*
for someone working in it. Easy to do one and forget the other since both are "sync docs after a
code change," but they're separate files in separate repos with separate audiences.

**How to apply**: after making a change, grep the touched file's old behavior/name or the file
path itself across that repo's `README.md`/`CLAUDE.md`/`docs/*.md` (the technique used for the
`uma-skill-tools` submodule migration's doc sweep and the SKL-3 fix's README update this session)
and fix anything the change makes false. If nothing's false, a change is still often worth a small
addition if it's directly relevant and cheap — don't manufacture doc work, but don't skip an
obviously-relevant one-line addition either.

**Global-localization terminology — scoped narrowly to changelog entries and commit-message
prose, not general repo documentation.** Tried applying this to a `README.md` section once
(kakari → "Rushed") and got corrected: general docs describing a mechanic across both server
variants should stay JP-primary with the Global name glossed in parens — **"kakari (Rushed)"**,
not "Rushed" standing in alone. The rule only holds for text whose whole job is being read by an
end user in the moment (changelog `<li>` entries, commit subject/body prose) — anywhere the JP
term is doing real documentation work (README/CLAUDE.md/`docs/*.md`, code comments, `plans/`
analysis, where precision against the source doc matters more than reader-facing polish), keep
kakari primary and gloss it, don't replace it.

Within that narrow scope, use the **Global client's own localized names**, not JP terms or
GameTora-derived approximations:
- Mechanic names: "Rushed" in a changelog line or commit subject, "kakari (Rushed)" everywhere else.
- Skill names: pull the *official* Global name from `master.mdb`'s `text_data` table, category 47
  (`sqlite3 master.mdb "SELECT [index], text FROM text_data WHERE category=47 AND [index]=<skillId>"`)
  — not `uma-skill-tools/data/skillnames.json`'s GameTora-derived names, which can differ
  materially (confirmed once already: GameTora had "Gamester"/"Questionable Strategy"/"All or
  Nothing" for 3 skills whose real Global names are "Nothing Ventured"/"Risky Business"/"It's All
  or Nothing").
