// Local-dev OIDC auto-login.
//
// On first /api or /oauth2 request, fetches an ID token from Dex via the
// Resource Owner Password Credentials grant using the hardcoded local-dev
// admin@example.com/password creds, caches it, and injects it as
// Authorization: Bearer <token> on every subsequent proxied request.
//
// Pair with oauth2-proxy --skip-jwt-bearer-tokens=true so the cluster
// accepts bearer tokens instead of the session cookie. The token survives
// vite restarts since it's keyed off Dex's TTL (24h by default).
//
// On Dex restart all signing keys rotate, invalidating cached tokens.
// The plugin runs an http reverse proxy itself (not vite's built-in proxy)
// so it can detect oauth2-proxy's 302→/dex/auth response, drop the cached
// token, and retry transparently.
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

const DEFAULT_DEX_TOKEN_URL = 'https://192.168.1.102.nip.io:10443/dex/token';
const DEFAULT_PATHS = ['/api'];
const CLIENT_ID = 'rollout-dashboard';
const CLIENT_SECRET = 'rollout-dashboard-secret';
const USERNAME = 'admin@example.com';
const PASSWORD = 'password';
const SCOPE = 'openid email profile groups audience:server:client_id:kubernetes';

interface TokenResponse {
	id_token: string;
	access_token: string;
	expires_in: number;
}

function postForm(url: string, params: URLSearchParams): Promise<{ statusCode: number; body: string }> {
	return new Promise((resolve, reject) => {
		const u = new URL(url);
		const data = params.toString();
		const req = https.request(
			{
				hostname: u.hostname,
				port: u.port || 443,
				path: u.pathname + u.search,
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					'Content-Length': Buffer.byteLength(data)
				},
				rejectUnauthorized: false
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on('data', (c) => chunks.push(c));
				res.on('end', () =>
					resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() })
				);
			}
		);
		req.on('error', reject);
		req.write(data);
		req.end();
	});
}

async function fetchTokenFromDex(dexUrl: string): Promise<TokenResponse> {
	const params = new URLSearchParams({
		grant_type: 'password',
		username: USERNAME,
		password: PASSWORD,
		scope: SCOPE,
		client_id: CLIENT_ID,
		client_secret: CLIENT_SECRET
	});
	const { statusCode, body } = await postForm(dexUrl, params);
	if (statusCode !== 200) {
		throw new Error(`Dex token request failed: ${statusCode} ${body}`);
	}
	return JSON.parse(body) as TokenResponse;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on('data', (c) => chunks.push(c));
		req.on('end', () => resolve(Buffer.concat(chunks)));
		req.on('error', reject);
	});
}

function isDexRedirect(status: number | undefined, location: string | undefined): boolean {
	return status === 302 && !!location && location.includes('/dex/auth');
}

interface ProxyOpts {
	target: string;
	getToken: () => Promise<string>;
	invalidateToken: () => void;
}

async function proxyRequest(
	req: IncomingMessage,
	res: ServerResponse,
	opts: ProxyOpts
): Promise<void> {
	const target = new URL(opts.target);
	const isHttps = target.protocol === 'https:';
	const lib = isHttps ? https : http;
	const body =
		req.method && req.method !== 'GET' && req.method !== 'HEAD' ? await readBody(req) : null;

	for (let attempt = 0; attempt < 2; attempt++) {
		const token = await opts.getToken();
		const headers: http.OutgoingHttpHeaders = { ...req.headers };
		headers.host = target.host;
		headers.authorization = `Bearer ${token}`;
		if (body) headers['content-length'] = body.length;

		const upstream = await new Promise<IncomingMessage>((resolve, reject) => {
			const r = lib.request(
				{
					hostname: target.hostname,
					port: target.port || (isHttps ? 443 : 80),
					path: req.url,
					method: req.method,
					headers,
					rejectUnauthorized: false
				},
				resolve
			);
			r.on('error', reject);
			if (body) r.write(body);
			r.end();
		});

		if (attempt === 0 && isDexRedirect(upstream.statusCode, upstream.headers.location as string)) {
			console.warn('[dev-auth] oauth2-proxy rejected token (likely Dex restart) — refreshing');
			upstream.resume();
			opts.invalidateToken();
			continue;
		}

		res.statusCode = upstream.statusCode ?? 502;
		for (const [k, v] of Object.entries(upstream.headers)) {
			if (v !== undefined) res.setHeader(k, v as string | string[]);
		}
		upstream.pipe(res);
		return;
	}
}

export function devAuthPlugin(opts: { dexTokenUrl?: string; paths?: Record<string, string> } = {}): Plugin {
	const dexUrl = opts.dexTokenUrl ?? process.env.DEX_TOKEN_URL ?? DEFAULT_DEX_TOKEN_URL;
	// Map of path-prefix → upstream target. Defaults match the cluster ingress.
	const routes =
		opts.paths ??
		({
			'/api': 'https://kuberik.192.168.1.102.nip.io:8080',
			'/oauth2': 'https://kuberik.192.168.1.102.nip.io:8080'
		} as Record<string, string>);

	let cache: { token: string; expiresAt: number } | null = null;
	let inflight: Promise<string> | null = null;

	async function getToken(): Promise<string> {
		if (cache && cache.expiresAt > Date.now() + 60_000) return cache.token;
		if (inflight) return inflight;
		inflight = (async () => {
			try {
				const t = await fetchTokenFromDex(dexUrl);
				cache = { token: t.id_token, expiresAt: Date.now() + t.expires_in * 1000 };
				console.log(
					`[dev-auth] obtained id_token from Dex (expires in ${t.expires_in}s) as ${USERNAME}`
				);
				return t.id_token;
			} finally {
				inflight = null;
			}
		})();
		return inflight;
	}

	function invalidateToken() {
		cache = null;
	}

	function matchRoute(url: string): string | null {
		for (const [prefix, target] of Object.entries(routes)) {
			if (url === prefix || url.startsWith(prefix + '/') || url.startsWith(prefix + '?')) {
				return target;
			}
		}
		return null;
	}

	return {
		name: 'dev-auth',
		configResolved(config) {
			// Strip vite's built-in proxy for the routes we handle, so our middleware wins.
			if (config.server.proxy) {
				for (const prefix of Object.keys(routes)) {
					delete (config.server.proxy as Record<string, unknown>)[prefix];
				}
			}
		},
		configureServer(server) {
			server.middlewares.use(async (req, res, next) => {
				if (!req.url) return next();
				const target = matchRoute(req.url);
				if (!target) return next();
				try {
					await proxyRequest(req, res, { target, getToken, invalidateToken });
				} catch (e) {
					console.error('[dev-auth] proxy error:', e);
					if (!res.headersSent) {
						res.statusCode = 502;
						res.end('dev-auth proxy error');
					}
				}
			});
		}
	};
}
