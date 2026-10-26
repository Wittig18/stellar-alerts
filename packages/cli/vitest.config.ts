import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@stellar-alerts/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The vault derives its key with argon2id (64 MiB, 3 iterations). In pure
    // JavaScript that takes several seconds per derivation, and the vault
    // tests perform several derivations per case, which overruns vitest's 5s
    // default on slower machines.
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
