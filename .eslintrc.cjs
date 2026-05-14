/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  env: { node: true, es2022: true },
  ignorePatterns: ['dist', 'node_modules', 'tests'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'warn',
    // Enforce ASCII-only identifiers in source code. User-facing strings are
    // confined to src/i18n/catalog/zh.ts and src/data/** (LocalizedString.zh).
    'id-match': ['error', '^[\\x00-\\x7F]+$', { properties: false }],
  },
  overrides: [
    {
      // Data and i18n zh catalog legitimately carry Chinese inside string
      // literals (LocalizedString.zh / catalog values). Identifiers there are
      // still ASCII; only string contents may be non-ASCII.
      files: ['src/data/**/*.ts', 'src/i18n/catalog/zh.ts'],
      rules: {},
    },
  ],
};
