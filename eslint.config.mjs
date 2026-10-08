export default [{
  files: ['scripts/**/*.mjs', 'installer/**/*.mjs', 'test/**/*.mjs'],
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { console: 'readonly', process: 'readonly', URL: 'readonly', Buffer: 'readonly', AbortSignal: 'readonly', fetch: 'readonly', structuredClone: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly' } },
  rules: { 'no-undef': 'error', 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }], 'eqeqeq': 'error', 'no-unreachable': 'error', 'no-constant-condition': 'error', 'no-dupe-keys': 'error' }
}];
