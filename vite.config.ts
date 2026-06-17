import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["apps/web/src/**/*.test.ts"],
    exclude: ["apps/web/e2e/**"],
  },
  lint: {
    ignorePatterns: [
      "node_modules/**",
      "**/node_modules/**",
      "apps/web/.next/**",
      "apps/web/out/**",
    ],
    options: {
      typeAware: false,
      typeCheck: false,
    },
  },
  fmt: {
    ignorePatterns: [
      "node_modules/**",
      "**/node_modules/**",
      "apps/web/.next/**",
      "apps/web/out/**",
    ],
    singleQuote: false,
    semi: true,
    sortPackageJson: true,
  },
  staged: {
    "*.{js,ts,jsx,tsx,vue,svelte,json,jsonc,css,md}": "vp check --fix",
  },
});
