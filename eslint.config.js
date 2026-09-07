// ESLint (flat config) für Server (ESM/Node), Skripte, Tests und das React-Frontend.
//   npm run lint          → alles prüfen
//   npx eslint web/src    → nur Frontend
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

const unused = { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true };

export default [
  { ignores: ['**/node_modules/**', 'web/dist/**', 'release/**', 'data/**', 'backups/**', 'docs/**', '.previous/**', '.update-tmp/**'] },

  // Server, Skripte, Tests
  {
    files: ['server/**/*.js', 'scripts/**/*.mjs', 'test/**/*.mjs', 'vitest.config.mjs', 'eslint.config.js'],
    ...js.configs.recommended,
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node } },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', unused],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-constant-condition': ['error', { checkLoops: false }],
      // Muster `let x = <Default>; try { x = … } catch { … }` ist hier bewusst
      'no-useless-assignment': 'off',
    },
  },

  // Frontend (TypeScript + React)
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ['web/src/**/*.{ts,tsx}', 'web/vite.config.ts'] })),
  {
    files: ['web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
      // Regeln für den React Compiler (nicht im Einsatz): Formularzustand aus Abfragen zu spiegeln und der
      // Fokus-Anker des Modals (activeElement beim Öffnen) sind bewusste Muster
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/purity': 'off',
      '@typescript-eslint/no-unused-vars': ['error', unused],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  { files: ['web/vite.config.ts'], languageOptions: { globals: { ...globals.node } } },
];
