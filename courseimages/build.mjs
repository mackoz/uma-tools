import * as esbuild from 'esbuild';

import { program } from 'commander';

program
	.option('--debug');

program.parse();
const options = program.opts();
const debug = !!options.debug;

const mockAssertFn = debug ? 'console.assert' : 'function(){}';
const mockAssert = {
	name: 'mockAssert',
	setup(build) {
		build.onResolve({filter: /^node:assert$/}, args => ({
			path: args.path, namespace: 'mockAssert-ns'
		}));
		build.onLoad({filter: /.*/, namespace: 'mockAssert-ns'}, () => ({
			contents: 'module.exports={strict:'+mockAssertFn+'};',
			loader: 'js'
		}));
	}
};

await esbuild.build({
	entryPoints: [{in: './app.tsx', out: 'bundle'}],
	bundle: true,
	minify: !debug,
	outdir: '.',
	define: {CC_DEBUG: debug.toString()},
	plugins: [mockAssert]
});
