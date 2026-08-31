// PIPE-37: builds the sim-vs-replay accuracy report into one self-contained HTML file.
//
//   node scripts/build-accuracy-artifact.mjs \
//     --artifact-json uma-skill-tools/tmp/replay-analysis/artifact.json \
//     -o tmp/accuracy-report.html
//
// Bundles scripts/artifact-src/accuracy-charts.js (a d3-scale/d3-shape/d3-array/d3-format
// subset -- skip d3-axis, it drags in d3-selection for a live-DOM axis this doesn't need)
// via esbuild into an IIFE, then splices it and the artifact JSON into
// scripts/artifact-src/accuracy-report.body.html to produce a standalone document.
//
// Splice discipline ported from plans/scripts/build-artifact.py (its own docstring
// records this exact bug shipping live once): a SINGLE-PASS placeholder substitution over
// the original template, never a chain of .replace() calls -- a chain re-scans content
// already spliced in by an earlier call, so if a later replacement's source text happens
// to contain an earlier placeholder's name (this page embeds JSON with uma names in it;
// not implausible), a chained .replace() would corrupt already-valid JSON. Re-parses the
// embedded JSON blob after splicing and fails the build before writing if it doesn't
// round-trip.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { program } from 'commander';
import * as esbuild from 'esbuild';

const root = path.dirname(fileURLToPath(import.meta.url));

program
	.requiredOption(
		'--artifact-json <path>',
		'path to analyze_replay_diff.py --artifact-json output',
	)
	.requiredOption('-o, --output <path>', 'output HTML path');
program.parse();
const opts = program.opts();

// _safe_json equivalent (plans/scripts/build-artifact.py:433-436): escape "</" so a value
// containing the literal text "</script>" can't truncate the embedding <script> tag.
function safeJson(obj) {
	return JSON.stringify(obj).replace(/<\//g, '<\\/');
}

async function main() {
	const artifactJsonPath = path.resolve(opts.artifactJson);
	const dataRaw = fs.readFileSync(artifactJsonPath, 'utf8');
	const data = JSON.parse(dataRaw); // fail loudly now if the input itself isn't valid JSON

	const bundleResult = await esbuild.build({
		entryPoints: [path.join(root, 'artifact-src/accuracy-charts.js')],
		bundle: true,
		minify: true,
		format: 'iife',
		write: false,
		logLevel: 'warning',
	});
	const chartsBundle = bundleResult.outputFiles[0].text;

	const bodyTemplate = fs.readFileSync(
		path.join(root, 'artifact-src/accuracy-report.body.html'),
		'utf8',
	);

	const dataJson = safeJson(data);
	const values = {
		__ACCURACY_DATA_JSON__: dataJson,
		__ACCURACY_CHARTS_BUNDLE__: chartsBundle,
	};
	const placeholderRe = new RegExp(
		Object.keys(values)
			.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
			.join('|'),
		'g',
	);
	const bodyContent = bodyTemplate.replace(placeholderRe, (m) => values[m]);

	// Re-parse the embedded JSON blob to prove the splice didn't corrupt it, before
	// writing anything -- matches build-artifact.py's validate_output().
	const embeddedMatch = bodyContent.match(
		/window\.__ACCURACY_DATA__ = (.*?);<\/script>/s,
	);
	if (!embeddedMatch) {
		throw new Error(
			'could not find the embedded data script block after splicing',
		);
	}
	let reparsed;
	try {
		reparsed = JSON.parse(embeddedMatch[1]);
	} catch (e) {
		throw new Error(
			`embedded data JSON failed to re-parse after splicing -- the splice corrupted it: ${e.message}`,
		);
	}
	if (
		reparsed.courseSetId !== data.courseSetId ||
		(reparsed.runs === undefined && data.runs !== undefined)
	) {
		throw new Error(
			'embedded data JSON re-parsed but does not match the source data -- splice corruption suspected',
		);
	}

	const titleMatch = bodyContent.match(/<title>(.*?)<\/title>/);
	const title = titleMatch ? titleMatch[1] : 'Sim Accuracy Report';

	const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
</head>
<body>
${bodyContent}
</body>
</html>
`;

	fs.mkdirSync(path.dirname(path.resolve(opts.output)), { recursive: true });
	fs.writeFileSync(opts.output, html);
	console.log(`wrote ${opts.output} (${(html.length / 1024).toFixed(0)} KB)`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
