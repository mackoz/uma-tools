---
name: feedback-keep-and-generalize-test-tools
description: "Always keep test scripts/tools created while implementing a fix; after the implementation plan is finalized, check whether they can be generalized for future tests"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 4000c33d-e8de-4868-9575-c8a18e4d9ff6
  modified: 2026-08-26T01:21:33.100Z
---

Whenever a script or tool is created to test new code (e.g. a stub-based unit test, a
verification harness, a one-off checker), keep it rather than deleting it once its immediate
purpose is served. Once implementation for the current task is done and the plan is finalized,
check whether what was created can be generalized into a reusable tool for future tests, and do
that generalization as a deliberate follow-up step — not just left as one-off, task-specific code.

**Why:** Given directly by the user during the DYN-8/DYN-14 (Spot Struggle) work in `uma-tools`.
In that session, three mechanics tests (`test/rushed-escape-roll.ts`,
`test/spot-struggle-duration.ts`, `test/spot-struggle-group.ts`) were each built with hand-rolled
stub-building boilerplate, and the duplication across them was only fixed after the user
explicitly asked for it — the natural instinct was to treat each test's scaffolding as disposable
to that ticket. The user wants the harvesting step to happen proactively as standard practice, not
only on request.

**How to apply:** After finishing implementation and writing/updating the plan or ticket for the
current task, before considering the task fully done: (1) confirm every test/verification script
written along the way is still present in the repo (not deleted as scratch work), and (2) look at
what it does — if the same shape (a stub-building pattern, a verification loop, a seeding idiom,
etc.) would help a *future* test of similar code, factor it into a shared, named, reusable
module/helper rather than leaving it duplicated or buried in one test file. See
[[project_plans_directory]] for where this repo's own conventions and work-queue docs on testing
live if a matching doc needs updating alongside the refactor.
