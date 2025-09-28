// @ts-check
import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import { defineConfig } from 'eslint/config';

export default defineConfig([
	{
		ignores: [
			'types/**/*.d.ts',
			'out/**',
			'temp/**',
		]
	},
	js.configs.recommended,
	{
		files: ['**/*.{ts,mts,cts,js,mjs,cjs}'],
		languageOptions: {
			parser: tsparser,
			parserOptions: {
				ecmaVersion: 'latest',
				sourceType: 'module'
			}
		},
		plugins: {
			'@typescript-eslint': tseslint
		},
		rules: {
			...tseslint.configs.recommended.rules,
			'@typescript-eslint/no-non-null-assertion': 'off',
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unused-vars': 'off',
			'no-useless-escape': 'off',
			'semi': 'warn',
			'quotes': ['warn', 'single', { allowTemplateLiterals: true }],
			'indent': ['warn', 'tab', { SwitchCase: 1 }],
			'no-undef': 'off',
			'prefer-const': 'warn',
			'no-restricted-syntax': [
				'warn',
				{
					selector: ':matches(PropertyDefinition, TSParameterProperty, MethodDefinition[key.name!="constructor"])[accessibility="private"]',
					message: 'Use #private instead',
				},
			],
		}
	}
]);