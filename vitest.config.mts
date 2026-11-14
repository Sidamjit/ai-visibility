import { defineConfig } from 'vitest/config';

/**
 * Root Vitest config. Tests live next to the code they cover as `*.test.ts`
 * inside `packages/*` and `apps/worker`. The web app is covered by `next build`
 * (type + render checks) rather than unit tests in this pilot.
 */
export default defineConfig({
  test: {
    include: ['packages/**/src/**/*.test.ts', 'apps/worker/src/**/*.test.ts'],
    environment: 'node',
  },
});
