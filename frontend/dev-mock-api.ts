/**
 * Vite dev server plugin that mocks the backend API for visual testing.
 *
 * Usage: In vite.config.ts, import and add to the plugins array:
 *
 *   import { mockApiPlugin } from './dev-mock-api';
 *   // ...
 *   plugins: [mockApiPlugin(), mkcert(), ...]
 *
 * Then run `npm run dev` and navigate to:
 *   https://localhost:5173/rollouts/default/hello-world
 *
 * Remove the plugin from vite.config.ts when done testing.
 */

import type { Plugin } from 'vite';

const NAMESPACE = 'default';
const ROLLOUT_NAME = 'hello-world';
const APP_NAMESPACE = 'hello-world';
const KUSTOMIZATION_NAME = 'hello-world';
const KUSTOMIZATION_NAMESPACE = 'default';

const mockRolloutResponse = {
	rollout: {
		apiVersion: 'kuberik.com/v1alpha1',
		kind: 'Rollout',
		metadata: {
			name: ROLLOUT_NAME,
			namespace: NAMESPACE,
			annotations: {
				'dashboard.rollout.kuberik.com/description':
					'Example application for testing rollout features.'
			},
			labels: {
				environment: 'dev'
			}
		},
		spec: {
			releasesImagePolicy: `${NAMESPACE}/${ROLLOUT_NAME}`,
			healthCheckSelector: { matchLabels: { app: ROLLOUT_NAME } },
			versionHistoryLimit: 10,
			minBakeTime: '1s'
		},
		status: {
			wantedVersion: 'f68d0ac',
			currentVersion: 'f68d0ac',
			previousVersion: 'a1b2c3d',
			history: [
				{
					version: { tag: 'f68d0ac', version: 'f68d0ac' },
					timestamp: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
					message: '*Automatic deployment*',
					triggeredBy: { kind: 'System', name: 'System' },
					bakeStatus: 'Succeeded',
					bakeStartTime: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
					bakeEndTime: new Date(Date.now() - 5 * 60 * 1000).toISOString()
				},
				{
					version: { tag: 'a1b2c3d', version: 'a1b2c3d' },
					timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
					message: '*Automatic deployment*',
					triggeredBy: { kind: 'System', name: 'System' },
					bakeStatus: 'Succeeded',
					bakeStartTime: new Date(Date.now() - 115 * 60 * 1000).toISOString(),
					bakeEndTime: new Date(Date.now() - 114 * 60 * 1000).toISOString()
				},
				{
					version: { tag: 'e4f5a6b', version: 'e4f5a6b' },
					timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
					message: 'Fix database connection pooling',
					triggeredBy: { kind: 'User', name: 'alice' },
					bakeStatus: 'Failed',
					bakeStatusMessage: 'Health check failed: readiness probe timeout',
					bakeStartTime: new Date(Date.now() - 295 * 60 * 1000).toISOString(),
					bakeEndTime: new Date(Date.now() - 290 * 60 * 1000).toISOString()
				},
				{
					version: { tag: '7c8d9e0', version: '7c8d9e0' },
					timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
					message: '*Automatic deployment*',
					triggeredBy: { kind: 'System', name: 'System' },
					bakeStatus: 'Succeeded',
					bakeStartTime: new Date(Date.now() - 23.9 * 60 * 60 * 1000).toISOString(),
					bakeEndTime: new Date(Date.now() - 23.8 * 60 * 60 * 1000).toISOString()
				},
				{
					version: { tag: 'b3c4d5e', version: 'b3c4d5e' },
					timestamp: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
					message: 'Initial release',
					triggeredBy: { kind: 'User', name: 'bob' },
					bakeStatus: 'Succeeded',
					bakeStartTime: new Date(Date.now() - 47.9 * 60 * 60 * 1000).toISOString(),
					bakeEndTime: new Date(Date.now() - 47.8 * 60 * 60 * 1000).toISOString()
				}
			]
		}
	},
	kustomizations: {
		items: [
			{
				apiVersion: 'kustomize.toolkit.fluxcd.io/v1',
				kind: 'Kustomization',
				metadata: {
					name: KUSTOMIZATION_NAME,
					namespace: KUSTOMIZATION_NAMESPACE
				},
				spec: {},
				status: { conditions: [] }
			}
		]
	},
	ociRepositories: { items: [] },
	rolloutGates: { items: [] },
	environment: {
		apiVersion: 'kuberik.com/v1alpha1',
		kind: 'Environment',
		metadata: { name: 'dev', namespace: NAMESPACE },
		spec: { label: 'dev' }
	},
	kruiseRollout: null,
	rolloutTests: { items: [] }
};

const mockManagedResources = {
	managedResources: [
		{
			groupVersionKind: 'apps/v1/Deployment',
			name: ROLLOUT_NAME,
			namespace: APP_NAMESPACE,
			status: 'Current',
			message: '',
			lastModified: new Date().toISOString(),
			object: {
				apiVersion: 'apps/v1',
				kind: 'Deployment',
				metadata: { name: ROLLOUT_NAME, namespace: APP_NAMESPACE },
				spec: { replicas: 1 },
				status: { readyReplicas: 1, replicas: 1 }
			}
		},
		// -- KruiseRollout so the deployment timeline renders --
		{
			groupVersionKind: 'rollouts.kruise.io/v1beta1/Rollout',
			name: ROLLOUT_NAME,
			namespace: APP_NAMESPACE,
			status: 'Current',
			message: '',
			lastModified: new Date().toISOString(),
			object: {
				apiVersion: 'rollouts.kruise.io/v1beta1',
				kind: 'Rollout',
				metadata: { name: ROLLOUT_NAME, namespace: APP_NAMESPACE },
				spec: {
					workloadRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: ROLLOUT_NAME },
					strategy: {
						canary: {
							steps: [
								{ replicas: 1, pause: { duration: 5 } },
								{ replicas: '100%' },
								{ replicas: '100%' }
							]
						}
					}
				},
				status: {
					phase: 'Healthy',
					canaryStatus: {
						currentStepIndex: 2,
						currentStepState: 'Completed',
						canaryRevision: 'f68d0ac',
						observedWorkloadGeneration: 1
					},
					conditions: [{ type: 'Progressing', status: 'True', reason: 'Completed' }]
				}
			}
		},
		// -- RolloutTest WITH link annotations (this is what we're testing!) --
		{
			groupVersionKind: 'rollout.kuberik.com/v1alpha1/RolloutTest',
			name: `${ROLLOUT_NAME}-test`,
			namespace: APP_NAMESPACE,
			status: 'Current',
			message: '',
			lastModified: new Date().toISOString(),
			object: {
				apiVersion: 'rollout.kuberik.com/v1alpha1',
				kind: 'RolloutTest',
				metadata: {
					name: `${ROLLOUT_NAME}-test`,
					namespace: APP_NAMESPACE,
					annotations: {
						'rollout.kuberik.com/link.Logs':
							'https://example.com/logs?service=hello-world&live=true',
						'rollout.kuberik.com/link.CI':
							'https://example.com/ci/test/runs?service=hello-world&version=f68d0ac'
					}
				},
				spec: {
					rolloutName: ROLLOUT_NAME,
					stepIndex: 2,
					jobTemplate: {
						template: {
							spec: {
								containers: [
									{
										name: 'test',
										env: [
											{ name: 'DD_SERVICE', value: ROLLOUT_NAME },
											{ name: 'DD_ENV', value: 'dev' },
											{ name: 'DD_VERSION', value: 'main-1770831919-f68d0ac3ed1185943c9105df735a099a2165c7ce' }
										]
									}
								]
							}
						}
					}
				},
				status: {
					phase: 'Succeeded',
					retryCount: 0,
					activePods: 0,
					succeededPods: 1,
					failedPods: 0,
					jobName: `${ROLLOUT_NAME}-test-f68d0ac`
				}
			}
		}
	]
};

const mockPermissions = {
	permissions: { update: true, patch: true },
	resource: {
		apiGroup: 'kuberik.com',
		kind: 'Rollout',
		name: ROLLOUT_NAME,
		namespace: NAMESPACE
	}
};

const mockHealthChecks = {
	healthChecks: [
		{
			name: ROLLOUT_NAME,
			namespace: APP_NAMESPACE,
			kind: 'Deployment',
			apiVersion: 'apps/v1',
			status: 'Healthy',
			message: 'Deployment is available'
		}
	]
};

export function mockApiPlugin(): Plugin {
	return {
		name: 'mock-api',
		configureServer(server) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			server.middlewares.use((req: any, res: any, next: () => void) => {
				if (!req.url?.startsWith('/api/')) return next();

				res.setHeader('Content-Type', 'application/json');

				// GET /api/rollouts
				if (req.url === '/api/rollouts') {
					return res.end(
						JSON.stringify({
							rollouts: { items: [mockRolloutResponse.rollout] }
						})
					);
				}

				// GET /api/rollouts/:namespace/:name
				if (req.url === `/api/rollouts/${NAMESPACE}/${ROLLOUT_NAME}`) {
					return res.end(JSON.stringify(mockRolloutResponse));
				}

				// GET /api/rollouts/:namespace/:name/permissions/all
				if (req.url === `/api/rollouts/${NAMESPACE}/${ROLLOUT_NAME}/permissions/all`) {
					return res.end(JSON.stringify(mockPermissions));
				}

				// GET /api/rollouts/:namespace/:name/rollout-tests
				if (req.url === `/api/rollouts/${NAMESPACE}/${ROLLOUT_NAME}/rollout-tests`) {
					const rolloutTestObject = mockManagedResources.managedResources.find(
						(r) => r.groupVersionKind === 'rollout.kuberik.com/v1alpha1/RolloutTest'
					);
					return res.end(
						JSON.stringify({
							rolloutTests: { items: rolloutTestObject ? [rolloutTestObject.object] : [] },
							kruiseRollout: null
						})
					);
				}

				// GET /api/rollouts/:namespace/:name/health-checks
				if (req.url === `/api/rollouts/${NAMESPACE}/${ROLLOUT_NAME}/health-checks`) {
					return res.end(JSON.stringify(mockHealthChecks));
				}

				// GET /api/rollouts/:namespace/:name/pods/logs (SSE stream)
				if (req.url?.startsWith(`/api/rollouts/${NAMESPACE}/${ROLLOUT_NAME}/pods/logs`)) {
					res.setHeader('Content-Type', 'text/event-stream');
					res.setHeader('Cache-Control', 'no-cache');
					res.setHeader('Connection', 'keep-alive');

					const pods = [
						{ name: `${ROLLOUT_NAME}-6f8b9c4d7-x2k9p`, namespace: APP_NAMESPACE, type: 'pod' },
						{ name: `${ROLLOUT_NAME}-6f8b9c4d7-m4j7q`, namespace: APP_NAMESPACE, type: 'pod' },
						{ name: `${ROLLOUT_NAME}-test-f68d0ac-zt5rn`, namespace: APP_NAMESPACE, type: 'test' }
					];

					// Send pods event first
					res.write(`event: pods\ndata: ${JSON.stringify(pods)}\n\n`);

					// Sample log lines for realistic output
					const sampleLogs = [
						{ level: 'INFO', msg: 'Starting server on :8080 with configuration loaded from /etc/config/app.yaml, environment=production, region=eu-west-1, instance_id=i-0a1b2c3d4e5f6g7h8' },
						{ level: 'INFO', msg: 'Connected to database postgresql://db.internal.cluster.local:5432/hello_world?sslmode=require&connect_timeout=10&application_name=hello-world-api-server' },
						{ level: 'DEBUG', msg: 'Loading configuration from /etc/config/app.yaml: database.pool_size=25, database.max_idle=5, cache.ttl=300s, cache.backend=redis, tracing.enabled=true, tracing.sample_rate=0.1' },
						{ level: 'INFO', msg: 'Health check endpoint registered at /healthz | Readiness probe: /ready | Liveness probe: /alive | Startup probe: /startup (timeout: 30s)' },
						{ level: 'INFO', msg: 'Metrics endpoint registered at /metrics (prometheus format) | Custom metrics: http_requests_total, http_request_duration_seconds, db_query_duration_seconds, cache_hit_ratio' },
						{ level: 'INFO', msg: 'Ready to accept connections on 0.0.0.0:8080 (HTTP) and 0.0.0.0:8443 (HTTPS) | TLS certificate loaded from /etc/tls/tls.crt, key from /etc/tls/tls.key' },
						{ level: 'INFO', msg: 'GET /api/v1/users?page=1&limit=50&sort=created_at&order=desc 200 12ms | request_id=req_a1b2c3d4 | user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" | ip=10.244.3.15' },
						{ level: 'DEBUG', msg: 'Cache hit for key: users:list:page=1:limit=50:sort=created_at:order=desc | cache_backend=redis | ttl_remaining=245s | size=12.4KB | compression=gzip' },
						{ level: 'INFO', msg: 'POST /api/v1/orders 201 45ms | request_id=req_e5f6g7h8 | order_id=ord_9f8e7d6c | total=149.99 | currency=EUR | items=3 | payment_method=stripe' },
						{ level: 'WARN', msg: 'Slow query detected: SELECT o.*, u.name, u.email FROM orders o JOIN users u ON o.user_id = u.id WHERE o.status = $1 AND o.created_at > $2 ORDER BY o.created_at DESC LIMIT 100 -- execution_time=320ms threshold=200ms rows_returned=87' },
						{ level: 'INFO', msg: 'GET /api/v1/products?category=electronics&brand=samsung&min_price=100&max_price=2000&in_stock=true&sort=popularity 200 8ms | results=142 | cache=HIT' },
						{ level: 'ERROR', msg: 'Failed to connect to redis at redis-master.cache.svc.cluster.local:6379 - ECONNREFUSED | retry_attempt=3/5 | backoff=8s | last_successful_connection=2m30s ago | pending_operations=12' },
						{ level: 'INFO', msg: 'Retrying redis connection in 5s... | connection_pool: active=0/25 idle=0/5 | fallback_mode=local_cache | degraded_features=[session_store, rate_limiter, pub_sub]' },
						{ level: 'INFO', msg: 'Redis connection re-established to redis-master.cache.svc.cluster.local:6379 | latency=2.3ms | pool_recovered: active=3/25 idle=5/5 | replaying 12 buffered operations' },
						{ level: 'DEBUG', msg: 'Processing webhook payload: {"event":"order.completed","id":"ord_9f8e7d6c","customer_id":"cust_x1y2z3","amount":149.99,"currency":"EUR","items":[{"sku":"SKU-001","qty":1},{"sku":"SKU-042","qty":2}],"metadata":{"source":"web","campaign":"summer-sale"}}' },
						{ level: 'INFO', msg: 'GET /healthz 200 1ms | checks: database=ok(2ms) redis=ok(1ms) disk=ok(89% free) memory=ok(654MB/1024MB) goroutines=142 uptime=4h23m' },
						{ level: 'INFO', msg: 'Graceful shutdown initiated (SIGTERM received), draining 23 active connections... | in_flight_requests=23 | drain_timeout=30s | active_websockets=5 | background_jobs=3' },
						{ level: 'INFO', msg: 'All connections drained successfully in 2.4s, shutting down HTTP server | total_requests_served=1,284,567 | uptime=4h23m12s | avg_response_time=18ms' },
						{ level: 'WARN', msg: 'High memory usage detected: 892MB / 1024MB (87%) | heap_alloc=756MB heap_sys=892MB stack_inuse=12MB gc_pause_avg=4.2ms num_goroutines=342 | consider increasing memory limit' },
						{ level: 'INFO', msg: 'GC completed: freed 245MB in 12ms | before=892MB after=647MB | next_gc_target=780MB | total_gc_cycles=1847 | cpu_fraction=0.02%' },
					];

					const testLogs = [
						{ level: 'INFO', msg: 'Running test suite: integration' },
						{ level: 'INFO', msg: 'Test: health check endpoint ... PASSED (2ms)' },
						{ level: 'INFO', msg: 'Test: create user ... PASSED (145ms)' },
						{ level: 'WARN', msg: 'Test: update user with invalid email ... PASSED (12ms) [expected 400]' },
						{ level: 'INFO', msg: 'Test: list orders with pagination ... PASSED (89ms)' },
						{ level: 'ERROR', msg: 'Test: concurrent writes ... FAILED: expected 200 but got 409 Conflict' },
						{ level: 'INFO', msg: 'Test: delete expired sessions ... PASSED (234ms)' },
						{ level: 'INFO', msg: 'Test suite completed: 6/7 passed, 1 failed' },
					];

					let logIndex = 0;
					const baseTime = Date.now() - 60000; // Start logs 1 min ago

					// Send a burst of initial historical logs
					const initialCount = 30;
					for (let i = 0; i < initialCount; i++) {
						const pod = pods[i % 2]; // Alternate between the two app pods
						const sample = sampleLogs[i % sampleLogs.length];
						const ts = baseTime + i * 2000;
						const logLine = {
							pod: pod.name,
							container: 'app',
							type: pod.type,
							line: `${new Date(ts).toISOString()} ${sample.level} ${sample.msg}`,
							timestamp: ts
						};
						res.write(`event: log\ndata: ${JSON.stringify(logLine)}\n\n`);
					}

					// Send some test pod logs
					for (let i = 0; i < testLogs.length; i++) {
						const ts = baseTime + (initialCount + i) * 2000;
						const logLine = {
							pod: pods[2].name,
							container: 'test-runner',
							type: 'test',
							line: `${new Date(ts).toISOString()} ${testLogs[i].level} ${testLogs[i].msg}`,
							timestamp: ts
						};
						res.write(`event: log\ndata: ${JSON.stringify(logLine)}\n\n`);
					}

					// Stream new logs periodically
					const interval = setInterval(() => {
						const pod = pods[logIndex % 2];
						const sample = sampleLogs[logIndex % sampleLogs.length];
						const ts = Date.now();
						const logLine = {
							pod: pod.name,
							container: 'app',
							type: pod.type,
							line: `${new Date(ts).toISOString()} ${sample.level} ${sample.msg}`,
							timestamp: ts
						};
						res.write(`event: log\ndata: ${JSON.stringify(logLine)}\n\n`);
						logIndex++;
					}, 2000);

					req.on('close', () => clearInterval(interval));
					return;
				}

				// GET /api/kustomizations/:namespace/:name/managed-resources
				if (
					req.url ===
					`/api/kustomizations/${KUSTOMIZATION_NAMESPACE}/${KUSTOMIZATION_NAME}/managed-resources`
				) {
					return res.end(JSON.stringify(mockManagedResources));
				}

				// Fallback: return empty JSON for any unhandled API routes
				return res.end(JSON.stringify({}));
			});
		}
	};
}
