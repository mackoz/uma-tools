# ADR-0002: Assets use a hardcoded `/uma-tools/` absolute prefix

**Status:** Inherited (rationale reconstructed)
**Date recorded:** 2026-08-21 (convention predates this fork; documented in `docs/deployment.md`)

## Context

The site deploys to GitHub Pages as a *project site*, which is always served under `/<repo-name>/` — here, `https://mackoz.github.io/uma-tools/`. Icons and fonts are referenced from many places (`icons.json` values, CSS `@font-face` rules, inline component paths) and by multiple apps living at different depths (`/uma-tools/umalator-global/`, `/uma-tools/skill-visualizer/`, …).

## Decision

Every icon and font is referenced by an **absolute URL hardcoded to `/uma-tools/...`**, baked into the bundles at build time. New asset references must follow the same convention (`CLAUDE.md` hard rule 4; `docs/deployment.md` lists the key source locations and says to `rg '/uma-tools/'` rather than treating any list as exhaustive).

## Options considered

- **Relative paths.** Rejected: the same shared components render at different URL depths depending on which app includes them, so one relative path cannot resolve correctly everywhere; `icons.json` values in particular are consumed from multiple apps.
- **A configurable base-path define.** Not taken (inherited): a single hosting target makes the indirection pure overhead; `docs/deployment.md` explicitly scopes support to GitHub Pages and calls other hosts out of scope.

## Consequences

- The site only works when served under a path that literally is `/uma-tools/` — renaming the repository breaks every asset reference, and root-serving hosts (Cloudflare Pages, Netlify, a plain vhost) 404 all icons and fonts unless staged under a `uma-tools/` subfolder.
- Local dev must reproduce the prefix: the dev server serves from the checkout's *parent* directory and only resolves cleanly if the clone is named `uma-tools` (`docs/deployment.md`'s local-dev gotcha).
- In exchange, asset references are uniform and context-free: the same string works from any app at any depth, and there is no base-path plumbing to thread through components.

## Amendments

**2026-09-15:** The first Consequences bullet's "root-serving hosts … 404 all icons and fonts unless staged under a `uma-tools/` subfolder" now has a third resolution, alongside staging under a subfolder or making the prefix configurable: an edge rewrite that strips the `/uma-tools/` segment from the incoming request, so the hardcoded URLs still resolve against an origin that serves at the root. This is now how the site's custom domain (`umalator.mackoz.net`) — itself a root-serving host, from GitHub Pages' point of view — satisfies the constraint, without reversing the decision recorded above. See `docs/adr/0022-custom-domain-edge-rewrite.md`.
