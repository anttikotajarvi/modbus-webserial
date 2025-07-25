import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',           // we only test pure logic; no DOM APIs needed
    coverage: {
      reporter: ['text', 'html']
    }
  }
});
