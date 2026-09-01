// PIPE-37: mechanical checks for a self-contained Artifact HTML file (e.g. the output of
// scripts/build-accuracy-artifact.mjs) before publishing it. Reuses the WCAG contrast
// helper from scripts/smoke-page-helpers.mjs rather than smoke.mjs's own harness, which
// hard-fails outside a checkout literally named uma-tools and boots umalator-global's own
// dev server -- neither applies to a standalone artifact file.
//
//   node scripts/check-artifact.mjs <file.html> [--selectors "h1,.stat-value,.card"]
//
// Checks, both color-scheme states (light forced via ?prefers-color-scheme emulation,
// dark via the same): every selector's WCAG contrast ratio (AA thresholds: 4.5:1 normal
// text, 3:1 large text), zero non-null-origin network requests (the CSP a real Artifact
// enforces -- this repo's own build should never depend on one slipping through), and
// document.body.scrollWidth <= clientWidth (no horizontal overflow -- the artifact
// contract requires wide content to scroll in its own container, not the page body).
//
// Exit codes: 0 = all checks passed, 1 = at least one check failed, 2 = playwright not
// installed.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PAGE_HELPERS } from './smoke-page-helpers.mjs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
	console.error(
		'usage: node scripts/check-artifact.mjs <file.html> [--selectors "sel1,sel2"]',
	);
	process.exit(1);
}
const selectorsArgIdx = args.indexOf('--selectors');
const selectors = (
	selectorsArgIdx !== -1
		? args[selectorsArgIdx + 1]
		: 'h1,.eyebrow,.stat-label,.stat-value,.stat-sub,.panel h2,.scope-line,th,td,.verdict-badge,.callout p,.citation'
)
	.split(',')
	.map((s) => s.trim());

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	console.log('check-artifact SKIPPED (playwright not installed)');
	process.exit(2);
}

const fileUrl = pathToFileURL(path.resolve(file)).href;
const checks = [];
function check(id, ok, detail) {
	checks.push({ id, ok, detail });
}

async function runTheme(browser, colorScheme) {
	const context = await browser.newContext({ colorScheme });
	const page = await context.newPage();
	const requests = [];
	page.on('request', (req) => requests.push(req.url()));

	await page.goto(fileUrl);
	await page.evaluate(PAGE_HELPERS);
	await page.waitForTimeout(300); // let the bootstrap script + chart render finish

	// Zero non-null-origin requests -- file:// navigation's own document load appears as
	// a request too, so allow exactly the entry document; anything else (a font fetch
	// that didn't get proxied, a stray absolute asset URL) fails this.
	const foreign = requests.filter(
		(u) => u !== fileUrl && !u.startsWith('data:'),
	);
	// Google Fonts is the one external host the real Artifact CSP admits.
	const trulyForeign = foreign.filter(
		(u) =>
			!u.startsWith('https://fonts.googleapis.com') &&
			!u.startsWith('https://fonts.gstatic.com'),
	);
	check(
		`requests.${colorScheme}`,
		trulyForeign.length === 0,
		trulyForeign.length ? trulyForeign.join(', ') : undefined,
	);

	const overflow = await page.evaluate(() => ({
		scrollWidth: document.body.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
	}));
	check(
		`overflow.${colorScheme}`,
		overflow.scrollWidth <= overflow.clientWidth + 1,
		`scrollWidth=${overflow.scrollWidth} clientWidth=${overflow.clientWidth}`,
	);

	for (const sel of selectors) {
		const els = await page.$$(sel);
		if (els.length === 0) continue;
		const c = await page.evaluate((s) => window.__smoke.contrast(s), sel);
		if (c.error) continue;
		const min = c.large ? 3.0 : 4.5;
		check(
			`contrast.${colorScheme}.${sel}`,
			c.ratio >= min,
			`${c.ratio} < ${min} (fg ${c.fg} on bg ${c.bg}, size=${c.fontSize})`,
		);
	}

	// Trajectory panel interactivity: hovering the chart should update the readout. Use
	// locator.hover() (auto-scrolls the target into view first), not a manual
	// boundingBox()+mouse.move() -- the panel sits well below the fold, and
	// boundingBox() coordinates without an intervening scroll land outside the actual
	// viewport, so a raw mouse.move() silently no-ops (caught by first running this
	// check: it reported the readout as unchanged even though hovering the same chart by
	// hand, through the browser, demonstrably works).
	const hoverLocator = page
		.locator('.traj-chart-host svg .hover-overlay')
		.first();
	if (await hoverLocator.count()) {
		const before = await page.textContent('.traj-readout');
		await hoverLocator.hover();
		await page.waitForTimeout(100);
		const after = await page.textContent('.traj-readout');
		check(
			`trajectory-hover.${colorScheme}`,
			after !== before,
			`before="${before}" after="${after}"`,
		);
	}

	await context.close();
}

const browser = await chromium.launch();
// Each call opens its own browser context (runTheme's first line) -- independent of each
// other, so run them concurrently instead of paying for two full page loads back to back.
// Both push into the shared `checks` array via check(), but every id is already
// colorScheme-qualified (e.g. `contrast.light.h1` vs `contrast.dark.h1`), so interleaved
// push order across the two calls is harmless.
await Promise.all([runTheme(browser, 'light'), runTheme(browser, 'dark')]);
await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log(`check-artifact: ${checks.length} checks, ${failed.length} failed`);
for (const c of failed)
	console.log(`  FAIL ${c.id}${c.detail ? `: ${c.detail}` : ''}`);
process.exit(failed.length ? 1 : 0);
