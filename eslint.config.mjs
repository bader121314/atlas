import tseslint from 'typescript-eslint';
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/next-env.d.ts',
      '**/generated/**',
      'scaffold.cjs',
      'scripts/ui-smoke.cjs',
    ],
  },
  ...tseslint.configs.recommended,
);
