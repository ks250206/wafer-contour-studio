import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Keep existing editor synchronization patterns visible during the stack upgrade.
  {
    files: [
      "components/maskMapEditor.tsx",
      "components/pointTable.tsx",
      "components/waferVisualizer.tsx",
    ],
    rules: { "react-hooks/set-state-in-effect": "warn" },
  },
  {
    files: ["components/maskMapEditor.tsx"],
    rules: { "react-hooks/refs": "warn" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
