import { Platform } from 'obsidian';

/** 最多跟随的重定向次数，避免代理链路中出现循环跳转 */
const MAX_REDIRECTS = 5;

/** 需要跟随重定向的 HTTP 状态码 */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** 代理连接信息 */
interface ProxyContext {
	proxyUrl: URL;
	proxyAuth?: string;
}

/**
 * 桌面端渲染进程提供 require，移动端没有 Node 内建模块。
 * 仅在代理模式启用且桌面端运行时才会真正调用。
 */
declare const require: (id: string) => unknown;

/**
 * 校验代理地址并提取连接信息。
 * @param proxyAddress 用户填写的代理地址
 * @returns 代理上下文；地址无效时返回 null
 */
function createProxyContext(proxyAddress: string): ProxyContext | null {
	let proxyUrl: URL;
	try {
		proxyUrl = new URL(proxyAddress);
	} catch {
		return null;
	}
	if (proxyUrl.protocol !== 'http:' && proxyUrl.protocol !== 'https:') {
		return null;
	}
	return {
		proxyUrl,
		proxyAuth: buildProxyAuth(proxyUrl),
	};
}

/**
 * 构造代理认证头；只有代理地址包含用户名/密码时才需要。
 * @param proxyUrl 代理地址
 * @returns Proxy-Authorization 值；无认证信息时返回 undefined
 */
function buildProxyAuth(proxyUrl: URL): string | undefined {
	if (!Platform.isDesktop) {
		return undefined;
	}
	if (!proxyUrl.username && !proxyUrl.password) {
		return undefined;
	}
	const { Buffer } = require('buffer') as typeof import('buffer');
	const user = decodeURIComponent(proxyUrl.username);
	const pass = decodeURIComponent(proxyUrl.password);
	return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

/**
 * 把 fetch 的 Headers 参数转成 Node http 需要的普通对象。
 * @param headers HeadersInit 形式的请求头
 * @returns 键值均为字符串的请求头对象
 */
function headersToObject(headers?: HeadersInit): Record<string, string> {
	const result: Record<string, string> = {};
	if (!headers) {
		return result;
	}
	if (headers instanceof Headers) {
		headers.forEach((value, key) => {
			result[key] = value;
		});
		return result;
	}
	if (Array.isArray(headers)) {
		for (const [key, value] of headers) {
			result[key] = value;
		}
		return result;
	}
	for (const [key, value] of Object.entries(headers)) {
		if (value !== undefined) {
			result[key] = String(value);
		}
	}
	return result;
}

/**
 * 把 fetch 入参统一解析成 URL。
 * @param input fetch 的请求入参
 * @returns 解析后的 URL
 */
function toUrl(input: RequestInfo | URL): URL {
	if (typeof input === 'string') {
		return new URL(input);
	}
	if (input instanceof URL) {
		return new URL(input.href);
	}
	return new URL(input.url);
}

/**
 * 把 Node 的响应流包装成 Web ReadableStream，供全局 Response 使用。
 * @param nodeStream Node 的 IncomingMessage
 * @returns Web ReadableStream
 */
function nodeStreamToWebStream(
	nodeStream: import('stream').Readable,
): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			nodeStream.on('data', (chunk: Uint8Array) => {
				try {
					controller.enqueue(new Uint8Array(chunk));
				} catch {
					// 流已被取消时忽略后续数据
				}
			});
			nodeStream.on('end', () => {
				controller.close();
			});
			nodeStream.on('error', (err) => {
				controller.error(err);
			});
		},
		cancel() {
			nodeStream.destroy();
		},
	});
}

/**
 * 用 Node 响应构建 fetch Response，并补上 url 便于调试日志查看。
 * @param nodeRes Node 的 IncomingMessage
 * @param url 实际请求地址
 * @returns fetch Response
 */
function buildResponse(
	nodeRes: import('http').IncomingMessage,
	url: string,
): Response {
	const headers = new Headers();
	for (const [key, value] of Object.entries(nodeRes.headers)) {
		if (value === undefined) {
			continue;
		}
		headers.append(key, Array.isArray(value) ? value.join(', ') : value);
	}
	const response = new Response(nodeStreamToWebStream(nodeRes), {
		status: nodeRes.statusCode ?? 200,
		statusText: nodeRes.statusMessage ?? '',
		headers,
	});
	Object.defineProperty(response, 'url', {
		value: url,
		configurable: true,
	});
	return response;
}

/**
 * 按 fetch 语义处理重定向后的请求参数。
 * @param init 原始请求参数
 * @param status 重定向状态码
 * @returns 调整后的请求参数
 */
function redirectInit(init: RequestInit, status: number): RequestInit {
	const method = (init.method ?? 'GET').toUpperCase();
	const nextInit: RequestInit = { ...init };
	// 303 以及 301/302 的 POST 按规范降级为 GET，并移除内容相关请求头
	if (status === 303 || ((status === 301 || status === 302) && method === 'POST')) {
		nextInit.method = 'GET';
		nextInit.body = undefined;
		const headers = new Headers(init.headers);
		headers.delete('content-length');
		headers.delete('content-type');
		nextInit.headers = headers;
	}
	return nextInit;
}

/**
 * 代理模式下的 fetch 主流程：跟随重定向并复用同一代理连接信息。
 * @param context 代理连接信息
 * @param input 请求地址
 * @param init 请求参数
 * @param redirectsLeft 剩余重定向次数
 * @returns fetch Response
 */
async function proxyFetch(
	context: ProxyContext,
	input: RequestInfo | URL,
	init: RequestInit,
	redirectsLeft: number,
): Promise<Response> {
	const targetUrl = toUrl(input);
	const response = await rawRequest(context, targetUrl, init);
	if (
		REDIRECT_STATUSES.has(response.status) &&
		redirectsLeft > 0 &&
		init.redirect !== 'manual'
	) {
		const location = response.headers.get('location');
		if (location) {
			await response.body?.cancel().catch(() => undefined);
			return proxyFetch(
				context,
				new URL(location, targetUrl),
				redirectInit(init, response.status),
				redirectsLeft - 1,
			);
		}
	}
	return response;
}

/**
 * 根据目标协议分发到 HTTP 或 HTTPS 的代理请求实现。
 * @param context 代理连接信息
 * @param targetUrl 目标地址
 * @param init 请求参数
 * @returns fetch Response
 */
function rawRequest(
	context: ProxyContext,
	targetUrl: URL,
	init: RequestInit,
): Promise<Response> {
	if (targetUrl.protocol === 'https:') {
		return rawHttpsRequest(context, targetUrl, init);
	}
	if (targetUrl.protocol === 'http:') {
		return rawHttpRequest(context, targetUrl, init);
	}
	return Promise.reject(
		new Error(`代理模式不支持该协议：${targetUrl.protocol}`),
	);
}

/** 代理地址的默认端口 */
function proxyDefaultPort(proxyUrl: URL): number {
	return proxyUrl.protocol === 'https:' ? 443 : 80;
}

/**
 * 通过代理发送 HTTP 请求：使用绝对 URI 形式，代理可直接转发。
 * @param context 代理连接信息
 * @param targetUrl 目标地址
 * @param init 请求参数
 * @returns fetch Response
 */
function rawHttpRequest(
	context: ProxyContext,
	targetUrl: URL,
	init: RequestInit,
): Promise<Response> {
	if (!Platform.isDesktop) {
		return Promise.reject(new Error('代理模式仅在桌面端可用'));
	}
	return new Promise<Response>((resolve, reject) => {
		const http = require('http') as typeof import('http');
		const method = (init.method ?? 'GET').toUpperCase();
		const headers = headersToObject(init.headers);
		const body = typeof init.body === 'string' ? init.body : undefined;
		const signal = init.signal;

		const req = http.request(
			{
				host: context.proxyUrl.hostname,
				port: context.proxyUrl.port || proxyDefaultPort(context.proxyUrl),
				method,
				path: targetUrl.href,
				headers: {
					...headers,
					Host: targetUrl.host,
					...(context.proxyAuth
						? { 'Proxy-Authorization': context.proxyAuth }
						: {}),
				},
				agent: false,
			},
			(res) => {
				cleanup();
				resolve(buildResponse(res, targetUrl.href));
			},
		);

		const onAbort = () => req.destroy(new Error('代理请求已中止'));
		const cleanup = () => signal?.removeEventListener('abort', onAbort);
		if (signal) {
			if (signal.aborted) {
				req.destroy(new Error('代理请求已中止'));
				return;
			}
			signal.addEventListener('abort', onAbort, { once: true });
		}
		req.on('error', (err) => {
			cleanup();
			reject(err);
		});
		if (body) {
			req.write(body);
		}
		req.end();
	});
}

/**
 * 通过代理发送 HTTPS 请求：先用 CONNECT 建立隧道，再在隧道内完成 TLS 与请求。
 * @param context 代理连接信息
 * @param targetUrl 目标地址
 * @param init 请求参数
 * @returns fetch Response
 */
function rawHttpsRequest(
	context: ProxyContext,
	targetUrl: URL,
	init: RequestInit,
): Promise<Response> {
	if (!Platform.isDesktop) {
		return Promise.reject(new Error('代理模式仅在桌面端可用'));
	}
	return new Promise<Response>((resolve, reject) => {
		const http = require('http') as typeof import('http');
		const https = require('https') as typeof import('https');
		const tls = require('tls') as typeof import('tls');
		const method = (init.method ?? 'GET').toUpperCase();
		const headers = headersToObject(init.headers);
		const body = typeof init.body === 'string' ? init.body : undefined;
		const signal = init.signal;
		const targetPort = targetUrl.port || '443';
		const authority = `${targetUrl.hostname}:${targetPort}`;

		let settled = false;
		let tlsSocket: import('tls').TLSSocket | undefined;
		let activeRequest: import('http').ClientRequest | undefined;

		const onAbort = () => {
			activeRequest?.destroy();
			tlsSocket?.destroy();
		};
		const cleanup = () => signal?.removeEventListener('abort', onAbort);
		const fail = (err: Error) => {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			activeRequest?.destroy();
			tlsSocket?.destroy();
			reject(err);
		};

		if (signal) {
			if (signal.aborted) {
				fail(new Error('代理请求已中止'));
				return;
			}
			signal.addEventListener('abort', onAbort, { once: true });
		}

		const connectReq = http.request({
			host: context.proxyUrl.hostname,
			port: context.proxyUrl.port || proxyDefaultPort(context.proxyUrl),
			method: 'CONNECT',
			path: authority,
			headers: {
				Host: authority,
				...(context.proxyAuth
					? { 'Proxy-Authorization': context.proxyAuth }
					: {}),
			},
			agent: false,
		});

		connectReq.on('error', fail);

		connectReq.on('connect', (res, socket) => {
			if (res.statusCode !== 200) {
				socket.destroy();
				fail(
					new Error(
						`代理 CONNECT 失败：HTTP ${res.statusCode ?? '未知状态'}`,
					),
				);
				return;
			}
			tlsSocket = tls.connect({
				socket,
				servername: targetUrl.hostname,
			});
			tlsSocket.on('error', fail);
			tlsSocket.on('secureConnect', () => {
				activeRequest = https.request(
					{
						host: targetUrl.hostname,
						port: targetUrl.port || 443,
						path: targetUrl.pathname + targetUrl.search,
						method,
						headers,
						agent: false,
						createConnection: () => tlsSocket,
					},
					(res) => {
						if (settled) {
							return;
						}
						settled = true;
						cleanup();
						resolve(buildResponse(res, targetUrl.href));
					},
				);
				activeRequest.on('error', fail);
				if (body) {
					activeRequest.write(body);
				}
				activeRequest.end();
			});
		});

		connectReq.end();
	});
}

/**
 * 创建代理模式的 fetch 实现，供 ChatOpenAI 的 configuration.fetch 注入。
 * @param proxyAddress 用户填写的代理地址
 * @returns 代理 fetch；移动端或地址无效时返回 undefined
 */
export function createProxyFetch(
	proxyAddress: string,
): typeof fetch | undefined {
	if (!Platform.isDesktop) {
		return undefined;
	}
	const context = createProxyContext(proxyAddress);
	if (!context) {
		return async () => {
			throw new Error(`代理地址无效，请检查设置：${proxyAddress}`);
		};
	}
	return (input, init) =>
		proxyFetch(context, input, init ?? {}, MAX_REDIRECTS);
}

/**
 * 脱敏代理地址，便于写入调试日志。
 * @param proxyAddress 用户填写的代理地址
 * @returns 隐藏用户名密码后的代理地址
 */
export function formatProxyAddress(proxyAddress: string): string {
	try {
		const url = new URL(proxyAddress);
		if (url.username || url.password) {
			url.username = '***';
			url.password = '***';
		}
		return url.toString();
	} catch {
		return proxyAddress;
	}
}
