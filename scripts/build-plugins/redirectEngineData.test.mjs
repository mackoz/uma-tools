import assert from 'node:assert/strict';
import path from 'node:path';
import { redirectEngineDataPath } from './redirectEngineData.mjs';

// --- resolves a one-level-deep specifier from uma-tools root ---
{
	const importer = path.resolve('umalator-global/app.tsx');
	const result = redirectEngineDataPath(
		'../uma-skill-tools/data/jp/skill_data.json',
		importer,
	);
	assert.equal(
		result,
		path.resolve('uma-skill-tools/data/global/skill_data.json'),
	);
}

// --- resolves a two-levels-deep specifier (the exact shape that broke before) ---
{
	const importer = path.resolve('umalator/components/UmasTab.tsx');
	const result = redirectEngineDataPath(
		'../../uma-skill-tools/data/jp/skill_data.json',
		importer,
	);
	assert.equal(
		result,
		path.resolve('uma-skill-tools/data/global/skill_data.json'),
	);
}

// --- resolves the engine's own internal specifier (bundled in, one level from data/jp/) ---
{
	const importer = path.resolve('uma-skill-tools/RaceSolverBuilder.ts');
	const result = redirectEngineDataPath('./data/jp/skill_data.json', importer);
	assert.equal(
		result,
		path.resolve('uma-skill-tools/data/global/skill_data.json'),
	);
}

// --- non-matching specifier returns null, untouched ---
{
	const importer = path.resolve('umalator-global/app.tsx');
	assert.equal(redirectEngineDataPath('../skill_meta.json', importer), null);
}

// --- specifier already pointing at data/global/ returns null (no double-redirect) ---
{
	const importer = path.resolve('umalator-global/app.tsx');
	const result = redirectEngineDataPath(
		'../uma-skill-tools/data/global/skill_data.json',
		importer,
	);
	assert.equal(result, null);
}

console.log('redirectEngineData.test.mjs: all assertions passed');
