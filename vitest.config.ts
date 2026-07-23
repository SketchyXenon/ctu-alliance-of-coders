import { defineConfig } from "vitest/config";
import path from "path";

// Per W5: pure-function + lib unit tests only (no Next.js route integration).
// Matches the test pyramid (04-testing-methodology.md section 2): many fast
// unit tests at the base, integration deferred until a test DB harness exists.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
