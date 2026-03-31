import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: [
      "src/__tests__/e2e.test.ts",
      "src/container/__tests__/container-e2e.test.ts",
      "src/verification/__tests__/browserSmoke.test.ts",
      "src/verification/__tests__/devServer.test.ts",
    ],
    globals: false,
    pool: "forks",
    testTimeout: 10_000,
    hookTimeout: 10_000,
    typecheck: {
      tsconfig: "tsconfig.test.json",
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/__tests__/**", "src/types/**"],
    },
  },
  resolve: {
    conditions: ["node"],
  },
});
