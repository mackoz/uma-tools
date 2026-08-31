// PIPE-37: chart rendering for the sim-vs-replay accuracy report artifact. Bundled by
// scripts/build-accuracy-artifact.mjs into an IIFE (window.AccuracyCharts) and inlined
// into the artifact's <script> block -- no runtime dependency, no network fetch.
//
// d3 subset only (d3-scale/d3-shape/d3-array/d3-format), matching umalator/app.tsx's own
// charting idiom -- skip d3-axis (it drags in d3-selection for a live-DOM axis this
// doesn't need) and hand-emit ticks from scale.ticks() instead.

import { extent } from 'd3-array';
import { format } from 'd3-format';
import { scaleLinear } from 'd3-scale';
import { curveMonotoneX, line as d3line } from 'd3-shape';

const fmtBasinn = format('.2f'); // no forced sign -- always used on an abs() value paired with a worded direction ("behind by")
const fmtBasinnSigned = format('+.1f');
const fmtM = format('.0f');
const fmtT = format('.1f');
const fmtT2 = format('.2f');

function svgEl(tag, attrs) {
	const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
	for (const k in attrs) el.setAttribute(k, attrs[k]);
	return el;
}

function textEl(x, y, text, cls) {
	const el = svgEl('text', { x, y, class: cls || '' });
	el.textContent = text;
	return el;
}

// Bar histogram from {edges, counts} (np.histogram shape). Draws two overlaid series if
// `series` has two entries, for the "all runs vs own-trainer runs" comparison panel.
export function renderHistogramCompare(container, series, opts) {
	const width = opts.width || 640;
	const height = opts.height || 260;
	const margin = { top: 16, right: 16, bottom: 32, left: 16 };
	const innerW = width - margin.left - margin.right;
	const innerH = height - margin.top - margin.bottom;

	const allEdges = series.flatMap((s) => s.data.edges);
	const xExtent = extent(allEdges);
	const x = scaleLinear().domain(xExtent).range([0, innerW]);
	const maxCount = Math.max(
		1,
		...series.flatMap((s) => s.data.counts.map((c) => c / Math.max(1, s.n))),
	);
	const y = scaleLinear().domain([0, maxCount]).range([innerH, 0]);

	const svg = svgEl('svg', {
		viewBox: `0 0 ${width} ${height}`,
		class: 'chart',
	});
	const g = svgEl('g', {
		transform: `translate(${margin.left},${margin.top})`,
	});
	svg.appendChild(g);

	// zero line + x-axis ticks (hand-emitted, per the d3-axis skip above)
	g.appendChild(
		svgEl('line', {
			x1: x(0),
			x2: x(0),
			y1: 0,
			y2: innerH,
			class: 'zero-line',
		}),
	);
	for (const t of x.ticks(6)) {
		g.appendChild(
			svgEl('line', {
				x1: x(t),
				x2: x(t),
				y1: innerH,
				y2: innerH + 4,
				class: 'tick',
			}),
		);
		g.appendChild(textEl(x(t), innerH + 16, fmtM(t), 'tick-label'));
	}

	series.forEach((s, si) => {
		const { edges, counts } = s.data;
		for (let i = 0; i < counts.length; i++) {
			const x0 = x(edges[i]),
				x1 = x(edges[i + 1]);
			const frac = counts[i] / Math.max(1, s.n);
			const bw = Math.max(0.5, x1 - x0 - 1);
			const bx = si === 0 ? x0 : x0 + (x1 - x0 - bw);
			const bar = svgEl('rect', {
				x: bx,
				y: y(frac),
				width: bw,
				height: Math.max(0, innerH - y(frac)),
				class: `bar bar-${si}`,
			});
			const t = svgEl('title');
			t.textContent = `${s.label}: [${fmtM(edges[i])}, ${fmtM(edges[i + 1])})m, ${counts[i]}/${s.n} runs`;
			bar.appendChild(t);
			g.appendChild(bar);
		}
	});

	container.appendChild(svg);
}

// Interactive trajectory overlay: distance-vs-time for one race's sim and real curves,
// with a build selector (tabs) and hover-to-inspect (vertical guide + readout).
export function renderTrajectoryOverlay(container, examples, opts) {
	const width = opts.width || 720;
	const height = opts.height || 320;
	const margin = { top: 16, right: 16, bottom: 32, left: 44 };
	const innerW = width - margin.left - margin.right;
	const innerH = height - margin.top - margin.bottom;

	const tabs = document.createElement('div');
	tabs.className = 'traj-tabs';
	container.appendChild(tabs);

	const chartHost = document.createElement('div');
	chartHost.className = 'traj-chart-host';
	container.appendChild(chartHost);

	const readout = document.createElement('div');
	readout.className = 'traj-readout';
	container.appendChild(readout);

	function draw(example) {
		chartHost.textContent = '';
		readout.textContent = 'Hover the chart to inspect a moment in the race.';

		const samples = example.samples;
		const x = scaleLinear()
			.domain(extent(samples, (d) => d.time))
			.range([0, innerW]);
		const yMax = Math.max(
			...samples.map((d) => Math.max(d.simDist, d.realDist)),
		);
		const y = scaleLinear().domain([0, yMax]).nice().range([innerH, 0]);

		const svg = svgEl('svg', {
			viewBox: `0 0 ${width} ${height}`,
			class: 'chart',
		});
		const g = svgEl('g', {
			transform: `translate(${margin.left},${margin.top})`,
		});
		svg.appendChild(g);

		for (const t of y.ticks(5)) {
			g.appendChild(
				svgEl('line', {
					x1: 0,
					x2: innerW,
					y1: y(t),
					y2: y(t),
					class: 'gridline',
				}),
			);
			g.appendChild(textEl(-8, y(t) + 4, fmtM(t), 'tick-label tick-label-y'));
		}
		for (const t of x.ticks(6)) {
			g.appendChild(
				svgEl('line', {
					x1: x(t),
					x2: x(t),
					y1: innerH,
					y2: innerH + 4,
					class: 'tick',
				}),
			);
			g.appendChild(textEl(x(t), innerH + 16, `${fmtT(t)}s`, 'tick-label'));
		}

		const realLine = d3line()
			.x((d) => x(d.time))
			.y((d) => y(d.realDist))
			.curve(curveMonotoneX);
		const simLine = d3line()
			.x((d) => x(d.time))
			.y((d) => y(d.simDist))
			.curve(curveMonotoneX);
		g.appendChild(
			svgEl('path', { d: realLine(samples), class: 'traj-line traj-real' }),
		);
		g.appendChild(
			svgEl('path', { d: simLine(samples), class: 'traj-line traj-sim' }),
		);

		const guide = svgEl('line', {
			x1: 0,
			x2: 0,
			y1: 0,
			y2: innerH,
			class: 'guide',
			style: 'display:none',
		});
		g.appendChild(guide);
		const overlay = svgEl('rect', {
			x: 0,
			y: 0,
			width: innerW,
			height: innerH,
			class: 'hover-overlay',
		});
		g.appendChild(overlay);

		overlay.addEventListener('mousemove', (ev) => {
			const rect = svg.getBoundingClientRect();
			const scaleX = width / rect.width;
			const px = (ev.clientX - rect.left) * scaleX - margin.left;
			const t = x.invert(Math.max(0, Math.min(innerW, px)));
			let nearest = samples[0];
			for (const s of samples)
				if (Math.abs(s.time - t) < Math.abs(nearest.time - t)) nearest = s;
			guide.setAttribute('x1', x(nearest.time));
			guide.setAttribute('x2', x(nearest.time));
			guide.style.display = '';
			const gap = (nearest.simDist - nearest.realDist) / 2.5;
			readout.textContent =
				`t=${fmtT(nearest.time)}s -- real ${fmtM(nearest.realDist)}m, sim ${fmtM(nearest.simDist)}m ` +
				`(sim ${gap >= 0 ? 'ahead' : 'behind'} by ${fmtBasinn(Math.abs(gap))} basinn)`;
		});
		overlay.addEventListener('mouseleave', () => {
			guide.style.display = 'none';
			readout.textContent = 'Hover the chart to inspect a moment in the race.';
		});

		chartHost.appendChild(svg);
	}

	examples.forEach((ex, i) => {
		const tab = document.createElement('button');
		tab.type = 'button';
		tab.className = `traj-tab${i === 0 ? ' active' : ''}`;
		tab.textContent = ex.buildKey;
		tab.addEventListener('click', () => {
			tabs.querySelectorAll('.traj-tab').forEach((t) => {
				t.classList.remove('active');
			});
			tab.classList.add('active');
			draw(ex);
		});
		tabs.appendChild(tab);
	});

	if (examples.length) draw(examples[0]);
}

// Strip plot: one lane per (race, own-build) reseed run, ~100 jittered dots for the
// re-seeded outcomes plus one larger marker for what actually happened, against a zero
// line (zero == the real result, since finishPosErrBasinn already is the sim-vs-real
// error). Own runs only -- reseedSpread.perRun is built that way upstream.
export function renderReseedStrip(container, data, opts) {
	const width = opts.width || 880;
	const height = opts.height || 340;
	const margin = { top: 16, right: 16, bottom: 40, left: 48 };
	const innerW = width - margin.left - margin.right;
	const innerH = height - margin.top - margin.bottom;

	const runs = data.perRun;
	const n = runs.length;
	const laneW = innerW / n;

	const allVals = runs.flatMap((r) => r.values.concat([r.actualErrBasinn]));
	const y = scaleLinear().domain(extent(allVals)).nice().range([innerH, 0]);

	const svg = svgEl('svg', {
		viewBox: `0 0 ${width} ${height}`,
		class: 'chart',
	});
	const g = svgEl('g', {
		transform: `translate(${margin.left},${margin.top})`,
	});
	svg.appendChild(g);

	for (const t of y.ticks(6)) {
		g.appendChild(
			svgEl('line', {
				x1: 0,
				x2: innerW,
				y1: y(t),
				y2: y(t),
				class: 'gridline',
			}),
		);
		g.appendChild(
			textEl(-8, y(t) + 4, fmtBasinnSigned(t), 'tick-label tick-label-y'),
		);
	}
	g.appendChild(
		svgEl('line', {
			x1: 0,
			x2: innerW,
			y1: y(0),
			y2: y(0),
			class: 'zero-line',
		}),
	);
	g.appendChild(
		textEl(innerW, y(0) - 6, 'reality', 'tick-label strip-zero-label'),
	);

	// build-group dividers + labels, in the order perRun is already sorted (buildKey, file)
	let groupStart = 0;
	let prevBuild = runs.length ? runs[0].buildKey : null;
	function closeGroup(endIdx) {
		const cx = ((groupStart + endIdx) / 2) * laneW;
		g.appendChild(textEl(cx, innerH + 20, prevBuild, 'tick-label'));
	}
	runs.forEach((r, i) => {
		if (r.buildKey !== prevBuild) {
			g.appendChild(
				svgEl('line', {
					x1: i * laneW,
					x2: i * laneW,
					y1: 0,
					y2: innerH,
					class: 'strip-divider',
				}),
			);
			closeGroup(i);
			groupStart = i;
			prevBuild = r.buildKey;
		}
	});
	if (runs.length) closeGroup(n);

	runs.forEach((r, i) => {
		const cx = i * laneW + laneW / 2;
		const sorted = [...r.values].sort((a, b) => a - b);
		const lo = sorted[0];
		const hi = sorted[sorted.length - 1];
		const median = sorted[Math.floor(sorted.length / 2)];

		const hit = svgEl('rect', {
			x: i * laneW,
			y: 0,
			width: laneW,
			height: innerH,
			class: 'strip-hit',
		});
		const title = svgEl('title');
		title.textContent =
			`${r.charaName} (${r.file.replace(/\.json$/, '')}): the 100 reseeded outcomes span ` +
			`${fmtBasinnSigned(lo)} to ${fmtBasinnSigned(hi)} basinn (median ${fmtBasinnSigned(median)}); ` +
			`this race's actual result was ${fmtBasinnSigned(r.actualErrBasinn)} basinn`;
		hit.appendChild(title);
		g.appendChild(hit);

		r.values.forEach((v) => {
			const jitter = (Math.random() - 0.5) * Math.max(1, laneW - 4);
			g.appendChild(
				svgEl('circle', {
					cx: cx + jitter,
					cy: y(v),
					r: 1.4,
					class: 'strip-dot',
				}),
			);
		});
		g.appendChild(
			svgEl('circle', {
				cx,
				cy: y(r.actualErrBasinn),
				r: 4,
				class: 'strip-actual',
			}),
		);
	});

	container.appendChild(svg);
}

// Small-multiples scatter: sim finish time vs. real finish time, one panel per own-trainer
// build, each with its own identity (y=x) line -- a build's points hugging that line means
// the sim tracks that horse's race-to-race ups and downs; scatter means it doesn't (this is
// the same population headline A's per-build rho is computed over, laid out point-by-point).
export function renderFinishTimeScatterGrid(container, dataByBuild, opts) {
	const width = opts.width || 260;
	const height = opts.height || 220;
	const margin = { top: 10, right: 10, bottom: 30, left: 36 };
	const innerW = width - margin.left - margin.right;
	const innerH = height - margin.top - margin.bottom;

	const grid = document.createElement('div');
	grid.className = 'scatter-grid';
	container.appendChild(grid);

	Object.keys(dataByBuild)
		.sort()
		.forEach((build) => {
			const points = dataByBuild[build];
			const cell = document.createElement('div');
			cell.className = 'scatter-cell';
			const label = document.createElement('div');
			label.className = 'scatter-cell-label';
			label.textContent = build;
			cell.appendChild(label);

			const allT = points.flatMap((p) => [p.realFinishTime, p.simFinishTime]);
			const domain = extent(allT);
			const pad = (domain[1] - domain[0]) * 0.1 || 0.5;
			const scale = scaleLinear()
				.domain([domain[0] - pad, domain[1] + pad])
				.range([0, innerW]);

			const svg = svgEl('svg', {
				viewBox: `0 0 ${width} ${height}`,
				class: 'chart',
			});
			const g = svgEl('g', {
				transform: `translate(${margin.left},${margin.top})`,
			});
			svg.appendChild(g);

			for (const t of scale.ticks(4)) {
				const sx = scale(t);
				g.appendChild(
					svgEl('line', {
						x1: sx,
						x2: sx,
						y1: 0,
						y2: innerH,
						class: 'gridline',
					}),
				);
				g.appendChild(textEl(sx, innerH + 14, fmtT(t), 'tick-label'));
				g.appendChild(
					textEl(-6, innerH - sx + 3, fmtT(t), 'tick-label tick-label-y'),
				);
			}
			g.appendChild(
				svgEl('line', {
					x1: 0,
					y1: innerH,
					x2: innerW,
					y2: 0,
					class: 'identity-line',
				}),
			);

			points.forEach((p) => {
				const cx = scale(p.realFinishTime);
				const cy = innerH - scale(p.simFinishTime);
				const dot = svgEl('circle', { cx, cy, r: 3.5, class: 'scatter-dot' });
				const title = svgEl('title');
				title.textContent =
					`${p.file.replace(/\.json$/, '')}: real ${fmtT2(p.realFinishTime)}s, ` +
					`sim ${fmtT2(p.simFinishTime)}s`;
				dot.appendChild(title);
				g.appendChild(dot);
			});

			cell.appendChild(svg);
			grid.appendChild(cell);
		});
}

window.AccuracyCharts = {
	renderHistogramCompare,
	renderTrajectoryOverlay,
	renderReseedStrip,
	renderFinishTimeScatterGrid,
};
