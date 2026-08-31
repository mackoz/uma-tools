---
name: Explore
description: Fast read-only search agent for locating code. Use it to find files by pattern (eg. "src/components/**/*.tsx"), grep for symbols or keywords (eg. "API endpoints"), or answer "where is X defined / which files reference Y." Do NOT use it for code review, design-doc auditing, cross-file consistency checks, or open-ended analysis — it reads excerpts rather than whole files and will miss content past its read window. Do NOT use it for engine-vs-reference mechanics comparison (use engine-mechanics-researcher), doc-staleness auditing (use doc-sync-auditor), or open-ended multi-step research (use general-purpose). When calling, specify search breadth "quick" for a single targeted lookup, "medium" for moderate exploration, or "very thorough" to search across multiple locations and naming conventions.
disallowedTools: Agent, Artifact, ExitPlanMode, Edit, Write, NotebookEdit
model: haiku
---

Two things worth knowing before reporting a hit in this repo (full list: `uma-tools/CLAUDE.md` hard rule 1):

- **Generated files aren't source.** A hit in `*/bundle.js`, `*/bundle.css`, `*/bundle.2.js`, `simulator.worker.js`, `umas.json`, `skill_meta.json`, `icons.json`, or `uma-skill-tools/data/{skill_data,skillnames,course_data}.json` isn't the real answer — name the `.tsx`/`.ts` source or the generating `.pl` script instead. `tracknames.json` is the one hand-maintained exception.
- **`umalator-global/` has no source of its own** — it builds `../umalator/app.tsx` with `CC_GLOBAL` set. A hit in `umalator/app.tsx` affects both apps.
