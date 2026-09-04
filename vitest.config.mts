import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['umalator/**/*.test.ts', 'components/**/*.test.{ts,tsx}'],
		environment: 'node',
	},
});
