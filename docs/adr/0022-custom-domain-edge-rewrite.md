# ADR-0022: Custom domain via a Cloudflare edge rewrite, prefix stays hardcoded

**Status:** Accepted
**Date:** 2026-09-15

## Context

The site has deployed since ADR-0002 as a GitHub Pages *project site* at `https://mackoz.github.io/uma-tools/`, with every icon and font referenced by an absolute URL hardcoded to `/uma-tools/...`. That works because a project site is served at `/<repo-name>/`, which happens to equal the hardcoded prefix.

We want the site reachable at a custom domain, `umalator.mackoz.net`. GitHub Pages serves a custom domain at the domain **root** — there is no way to make Pages serve a custom domain under a `/uma-tools/` subpath. Pointed at the domain with no other change, every `/uma-tools/...` asset request 404s: the exact failure mode ADR-0002 already named for other root-serving hosts (Cloudflare Pages, Netlify, a plain vhost), now happening to GitHub Pages itself once a custom domain is attached.

Cloudflare was already the plan for DNS (mackoz.net's zone lives there), which makes its edge features available for free as part of pointing the domain at Pages at all.

## Decision

Serve the Pages site from `umalator.mackoz.net`, keep the hardcoded `/uma-tools/` prefix exactly as ADR-0002 left it, and add a Cloudflare Transform Rule that rewrites an incoming `/uma-tools/*` request path to `/*` before it reaches the GitHub Pages origin. The rule lives only in the Cloudflare dashboard; no source file changes. See `docs/deployment.md`'s "Custom domain" section for the exact rule and the DNS sequencing it depends on (grey-cloud until the certificate provisions, then orange-cloud with Full (strict) TLS).

## Options considered

1. **Cloudflare redirect rule to the `github.io` URL.** `umalator.mackoz.net` → `https://mackoz.github.io/uma-tools/...` as an HTTP redirect. Rejected: zero repo change and works immediately, but the domain is then purely cosmetic — every visitor's browser bar ends up back on `github.io` after the redirect, so the custom domain buys nothing a bookmark to the existing URL didn't already provide.
2. **Cloudflare Worker as a reverse proxy.** Fetch the Pages origin server-side and stream the response back under the custom domain, prefixing `/uma-tools/` onto every asset request itself. Rejected: it keeps the URL and handles the prefix at least as naturally as a rewrite rule, but it routes every page load's icon and font requests through a Worker, competing for the free plan's 100k-requests/day ceiling this site's own traffic would otherwise never approach — a real ongoing cost and an extra network hop, for no behavior a static Transform Rule doesn't already provide.
3. **Make the base path configurable in source and rebuild.** Thread a build-time base-path define through every asset reference and rebuild for the new domain. Rejected: touches all 27 `/uma-tools/` source references (`umalator/app.tsx`, `umalator/tokens.css`, `components/SkillList.tsx`, `components/SkillPicker.tsx`, `components/SkillIcons.ts`, `components/HorseDef.tsx`, `umalator/components/UmasTab.tsx`, `umadle/app.tsx`, `rougelike/app.tsx`) plus every value in `icons.json`, reverses the choice ADR-0002 inherited and re-affirmed, and adds base-path plumbing through shared components (`components/SkillList.tsx`, `components/SkillPicker.tsx`) that render at different depths in different apps — exactly the asymmetry ADR-0002's "relative paths" option was rejected over, just reintroduced through a different mechanism. A large, invasive change to avoid configuring one dashboard rule.

## Consequences

- The load-bearing piece of this setup — the Transform Rule — lives outside version control entirely. Nothing in this repo, its history, or its docs enforces or even reveals its existence beyond the prose in `docs/deployment.md`; a dashboard change with no corresponding commit can silently break the whole site.
- The `github.io` URL now redirects to the custom domain once GitHub registers it (this is GitHub's own behavior, not something either side configures per request) — links to `mackoz.github.io/uma-tools/...` shared before this change now resolve somewhere else than when they were shared.
- The rewrite only fires on traffic that actually passes through Cloudflare's proxy. The DNS record must be grey-clouded (unproxied) for the initial Let's Encrypt certificate issuance, so there is a window, and any future re-issuance or manual grey-cloud, where the record is technically live but the rewrite is not — every asset 404s until the record is orange-clouded again.
- ADR-0002's constraint — "the site only works when served under a path that literally is `/uma-tools/`" — is no longer literally true at the edge: the origin still requires it, but the edge now manufactures it from a URL that doesn't contain it. The constraint is satisfied by infrastructure sitting in front of GitHub Pages, not by the served URL genuinely matching the hardcoded prefix.
