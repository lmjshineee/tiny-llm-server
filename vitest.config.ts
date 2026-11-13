import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'coverage',
      include: ['src/core/**/*.ts', 'src/app/**/*.ts', 'src/app/**/*.tsx'],
      exclude: ['src/core/index.ts', 'src/core/types.ts', 'src/app/main.tsx'],
      thresholds: {
        statements: 85,
        branches: 78,
        functions: 88,
        lines: 87,
      },
    },
  },
})
