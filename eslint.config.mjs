// Flat ESLint config for the JS-only Next.js app (no TypeScript parser needed).
import nextPlugin from "@next/eslint-plugin-next";
import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  { ignores: ["node_modules/**", ".next/**", "contracts/**"] },
  {
    files: ["**/*.{js,jsx,mjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        window: "readonly", document: "readonly", navigator: "readonly", console: "readonly", fetch: "readonly",
        setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly", clearInterval: "readonly",
        requestAnimationFrame: "readonly", cancelAnimationFrame: "readonly", performance: "readonly",
        URL: "readonly", URLSearchParams: "readonly", TextEncoder: "readonly", AbortSignal: "readonly",
        process: "readonly", BigInt: "readonly",
      },
    },
    settings: { react: { version: "detect" } },
    plugins: { "@next/next": nextPlugin, react: reactPlugin, "react-hooks": reactHooks },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      "react/jsx-uses-react": "error",
      "react/jsx-uses-vars": "error",
      "react/jsx-key": "error",
      "react/no-unescaped-entities": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-unused-vars": ["warn", { args: "none", ignoreRestSiblings: true }],
      "no-undef": "error",
      "@next/next/no-img-element": "off",
    },
  },
];
