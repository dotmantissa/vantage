import js from '@eslint/js';
import globals from 'globals';
export default [
  { ignores: ['frontend/**', 'node_modules/**', 'artifacts/**', 'backend/src/routes/api.js', 'backend/src/indexer.js', 'deploy/deploy.mjs', 'deploy/seed_market.mjs'] },
  js.configs.recommended,
  {files:['tests/browser/**'],languageOptions:{globals:globals.browser}},
  { languageOptions: { globals: globals.node }, rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }] } },
];
