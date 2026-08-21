# Deployment

## The `/uma-tools/` base path

Every icon and font is referenced by an **absolute URL hardcoded to `/uma-tools/...`**, baked into the generated bundles at build time. Key source locations:

- `icons.json` — every value, e.g. `"1001": "/uma-tools/icons/chara/chr_icon_1001.png"`.
- `umalator/app.css:3,8` — `@font-face` rules for the two Inter weights and NotoSansJP.
- `umalator/app.tsx:187–238` and `:3164` — time/weather/season icons and chart-filter backgrounds.
- `components/SkillList.tsx:208,398,612` and `components/SkillPicker.tsx:30,405` — skill icons and filter backgrounds.
- `courseimages/index.html` — inline `@font-face` rules.

Other app-specific images follow the same convention; use `rg '/uma-tools/'` before adding or changing an asset path rather than treating this list as exhaustive.

This means **the site only works correctly when served under a URL path that literally is `/uma-tools/`**. This repo happens to live at `github.com/mackoz/uma-tools`, so GitHub Pages project-site hosting (`https://mackoz.github.io/uma-tools/`) is an exact match — that's the deployment target this doc covers.

(This constraint is **inherited from upstream**, not something this fork introduced — the same `/uma-tools/` prefix appears 77 times in `alpha123/uma-tools`'s own source, for the same reason: its repo is also named `uma-tools`.)

Hosts that serve at the domain root (Cloudflare Pages, Netlify, Vercel, a plain nginx vhost) will 404 every icon and font unless the repo is staged under a `uma-tools/` subfolder of whatever they serve, or the source is changed to make the prefix configurable and rebuilt. Out of scope for this doc — GitHub Pages is the supported path.

## GitHub Pages

1. Repo Settings → Pages → **Source: GitHub Actions**. (Confirmed via `gh api repos/mackoz/uma-tools/pages` → `"build_type": "workflow"`.)
2. Confirm `.nojekyll` exists at repo root (added alongside these docs) so GitHub Pages doesn't run Jekyll processing over directories like `_`-prefixed ones — harmless here since none exist, but it's a standard safety net and costs nothing.
3. Once published, the apps are reachable at:
   - `https://mackoz.github.io/uma-tools/umalator-global/` — primary Global simulator
   - `https://mackoz.github.io/uma-tools/umalator/` — JP version
   - `https://mackoz.github.io/uma-tools/skill-visualizer-global/`, `.../skill-visualizer/`
   - `https://mackoz.github.io/uma-tools/build-planner/`, `.../courseimages/`, `.../umadle/`, `.../rougelike/`
   - `https://mackoz.github.io/uma-tools/` — the root landing page (`index.html`), linking to all of the above.

**If you rename the repository**, the base path breaks — every `/uma-tools/...` asset reference stays hardcoded regardless of the new repo name, since GitHub Pages project sites are served at `/<repo-name>/`.

## Automated builds via GitHub Actions

`.github/workflows/deploy.yml` rebuilds every app that has a `build.mjs` — `umalator`, `umalator-global`, `skill-visualizer-global`, `skill-visualizer`, `courseimages`, `rougelike`, `umadle` — on every push to `master`, then publishes the whole repo tree to Pages via `upload-pages-artifact`. This is now the **only** deploy path: Pages' `build_type` is `workflow`, not the legacy branch-source builder, so there's nothing serving the committed tree in parallel. (It used to be both at once — the legacy branch-source pipeline and this workflow both created a `github-pages` deployment on every push, seconds apart, and whichever finished last silently won; that's why bundles used to need to be committed and current. Fixed 2026-08-20 by flipping Pages' source to GitHub Actions via `gh api -X PUT repos/mackoz/uma-tools/pages -f build_type=workflow`.)

None of those seven apps' `bundle.js`/`bundle.css`/`simulator.worker.js` are tracked in git anymore — see `.gitignore`. `build-planner` is the one app CI does **not** rebuild: its source doesn't compile against the current `uma-skill-tools` layout, and its committed bundle is in fact already broken in production as a result — see [apps.md#build-planner](apps.md#build-planner) for the specifics. That one bundle stays committed until someone fixes the underlying source.

## Local dev

```sh
npm install
cd umalator-global
node build.mjs --serve        # port 8000 by default; node build.mjs --serve 3000 for a custom port
```

Then open `http://localhost:8000/uma-tools/umalator-global/`.

The other `build.mjs`-capable apps (`umalator/`, `skill-visualizer-global/`, `skill-visualizer/`, `courseimages/`, `rougelike/`, `umadle/`) work the same way from their own directories — only `umalator-global/` and `skill-visualizer-global/` have a `--serve` mode; the rest use `node build.mjs [--debug]` and reload manually, or serve statically. `npm run build` at the repo root builds all of them in one shot.

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
