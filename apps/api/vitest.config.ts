import { defineConfig } from 'vitest/config';

/** Test service memakai DB `ares` lokal dari DATABASE_URL (.env root), bukan mock. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
