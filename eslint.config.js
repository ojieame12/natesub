import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Warn against defining local Pressable/Button components
      // Use shared components from ./components instead
      'no-restricted-syntax': [
        'warn',
        {
          selector: 'FunctionDeclaration[id.name="Pressable"]',
          message: 'Use the shared Pressable component from "./components" instead of defining locally.',
        },
        {
          selector: 'VariableDeclarator[id.name="Pressable"]',
          message: 'Use the shared Pressable component from "./components" instead of defining locally.',
        },
      ],
    },
  },
  // Exclude shared components directory from the local definition check
  {
    files: ['src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
])
