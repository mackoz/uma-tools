// Decrypts a copy of the game client's `meta` asset-manifest DB (a sibling of `master.mdb`,
// single table `a(n, h, e, rowid)` mapping asset name -> content hash / per-asset encryption
// key -- see docs/data-pipeline.md) into a plaintext SQLite file, so this repo's existing
// Perl pipeline (extract_resource.pl, make_uma_info.pl -- both already open `meta` with a
// bare `DBI->connect`, no decryption) can read it unchanged.
//
// PIPE-2: current game clients encrypt `meta` with sqleet ChaCha20 (the default cipher of
// SQLite3MultipleCiphers), not SQLCipher -- confirmed from the file header itself: bytes
// 16 onward (page size, format version, reserved-space byte) are valid plaintext SQLite
// header fields, only the first 16 bytes (the magic string) are replaced with a random
// salt, and each page carries 32 reserved bytes (16-byte nonce + 16-byte Poly1305 tag).
// SQLCipher encrypts the whole first page including those header fields; sqleet does not.
// That means a maintained drop-in binding (better-sqlite3-multiple-ciphers, which supports
// sqleet/ChaCha20 alongside SQLCipher) can open it directly with PRAGMA hexkey, no need to
// hand-roll SQLCipher's PBKDF2/page-HMAC scheme.
//
// The decryption key below was cross-checked from two independent sources and matched
// byte-for-byte: PIPE-2's own research (MarshmallowAndroid/UmamusumeExplorer,
// UmaDataHelper.cs) and this script's own derivation from daydreamer-json/uma-db-stuff's
// published key-derivation constants (src/utils/config.ts's `cipher.sqliteDb.plainKey` /
// `.baseKey`, XORed per src/utils/db.ts's `generateDecryptionKey`: plainKey[i] ^ baseKey[i
// % 13]). Two unrelated reverse-engineering efforts agreeing is meaningful evidence this key
// is current, but it is still an extracted client secret with a documented history of
// rotating on client updates (see PIPE-2's evidence: UmaViewer issue #191) -- if this script
// fails to open a `meta` file with "file is not a database" or a HMAC/tag mismatch, the key
// has most likely rotated again; that's a "come back and re-derive it" problem, not a bug
// in this script.
//
// better-sqlite3-multiple-ciphers is NOT a package.json dependency -- deploy.yml runs a
// plain `npm install` on every push, and this is a deliberately-run, native-binding data
// tool, not part of any built app (same reasoning as the pipeline's undeclared Perl module
// requirements, DBI/File::Slurper/etc., documented in docs/data-pipeline.md). Install it
// yourself before running this script: npm i -D better-sqlite3-multiple-ciphers
//
// Usage:
//   node scripts/decrypt-meta-db.mjs <path-to-encrypted-meta> [output-path]
//   # output defaults to <input>.decrypted

import * as fs from 'node:fs';
import * as path from 'node:path';

// Derived from daydreamer-json/uma-db-stuff's src/utils/config.ts + src/utils/db.ts
// (AGPL-3.0 -- this is the extracted numeric result of their published key-derivation
// constants, not a copy of their code) and independently matched against PIPE-2's
// MarshmallowAndroid/UmamusumeExplorer-derived candidate key.
const META_DB_HEXKEY =
	'9c2bab97bcf8c0c4f1a9ea7881a213f6c9ebf9d8d4c6a8e43ce5a259bde7e9fd';

async function main() {
	const [inputArg, outputArg] = process.argv.slice(2);
	if (!inputArg) {
		console.error(
			'Usage: node scripts/decrypt-meta-db.mjs <path-to-encrypted-meta> [output-path]',
		);
		process.exit(1);
	}
	const inputPath = path.resolve(inputArg);
	const outputPath = path.resolve(outputArg ?? `${inputPath}.decrypted`);

	if (!fs.existsSync(inputPath)) {
		console.error(`Input file does not exist: ${inputPath}`);
		process.exit(1);
	}

	let Database;
	try {
		({ default: Database } = await import('better-sqlite3-multiple-ciphers'));
	} catch {
		console.error(
			'better-sqlite3-multiple-ciphers is not installed. This is a deliberately-run ' +
				"data-pipeline tool, not a package.json dependency (see this file's header " +
				'comment). Install it first:\n\n' +
				'  npm i -D better-sqlite3-multiple-ciphers\n',
		);
		process.exit(1);
	}

	// db declared outside the try so the catch block can clean it up regardless of which
	// step failed -- including the copy/open steps themselves, which used to run before this
	// try started (PIPE-2 review): an exception from either propagated as an unhandled crash
	// instead of the intended console.error + process.exit(1) path, and a copy that succeeded
	// before `new Database()` threw was left stray on disk with no cleanup.
	let db;
	try {
		// better-sqlite3's `PRAGMA rekey` rewrites the currently-open database in place, so
		// work on a copy and never touch the original encrypted file.
		fs.copyFileSync(inputPath, outputPath);
		db = new Database(outputPath);
		db.pragma(`hexkey = '${META_DB_HEXKEY}'`);
		// PRAGMA rekey with an empty string tells SQLite3MultipleCiphers to write the database
		// back out unencrypted -- this is what turns the copy into a plain SQLite file the
		// existing Perl pipeline's bare `DBI->connect` can open.
		db.pragma("rekey = ''");
		// Confirms the key was actually accepted: an encrypted DB opened with the wrong key
		// does not throw on `new Database(...)` (SQLite defers reading page 1 that far), but
		// throws here as soon as a real query touches undecryptable pages.
		const tables = db
			.prepare(
				"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
			)
			.all()
			.map((r) => r.name);
		if (!tables.includes('a')) {
			throw new Error(
				`decrypted, but expected table "a" not found (got: ${tables.join(', ') || '(none)'})`,
			);
		}
		const { count } = db.prepare('SELECT count(*) AS count FROM a').get();
		console.log(`Decrypted ${outputPath}`);
		console.log(`Table "a": ${count} row(s)`);
	} catch (err) {
		db?.close();
		fs.rmSync(outputPath, { force: true });
		console.error(
			'Decryption failed -- the key was rejected, the file is not the expected format, ' +
				'or the copy/open step itself failed (disk full, permissions, etc). If this ' +
				"previously worked, the game client's encryption key has most likely rotated; " +
				"see this file's header comment. Underlying error:",
		);
		console.error(err.message);
		process.exit(1);
	}
	db.close();
}

main();
