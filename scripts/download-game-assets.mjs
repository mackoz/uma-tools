// Downloads game-client files straight from the CDN, keyed by rows in a decrypted `meta`
// DB (see scripts/decrypt-meta-db.mjs). PIPE-2.
//
// CDN route and request shape reverse-engineered from daydreamer-json/uma-db-stuff's
// src/utils/download.ts (AGPL-3.0 -- reimplemented from reading their approach, not copied;
// the URL scheme and header values are extracted client/CDN facts, not their expression):
//   https://<baseDomain>/<apiPath>/<endpoint>/<hash[0:2]>/<hash>
// where endpoint is "Generic" for master/sound/movie/font kinds, "Manifest" for manifest
// rows, otherwise "Windows/assetbundles".
//
// CONFIRMED WORKING for "Generic" (master.mdb refresh with no game install needed -- see
// forceDownloadMasterDb's LZ4-frame-compressed output) and "Manifest" kinds.
//
// CONFIRMED *NOT* WORKING for "Windows/assetbundles" -- i.e. this does NOT currently let you
// download individual icon/texture asset bundles. Verified 2026-08-24 (PIPE-2): every
// assetbundles-endpoint URL tried 404s from the CDN, including hashes independently
// confirmed present in a real client's dat/ folder (so it isn't resource-version rot on a
// stale meta snapshot -- the route itself doesn't serve individual bundles this way, at
// least not without something this script doesn't yet know, e.g. a resource-version path
// segment or session-scoped auth). Left in for whoever picks this back up -- don't remove
// it as dead code, but don't trust it either until someone finds the missing piece. Until
// then, individual asset extraction requires a real client install's dat/ folder copied in
// alongside meta/master.mdb, the same way this fork already handles those two files.
//
// Downloaded bundles are cached at dat/<hash[0:2]>/<hash>, matching the directory layout
// the game client itself uses (and what extract_resource.pl already expects when reading a
// real `dat/` tree) -- gitignored, see .gitignore's "Local asset-extraction working
// directories" entry.
//
// Usage:
//   node scripts/download-game-assets.mjs --meta meta-jp.decrypted --like "%chr_icon_1141%"
//   node scripts/download-game-assets.mjs --meta meta-jp.decrypted --like "..." --run
//
// Without --run this only lists what would be downloaded (a name/size preview) and exits --
// review the list before actually fetching. A --like pattern that matches an unexpectedly
// large number of rows is refused outright even with --run; narrow the pattern instead of
// forcing a mirror of the manifest.

import * as fs from 'node:fs';
import * as path from 'node:path';

import { program } from 'commander';

const BASE_DOMAIN = 'prd-storage-game-umamusume.akamaized.net';
const API_PATH = 'dl/resources';
const USER_AGENT =
	'UnityPlayer/2022.3.21f1 (UnityWebRequest/1.0, libcurl/8.5.0-DEV)';
const MAX_ROWS_WITHOUT_EXPLICIT_LIMIT = 200;

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
		'allow up to n matched rows (default refuses over ' +
			MAX_ROWS_WITHOUT_EXPLICIT_LIMIT +
			')',
		(v) => Number.parseInt(v, 10),
	)
	.option('--out <dir>', 'output cache directory', 'dat');

program.parse();
const opts = program.opts();

function resolveEndpoint(kind) {
	if (kind && ['master', 'sound', 'movie', 'font'].includes(kind))
		return 'Generic';
	if (kind?.includes('manifest')) return 'Manifest';
	return 'Windows/assetbundles';
}

function assetUrl(hash, kind) {
	return [
		'https:/',
		BASE_DOMAIN,
		API_PATH,
		resolveEndpoint(kind),
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

	const db = new Database(path.resolve(opts.meta), { readonly: true });
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

	const limit = opts.limit ?? MAX_ROWS_WITHOUT_EXPLICIT_LIMIT;
	if (rows.length > limit) {
		console.error(
			`Pattern matched ${rows.length} rows, over the limit of ${limit}. Narrow --like, ` +
				'or pass --limit explicitly if this is really intended -- this script refuses to ' +
				'silently mirror a large slice of the manifest.',
		);
		process.exit(1);
	}

	const totalBytes = rows.reduce((sum, r) => sum + r.l, 0);
	console.log(
		`${rows.length} row(s) matched, ${(totalBytes / 1024).toFixed(1)} KiB total:`,
	);
	for (const row of rows) {
		console.log(
			`  ${row.n}  (${row.l} bytes, ${row.e === 0n ? 'unencrypted' : 'AB-encrypted'})`,
		);
	}

	if (!opts.run) {
		console.log('\nDry run -- pass --run to actually download.');
		return;
	}

	for (const row of rows) {
		const destDir = path.join(opts.out, row.h.slice(0, 2));
		const destPath = path.join(destDir, row.h);
		if (fs.existsSync(destPath) && fs.statSync(destPath).size === row.l) {
			console.log(`skip (cached): ${row.n}`);
			continue;
		}
		fs.mkdirSync(destDir, { recursive: true });
		const url = assetUrl(row.h, row.m);
		const res = await fetch(url, {
			headers: { 'User-Agent': USER_AGENT, 'Cache-Control': 'no-cache' },
		});
		if (!res.ok) {
			console.error(`FAILED (${res.status}): ${row.n} <- ${url}`);
			continue;
		}
		const buf = Buffer.from(await res.arrayBuffer());
		if (buf.length !== row.l) {
			console.error(
				`WARNING: length mismatch for ${row.n}: expected ${row.l}, got ${buf.length}`,
			);
		}
		fs.writeFileSync(destPath, buf);
		console.log(`downloaded: ${row.n} -> ${destPath}`);
	}
}

main();
