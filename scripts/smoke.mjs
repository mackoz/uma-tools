// Browser smoke test for umalator-global: boots the dev server, drives a real
// Chromium through both themes, and asserts computed styles (text contrast,
// z-index stacking, clipping) plus basic interactions (search, skill picker,
// Skill Chart tab). Run via `npm run smoke` or as a stage of `npm run verify`.
//
//   node scripts/smoke.mjs [--port N] [--chart-run] [--headed] [--artifacts DIR]
//
// Screenshots and smoke-report.json land in scripts/smoke-artifacts/ (gitignored).
// Exit codes: 0 = all checks passed, 1 = at least one check failed,
// 2 = playwright/chromium not installed (verify reports this as SKIPPED).
//
// Must run from the main checkout: the dev server serves the repo's *parent*
// directory, so /uma-tools/-prefixed asset URLs only resolve when the checkout
// directory is literally named uma-tools (worktrees break this by design).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// WCAG contrast + z-index/rect helpers, injected into the page via page.evaluate below.
// Extracted to scripts/smoke-page-helpers.mjs (PIPE-37) so scripts/check-artifact.mjs can
// reuse the same contrast helper without importing this whole smoke suite.
import { PAGE_HELPERS } from './smoke-page-helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function argValue(flag, dflt) {
	const i = process.argv.indexOf(flag);
	return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const basePort = +argValue('--port', '8123');
const chartRun = process.argv.includes('--chart-run');
const headed = process.argv.includes('--headed');
const artifactsDir = path.resolve(
	root,
	argValue('--artifacts', 'scripts/smoke-artifacts'),
);

if (path.basename(root) !== 'uma-tools') {
	console.error(
		`smoke FAILED: must run from a checkout named uma-tools (this is ${path.basename(root)}).\n` +
			'The dev server serves the parent directory and asset URLs are /uma-tools/-prefixed, ' +
			'so worktree checkouts 404 on icons/fonts. Run from the main checkout.',
	);
	process.exit(1);
}

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	console.log(
		'smoke SKIPPED: playwright not installed (npm i -D playwright && npx playwright install chromium)',
	);
	process.exit(2);
}

fs.mkdirSync(artifactsDir, { recursive: true });

// ---- dev server lifecycle -----------------------------------------------------

let server = null;
let serverStderr = [];

function killServer() {
	if (server && !server.killed) server.kill('SIGTERM');
}
process.on('exit', killServer);
process.on('SIGINT', () => {
	killServer();
	process.exit(1);
});

async function startServer(port) {
	server = spawn('node', ['build.mjs', '--serve', String(port)], {
		cwd: path.join(root, 'umalator-global'),
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	server.stderr.on('data', (d) => {
		serverStderr.push(d.toString());
		if (serverStderr.length > 40) serverStderr.shift();
	});
	server.stdout.resume();
	const url = `http://localhost:${port}/uma-tools/umalator-global/`;
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		if (server.exitCode != null) return null; // died (e.g. EADDRINUSE)
		try {
			const r = await fetch(url);
			if (r.ok) return url;
		} catch {}
		await new Promise((r) => setTimeout(r, 250));
	}
	return null;
}

// ---- check bookkeeping --------------------------------------------------------

const checks = [];
const pageErrors = [];
let currentTheme = null;
let currentPage = null;

async function check(id, fn, meta = {}) {
	const rec = { id, theme: currentTheme, ok: true, ...meta };
	try {
		const detail = await fn();
		if (detail) Object.assign(rec, detail);
	} catch (e) {
		rec.ok = false;
		rec.message = String(e.message || e)
			.split('\n')
			.slice(0, 3)
			.join(' ');
		if (currentPage) {
			const shot = path.join(
				artifactsDir,
				`fail-${id.replace(/[^\w.-]/g, '_')}-${currentTheme}.png`,
			);
			try {
				await currentPage.screenshot({ path: shot });
				rec.screenshot = path.relative(root, shot);
			} catch {}
		}
	}
	checks.push(rec);
	return rec.ok;
}

function fail(msg, detail) {
	const e = new Error(msg);
	if (detail) Object.assign(e, detail);
	throw e;
}

async function assertContrast(page, id, selector, minOverride) {
	await check(
		id,
		async () => {
			const c = await page.evaluate(
				(sel) => window.__smoke.contrast(sel),
				selector,
			);
			if (!c || c.error) fail(`${selector}: ${c ? c.error : 'no result'}`);
			const min = minOverride ?? (c.large ? 3.0 : 4.5);
			if (c.ratio < min) {
				fail(
					`${selector}: contrast ${c.ratio} < ${min} (fg ${c.fg} on bg ${c.bg})`,
				);
			}
			return {
				selector,
				expected: `>= ${min}`,
				actual: c.ratio,
				fg: c.fg,
				bg: c.bg,
			};
		},
		{ selector },
	);
}

async function shoot(page, name) {
	const p = path.join(artifactsDir, `${name}-${currentTheme}.png`);
	await page.screenshot({ path: p });
}

// ---- per-theme run ------------------------------------------------------------

async function runTheme(browser, url, theme) {
	currentTheme = theme;
	const context = await browser.newContext({
		viewport: { width: 1280, height: 800 },
		colorScheme: theme,
	});
	await context.addInitScript((t) => localStorage.setItem('theme', t), theme);
	// Block third-party requests (analytics) for determinism; localhost only.
	await context.route('**/*', (route) => {
		const host = new URL(route.request().url()).hostname;
		if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]')
			route.continue();
		else route.abort();
	});
	const page = await context.newPage();
	currentPage = page;
	page.setDefaultTimeout(5000);
	page.on('pageerror', (e) =>
		pageErrors.push({ theme, message: String(e.message || e) }),
	);
	page.on('console', (msg) => {
		// --serve implies --debug, so console.assert noise is expected; blocked
		// third-party requests also log resource errors. Only real errors count.
		if (msg.type() !== 'error') return;
		const text = msg.text();
		if (/Failed to load resource|ERR_FAILED|Assertion/i.test(text)) return;
		pageErrors.push({ theme, message: text.slice(0, 300) });
	});

	await page.goto(url, { waitUntil: 'domcontentloaded' });
	await page.waitForSelector('#navBar', { state: 'visible', timeout: 15_000 });
	await page.evaluate(PAGE_HELPERS);
	// The app applies .dark in an effect after first paint and .tabsItem has
	// `transition: all`, so computed colors can be mid-fade when measured.
	// Freeze transitions/animations so style assertions see settled values.
	await page.addStyleTag({
		content:
			'*, *::before, *::after { transition: none !important; animation: none !important; }',
	});

	const errorsBefore = pageErrors.length;

	// theme init actually applied
	await check('theme.init', async () => {
		const isDark = await page.evaluate(() =>
			document.documentElement.classList.contains('dark'),
		);
		if (isDark !== (theme === 'dark')) {
			fail(
				`html.dark is ${isDark}, expected ${theme === 'dark'} for theme=${theme}`,
			);
		}
		return { expected: theme, actual: isDark ? 'dark' : 'light' };
	});

	// no horizontal document scroll on the main screen
	await check('clip.hscroll', async () => {
		const r = await page.evaluate(() => ({
			scrollWidth: document.documentElement.scrollWidth,
			innerWidth: window.innerWidth,
		}));
		if (r.scrollWidth > r.innerWidth) {
			fail(`document scrollWidth ${r.scrollWidth} > viewport ${r.innerWidth}`);
		}
		return { expected: `<= ${r.innerWidth}`, actual: r.scrollWidth };
	});

	// key chrome within viewport
	await check('clip.navbar', async () => {
		const r = await page.evaluate((sel) => window.__smoke.rect(sel), '#navBar');
		if (!r) fail('#navBar not found');
		if (r.x < 0 || r.right > 1280)
			fail(`#navBar overflows horizontally (x ${r.x}, right ${r.right})`);
		return {
			selector: '#navBar',
			actual: `x ${Math.round(r.x)}..${Math.round(r.right)}`,
		};
	});

	// contrast on always-visible chrome
	await assertContrast(
		page,
		'contrast.modetab-active',
		'#modeTabs .tabsItem.active',
	);
	await assertContrast(
		page,
		'contrast.modetab-inactive',
		'#modeTabs .tabsItem:not(.active)',
	);
	await assertContrast(
		page,
		'contrast.uma-search-input',
		'input.umaSelectInput',
	);

	await shoot(page, 'main');

	// uma name search: suggestions open and offer at least one result
	await check('search.uma', async () => {
		const input = page.locator('input.umaSelectInput').first();
		await input.click();
		await input.fill('spe');
		await page.waitForSelector('ul.umaSuggestions.open li.umaSuggestion', {
			state: 'visible',
		});
		const n = await page
			.locator('ul.umaSuggestions.open li.umaSuggestion')
			.count();
		await page.keyboard.press('Escape');
		if (n < 1) fail('no uma suggestions for "spe"');
		return {
			selector: 'ul.umaSuggestions.open li.umaSuggestion',
			expected: '>= 1',
			actual: n,
		};
	});

	// skill picker modal: open, stacking, filter, clipping, close
	const pickerOpened = await check('modal.picker-open', async () => {
		await page.locator('button.horseAddSkillBtn').first().click();
		await page.waitForSelector('.skill-picker-overlay', { state: 'visible' });
		await page.waitForSelector('.skill-picker-modal', { state: 'visible' });
		return { selector: '.skill-picker-overlay' };
	});

	if (pickerOpened) {
		await check('zindex.picker-above-sidebar', async () => {
			const z = await page.evaluate(() => ({
				picker: +window.__smoke.zIndex('.skill-picker-overlay'),
				sidebar: +window.__smoke.zIndex('#iconSidebar'),
			}));
			if (!(z.picker > z.sidebar)) {
				fail(
					`.skill-picker-overlay z ${z.picker} not above #iconSidebar z ${z.sidebar}`,
				);
			}
			return { expected: `> ${z.sidebar}`, actual: z.picker };
		});

		await check('modal.picker-filter', async () => {
			await page.waitForSelector('.skill-picker-item', { state: 'visible' });
			const before = await page.locator('.skill-picker-item').count();
			await page.locator('.skill-picker-search input').fill('speed');
			await page.waitForTimeout(400);
			const after = await page.locator('.skill-picker-item').count();
			if (after < 1) fail(`filtering for "speed" left ${after} items`);
			if (after >= before && before > 20)
				fail(`filter had no effect (${before} -> ${after})`);
			return {
				selector: '.skill-picker-item',
				expected: `1..${before - 1}`,
				actual: after,
			};
		});

		await check('clip.picker-modal', async () => {
			const r = await page.evaluate(
				(sel) => window.__smoke.rect(sel),
				'.skill-picker-modal',
			);
			if (!r) fail('.skill-picker-modal not found');
			if (r.x < 0 || r.right > 1280 || r.y < 0 || r.bottom > 800) {
				fail(
					`modal overflows viewport (x ${Math.round(r.x)}..${Math.round(r.right)}, y ${Math.round(r.y)}..${Math.round(r.bottom)})`,
				);
			}
			const list = await page.evaluate(() => {
				const el = document.querySelector('.skill-picker-list');
				if (!el) return null;
				const cs = getComputedStyle(el);
				return { overflowY: cs.overflowY };
			});
			if (!list) fail('.skill-picker-list not found');
			if (list.overflowY !== 'auto' && list.overflowY !== 'scroll') {
				fail(
					`.skill-picker-list overflow-y is ${list.overflowY}, long lists would clip`,
				);
			}
			return { selector: '.skill-picker-modal' };
		});

		await assertContrast(
			page,
			'contrast.picker-item',
			'.skill-picker-item .skill-picker-item-name, .skill-picker-item',
		);
		await assertContrast(
			page,
			'contrast.picker-search',
			'.skill-picker-search input',
		);

		await shoot(page, 'skillpicker');

		await check('modal.picker-close', async () => {
			await page.locator('.skill-picker-close').click();
			await page.waitForSelector('.skill-picker-overlay', {
				state: 'detached',
			});
			return { selector: '.skill-picker-close' };
		});
	}

	// info modal: deliberately stacked BELOW the icon sidebar (UI-7) so sidebar
	// navigation stays clickable — assert that ordering as intentional.
	const infoOpened = await check('modal.info-open', async () => {
		await page
			.locator('#iconSidebar .tabsItem[aria-label="About & changelog"]')
			.click();
		await page.waitForSelector('.infoModalOverlay', { state: 'visible' });
		return { selector: '.infoModalOverlay' };
	});

	if (infoOpened) {
		await check('zindex.infomodal-below-sidebar', async () => {
			const z = await page.evaluate(() => ({
				overlay: +window.__smoke.zIndex('.infoModalOverlay'),
				sidebar: +window.__smoke.zIndex('#iconSidebar'),
			}));
			if (!(z.overlay < z.sidebar)) {
				fail(
					`.infoModalOverlay z ${z.overlay} should stay below #iconSidebar z ${z.sidebar} (intentional, see UI-7)`,
				);
			}
			return { expected: `< ${z.sidebar}`, actual: z.overlay };
		});
		await assertContrast(page, 'contrast.infomodal', '.infoModal');
		await shoot(page, 'infomodal');
		await check('modal.info-close', async () => {
			await page.locator('.infoModalClose').click();
			await page.waitForSelector('.infoModalOverlay', { state: 'detached' });
			return { selector: '.infoModalClose' };
		});
	}

	// Skill Chart tab: controls render; the actual run is opt-in (--chart-run)
	const chartOpened = await check('chart.tab', async () => {
		await page
			.locator('#modeTabs .tabsItem', { hasText: 'Skill Chart' })
			.click();
		await page.waitForSelector('#chartRunSettings', { state: 'visible' });
		const active = await page
			.locator('#modeTabs .tabsItem.active')
			.textContent();
		if (!/Skill Chart/.test(active || ''))
			fail(`active mode tab is "${active}", not Skill Chart`);
		return { selector: '#chartRunSettings' };
	});

	if (chartOpened) {
		await check('chart.controls', async () => {
			for (const sel of ['#chartIconFilter', '#run']) {
				if (!(await page.locator(sel).first().isVisible()))
					fail(`${sel} not visible on Skill Chart tab`);
			}
			return { selector: '#chartIconFilter, #run' };
		});

		// Shop skills shortlist filter (UI-27, redesigned UI-28: one combined button + Clear, the
		// shortlist itself lives in the picker's side panel rather than an always-visible chip
		// strip). None of this depends on a completed chart run -- it only exercises the filter
		// UI, which renders before Run is ever pressed. Opening the picker triggers a
		// getActivateableSkills pass (measured ~10ms server-side, but budget a longer explicit
		// timeout here for this one wait rather than risk a flake against the page's 5s default).
		const shopFilterPicked = await check(
			'chart.shopfilter.controls',
			async () => {
				for (const sel of ['.shopSkillFilterRow', '.shopSkillFilterBtn']) {
					if (!(await page.locator(sel).first().isVisible()))
						fail(`${sel} not visible in the Shop skills row`);
				}
				return { selector: '.shopSkillFilterRow' };
			},
		);

		if (shopFilterPicked) {
			await check('chart.shopfilter.pick', async () => {
				await page
					.locator('.shopSkillFilterBtn', { hasText: 'Shop Skills' })
					.click();
				await page.waitForSelector('.skill-picker-overlay', {
					state: 'visible',
					timeout: 10_000,
				});
				await page.locator('.skill-picker-item').first().click();
				// Not asserting exactly 1: the default rarity-sorted list's first item can itself
				// be a skill with a ladder prerequisite (a gold auto-adding its white base), which
				// would make this 2 -- that's UI-28's own feature firing, not a bug. >= 1 is the
				// real invariant; chart.shopfilter.prereq below is the deterministic check on a
				// specific, known family.
				const items = await page.locator('.shopSkillPanelItem').count();
				if (items < 1)
					fail(
						`expected >= 1 shortlist panel item after picking one, got ${items}`,
					);
				return {
					selector: '.shopSkillPanelItem',
					expected: '>= 1',
					actual: items,
				};
			});

			await check('clip.shopfilter', async () => {
				const r = await page.evaluate(
					(sel) => window.__smoke.rect(sel),
					'.shopSkillPanel',
				);
				if (!r) fail('.shopSkillPanel not found');
				if (r.x < 0 || r.right > 1280)
					fail(
						`shop skill panel overflows viewport (x ${Math.round(r.x)}..${Math.round(r.right)})`,
					);
				return { selector: '.shopSkillPanel' };
			});

			await assertContrast(
				page,
				'contrast.shopchip',
				'.shopSkillPanelItem .shopSkillChipName',
			);

			// UI-16: the per-skill hint-level input (ShopSkillPanel.tsx's .shopSkillHint) -- same
			// shortlist state as chart.shopfilter.pick above, so it's still present here, before
			// chart.shopfilter.remove/clearall below empty the panel out.
			await assertContrast(page, 'contrast.shophint', '.shopSkillHint');

			// The SP budget input in the shop-skills filter row (ShopSkillFilter.tsx) -- rendered
			// whenever the shortlist is non-empty, so it exists here too (behind the open picker
			// modal; contrast() reads computed styles, not stacking).
			await assertContrast(page, 'contrast.shopbudget', '.shopSkillBudgetInput');

			await check('chart.shopfilter.remove', async () => {
				// Target the top-level (non-indented) item specifically: if the prior pick auto-
				// added a prerequisite, `.shopSkillChipRemove` alone would match more than one
				// element. Removal only cascades UP (removing a base removes what's built on top
				// of it, not the reverse -- see chart.shopfilter.prereq below), so removing the
				// top-level item leaves its own prerequisite(s), if any, behind -- which then
				// re-render as a new flat top-level entry, since nothing above them remains in the
				// shortlist. So this asserts the total count drops by exactly 1, not that the
				// panel empties.
				const before = await page.locator('.shopSkillPanelItem').count();
				await page
					.locator(
						'.shopSkillPanelItem:not(.shopSkillPanelItemChild) .shopSkillChipRemove',
					)
					.first()
					.click();
				const after = await page.locator('.shopSkillPanelItem').count();
				if (after !== before - 1)
					fail(
						`expected ${before - 1} panel items after removing one, got ${after}`,
					);
				return {
					selector: '.shopSkillPanelItem',
					expected: before - 1,
					actual: after,
				};
			});

			await check('chart.shopfilter.clearall', async () => {
				// .shopSkillPanelClear ("Clear all") lives inside the panel itself, so it's
				// reachable without closing the picker -- resets to a known-empty state regardless
				// of what the prior steps' auto-adds left behind, ahead of the deterministic
				// prereq check below.
				const items = await page.locator('.shopSkillPanelItem').count();
				if (items === 0)
					return { selector: '.shopSkillPanelClear', skipped: true };
				await page.locator('.shopSkillPanelClear').click();
				const after = await page.locator('.shopSkillPanelItem').count();
				if (after !== 0)
					fail(`expected 0 panel items after Clear all, got ${after}`);
				return { selector: '.shopSkillPanelClear', expected: 0, actual: after };
			});

			// Prerequisite auto-add/cascade-removal (UI-28): picking a gold skill also adds its
			// white prerequisite, indented beneath it; removing that prerequisite cascades the
			// gold away too. "Show all skills" first so the pick can't be dropped by course
			// procability -- Professor of Curvature/Corner Adept are ordinary Global skills
			// (verified present in umalator-global/skillnames.json and skill_data.json), not tied
			// to any particular course.
			await check('chart.shopfilter.prereq', async () => {
				await page
					.locator('.skill-picker-notice input[type="checkbox"]')
					.check();
				await page
					.locator('.skill-picker-search input')
					.fill('Professor of Curvature');
				await page.locator('.skill-picker-item').first().click();
				const items = await page.locator('.shopSkillPanelItem').count();
				if (items !== 2)
					fail(`expected 2 panel items (parent + prerequisite), got ${items}`);
				const child = page.locator('.shopSkillPanelItemChild');
				if ((await child.count()) !== 1)
					fail('expected exactly 1 indented (prerequisite) panel item');
				const childName = await child
					.locator('.shopSkillChipName')
					.textContent();
				if (!/Corner Adept/.test(childName || ''))
					fail(
						`indented prerequisite reads "${childName}", expected "Corner Adept ..."`,
					);
				// Removal cascades UP -- clicking the prerequisite's x must also remove the parent
				// that depends on it (clicking the parent's x, which has no dependents, would prove
				// nothing about the cascade).
				await child.locator('.shopSkillChipRemove').click();
				const afterCascade = await page.locator('.shopSkillPanelItem').count();
				if (afterCascade !== 0)
					fail(
						`expected 0 panel items after removing the prerequisite (cascade-up), got ${afterCascade}`,
					);
				return { selector: '.shopSkillPanelItemChild' };
			});

			await check('chart.shopfilter.readd', async () => {
				// Leave the shortlist non-empty (search cleared, back to the default course-
				// filtered pool) so the disables check below has something to work with. Not
				// asserting an exact count -- see chart.shopfilter.pick above for why the default
				// list's first item can itself pull in a prerequisite.
				await page.locator('.skill-picker-search input').fill('');
				await page
					.locator('.skill-picker-notice input[type="checkbox"]')
					.uncheck();
				await page.locator('.skill-picker-item').first().click();
				const items = await page.locator('.shopSkillPanelItem').count();
				if (items < 1)
					fail(`expected >= 1 panel item after re-adding, got ${items}`);
				return {
					selector: '.shopSkillPanelItem',
					expected: '>= 1',
					actual: items,
				};
			});

			await shoot(page, 'chart');

			await check('chart.shopfilter.close', async () => {
				await page.locator('.skill-picker-close').click();
				await page.waitForSelector('.skill-picker-overlay', {
					state: 'detached',
				});
				return { selector: '.skill-picker-overlay' };
			});

			await check('chart.shopfilter.disables', async () => {
				// Tabs (the rarity row) never sets the native `disabled` DOM property -- it
				// renders aria-disabled + a .disabled class instead (ui-components/Tabs.tsx) --
				// so this must not assert isDisabled() against it, only against the icon-type
				// buttons, which are plain <button disabled>.
				const rarityCount = await page
					.locator('#chartIconFilter .tabsItem')
					.count();
				const rarityDisabled = await page
					.locator('#chartIconFilter .tabsItem[aria-disabled="true"]')
					.count();
				if (rarityDisabled !== rarityCount) {
					fail(
						`expected all ${rarityCount} rarity tabs aria-disabled, got ${rarityDisabled}`,
					);
				}
				const iconBtns = page.locator('.chart-icon-filter-btn');
				const iconCount = await iconBtns.count();
				for (let i = 0; i < iconCount; ++i) {
					if (!(await iconBtns.nth(i).isDisabled()))
						fail(`.chart-icon-filter-btn[${i}] not disabled`);
				}
				if (!(await page.locator('.chartFilterNote').isVisible()))
					fail('.chartFilterNote not visible');
				return {
					selector: '.tabsItem, .chart-icon-filter-btn, .chartFilterNote',
				};
			});

			await check('chart.shopfilter.clear', async () => {
				await page.locator('.shopSkillFilterBtn', { hasText: 'Clear' }).click();
				const label = await page
					.locator('.shopSkillFilterBtn', { hasText: 'Shop Skills' })
					.textContent();
				if ((label || '').trim() !== 'Shop Skills')
					fail(
						`button reads "${label}" after Clear, expected exactly "Shop Skills"`,
					);
				const rarityDisabled = await page
					.locator('#chartIconFilter .tabsItem[aria-disabled="true"]')
					.count();
				if (rarityDisabled !== 0)
					fail('rarity tabs still aria-disabled after clearing the shortlist');
				return { selector: '.shopSkillFilterBtn' };
			});
		}

		if (chartRun) {
			await check('chart.run', async () => {
				await page.locator('#run').click();
				await page.waitForSelector('table.basinnChart tbody tr', {
					state: 'visible',
					timeout: 120_000,
				});
				const rows = await page.locator('table.basinnChart tbody tr').count();
				return {
					selector: 'table.basinnChart tbody tr',
					expected: '>= 1',
					actual: rows,
				};
			});
		}
		if (!shopFilterPicked) await shoot(page, 'chart');
	}

	// Umas tab: the roster search (input.umasSearchInput) only renders once a
	// roster is imported (UmasTab.tsx gates on importedUmas.length), so a fresh
	// context exercises the always-present import input + empty state instead.
	await check('search.umastab', async () => {
		await page.locator('#navTabs .tabsItem', { hasText: 'Umas' }).click();
		const input = page.locator('input.umasImportInput');
		await input.waitFor({ state: 'visible' });
		await input.fill('not-a-roster');
		const v = await input.inputValue();
		if (v !== 'not-a-roster') fail(`umas import input holds "${v}"`);
		if (!(await page.locator('.umasEmpty').isVisible()))
			fail('empty-roster state not shown');
		await input.fill('');
		return { selector: 'input.umasImportInput' };
	});

	// runtime errors collected across the whole theme pass
	await check('boot.pageerror', async () => {
		const errs = pageErrors
			.slice(errorsBefore)
			.filter((e) => e.theme === theme);
		if (errs.length)
			fail(`${errs.length} runtime error(s): ${errs[0].message}`);
		return { expected: '0 errors', actual: pageErrors.length - errorsBefore };
	});

	currentPage = null;
	await context.close();
}

// ---- main ---------------------------------------------------------------------

const started = Date.now();
let port = basePort;
let url = await startServer(port);
if (!url && server && server.exitCode != null) {
	// likely EADDRINUSE; retry once on the next port
	serverStderr = [];
	port = basePort + 1;
	url = await startServer(port);
}
if (!url) {
	console.error('smoke FAILED: dev server did not become ready');
	console.error(serverStderr.join('').split('\n').slice(-10).join('\n'));
	process.exit(1);
}

let browser;
try {
	browser = await chromium.launch({ headless: !headed });
} catch (e) {
	killServer();
	if (/executable doesn't exist|browserType.launch/i.test(String(e.message))) {
		console.log(
			'smoke SKIPPED: chromium not installed (npx playwright install chromium)',
		);
		process.exit(2);
	}
	throw e;
}

try {
	// Warm-up load: the dev server rebuilds on a request-count heuristic that
	// assumes two simulator.worker.js fetches per load while the app spawns
	// four workers — one throwaway load lets the build settle before checks.
	const warm = await browser.newPage();
	await warm.goto(url, { waitUntil: 'domcontentloaded' });
	await warm.waitForSelector('#navBar', { state: 'visible', timeout: 15_000 });
	await warm.waitForTimeout(2000);
	await warm.close();

	for (const theme of ['light', 'dark']) {
		await runTheme(browser, url, theme);
	}
} finally {
	await browser.close();
	killServer();
}

const failed = checks.filter((c) => !c.ok);
const report = {
	ok: failed.length === 0,
	port,
	durationMs: Date.now() - started,
	checks,
	pageErrors,
	serverStderrTail: serverStderr.join('').split('\n').slice(-10),
};
fs.writeFileSync(
	path.join(artifactsDir, 'smoke-report.json'),
	JSON.stringify(report, null, '\t') + '\n',
);

if (failed.length === 0) {
	console.log(
		`smoke OK (${checks.length} checks, light+dark, ${Math.round(report.durationMs / 1000)}s)`,
	);
	process.exit(0);
} else {
	const head = failed
		.slice(0, 3)
		.map((c) => `${c.id}[${c.theme}] ${c.message || ''}`.trim())
		.join('; ');
	console.log(`smoke FAILED ${failed.length}/${checks.length}: ${head}`);
	console.log(
		`detail: ${path.relative(root, path.join(artifactsDir, 'smoke-report.json'))}`,
	);
	process.exit(1);
}
