import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // GitHub's Windows runner runs this suite about eight times slower than a desktop PC.
    testTimeout: process.env.CI ? 60000 : 20000,
    hookTimeout: process.env.CI ? 60000 : 20000
  }
})
