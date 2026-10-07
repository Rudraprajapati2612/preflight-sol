import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    environment: 'node',
    // The LiteSVM oracle boots a real SVM and runs on-chain bytecode, which is
    // slower than a unit test but still well under a second per case.
    testTimeout: 30_000,
  },
})
