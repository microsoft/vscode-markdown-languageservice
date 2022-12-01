module.exports = {
	root: true,
	parser: '@typescript-eslint/parser',
	plugins: [
		'@typescript-eslint',
	],
	extends: [
		'eslint:recommended',
		'plugin:@typescript-eslint/recommended',
	],
	rules: {
		'@typescript-eslint/no-non-null-assertion': 0,
		'@typescript-eslint/no-explicit-any': 0,
		'@typescript-eslint/no-unused-vars': 0,
		'no-useless-escape': 0,
		'semi': 1,
		'quotes': [1, 'single', { allowTemplateLiterals: true }],
		'no-restricted-syntax': [
			'warn',
			{
				selector: ':matches(PropertyDefinition, TSParameterProperty, MethodDefinition[key.name!="constructor"])[accessibility="private"]',
				message: 'Use #private instead',
			},
		],
	},
	ignorePatterns: [
		'types/**/*.d.ts'
	]
}; 