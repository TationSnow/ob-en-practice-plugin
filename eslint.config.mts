import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
					'eslint.config.mts',
					'manifest.json',
					'vitest.config.ts',
					'tests/prompts.test.ts',
					'tests/structured-output.test.ts',
					'tests/model.test.ts',
					'tests/sentence-utils.test.ts',
					'tests/grammar-validator.test.ts',
					'tests/panel-events.test.ts',
				],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
);
