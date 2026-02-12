import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "**/venv/**",
      "dist/**",
      "node_modules/**",
      ".mypy_cache/**",
      ".ruff_cache/**",
      "public/**",
      "src/assets/*.js",
      "eslint.config.js",
      "offline-scripts/*.ts",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  {
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.tools.json", "./tsconfig.runtime.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Hard Gates from agentic/instructions.md
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/no-explicit-any": "warn", // Start with warn, then error later
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "prefer-const": "error",

      // Node and ESM Discipline
      "no-restricted-globals": ["error", "process", "__dirname", "__filename"],
    },
  },
  prettierConfig,
);
