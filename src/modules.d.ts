/**
 * 非代码资源的模块声明。
 * 词典数据（src/data/dictionary.txt）经 esbuild text loader 以字符串导入。
 */
declare module '*.txt' {
	const content: string;
	export default content;
}
