---
name: feedback-subagent-model-selection
description: "Which model to pass via the Agent tool's model param for each built-in subagent type, for token efficiency"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 2e5bd1eb-4cce-45d2-af99-61edb409b804
  modified: 2026-08-24T07:18:13.371Z
---

When spawning a built-in subagent type via the Agent tool in this repo, pass the `model` override param per this table instead of leaving it unset (unset inherits the parent/session model, which is often opus and overkill for narrow tasks):

- `Explore` → `haiku` — read-only grep/find/lookup tasks, cheapest model is sufficient
- `statusline-setup` → `haiku` — trivial, mechanical config edit
- `claude-code-guide` → `sonnet` — needs to search docs and synthesize correctly; haiku produced an inaccurate answer here once (claimed the Agent tool has no per-call `model` param, when it does)
- `general-purpose` → `sonnet` default; escalate to `opus` only for a specific task that's genuinely hard (deep multi-file refactors, ambiguous architecture calls)
- `Plan` → `sonnet` default; `opus` for high-stakes architecture/design decisions where a wrong plan is costly
- `claude` (catch-all) → `sonnet`

**Why:** No persistent settings.json key exists for per-agent-type model defaults (checked model-config.md / settings-reference.md docs), and no custom `.claude/agents/*.md` files exist in this repo to pin models via frontmatter. The only actual control point is the `model` param on each individual `Agent` tool call.

**How to apply:** Every time this session or a future one spawns one of these six built-in types via the Agent tool, set `model` per the table above unless the task's difficulty clearly warrants a different tier.
