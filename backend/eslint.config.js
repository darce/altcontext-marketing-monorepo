import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import eslintConfigPrettier from "eslint-config-prettier";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: rootDir,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "prefer-arrow-callback": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "fs",
                "path",
                "crypto",
                "child_process",
                "http",
                "https",
                "os",
                "util",
                "stream",
                "url",
                "buffer",
                "events",
                "net",
                "tls",
                "zlib",
              ],
              message: "Use node: prefix (e.g. node:fs, node:path).",
            },
          ],
        },
      ],
    },
  },
  eslintConfigPrettier,
];
