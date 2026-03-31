import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/e2e.test.ts", "src/container/__tests__/container-e2e.test.ts"],
    globals: false,
    pool: "forks",
    testTimeout: 600_000,
    hookTimeout: 30_000,
    typecheck: {
      tsconfig: "tsconfig.test.json",
    },
    resolve: {
      conditions: ["node"],
    },
  },
});
