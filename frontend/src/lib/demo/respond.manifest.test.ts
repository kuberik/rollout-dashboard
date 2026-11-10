import { describe, expect, it } from 'vitest';
import { respond } from './respond';
import { HF_APP } from './mock-data';
import { CW_NAME, CW_NAMESPACE } from './mock-details';

/**
 * Lane H's own manifest handler (squad-rollout spec §1) — a separate test
 * file from `respond.test.ts` so two lanes editing the same source file
 * (this one owns the diff/manifest route, Lane L owns the logs routes) do
 * not also have to interleave edits in one shared test file.
 */
function bodyOf(result: ReturnType<typeof respond>): { files?: Record<string, string> } {
	return JSON.parse(result.body ?? '{}');
}

describe('respond.ts — GET /rollouts/:namespace/:name/manifest/:tag', () => {
	it("serves checkout-edge-prod's last two deploys with real, different files", () => {
		const head = bodyOf(respond('GET', `/api/rollouts/${HF_APP}-prod/${HF_APP}/manifest/d09e6f4`));
		const prev = bodyOf(respond('GET', `/api/rollouts/${HF_APP}-prod/${HF_APP}/manifest/b7e0d41`));
		expect(head.files).toBeDefined();
		expect(prev.files).toBeDefined();
		expect(head.files?.['deployment.yaml']).not.toEqual(prev.files?.['deployment.yaml']);
		// Changed by design (squad-rollout diff, AD round 7): d09e6f4 "Reduce
		// checkout latency further" moves BOTH resources (replicas + a longer
		// edge cache TTL) — the diff page's two-resource case.
		expect(head.files?.['configmap.yaml']).not.toEqual(prev.files?.['configmap.yaml']);
	});

	// The "unchanged" case moved to 55f1a2c "Bump dependency lockfile": only
	// the image moves, the ConfigMap is byte-identical.
	it('keeps the ConfigMap unchanged across the lockfile bump (3e9d780 → 55f1a2c)', () => {
		const head = bodyOf(respond('GET', `/api/rollouts/${HF_APP}-prod/${HF_APP}/manifest/55f1a2c`));
		const prev = bodyOf(respond('GET', `/api/rollouts/${HF_APP}-prod/${HF_APP}/manifest/3e9d780`));
		expect(head.files?.['deployment.yaml']).not.toEqual(prev.files?.['deployment.yaml']);
		expect(head.files?.['configmap.yaml']).toEqual(prev.files?.['configmap.yaml']);
	});

	// A first deploy renders everything it created as added lines, so
	// hello-world-prod's only build needs a manifest; it ships the metrics
	// port its commit ("Add /metrics endpoint …") names.
	it("serves hello-world-prod's first (only) build", () => {
		const res = bodyOf(respond('GET', '/api/rollouts/hello-world-prod/hello-world/manifest/a1b2c3d'));
		expect(Object.keys(res.files ?? {}).sort()).toEqual(['deployment.yaml', 'service.yaml']);
		expect(res.files?.['deployment.yaml']).toContain('containerPort: 9090');
	});

	it('answers no `files` key for a build this fixture never recorded a manifest for', () => {
		const res = bodyOf(respond('GET', `/api/rollouts/${HF_APP}-prod/${HF_APP}/manifest/2c8b409`));
		expect(res.files).toBeUndefined();
	});

	it('answers no `files` key for any other rollout entirely', () => {
		const res = bodyOf(respond('GET', '/api/rollouts/hello-world-dev/hello-world-app/manifest/abc1234'));
		expect(res.files).toBeUndefined();
	});

	// AD round 3/4: "link the live row to its own diff" — checkout-worker's
	// own live FAILED build (the incident scenario's star rollout) gets a
	// real manifest pair too, not just checkout-edge-prod's.
	it("serves checkout-worker's own live pair with a real env-var change", () => {
		const head = bodyOf(respond('GET', `/api/rollouts/${CW_NAMESPACE}/${CW_NAME}/manifest/a02f1c4`));
		const prev = bodyOf(respond('GET', `/api/rollouts/${CW_NAMESPACE}/${CW_NAME}/manifest/3f1ed09`));
		expect(head.files).toBeDefined();
		expect(prev.files).toBeDefined();
		expect(head.files?.['deployment.yaml']).not.toEqual(prev.files?.['deployment.yaml']);
		expect(head.files?.['deployment.yaml']).toContain('PAYMENT_WEBHOOK_RETRY_BUDGET');
		expect(prev.files?.['deployment.yaml']).not.toContain('PAYMENT_WEBHOOK_RETRY_BUDGET');
	});
});
