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
						// src 与 tests 均在 tsconfig include 覆盖范围内，
						// 仅配置文件等非 tsconfig 成员需要登记到 default project
						maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 10,
						allowDefaultProject: [
							'eslint.config.mts',
							'manifest.json',
							'vitest.config.ts',
						],
					},
					tsconfigRootDir: import.meta.dirname,
					extraFileExtensions: ['.json'],
				},
		},
	},
	...obsidianmd.configs.recommended,
	{
		files: ['tests/setup.ts'],
		rules: {
			// 测试 mock 中没有 obsidian createDiv 运行时实现，保留原生 DOM 创建方式
			'obsidianmd/prefer-create-el': 'off',
		},
	},
	{
		// 测试运行于 Node 环境（vitest），不存在 window/activeWindow
		files: ['tests/**/*.ts'],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
		rules: {
			'obsidianmd/prefer-window-timers': 'off',
		},
	},
	{
		rules: {
			// URL、API Key 占位符、模型名与协议名属于大小写敏感内容，跳过 sentence-case 误报
			'obsidianmd/ui/sentence-case': [
				'warn',
				{
					ignoreRegex: [
						'sk-\\.\\.\\.',
						'https?://\\S+',
						'gpt-4o-mini',
						'Clash\\s+Verge',
						'LM\\s+Studio',
						'Ollama',
						'DeepSeek',
						'openai-compatible',
						'json_schema',
						'json_object',
						'\\bauto\\b',
					],
				},
			],
		},
	},
);
