// Root flat ESLint config shared across the pnpm workspace.
//
// Philosophy (see plans/016): a MINIMAL, GREEN, error-level floor that can be
// ratcheted later — not a perfect config. High-value correctness rules are
// `error`; stylistic / noisy rules are `warn` or `off`. Type-aware rules
// (e.g. no-floating-promises) are intentionally NOT enabled here: they require
// a per-file project service that is slow and would flag hundreds of
// pre-existing sites, defeating the "green now, ratchet later" goal.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'

export default tseslint.config(
  // ---- Global ignores (cwd-agnostic so it works from any package dir) ----
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/public/**',
      '**/*.d.ts',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/.vercel/**',
    ],
  },

  // ---- Base JS/TS recommended ----
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ---- Vue 3 (essential = correctness-only, not the noisy style rules) ----
  ...pluginVue.configs['flat/essential'],

  // ---- Language options: browser + node globals, TS parser in .vue ----
  {
    files: ['**/*.{ts,tsx,vue,js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },

  // ---- Minimal ruleset: correctness errors, noise downgraded ----
  {
    files: ['**/*.{ts,tsx,vue,js,mjs,cjs}'],
    rules: {
      // High-value correctness kept as errors (all mechanically satisfiable).
      'no-unused-vars': 'off', // superseded by the @typescript-eslint version
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'prefer-const': 'error', // autofixable

      // `no-undef` is off for TS/Vue: the TypeScript compiler already resolves
      // undefined references (and does so correctly for ambient DOM lib types
      // and Vite `define` globals like __BUILD_NUMBER__). Leaving it on only
      // produces false positives — the tseslint project recommends disabling it.
      'no-undef': 'off',

      // Noisy / low-value in a large mature codebase — downgraded so the
      // error-level gate is green now and can be ratcheted later.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      '@typescript-eslint/no-unused-expressions': 'off',
      'no-empty': 'off',
      'no-constant-condition': ['warn', { checkLoops: false }],
      'no-cond-assign': 'off',
      'no-case-declarations': 'warn',
      'no-irregular-whitespace': 'warn', // multilingual string data legitimately contains these

      // Vue: allow single-word component names (many in this app).
      'vue/multi-word-component-names': 'off',
      'vue/return-in-computed-property': 'warn',
    },
  },
)
