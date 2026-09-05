import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: [
			'umalator/**/*.test.ts',
			'components/**/*.test.{ts,tsx}',
			// Non-recursive: scripts/build-plugins/redirectEngineData.test.mjs is a
			// plain assert-and-log script (no vitest test()), run by hand rather than
			// through vitest -- a recursive glob here would pull it in and fail with
			// "No test suite found".
			'scripts/*.test.mjs',
		],
		environment: 'node',
	},
});
