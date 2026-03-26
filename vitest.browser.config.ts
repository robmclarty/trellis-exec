import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "src/verification/__tests__/browserSmoke.test.ts",
      "src/verification/__tests__/devServer.test.ts",
    ],
    globals: false,
    pool: "forks",
    testTimeout: 30_000,
    hookTimeout: 15_000,
    typecheck: {
      tsconfig: "tsconfig.test.json",
    },
  },
  resolve: {
    conditions: ["node"],
  },
});
