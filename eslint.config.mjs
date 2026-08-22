import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Prodpilot is a real-time countdown/clock app: reading Date.now() and
      // syncing local component state to an external source (Supabase,
      // window.location, setInterval/requestAnimationFrame ticks) inside
      // effects is the correct pattern here, not an anti-pattern. These two
      // React Compiler–oriented rules are tuned for apps that don't need a
      // live wall clock, so we relax them project-wide rather than sprinkle
      // eslint-disable comments through every timer-related hook/component.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
    },
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
