/*
 * Configuration ESLint.
 *
 * Deux environnements dans le meme depot : le serveur tourne sous Node en
 * modules ES, l'interface dans le navigateur, et le decodeur de codes-barres
 * dans un worker. Chacun a ses variables globales.
 */
import js from '@eslint/js';

const communs = {
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
  'no-var': 'error',
  'prefer-const': 'error',
  eqeqeq: ['error', 'smart'],
  'no-console': 'off',
};

export default [
  {
    ignores: ['node_modules/**', 'data/**', 'backups/**', '.test-*/**', 'public/js/vendor/**'],
  },
  js.configs.recommended,
  {
    // Serveur et scripts : Node.
    files: ['src/**/*.js', 'scripts/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        AbortSignal: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: communs,
  },
  {
    // Interface : navigateur.
    files: ['public/js/**/*.js'],
    ignores: ['public/js/scan-worker.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        history: 'readonly',
        localStorage: 'readonly',
        fetch: 'readonly',
        FormData: 'readonly',
        Worker: 'readonly',
        Blob: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        Image: 'readonly',
        ImageBitmap: 'readonly',
        OffscreenCanvas: 'readonly',
        createImageBitmap: 'readonly',
        BarcodeDetector: 'readonly',
        MouseEvent: 'readonly',
        Event: 'readonly',
        CustomEvent: 'readonly',
        HTMLElement: 'readonly',
        HTMLImageElement: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        console: 'readonly',
        alert: 'readonly',
        getComputedStyle: 'readonly',
      },
    },
    rules: communs,
  },
  {
    // Worker du scan : ni window ni document, mais self et importScripts.
    files: ['public/js/scan-worker.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: {
        self: 'readonly',
        importScripts: 'readonly',
        OffscreenCanvas: 'readonly',
        ImageBitmap: 'readonly',
        Uint8ClampedArray: 'readonly',
        ZXing: 'readonly',
      },
    },
    rules: communs,
  },
];
