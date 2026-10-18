import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build/test artefacts.
    "playwright-report/**",
    "test-results/**",
    ".uploads/**",
    ".uploads-e2e/**",
    "e2e/.auth/**",
    "packages/*/dist/**",
    "packages/*/release/**",
  ]),
  // Browser code must not construct zod schemas through the raw package: see src/lib/zod.ts (CSP-safe, no eval probe).
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: ["src/lib/zod.ts", "src/lib/env.ts", "src/lib/print/protocol.ts", "**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "no-restricted-imports": ["error", { paths: [{ name: "zod", message: "Import { z } from \"@/lib/zod\" (browser code must not probe eval; see src/lib/zod.ts)." }] }],
    },
  },
]);

export default eslintConfig;
