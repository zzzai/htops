import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["api/**", "data/**", "knowledge/**"],
    testTimeout: 120_000,
  },
});
