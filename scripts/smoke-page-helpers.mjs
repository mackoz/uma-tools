// Shared page-injected helpers for browser-driven checks. Extracted from smoke.mjs
// (PIPE-37) so scripts/check-artifact.mjs can reuse the WCAG contrast helper without
// importing smoke.mjs itself, which would run umalator-global's whole smoke suite as a
// side effect. smoke.mjs imports PAGE_HELPERS from here; behavior is unchanged from
// before the extraction (verified via `npm run smoke` after moving this).

// ---- WCAG contrast helpers (run inside the page) ------------------------------
// Resolves the effective background by walking ancestors past transparent
// backgrounds, compositing semi-transparent layers, then computes the WCAG
// contrast ratio between the element's text color and that background.
export const PAGE_HELPERS = `
window.__smoke = {
	parseColor(s) {
		const m = s.match(/rgba?\\(([^)]+)\\)/);
		if (!m) return null;
		const p = m[1].split(',').map(x => parseFloat(x));
		return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
	},
	composite(top, bottom) {
		const a = top.a + bottom.a * (1 - top.a);
		if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
		return {
			r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / a,
			g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / a,
			b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / a,
			a,
		};
	},
	effectiveBg(el) {
		const layers = [];
		for (let e = el; e; e = e.parentElement) {
			const c = this.parseColor(getComputedStyle(e).backgroundColor);
			if (c && c.a > 0) {
				layers.push(c);
				if (c.a >= 1) break;
			}
		}
		// final fallback: whatever the root paints, else white
		let bg = { r: 255, g: 255, b: 255, a: 1 };
		for (let i = layers.length - 1; i >= 0; i--) bg = this.composite(layers[i], bg);
		return bg;
	},
	luminance(c) {
		const f = v => {
			v /= 255;
			return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
		};
		return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
	},
	contrast(selector) {
		const el = document.querySelector(selector);
		if (!el) return { error: 'not found' };
		const cs = getComputedStyle(el);
		const fg = this.parseColor(cs.color);
		const bg = this.effectiveBg(el);
		const l1 = this.luminance(fg);
		const l2 = this.luminance(bg);
		const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
		const size = parseFloat(cs.fontSize);
		const bold = parseInt(cs.fontWeight, 10) >= 700;
		const large = size >= 24 || (size >= 18.66 && bold);
		return {
			fg: cs.color,
			bg: 'rgb(' + Math.round(bg.r) + ', ' + Math.round(bg.g) + ', ' + Math.round(bg.b) + ')',
			ratio: Math.round(ratio * 100) / 100,
			fontSize: size,
			large,
		};
	},
	zIndex(selector) {
		const el = document.querySelector(selector);
		if (!el) return null;
		return getComputedStyle(el).zIndex;
	},
	rect(selector) {
		const el = document.querySelector(selector);
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
	},
};
`;
