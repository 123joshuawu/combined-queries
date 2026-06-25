import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    typecheck: {
      enabled: false,
      tsconfig: './tsconfig.test.json',
      include: ['**/*.test-d.ts'],
    },
  },
});
