import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/test/**/*.test.ts", "apps/**/test/**/*.test.ts"],
    // Integration tests share one Postgres; run files serially to avoid
    // two suites truncating each other's data mid-run.
    fileParallelism: false,
    environment: "node",
    globals: false,
    passWithNoTests: true,
  },
});
