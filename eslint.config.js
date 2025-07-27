import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';

/**
 * Flat‑config for ESLint ≥ v9
 * – JS recommended rules
 * – TypeScript plugin & rules
 * – Browser + Node globals so Web Serial names (`SerialPort`, `navigator` …)
 *   are defined.
 * – Turn off base `no‑undef` for TS files; TypeScript compiler already catches
 *   undefined identifiers, and browser‑only globals otherwise trigger false
 *   positives.
 */
export default [
  js.configs.recommended,

  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { '@typescript-eslint': ts.plugin },

    languageOptions: {
      parser: ts.parser,
      parserOptions: { project: './tsconfig.json' },
      globals: {
        ...globals.node,
        ...globals.browser,
        // extra Web Serial globals not yet in @types/dom
        SerialPort:        'readonly',
        SerialPortFilter:  'readonly'
      }
    },

    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' }
      ]
    }
  }
];
