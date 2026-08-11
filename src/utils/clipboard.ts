/**
 * 将文本复制到剪贴板。
 * @param text 要复制的文本
 */
export async function copyTextToClipboard(text: string): Promise<void> {
	if (!navigator.clipboard?.writeText) {
		throw new Error('当前环境不支持剪贴板 API');
	}
	await navigator.clipboard.writeText(text);
}
