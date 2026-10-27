const { defineConfig, globalIgnores } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

// src/engine is the pure, deterministic simulation core. It must stay free of
// React/Expo/state/i18n imports and non-deterministic built-ins so it can later
// run on a Node server unchanged (shared-world multiplayer). These rules make
// the architecture contract mechanical — see the determinism contract in
// src/engine/sim.ts.
const engineGuard = {
  files: ['src/engine/**'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          'react*',
          'expo*',
          '@react-native/*',
          'zustand*',
          'i18next*',
          '@/*',
        ],
      },
    ],
    'no-restricted-properties': [
      'error',
      // Non-deterministic or implementation-defined across JS engines
      { object: 'Math', property: 'random' },
      { object: 'Math', property: 'exp' },
      { object: 'Math', property: 'log' },
      { object: 'Math', property: 'pow' },
      { object: 'Math', property: 'sin' },
      { object: 'Math', property: 'cos' },
      { object: 'Date', property: 'now' },
    ],
    'no-restricted-syntax': [
      'error',
      { selector: 'NewExpression[callee.name="Date"]', message: 'Engine must not read wall-clock time.' },
    ],
  },
};

module.exports = defineConfig([
  ...expoConfig,
  engineGuard,
  globalIgnores(['dist/*']),
]);
