import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-plugin-prettier";
import eslintConfigPrettier from "eslint-config-prettier";
import unusedImports from "eslint-plugin-unused-imports";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

export default tseslint.config(
    { ignores: ["**/dist/**", "**/node_modules/**"] },

    // 공통 TS 규칙 (전체 적용)
    {
        extends: [
            js.configs.recommended,
            ...tseslint.configs.recommended,
            eslintConfigPrettier,
        ],
        files: ["**/*.{ts,tsx}"],
        plugins: {
            prettier,
            "unused-imports": unusedImports,
            "simple-import-sort": simpleImportSort,
        },
        rules: {
            "prettier/prettier": "error",
            "no-unused-vars": "off",
            "@typescript-eslint/no-unused-vars": "off",
            "unused-imports/no-unused-imports": "error",
            "unused-imports/no-unused-vars": [
                "warn",
                {
                    vars: "all",
                    varsIgnorePattern: "^_",
                    args: "after-used",
                    argsIgnorePattern: "^_",
                },
            ],
            "simple-import-sort/imports": "error",
            "simple-import-sort/exports": "error",
        },
    },

    // web 전용 규칙
    {
        files: ["apps/web/**/*.{ts,tsx}"],
        languageOptions: {
            globals: globals.browser,
        },
        plugins: {
            "react-hooks": reactHooks,
            "react-refresh": reactRefresh,
        },
        rules: {
            ...reactHooks.configs.recommended.rules,
            "react-refresh/only-export-components": [
                "warn",
                { allowConstantExport: true },
            ],
        },
    },

    // api 전용 규칙
    {
        files: ["apps/api/**/*.ts"],
        languageOptions: {
            globals: globals.node,
        },
    }
);
