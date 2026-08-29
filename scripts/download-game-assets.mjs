// Downloads game-client files straight from the CDN, keyed by rows in a decrypted `meta`
// DB (see scripts/decrypt-meta-db.mjs). PIPE-2.
//
// CDN route and request shape reverse-engineered from daydreamer-json/uma-db-stuff's
// src/utils/download.ts (AGPL-3.0 -- reimplemented from reading their approach, not copied;
// the URL scheme and header values are extracted client/CDN facts, not their expression):
//   https://<baseDomain>/<apiPath>/<endpoint>/<hash[0:2]>/<hash>
// where endpoint is "Generic" for master/sound/movie/font kinds, "Manifest" for manifest
// rows, otherwise "<platform>/assetbundles" -- platform is "Windows" or "Android" and MUST
// match whatever client `meta` itself came from (see the platform lookup in main() below),
// because the bundle content -- and therefore its hash -- differs per platform.
//
// CONFIRMED WORKING for all three kinds, including individual asset bundles. Corrected
// 2026-08-25: an earlier version of this script hardcoded "Windows/assetbundles" and every
// URL 404s when the `meta` under test actually came from an Android client (Android-sourced
// hashes only exist under the Android prefix) -- that was misdiagnosed as PIPE-2, 2026-08-24
// as "the route doesn't serve individual bundles this way" when it was really just a platform
// mismatch between the test hashes and the hardcoded path. Re-verified end-to-end 2026-08-25
// with the platform now read from `meta` itself: downloaded a real icon bundle fresh from the
// CDN (no local dat/ needed), AB-XOR-decrypted it, extracted it with UnityPy, and pixel-diffed
// the result against the already-committed `icons/chara/chr_icon_1001.png` -- mean per-channel
// diff 2.2/255, identical to the diff level already documented for meta+dat-based extraction
// in docs/data-pipeline.md (ordinary antialiasing/re-encoding rounding, not a wrong asset).
// **This means dat/ is no longer required at all** -- only a decrypted `meta` -- see that
// doc's PIPE-2 section for the full writeup.
//
// Generic-endpoint downloads matching `forceDownloadMasterDb`'s approach are LZ4-frame-
// compressed -- detected here by the frame magic number (bytes 04 22 4D 18) and automatically
// decompressed via `lz4-napi` (not a package.json dependency, same on-demand-install pattern
// as decrypt-meta-db.mjs's better-sqlite3-multiple-ciphers -- install it yourself:
// `npm i -D lz4-napi`). Verified 2026-08-25 against a real `master.mdb.lz4` CDN download:
// `lz4-napi`'s `decompressFrameSync` produced a byte-identical copy of the real client's
// `master.mdb`. (An earlier attempt with the `lz4` package's pure-JS frame decoder failed
// partway through the same real file with "Invalid data block" -- apparently a block-
// dependent-mode frame this fork's game client uses that library doesn't handle correctly;
// `lz4-napi` -- napi-rs bindings around the actively-maintained Rust `lz4-flex` crate --
// decoded it correctly.) The raw compressed bytes are still what land in the dat/ cache (see
// below); the decompressed copy is written as a separate, immediately usable sibling file
// only when the frame magic is actually detected, not assumed from `kind` alone -- sound/
// movie/font Generic-kind rows are undemonstrated and may not be LZ4 at all.
//
// Downloaded bundles are cached at dat/<hash[0:2]>/<hash> (raw, as served by the CDN --
// matching the directory layout the game client itself uses and what extract_resource.pl
// already expects when reading a real `dat/` tree) -- gitignored, see .gitignore's "Local
// asset-extraction working directories" entry. --out defaults to a `dat/` directory next to
// --meta (not cwd-relative) so it lines up with extract_resource.pl's own `dat/` derivation,
// which is always a sibling of whatever <meta> path it's given, regardless of its own cwd.
//
// Usage:
//   node scripts/download-game-assets.mjs --meta meta_jp.decrypted --like "%chr_icon_1141%"
//   node scripts/download-game-assets.mjs --meta meta_jp.decrypted --like "..." --run
//
// Without --run this only lists what would be downloaded (a name/size preview) and exits --
// review the list before actually fetching. A --like pattern that matches an unexpectedly
// large number of rows -- by row count OR total bytes -- is refused outright even with --run;
// narrow the pattern instead of forcing a mirror of the manifest. --limit overrides both
// (it's the one existing escape hatch; a separate byte-limit flag felt like scope creep for a
// guard whose whole point is "stop and let a human look").

import * as fs from 'node:fs';
import * as path from 'node:path';

import { program } from 'commander';

const BASE_DOMAIN = 'prd-storage-game-umamusume.akamaized.net';
const API_PATH = 'dl/resources';
const USER_AGENT =
	'UnityPlayer/2022.3.21f1 (UnityWebRequest/1.0, libcurl/8.5.0-DEV)';
const MAX_ROWS_WITHOUT_EXPLICIT_LIMIT = 200;

// Derives the per-server suffix (e.g. "_jp") from a meta/meta.decrypted filename, so the
// dat/ default below follows whichever server's meta was passed in -- JP-specific files are
// suffixed (meta_jp, dat_jp/), Global stays unsuffixed (meta, dat/). Twin implementations:
// extract_resource.pl and make_uma_info.pl (Perl) -- keep the regex identical in all three
// if it ever changes. See docs/master-mdb-schema.md.
//
// Exits rather than guessing on an unrecognized name (e.g. a leftover pre-convention
// "meta-jp.decrypted") -- silently falling back to the unsuffixed (Global) dat/ would
// misroute a download into the wrong server's cache with nothing louder than a warning
// (PIPE-17 review, 2026-08-28).
function serverSuffix(basename) {
	const m = basename.match(
		/^(?:master|meta)(_[A-Za-z0-9]+)?(?:\.mdb|\.decrypted)?$/,
	);
	if (m) return m[1] ?? '';
	console.error(
		`download-game-assets.mjs: couldn't derive a server suffix from '${basename}' -- rename it to the master_jp.mdb/meta_jp convention (see docs/master-mdb-schema.md) rather than guessing which server's dat/ to use`,
	);
	process.exit(1);
}

// The guard's actual purpose (per its own refusal message) is "don't silently mirror a large
// slice of the manifest" -- a byte-volume concern a row-count cap alone doesn't protect
// against (a handful of huge `master`/`movie` rows sail through; hundreds of tiny `manifest`
// rows get refused for no protective reason). 100 MiB comfortably covers a legitimate single
// master.mdb refresh (~14-44 MiB compressed) or a small icon batch, well under
// manifest-mirroring territory.
const MAX_BYTES_WITHOUT_EXPLICIT_LIMIT = 100 * 1024 * 1024;
const LZ4_FRAME_MAGIC = Buffer.from([0x04, 0x22, 0x4d, 0x18]);

program
	.requiredOption(
		'--meta <path>',
		'path to a decrypted meta DB (see decrypt-meta-db.mjs)',
	)
	.requiredOption(
		'--like <pattern>',
		'SQL LIKE pattern matched against column a.n',
	)
	.option('--run', 'actually download; default is dry-run (list only)')
	.option(
		'--limit <n>',
		'allow up to n matched rows and any total byte volume (default refuses over ' +
			MAX_ROWS_WITHOUT_EXPLICIT_LIMIT +
			` rows or ${MAX_BYTES_WITHOUT_EXPLICIT_LIMIT / 1024 / 1024} MiB)`,
		(v) => {
			const n = Number.parseInt(v, 10);
			if (!Number.isInteger(n) || n < 0) {
				console.error(`--limit must be a non-negative integer, got: ${v}`);
				process.exit(1);
			}
			return n;
		},
	)
	.option(
		'--out <dir>',
		'output cache directory (default: dat/ next to --meta)',
	);

program.parse();
const opts = program.opts();

function resolveEndpoint(kind, platform) {
	// String(...) rather than kind?.toLowerCase(): only master/manifest/assetbundle kinds are
	// confirmed to carry a string `m` end-to-end (see the header comment) -- sound/movie/font
	// Generic-kind rows are untested and might not. `?.` alone only guards null/undefined, not
	// a wrong type such as a bigint/number `m`, which would throw on .toLowerCase() directly
	// (PIPE-2 review).
	const k = kind == null ? kind : String(kind).toLowerCase();
	if (k && ['master', 'sound', 'movie', 'font'].includes(k)) return 'Generic';
	if (k?.includes('manifest')) return 'Manifest';
	return `${platform}/assetbundles`;
}

async function maybeDecompressLz4(buf) {
	if (buf.length < 4 || !buf.subarray(0, 4).equals(LZ4_FRAME_MAGIC)) {
		return null;
	}
	let decompressFrameSync;
	try {
		({ decompressFrameSync } = await import('lz4-napi'));
	} catch {
		console.error(
			'Downloaded content is LZ4-frame-compressed (magic bytes detected) but ' +
				'lz4-napi is not installed -- the raw compressed bytes are still cached in ' +
				'dat/, but no decompressed copy was written. Install it and re-run to get ' +
				'one:\n\n  npm i -D lz4-napi\n',
		);
		return null;
	}
	return decompressFrameSync(buf);
}

function assetUrl(hash, kind, platform) {
	return [
		'https:/',
		BASE_DOMAIN,
		API_PATH,
		resolveEndpoint(kind, platform),
		hash.slice(0, 2),
		hash,
	].join('/');
}

async function main() {
	let Database;
	try {
		({ default: Database } = await import('better-sqlite3-multiple-ciphers'));
	} catch {
		console.error(
			"better-sqlite3-multiple-ciphers is not installed -- see decrypt-meta-db.mjs's " +
				'header comment. Install it first:\n\n  npm i -D better-sqlite3-multiple-ciphers\n',
		);
		process.exit(1);
	}

	let db;
	try {
		db = new Database(path.resolve(opts.meta), { readonly: true });
	} catch (err) {
		// Unlike the import steps above, this previously had no try/catch -- an invalid,
		// missing, or still-encrypted --meta path (an easy, untested mistake) crashed with a
		// raw stack trace via an unhandled rejection instead of this file's usual friendly
		// console.error + exit(1) pattern (PIPE-2 review).
		console.error(`Failed to open --meta ${opts.meta}: ${err.message}`);
		console.error(
			'Make sure this is a plaintext (already-decrypted) SQLite file -- ' +
				'see decrypt-meta-db.mjs.',
		);
		process.exit(1);
	}
	// The individual-assetbundle route is keyed by platform (`Windows/assetbundles` vs
	// `Android/assetbundles`) because the bundle *content* -- and therefore its hash -- differs
	// per platform (different texture compression, etc). `meta` records which client it came
	// from in table `c`; hardcoding "Windows" here previously produced a 404 for every asset
	// when `meta` actually came from an Android client (PIPE-2, 2026-08-25 -- the CDN route
	// works fine, the earlier "confirmed not working" finding was testing Android-sourced
	// hashes against the Windows path). Falls back to Windows if `c` doesn't have the expected
	// row -- matches this script's pre-fix behavior rather than guessing.
	const platformRow = db
		.prepare("SELECT n FROM c WHERE n = '//Android' OR n = '//Windows'")
		.get();
	const platform = platformRow ? platformRow.n.slice(2) : 'Windows';
	// `e` (the per-asset AB encryption key) is a signed 64-bit value that routinely exceeds
	// Number.MAX_SAFE_INTEGER -- safeIntegers(true) is required or better-sqlite3 silently
	// truncates it, corrupting the key downstream. `l` (byte length) never approaches that
	// range for a single asset, so it's coerced back to a plain Number below for arithmetic.
	const rows = db
		.prepare('SELECT n, h, e, l, m FROM a WHERE n LIKE ?')
		.safeIntegers(true)
		.all(opts.like)
		.map((r) => ({ ...r, l: Number(r.l) }));
	db.close();

	if (rows.length === 0) {
		console.log('No rows matched.');
		return;
	}

	// Sibling of --meta by default, matching extract_resource.pl's own dat/ derivation
	// (always relative to <meta>'s directory, never its own cwd) -- keeps the two tools
	// pointed at the same cache even when run from different working directories.
	// path.resolve(opts.out), not opts.out verbatim: decompPath below derives its own
	// directory from path.dirname(outDir), which only lines up with --meta's directory the
	// way the comment above describes if outDir is absolute -- a relative --out (e.g. "dat",
	// a natural value to pass) otherwise makes path.dirname(outDir) resolve to cwd, silently
	// misplacing (and potentially overwriting an unrelated same-named file for) any
	// decompressed sibling output (PIPE-2 review).
	const outDir = opts.out
		? path.resolve(opts.out)
		: path.join(
				path.dirname(path.resolve(opts.meta)),
				`dat${serverSuffix(path.basename(opts.meta))}`,
			);

	const totalBytes = rows.reduce((sum, r) => sum + r.l, 0);
	const rowLimit = opts.limit ?? MAX_ROWS_WITHOUT_EXPLICIT_LIMIT;
	const byteLimit =
		opts.limit != null ? Infinity : MAX_BYTES_WITHOUT_EXPLICIT_LIMIT;
	if (rows.length > rowLimit || totalBytes > byteLimit) {
		console.error(
			`Pattern matched ${rows.length} row(s), ${(totalBytes / 1024 / 1024).toFixed(1)} MiB ` +
				`total -- over the limit of ${rowLimit} rows or ` +
				`${(MAX_BYTES_WITHOUT_EXPLICIT_LIMIT / 1024 / 1024).toFixed(0)} MiB. Narrow --like, ` +
				'or pass --limit explicitly if this is really intended -- this script refuses to ' +
				'silently mirror a large slice of the manifest.',
		);
		process.exit(1);
	}

	console.log(
		`${rows.length} row(s) matched, ${(totalBytes / 1024).toFixed(1)} KiB total:`,
	);
	for (const row of rows) {
		console.log(
			`  ${row.n}  (${row.l} bytes, ${row.e === 0n ? 'unencrypted' : `AB-encrypted, key=${row.e}`})`,
		);
	}

	if (!opts.run) {
		console.log('\nDry run -- pass --run to actually download.');
		return;
	}

	for (const row of rows) {
		const destDir = path.join(outDir, row.h.slice(0, 2));
		const destPath = path.join(destDir, row.h);
		// Only Generic-kind rows (master/sound/movie/font) are ever LZ4-frame-compressed (see
		// header comment) -- computing/checking a decompPath for every other row (the common
		// case: icons and other individual asset bundles) meant the cache-hit branch below
		// always found it missing, re-read the full cached blob, and logged "regenerating
		// decompressed copy" on every single re-run even though nothing was ever regenerated
		// (PIPE-2 review).
		const isGenericKind = resolveEndpoint(row.m, platform) === 'Generic';
		const decompPath = isGenericKind
			? path.join(
					path.dirname(outDir),
					path.basename(row.n).replace(/\.lz4$/i, ''),
				)
			: null;
		const cached =
			fs.existsSync(destPath) && fs.statSync(destPath).size === row.l;
		let buf;
		if (cached) {
			// Cached raw bytes -- still worth checking whether the decompressed sibling is
			// missing (e.g. the user deleted master.mdb but kept dat/ around) before skipping
			// entirely, so re-running this command is a reliable way to regenerate it.
			if (!isGenericKind || fs.existsSync(decompPath)) {
				console.log(`skip (cached): ${row.n}`);
				continue;
			}
			buf = fs.readFileSync(destPath);
			console.log(`cached (regenerating decompressed copy): ${row.n}`);
		} else {
			fs.mkdirSync(destDir, { recursive: true });
			const url = assetUrl(row.h, row.m, platform);
			const res = await fetch(url, {
				headers: { 'User-Agent': USER_AGENT, 'Cache-Control': 'no-cache' },
			});
			if (!res.ok) {
				console.error(`FAILED (${res.status}): ${row.n} <- ${url}`);
				continue;
			}
			buf = Buffer.from(await res.arrayBuffer());
			if (buf.length !== row.l) {
				console.error(
					`WARNING: length mismatch for ${row.n}: expected ${row.l}, got ${buf.length}`,
				);
			}
			// Raw bytes always go to the dat/ cache, unchanged -- extract_resource.pl and the
			// cache-hit check above both expect the raw, as-served-by-the-CDN bytes there.
			fs.writeFileSync(destPath, buf);
			console.log(`downloaded: ${row.n} -> ${destPath}`);
		}

		if (decompPath) {
			const decompressed = await maybeDecompressLz4(buf);
			if (decompressed) {
				fs.writeFileSync(decompPath, decompressed);
				console.log(`  decompressed (LZ4 frame detected) -> ${decompPath}`);
			}
		}
	}
}

main();
