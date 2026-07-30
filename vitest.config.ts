import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * Vitest configuration for Eks-Food.
 *
 * Two test projects are declared so the right environment is used for each
 * kind of test:
 *   - `node`   : default environment for domain logic, factories, mocks, libs.
 *   - `jsdom`  : DOM-enabled environment for components / hooks tests.
 *
 * Path aliases mirror `tsconfig.json`:
 *   - `@/*`    -> src/*
 *   - `@eks/*` -> src/packages/*
 *
 * Each project carries its own `resolve.alias` because Vitest 4 projects do
 * not inherit the top-level `resolve` block — each project is its own Vite
 * root. The aliases are identical across projects so import paths behave the
 * same everywhere.
 *
 * Coverage is collected with the V8 provider and gated behind minimum
 * thresholds to keep quality high.
 */
const aliases = [
  // Order matters: the more specific prefix must come first so that
  // `@eks/...` is resolved before the broader `@/...` rule.
  { find: "@eks/", replacement: resolve(__dirname, "src/packages") + "/" },
  { find: "@/", replacement: resolve(__dirname, "src") + "/" },
];

export default defineConfig({
  resolve: { alias: aliases },
  test: {
    globals: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**", "dist/**", "build/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.{test,spec}.{ts,tsx}",
        "src/**/__tests__/**",
        "src/**/__mocks__/**",
        "src/**/*.d.ts",
        "src/packages/testing/**",
        "src/app/**/route.ts",
        "next-env.d.ts",
      ],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
    projects: [
      {
        // Pure-logic tests: domain, factories, mocks, libs, route handlers.
        resolve: { alias: aliases },
        test: {
          name: "node",
          environment: "node",
          include: [
            "src/**/*.{test,spec}.{ts,tsx}",
            "!src/**/*.dom.{test,spec}.{ts,tsx}",
            "!src/components/**/*.{test,spec}.{ts,tsx}",
          ],
        },
      },
      {
        // DOM tests (React components, hooks touching the DOM).
        resolve: { alias: aliases },
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: [
            "src/**/*.dom.{test,spec}.{ts,tsx}",
            "src/components/**/*.{test,spec}.{ts,tsx}",
          ],
        },
      },
    ],
  },
});
