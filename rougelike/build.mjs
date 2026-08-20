import * as esbuild from 'esbuild';

import { program } from 'commander';

program
	.option('--debug');

program.parse();
const options = program.opts();
const debug = !!options.debug;

await esbuild.build({
	entryPoints: [{in: './app.tsx', out: 'bundle'}],
	bundle: true,
	minify: !debug,
	outdir: '.',
	define: {CC_DEBUG: debug.toString()}
});
