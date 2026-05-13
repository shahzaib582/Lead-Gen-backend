import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import n from 'eslint-plugin-n';

export default [
  {
    ignores: ['**/node_modules/**', '**/coverage/**', '**/*.min.js', '**/*.json'],
  },
  js.configs.recommended,
  {
    ...n.configs['flat/recommended-script'],
    files: ['**/*.js'],
  },
  {
    files: ['src/index.js'],
    rules: {
      'n/no-process-exit': 'off',
    },
  },
  eslintConfigPrettier,
];
