// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

/**
 * Lint rules are chosen to catch defects, not to argue about style — Prettier
 * owns formatting. Type-aware rules are enabled because the bugs worth
 * catching here (floating promises, unsafe narrowing) are invisible without
 * type information.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.storage/**",
      "**/migrations/**",
      "**/*.tsbuildinfo",
      "apps/web/dist/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        // A dedicated project so tests, scripts and root config files are
        // type-checked by the linter too, not skipped as "out of project".
        project: ["./tsconfig.eslint.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // An unawaited promise in a request handler is a silent data-loss bug.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      // Unused code is usually a leftover from a refactor that missed a spot.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      // `any` is allowed only where an external type forces it, and must be
      // explicit rather than inferred.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      // Drizzle and Fastify return plenty of legitimately loose template types.
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/require-await": "off",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },

  // The web app: hooks rules matter, Node globals do not.
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },

  /*
   * Boundaries that parse untyped third-party JSON.
   *
   * The portal returns `Record<string, unknown>`; coercing a field with
   * `String()` is the correct handling for a value whose type we genuinely do
   * not know, and the alternative — asserting a type we cannot verify — would
   * be worse. The rule stays on everywhere else.
   */
  {
    files: [
      "packages/nic-client/src/**/*.ts",
      "packages/core/src/compliance/**/*.ts",
      "apps/api/src/routes/**/*.ts",
      "apps/worker/src/**/*.ts",
      "scripts/**/*.ts",
    ],
    rules: { "@typescript-eslint/no-base-to-string": "off" },
  },

  // Entry points and scripts legitimately write to stdout.
  {
    files: [
      "scripts/**/*.{ts,mjs}",
      "**/src/server.ts",
      "**/src/worker.ts",
      "**/src/migrate.ts",
    ],
    rules: { "no-console": "off" },
  },

  // Plain Node scripts: not TypeScript, so type-aware rules do not apply.
  {
    files: ["**/*.mjs", "**/*.js", "**/*.cjs"],
    // Spread first: disableTypeChecked carries its own languageOptions and
    // would otherwise clobber the globals declared below it.
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: globals.node,
    },
  },

  // Tests assert against loose shapes on purpose.
  {
    files: ["**/test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
