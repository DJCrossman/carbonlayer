import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'happy-dom',
    // zod/mini's messages, as the extension's scripts load them first.
    setupFiles: ['src/lib/zod-messages.ts'],
  },
});
