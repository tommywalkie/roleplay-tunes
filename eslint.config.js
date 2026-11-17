import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/dev-dist/**', '**/coverage/**', '**/node_modules/**', '**/.agents/**', 'tmp/**'],
  },
  ...tseslint.configs.recommended,
);
