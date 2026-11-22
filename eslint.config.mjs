import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "node_modules/",
      "dist/",
      "coverage/",
      "generated/",
      "prisma/migrations/",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  // Scripts do k6: variáveis globais injetadas pelo próprio k6
  {
    files: ["tests/carga/**/*.js"],
    languageOptions: { globals: { __ENV: "readonly" } },
  },
  prettierConfig,
);
