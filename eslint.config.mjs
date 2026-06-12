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
    files: ['src/index.js', 'scripts/**/*.js', 'src/workers/**/*.js'],
    rules: {
      'n/no-process-exit': 'off',
    },
  },
  {
    files: ['src/**/*.js'],
    ignores: ['src/utils/response.js'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.type="MemberExpression"][callee.property.name="json"][callee.object.type="CallExpression"][callee.object.callee.type="MemberExpression"][callee.object.callee.object.name="res"]',
          message:
            'Use errorResponse, successResponse, or successResponsePaginated from utils/response.js instead of res.status().json().',
        },
        {
          selector:
            'CallExpression[callee.type="MemberExpression"][callee.property.name="json"][callee.object.name="res"]',
          message:
            'Use errorResponse, successResponse, or successResponsePaginated from utils/response.js instead of res.json().',
        },
      ],
    },
  },
  eslintConfigPrettier,
];
