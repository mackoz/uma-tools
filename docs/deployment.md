# Deployment

## The `/uma-tools/` base path

Every icon and font is referenced by an **absolute URL hardcoded to `/uma-tools/...`**, baked into the generated bundles at build time. Key source locations:

- `icons.json` — every value, e.g. `"1001": "/uma-tools/icons/chara/chr_icon_1001.png"`.
- `umalator/tokens.css:13,21,29` — `@font-face` rules for the two Inter weights and NotoSansJP (moved here from `app.css` during the UI-9 design-token redesign).
- `umalator/app.tsx:482,533,557,6957` — time/weather/season icons and chart-filter backgrounds.
- `components/SkillList.tsx:932` and `components/SkillPicker.tsx:43,570` — skill icons and filter backgrounds.
- `courseimages/index.html` — inline `@font-face` rules.

Other app-specific images follow the same convention; use `rg '/uma-tools/'` before adding or changing an asset path rather than treating this list as exhaustive.

This means **the site only works correctly when served under a URL path that literally is `/uma-tools/`**. This repo happens to live at `github.com/mackoz/uma-tools`, so GitHub Pages project-site hosting (`https://mackoz.github.io/uma-tools/`) is an exact match — that's the deployment target this doc covers.

Hosts that serve at the domain root (Cloudflare Pages, Netlify, Vercel, a plain nginx vhost) will 404 every icon and font unless the repo is staged under a `uma-tools/` subfolder of whatever they serve, or the source is changed to make the prefix configurable and rebuilt. That constraint is real, and it now applies to GitHub Pages itself: attaching a custom domain (see "Custom domain" below) makes Pages serve at the domain root too, the same as any of the hosts above. This deployment satisfies the constraint on its custom domain with a Cloudflare edge rewrite that *strips* the `/uma-tools/` prefix from each incoming request before it reaches Pages, so the hardcoded URLs the bundles emit resolve against a root-served origin — not by making the prefix configurable in source. Other root-serving hosts remain out of scope for this doc.

## GitHub Pages

1. Repo Settings → Pages → **Source: GitHub Actions**. (Confirmed via `gh api repos/mackoz/uma-tools/pages` → `"build_type": "workflow"`.)
2. Confirm `.nojekyll` exists at repo root (added alongside these docs) so GitHub Pages doesn't run Jekyll processing over directories like `_`-prefixed ones — harmless here since none exist, but it's a standard safety net and costs nothing.
3. Once published, the apps are reachable at:
   - `https://mackoz.github.io/uma-tools/umalator-global/` — primary Global simulator
   - `https://mackoz.github.io/uma-tools/umalator/` — JP version
   - `https://mackoz.github.io/uma-tools/skill-visualizer-global/`, `.../skill-visualizer/`
   - `https://mackoz.github.io/uma-tools/build-planner/`, `.../courseimages/`
   - `https://mackoz.github.io/uma-tools/` — the root landing page (`index.html`), linking to all of the above.

Those `mackoz.github.io` URLs now 301 to the custom domain — see "Custom domain" below.

**If you rename the repository**, the base path breaks — every `/uma-tools/...` asset reference stays hardcoded regardless of the new repo name, since GitHub Pages project sites are served at `/<repo-name>/`.

## Custom domain

The site is served at **`https://umalator.mackoz.net/`** (the bare hostname redirects to `/umalator-global/`). `mackoz.github.io/uma-tools/` still works, but only as a redirect — GitHub 301s the default domain to the custom one once a custom domain is set, so previously shared links land on the new domain rather than serving from `github.io` directly. Deep links keep their sub-path: `mackoz.github.io/uma-tools/umalator-global/` → `umalator.mackoz.net/umalator-global/`. See `docs/adr/0022-custom-domain-edge-rewrite.md` for why this was worth doing rather than leaving `github.io` as the only address.

Pages serves a custom domain at the **domain root**, which strips the `/uma-tools/` segment every icon and font URL is hardcoded against. A Cloudflare URL-rewrite rule puts it back by stripping the prefix on the way to the origin. That rule is what makes the site work at all on this domain.

**The `CNAME` file is not the mechanism, and this repo does not have one.** GitHub's own docs are explicit: "If you are publishing from a custom GitHub Actions workflow, no `CNAME` file is created, and any existing `CNAME` file is ignored and is not required." This repo's Pages source is `workflow` (see "Automated builds" below), so a committed `CNAME` does nothing at all — it was tried, shipped in the artifact, and left `gh api repos/mackoz/uma-tools/pages` reporting `"cname": null`. The custom domain lives **only** in Settings → Pages (or `gh api -X PUT repos/mackoz/uma-tools/pages -f cname=...`). Don't re-add the file expecting it to do something.

### Setup, in this order

1. **DNS first**: a `CNAME umalator → mackoz.github.io` record, **grey-clouded (DNS only)**. GitHub cannot complete its Let's Encrypt HTTP challenge through the Cloudflare proxy, so the record must stay unproxied until the certificate is issued.
2. **All three Cloudflare rules next**, while nothing is proxied and they are therefore inert. Cloudflare warns that the rules may not match traffic because the record is not proxied — that warning is expected here; choose "Ignore and deploy rule anyway", **not** "Create a new proxied DNS record" (which would add a competing proxied record and block certificate issuance).
3. **Then Settings → Pages → Custom domain** = `umalator.mackoz.net`. **This is the cutover**: from this moment `github.io` redirects here. Wait for the certificate (minutes to about an hour), then tick **Enforce HTTPS** — without it GitHub emits `http://` in its redirect and plain HTTP 404s, breaking every legacy link.
4. **Last**, orange-cloud the DNS record and set SSL/TLS to **Full (strict)**. Both rules start firing at this point.

The site is degraded between steps 3 and 4 — reachable but unstyled, since Cloudflare is not yet in the path — so run them back to back rather than pausing in between.

**SSL/TLS must be Full (strict), and this is not optional.** Enforce HTTPS makes the origin redirect HTTP to HTTPS. On **Flexible**, Cloudflare connects to the origin over HTTP, receives that redirect, returns it to the browser, and connects over HTTP again on the retry — an infinite loop presenting as `ERR_TOO_MANY_REDIRECTS` across the whole site. Avoid "Automatic SSL/TLS" too: it probes the origin and can sit on a weaker mode while deciding. Note this is a **zone-wide** setting — it applies to every *proxied* hostname under `mackoz.net`, so check what else is orange-clouded before changing it. (`t.mackoz.net`, the PostHog telemetry proxy in `umalator/telemetry.ts`, is DNS-only and therefore unaffected.)

### The three rules

The first two use the dashboard's **Wildcard pattern** mode; the third is a cache rule. Do not use `regex_replace()` — it is gated to Business/Enterprise plans and WAF Advanced, and saving a rule containing it on Free or Pro fails with an entitlement error ("not available to this plan"). Wildcard mode uses no expression functions and has no such gate.

**Rewrite rule** (Rules → URL rewrite rule) — strips the prefix so the hardcoded asset URLs resolve:

| Field | Value |
|---|---|
| Request URL | `https://umalator.mackoz.net/uma-tools/*` |
| Path → Target path | `/uma-tools/*` |
| Path → Rewrite to | `/${1}` |
| Query | leave both blank |

`Request URL` **matches but does not capture** — per Cloudflare's docs it "will not be used for capturing URL patterns for rewrites". `${1}` refers to the `*` in **Target path**, not the one in Request URL. Naming the host in Request URL is deliberate: rules are zone-wide, so a bare path pattern would also rewrite `/uma-tools/*` on every other hostname under `mackoz.net`.

**Redirect rule** (Rules → Redirects) — points the bare hostname at the app it is named after:

| Field | Value |
|---|---|
| Request URL | `https://umalator.mackoz.net/` |
| Target URL | `https://umalator.mackoz.net/umalator-global/` |
| Status code | 302 |
| Preserve query string | on |

The absence of a `*` is load-bearing: a wildcard pattern must match the whole URL, so this matches only the root. Adding `*` would match every path on the site and redirect all of it, icons included, into a loop. 302 rather than 301 because browsers cache a 301 aggressively and it is painful to walk back.

Shared simulator links survive the redirect: umalator serializes state into `location.hash` (`umalator/app.tsx:4426`), fragments are never sent to the server, and the browser reattaches the original fragment to the redirect target since the target carries none of its own.

**Cache rule** (Caching → Cache Rules) — **required, not an optimization.** Before the custom domain, GitHub Pages' own CDN purged on every deploy, so a push was live immediately. Cloudflare does not know a deploy happened, and cached the build artifacts for four hours: a push would appear not to have taken effect, tempting you to debug a build that was in fact fine. Worst case is a stale `simulator.worker.js` — the simulation engine — behind a fresh UI, silently producing results that disagree with what the same build's changelog claims.

Bypass cache for the three files that change on every deploy, leaving the 404 icons and three variable fonts (the files edge caching actually helps) cached normally. Set the filter via **Edit expression** rather than the row builder:

```
(http.request.full_uri wildcard r"https://umalator.mackoz.net/*bundle.*") or (http.request.full_uri wildcard r"https://umalator.mackoz.net/*simulator.worker.js")
```

Cache eligibility **Bypass cache**, and add **Browser TTL → Respect origin TTL**. Without the Browser TTL setting Cloudflare applies its own 4-hour default, and — as the dashboard itself warns — *purging Cloudflare's cache does not clear browsers' caches*, so a returning visitor would hold a stale bundle regardless. With it, GitHub Pages' own `max-age=600` passes through.

Use the expression box rather than entering builder rows one at a time. Building this rule row-by-row silently dropped a different row on two consecutive attempts (`bundle.css` first, then `simulator.worker.js`), each time with a pattern shape identical to rows that worked — the cause was never established, and a dropped row fails silently.

A new cache rule only governs future responses, so **purge once after creating it** (Caching → Configuration → Purge Everything) to clear whatever is already stored.

### Resulting behavior

Cloudflare evaluates redirects (`http_request_dynamic_redirect`) before URL rewrites (`http_request_transform`), whatever order they appear in the dashboard — see [Cloudflare's phases list](https://developers.cloudflare.com/ruleset-engine/reference/phases-list/). The redirect therefore sees the *original* path, before the prefix is stripped, which produces two deliberate entry points:

| Request | Redirect | Rewrite | Result |
|---|---|---|---|
| `/` | fires → `/umalator-global/` | no match | the Global simulator |
| `/uma-tools/` | no match (path isn't `/`) | strips to `/` | the multi-app landing page |
| `/uma-tools/icons/10011.png` | no match | strips to `/icons/10011.png` | the icon |

The second row is what legacy `github.io/uma-tools/` links reach, preserving their old behavior — that URL always served the landing page, not the simulator.

One cosmetic wart: GitHub emits `http://` in its redirect even with Enforce HTTPS on, so a legacy link takes two hops (`github.io` → `http://` → `https://`) instead of one. It resolves correctly; it is not worth chasing.

**Both rules exist only in the Cloudflare dashboard — nothing in this repo references them.** If either is deleted, or the DNS record is set back to DNS-only (which bypasses Cloudflare entirely), the symptom is a completely unstyled page with no icons and no Japanese font, with no in-repo explanation for why. This is the single most important thing to know about this section.

### Verifying

Confirmed working 2026-09-15, in both directions:

```sh
curl -sI https://umalator.mackoz.net/                            # 302 -> /umalator-global/
curl -so /dev/null -w '%{http_code}\n' \
  https://umalator.mackoz.net/uma-tools/icons/10011.png          # 200 image/png
curl -so /dev/null -w '%{http_code}\n' \
  "https://umalator.mackoz.net/uma-tools/fonts/Inter-VariableFont_opsz,wght.ttf"   # 200
curl -sIL https://mackoz.github.io/uma-tools/umalator-global/    # ends 200 on the custom domain
```

The comma in `Inter-VariableFont_opsz,wght.ttf` is the likeliest thing to break through a proxy (see "Serving notes" below) — it survives this one, but re-check it after any edge-config change. A missing font shows as fallback serif/sans rather than a visible error, so it is easy to miss by eye.

Check the cache rule with the response headers, not by eye — a stale bundle looks identical to a fresh one:

```sh
curl -sI https://umalator.mackoz.net/umalator-global/bundle.js | grep -i 'cf-cache-status\|cache-control'
#   cf-cache-status: DYNAMIC     <- bypassing, correct
#   cache-control: max-age=600   <- origin's own header, so Browser TTL is respected
```

`DYNAMIC` on all six build artifacts (`bundle.js`, `bundle.css`, `simulator.worker.js` × `umalator/` and `umalator-global/`) is the pass condition. `HIT` or `MISS` on any of them means the rule is not matching it, and `cache-control: max-age=14400` is the corroborating signal — that is Cloudflare's default leaking through where the rule missed. An icon should still go `MISS` then `HIT` on a second request; if icons report `DYNAMIC`, the rule is too broad and you have given up edge caching on the assets that most need it.

If DNS looks wrong while testing, query a public resolver rather than trusting the local cache (`dig +short @1.1.1.1 umalator.mackoz.net`). A proxied record returns Cloudflare anycast IPs (`104.x`/`172.67.x`) and hides the CNAME target; a grey-clouded one reveals the target and GitHub's `185.199.x` addresses.

## Automated builds via GitHub Actions

`.github/workflows/deploy.yml` rebuilds every app that has a `build.mjs` — `umalator`, `umalator-global`, `skill-visualizer-global`, `skill-visualizer`, `courseimages` — on every push to `master`, then publishes the whole repo tree to Pages via `upload-pages-artifact`. A `paths-ignore` filter skips the run when *every* file in the push is markdown or `scripts/verify-baseline.json` — no deployed app reads either at runtime, and the baseline is re-recorded in its own commit after each `tsc` burn-down slice. Note that skipping does not make those files absent from Pages: `path: .` above publishes them like any other tracked path, so what a skip actually leaves behind is a stale already-live copy, harmless only because nothing fetches them there. A push that also touches real source still builds. This is now the **only** deploy path: Pages' `build_type` is `workflow`, not the legacy branch-source builder, so there's nothing serving the committed tree in parallel. (It used to be both at once — the legacy branch-source pipeline and this workflow both created a `github-pages` deployment on every push, seconds apart, and whichever finished last silently won; that's why bundles used to need to be committed and current. Fixed 2026-08-20 by flipping Pages' source to GitHub Actions via `gh api -X PUT repos/mackoz/uma-tools/pages -f build_type=workflow`.)

None of those seven apps' `bundle.js`/`bundle.css`/`simulator.worker.js` are tracked in git anymore — see `.gitignore`. `build-planner` is the one app CI does **not** rebuild: its source doesn't compile against the current `uma-skill-tools` layout, and its committed bundle is in fact already broken in production as a result — see [apps.md#build-planner](apps.md#build-planner) for the specifics. That one bundle stays committed until someone fixes the underlying source.

## Local dev

```sh
npm install
cd umalator-global
node build.mjs --serve        # port 8000 by default; node build.mjs --serve 3000 for a custom port
```

Then open `http://localhost:8000/uma-tools/umalator-global/`. An agent (or anyone who wants a server that
can be stopped without `pkill -f` guesswork) should use `scripts/dev-serve.sh start|status|stop
[--port N]` instead — it is idempotent and only ever signals the process it started (PIPE-67).

The other `build.mjs`-capable apps (`umalator/`, `skill-visualizer-global/`, `skill-visualizer/`, `courseimages/`) work the same way from their own directories — only `umalator-global/` and `skill-visualizer-global/` have a `--serve` mode; the rest use `node build.mjs [--debug]` and reload manually, or serve statically. `npm run build` at the repo root builds all of them in one shot.

### Local dev gotcha: the server root is your checkout's *parent* directory

Both `umalator-global/build.mjs` and `skill-visualizer-global/build.mjs` compute their static-file root as:

```js
const root = path.join(dirname, '..', '..');   // i.e. two levels above the sub-app dir
```

That's the **parent of the whole repo checkout** — every request for `/uma-tools/icons/...`, `/uma-tools/fonts/...`, or `index.html` is resolved against `<checkout-parent>/uma-tools/...` on disk, not against files inside this repo. Only the three build artifacts (`bundle.js`, `bundle.css`, `simulator.worker.js`) are served from the in-memory esbuild rebuild — everything else comes from disk at that computed path.

**In practice: this only works if your local clone of this repo is a directory literally named `uma-tools`.** If you've cloned it under a different name (a fork suffix, a different folder name, etc.), the dev server will serve icons/fonts/`index.html` from whatever *actually is* named `uma-tools` next to your checkout — which may not exist, or may be an unrelated/stale clone, and either way isn't the code you're editing. Rename or symlink your checkout to `uma-tools` before running `--serve` if you hit missing icons or a stale-looking page despite editing source.

## Serving notes

- `simulator.worker.js` must be a sibling of `index.html` — it's created at runtime via `new Worker('./simulator.worker.js')` (a page-relative URL), not referenced from `index.html` itself.
- Serve `.ttf` as a font MIME type. Note `fonts/Inter-VariableFont_opsz,wght.ttf` has a **comma in the filename** — some CDNs/hosts mangle commas in URLs; GitHub Pages handles it fine.
- No JSON is fetched at runtime — every data file is inlined into the JS bundle at build time. You do not need to expose `*.json` to the web server for the app to function (though there's no harm in it being reachable).
- The only runtime network calls are PostHog telemetry (Global build only, disabled in debug/serve mode) and a user-initiated Gemini OCR call (roster screenshot import) using a key the user supplies themselves. Nothing server-side, no API you need to run.
