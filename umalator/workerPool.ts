// A small pool of simulator.worker.ts instances, replacing the previous
// `[1,2,3,4].map(_ => useMemo(() => new Worker(...), []))` pattern in app.tsx -- which called
// useMemo from inside a .map() callback (a rules-of-hooks violation that happened to work only
// because the array length was constant), hardcoded 4 workers, and closed its message handler
// over `[]`, so it could never see fresh state without an escape hatch like a ref.
//
// This module owns worker lifecycle only. The handler function it dispatches to is swapped out
// on every render via setHandler() (see app.tsx), so it's always the latest closure, and never
// goes stale across a cancelAll() respawn the way the old inline useMemo handler would have.

export interface WorkerPool {
	readonly size: number;
	post(index: number, message: unknown, transfer?: Transferable[]): void;
	setHandler(fn: (workerIndex: number, data: any) => void): void;
	setErrorHandler(fn: (workerIndex: number, e: ErrorEvent) => void): void;
	// Terminates every worker and eagerly respawns them, so CPU actually stops for a superseded
	// run instead of merely having its results ignored. There is no cooperative alternative here:
	// a worker mid-race is in a synchronous step loop and can't poll for a cancel message until it
	// yields, and the SharedArrayBuffer/Atomics.wait alternative needs COOP/COEP headers GitHub
	// Pages can't set (see docs/deployment.md).
	cancelAll(): void;
	dispose(): void;
}

export function createWorkerPool(size: number, url: string): WorkerPool {
	let handler: (workerIndex: number, data: any) => void = () => {};
	let errorHandler: (workerIndex: number, e: ErrorEvent) => void = () => {};
	let workers: Worker[] = [];

	function spawnOne(index: number): Worker {
		const w = new Worker(url);
		w.addEventListener('message', (e: MessageEvent) => handler(index, e.data));
		w.addEventListener('error', (e: ErrorEvent) => errorHandler(index, e));
		return w;
	}

	function spawnAll() {
		workers = [];
		for (let i = 0; i < size; ++i) workers.push(spawnOne(i));
	}
	spawnAll();

	return {
		size,
		post(index, message, transfer) {
			workers[index].postMessage(message, transfer as any);
		},
		setHandler(fn) {
			handler = fn;
		},
		setErrorHandler(fn) {
			errorHandler = fn;
		},
		cancelAll() {
			workers.forEach((w) => {
				w.terminate();
			});
			spawnAll();
		},
		dispose() {
			workers.forEach((w) => {
				w.terminate();
			});
			workers = [];
		},
	};
}
