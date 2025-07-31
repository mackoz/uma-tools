import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as http from 'node:http';
import { fileURLToPath } from 'node:url';

import { program } from 'commander';

program
	.option('--debug')
	.option('--serve [port]', 'run development server on [port]', 8000);

program.parse();
const options = program.opts();
const port = options.serve;
const serve = port != null;
const debug = !!options.debug || serve;

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(dirname, '..', '..');

const redirectData = {
	name: 'redirectData',
	setup(build) {
		build.onResolve({filter: /^\.\.?(?:\/uma-skill-tools)?\/data\//}, args => ({
			path: path.join(dirname, args.path.split('/data/')[1])
		}));
		build.onResolve({filter: /skill_meta.json$/}, args => ({
			path: path.join(dirname, 'skill_meta.json')
		}));
		build.onResolve({filter: /umas.json$/}, args => ({
			path: path.join(dirname, 'umas.json')
		}));
	}
};

const mockAssertFn = debug ? 'console.assert' : 'function(){}';
const mockAssert = {
	name: 'mockAssert',
	setup(build) {
		build.onResolve({filter: /^assert$/}, args => ({
			path: args.path, namespace: 'mockAssert-ns'
		}));
		build.onLoad({filter: /.*/, namespace: 'mockAssert-ns'}, () => ({
			contents: 'module.exports={strict:'+mockAssertFn+'};',
			loader: 'js'
		}));
	}
};

const redirectTable = {
	name: 'redirectTable',
	setup(build) {
		build.onResolve({filter: /^@tanstack\//}, args => ({
			path: path.join(dirname, '..', 'vendor', args.path.slice(10), 'index.ts')
		}));
	}
};

const ctx = await esbuild.context({
	entryPoints: [{in: '../umalator/app.tsx', out: 'bundle'}, '../umalator/simulator.worker.ts'],
	bundle: true,
	minify: !debug,
	outdir: '.',
	write: !serve,
	define: {CC_DEBUG: debug.toString(), CC_GLOBAL: 'true'},
	external: ['*.ttf'],
	plugins: [redirectData, mockAssert, redirectTable]
});

const MIME_TYPES = {
	'.html': 'text/html; charset=UTF-8',
	'.css': 'text/css',
	'.js': 'text/javascript',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
	'.otf': 'font/otf',
	'.ttf': 'font/ttf',
	'.woff': 'font/woff'
};

const ARTIFACTS = ['bundle.js', 'bundle.css', 'simulator.worker.js'];

function runServer(port) {
	const requestCount = new Map(ARTIFACTS.map(f => [f, 0]));
	let buildCount = 0;
	let output = null;
	http.createServer(async (req, res) => {
		const url = req.url.endsWith('/') ? req.url + 'index.html' : req.url;
		const filename = path.basename(url);
		if (ARTIFACTS.indexOf(filename) > -1) {
			const requestN = requestCount.get(filename) + 1;
			requestCount.set(filename, requestN);
			if (requestN != buildCount) {
				buildCount += 1;
				console.log(`rebuilding ... => ${buildCount}`);
				await ctx.cancel();
				output = new Promise(async resolve => {
					const result = await ctx.rebuild();
					resolve(new Map(result.outputFiles.map(o => [path.basename(o.path), o.contents])));
				});
			}
			console.log(`GET ${req.url} 200 OK => ${requestN}`);
			const artifact = (await output).get(filename);
			res.writeHead(200, {
				'Content-type': MIME_TYPES[path.extname(filename)],
				'Content-length': artifact.length
			}).end(artifact);
		} else {
			const fp = path.join(root, url);
			const exists = await fs.promises.access(fp).then(() => true, () => false);
			if (exists) {
				console.log(`GET ${req.url} 200 OK`);
				res.writeHead(200, {'Content-type': MIME_TYPES[path.extname(filename)] || 'application/octet-stream'});
				fs.createReadStream(fp).pipe(res);
			} else {
				console.log(`GET ${req.url} 404 not found`)
				res.writeHead(404).end();
			}
		}
	}).listen(port);
}

if (serve) {
	runServer(port);
	console.log(`Serving on http://[::]:${port}/ ...`);
} else {
	await ctx.rebuild();
}
