# Deployment

## The `/uma-tools/` base path

Every icon and font is referenced by an **absolute URL hardcoded to `/uma-tools/...`**, baked into the committed bundles at build time. Source locations:

- `icons.json` — every value, e.g. `"1001": "/uma-tools/icons/chara/chr_icon_1001.png"`.
- `umalator/app.css:3,8` — `@font-face` rules for the two Inter weights and NotoSansJP.
- `umalator/app.tsx:222` and `:3089` — season icons and skill icon backgrounds.
- `components/SkillList.tsx:612`, `components/SkillPicker.tsx:405` — skill icon backgrounds.
- `courseimages/index.html` — inline `@font-face` rules.

This means **the site only works correctly when served under a URL path that literally is `/uma-tools/`**. This repo happens to live at `github.com/mackoz/uma-tools`, so GitHub Pages project-site hosting (`https://mackoz.github.io/uma-tools/`) is an exact match — that's the deployment target this doc covers.

(This constraint is **inherited from upstream**, not something this fork introduced — the same `/uma-tools/` prefix appears 77 times in `alpha123/uma-tools`'s own source, for the same reason: its repo is also named `uma-tools`.)

Hosts that serve at the domain root (Cloudflare Pages, Netlify, Vercel, a plain nginx vhost) will 404 every icon and font unless the repo is staged under a `uma-tools/` subfolder of whatever they serve, or the source is changed to make the prefix configurable and rebuilt. Out of scope for this doc — GitHub Pages is the supported path.

## GitHub Pages (recommended, zero build required)

The committed bundles are current — `git ls-files` shows every `*/bundle.js`, `*/bundle.css`, and `*/simulator.worker.js` tracked in git, and the repo's `.gitignore` only excludes `node_modules/`. GitHub Pages can therefore serve the repository directly with no build step:

1. Repo Settings → Pages → **Source: Deploy from a branch** → branch `master`, folder `/ (root)`.
2. Confirm `.nojekyll` exists at repo root (added alongside these docs) so GitHub Pages doesn't run Jekyll processing over directories like `_`-prefixed ones — harmless here since none exist, but it's a standard safety net and costs nothing.
3. Once published, the apps are reachable at:
   - `https://mackoz.github.io/uma-tools/umalator-global/` — primary Global simulator
   - `https://mackoz.github.io/uma-tools/umalator/` — JP version
   - `https://mackoz.github.io/uma-tools/skill-visualizer-global/`, `.../skill-visualizer/`
   - `https://mackoz.github.io/uma-tools/build-planner/`, `.../courseimages/`, `.../umadle/`, `.../rougelike/`
   - `https://mackoz.github.io/uma-tools/` — the root landing page (`index.html`), linking to all of the above.

**If you rename the repository**, the base path breaks — every `/uma-tools/...` asset reference stays hardcoded regardless of the new repo name, since GitHub Pages project sites are served at `/<repo-name>/`.

## Automated builds via GitHub Actions

`.github/workflows/deploy.yml` rebuilds the three apps that have a `build.mjs` (`umalator`, `umalator-global`, `skill-visualizer-global`) on every push to `master`, then publishes the whole repo tree to Pages. This exists so source changes don't silently go stale relative to their committed bundles (see the `CLAUDE.md` guardrail on this).

It deliberately does **not** rebuild:
- `umadle` — its `build.bat` depends on `accessible-autocomplete`, which isn't in `package.json` (see [apps.md](apps.md#umadle)); a clean `npm ci` can't build it.
- `build-planner`, `courseimages`, `skill-visualizer`, `rougelike` — `.bat`-only, Windows-oriented build scripts not easily run in CI as-is.

Those four ship whatever's currently committed. If you change their source, rebuild locally (Wine, a Windows runner, or by hand-translating the `.bat` into equivalent `esbuild` CLI flags) and commit the result.

## Local dev

```sh
npm install
cd umalator-global
node build.mjs --serve        # port 8000 by default; node build.mjs --serve 3000 for a custom port
```

Then open `http://localhost:8000/uma-tools/umalator-global/`.

The other `build.mjs`-capable apps (`umalator/`, `skill-visualizer-global/`) work the same way from their own directories (`umalator/` has no `--serve` mode — use `node build.mjs --debug` and reload manually, or serve statically).

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
