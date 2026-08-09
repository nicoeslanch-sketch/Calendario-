import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/**', '.vite/**', 'supabase/functions/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['public/sw.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: { ...globals.serviceworker },
    },
  },
];
