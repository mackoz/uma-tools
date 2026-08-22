# ADR-0008: Chart cancellation terminates and respawns workers

**Status:** Accepted
**Date:** 2026-08-21 (`umalator/workerPool.ts`, PR #11)

## Context

A chart run fans thousands of simulations out to a pool of web workers. When the user hits Stop (or starts a superseding run), the old behavior only marked the stale run's results as ignored — the CPUs kept burning through the abandoned batch. A worker mid-race is inside a synchronous step loop and cannot notice anything until it yields.

## Decision

`WorkerPool.cancelAll()` **terminates every worker and eagerly respawns them**. The module's own comment states the reasoning: "so CPU actually stops for a superseded run instead of merely having its results ignored. There is no cooperative alternative here: a worker mid-race is in a synchronous step loop and can't poll for a cancel message until it yields, and the SharedArrayBuffer/Atomics.wait alternative needs COOP/COEP headers GitHub Pages can't set."

The pool also owns worker lifecycle exclusively, with the message handler swapped per render (`setHandler`) — replacing an earlier pattern that called `useMemo` inside a `.map()` callback (a rules-of-hooks violation that worked only by accident) and closed over stale state.

## Options considered

- **Cooperative cancellation (poll a flag / check for a message).** Rejected: the simulation loop is synchronous; the worker can't observe the flag until the batch yields, which is exactly too late.
- **`SharedArrayBuffer` + `Atomics` signaling.** Rejected: requires cross-origin-isolation (COOP/COEP) response headers, which GitHub Pages cannot set (`docs/deployment.md`) — see ADR-0004 for why Pages is the deployment target.
- **Let stale runs finish and discard results.** The prior state; rejected as the bug: minutes of wasted CPU and a hot laptop for a run the user already abandoned.

## Consequences

- Stop actually stops: CPU drops immediately, and the eager respawn means the next run doesn't pay worker-startup latency.
- Termination is indiscriminate — any in-flight batch on any worker dies, so the protocol must (and does) treat every batch as restartable from its block identity (ADR-0007's reproducible blocks are what make this safe).
- Worker startup cost is paid on every cancellation; acceptable because cancellations are user-initiated and rare relative to batches.
