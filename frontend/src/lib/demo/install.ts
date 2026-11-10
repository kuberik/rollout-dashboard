/**
 * THE DEMO BUILD'S BACKEND: A `fetch` SHIM, AND NOTHING ELSE.
 *
 * `VITE_DEMO=1 DEMO_BASE=/demo pnpm exec vite build` (see
 * `scripts/build-demo.sh`) produces a static dashboard that kuberik.com serves
 * under `/demo/` and embeds in an iframe per showcase. There is no backend, no
 * cluster, no login and no GitHub behind it — every `/api/**` request is
 * answered in the page by `respond()` from `./respond.ts`, the same routing
 * table the Vite dev mock uses.
 *
 * ⭐ ONE SHIM COVERS SSE TOO. `eventsource-client` (which is what
 * `src/lib/api/events.ts` and `src/lib/api/logs.ts` use, NOT the platform
 * `EventSource`) reads `globalThis.fetch` and iterates `response.body`. So a
 * `Response` whose body is a `ReadableStream` is a first-class SSE stream to
 * it, and `/api/events/stream` and the pod-log stream need no second
 * mechanism. A platform `EventSource` would have needed one; if anything in
 * this app ever switches to it, this file must grow an `EventSource` shim.
 *
 * ⛔ TEARDOWN IS LOAD-BEARING. Each stream holds an interval. It is cancelled
 * on `AbortSignal` (how `eventsource-client` closes and how the log panel
 * unmounts) and on `ReadableStream.cancel` (how the browser reports a reader
 * going away). Losing either leaks a timer per navigation for the life of the
 * tab.
 */

import { respond, type MockResult } from './respond';

let installed = false;

function toResponse(result: MockResult, signal?: AbortSignal | null): Response {
	if (!result.stream) {
		return new Response(result.body ?? '{}', {
			status: result.status,
			headers: result.headers
		});
	}

	const encoder = new TextEncoder();
	let stop: (() => void) | undefined;
	let closed = false;

	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			const end = () => {
				if (closed) return;
				closed = true;
				stop?.();
				try {
					controller.close();
				} catch {
					/* already closed by the consumer */
				}
			};
			stop = result.stream!.start((chunk) => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(chunk));
				} catch {
					/* the consumer went away between chunks */
					end();
				}
			});
			// ⛔ `end()` CAN RUN BEFORE `stop` EXISTS, AND THAT LEAKED THE TIMER.
			// `start()` writes its opening chunks SYNCHRONOUSLY (the pod list, 38
			// backlog log lines) and only then returns the teardown. If one of
			// those enqueues throws — a consumer that is already gone — `end()`
			// fires with `stop` still `undefined`, closes the stream, and the
			// interval `start()` is about to return runs forever with nobody
			// reading it. Re-running the teardown here is the only ordering that
			// covers it; `end()` is idempotent via `closed`.
			if (closed) stop();
			if (signal) {
				if (signal.aborted) end();
				else signal.addEventListener('abort', end, { once: true });
			}
		},
		cancel() {
			closed = true;
			stop?.();
		}
	});

	return new Response(body, { status: result.status, headers: result.headers });
}

/**
 * Replaces `globalThis.fetch` with one that answers `/api/**` from the mock
 * and forwards everything else (the app's own chunks, fonts, images) to the
 * real implementation. Idempotent.
 */
export function installDemoApi(): void {
	if (installed || typeof window === 'undefined') return;
	installed = true;

	const realFetch = globalThis.fetch.bind(globalThis);

	globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		let rawUrl: string;
		let method = init?.method ?? 'GET';
		let signal = init?.signal ?? null;
		if (typeof input === 'string') rawUrl = input;
		else if (input instanceof URL) rawUrl = input.href;
		else {
			rawUrl = input.url;
			method = init?.method ?? input.method;
			signal = init?.signal ?? input.signal;
		}

		let url: URL;
		try {
			url = new URL(rawUrl, window.location.href);
		} catch {
			return realFetch(input as RequestInfo, init);
		}
		if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) {
			return realFetch(input as RequestInfo, init);
		}

		// ⭐ THE REQUEST BODY — mutations (retry, change-version) POST JSON.
		// `init.body` is a plain string for every call site in this app today
		// (always `JSON.stringify(...)`), which needs no awaiting at all; the
		// `Request`-as-`input` shape is read via `.text()` for completeness
		// (nothing in this app constructs one, but `fetch`'s own contract
		// allows it, and this shim is `respond()`'s only caller for real
		// requests — see that file's own doc comment on `MockOptions.body`).
		let body: string | undefined;
		if (typeof init?.body === 'string') body = init.body;
		else if (method !== 'GET' && method !== 'HEAD' && input instanceof Request) {
			try {
				body = await input.clone().text();
			} catch {
				body = undefined;
			}
		}

		return toResponse(respond(method, url.pathname + url.search, { body }), signal);
	};
}
