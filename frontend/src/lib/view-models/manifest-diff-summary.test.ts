import { describe, expect, it } from 'vitest';
import {
	summarizeManifestChange,
	manifestChangeParts,
	manifestResource
} from './manifest-diff-summary';

const OLD = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout-edge
spec:
  replicas: 4
  template:
    spec:
      containers:
        - name: checkout-edge
          image: ghcr.io/exampleco/checkout-edge:b7e0d41
`;

const NEW = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout-edge
spec:
  replicas: 6
  template:
    spec:
      containers:
        - name: checkout-edge
          image: ghcr.io/exampleco/checkout-edge:d09e6f4
`;

describe('summarizeManifestChange', () => {
	it('names both the image tag and the replica count when both changed', () => {
		expect(summarizeManifestChange(OLD, NEW)).toBe('image b7e0d41 → d09e6f4 · replicas 4 → 6');
	});

	it('names only the field that actually changed', () => {
		const sameReplicas = NEW.replace('replicas: 6', 'replicas: 4');
		expect(summarizeManifestChange(OLD, sameReplicas)).toBe('image b7e0d41 → d09e6f4');
	});

	it('returns null when neither tracked field changed', () => {
		expect(summarizeManifestChange(OLD, OLD)).toBeNull();
	});

	// Changed by design (squad-rollout diff, AD round 5): a ConfigMap's
	// `data:` keys are tracked now, so a changed value has a headline.
	it('names a changed ConfigMap data key', () => {
		const cm = 'apiVersion: v1\nkind: ConfigMap\ndata:\n  LOG_LEVEL: info\n';
		expect(summarizeManifestChange(cm, cm.replace('info', 'debug'))).toBe('LOG_LEVEL info → debug');
	});

	it('returns null for a file with no tracked fields at all', () => {
		const svc = 'apiVersion: v1\nkind: Service\nspec:\n  type: ClusterIP\n';
		expect(summarizeManifestChange(svc, svc.replace('ClusterIP', 'NodePort'))).toBeNull();
	});

	it('is order-stable: image before replicas, regardless of their order in the file', () => {
		const oldReordered = 'replicas: 4\nimage: foo:aaa\n';
		const newReordered = 'image: foo:bbb\nreplicas: 6\n';
		expect(summarizeManifestChange(oldReordered, newReordered)).toBe('image aaa → bbb · replicas 4 → 6');
	});

	// AD round 4, item 7: "the headline includes added env vars" —
	// `checkout-worker`'s own real fixture (CW_MANIFESTS) is exactly this
	// case, no image/replicas change at all.
	const ENV_OLD = `spec:
  template:
    spec:
      containers:
        - name: checkout-worker
          image: ghcr.io/exampleco/checkout-worker:3f1ed09
          env:
            - name: PAYMENT_WEBHOOK_URL
              value: https://payments.internal/webhook
`;
	const ENV_NEW = `spec:
  template:
    spec:
      containers:
        - name: checkout-worker
          image: ghcr.io/exampleco/checkout-worker:a02f1c4
          env:
            - name: PAYMENT_WEBHOOK_URL
              value: https://payments.internal/webhook
            - name: PAYMENT_WEBHOOK_RETRY_BUDGET
              value: "3"
`;

	it('names a single added env var directly', () => {
		expect(summarizeManifestChange(ENV_OLD, ENV_NEW)).toBe(
			'image 3f1ed09 → a02f1c4 · added PAYMENT_WEBHOOK_RETRY_BUDGET'
		);
	});

	it('names a single removed env var directly', () => {
		expect(summarizeManifestChange(ENV_NEW, ENV_OLD)).toBe(
			'image a02f1c4 → 3f1ed09 · removed PAYMENT_WEBHOOK_RETRY_BUDGET'
		);
	});

	it('counts multiple added env vars instead of naming each', () => {
		const twoMore = ENV_NEW.replace(
			'value: "3"\n',
			'value: "3"\n            - name: PAYMENT_WEBHOOK_TIMEOUT_MS\n              value: "5000"\n'
		);
		expect(summarizeManifestChange(ENV_OLD, twoMore)).toBe('image 3f1ed09 → a02f1c4 · +2 env vars');
	});

	it('never mistakes a container\'s own "- name:" for an env var', () => {
		// Same container name on both sides, no `env:` block at all — a bare
		// `name:` regex would wrongly read the CONTAINER as an added env var.
		const noEnv = 'spec:\n  containers:\n    - name: checkout-worker\n      image: foo:aaa\n';
		const noEnvNew = 'spec:\n  containers:\n    - name: checkout-worker\n      image: foo:bbb\n';
		expect(summarizeManifestChange(noEnv, noEnvNew)).toBe('image aaa → bbb');
	});
});

describe('manifestChangeParts', () => {
	it('returns structured parts in headline order', () => {
		const a = 'spec:\n  replicas: 4\n  template:\n    spec:\n      containers:\n        - name: x\n          image: r/x:aaa\n';
		const b = a.replace('replicas: 4', 'replicas: 6').replace(':aaa', ':bbb');
		expect(manifestChangeParts(a, b)).toEqual([
			{ kind: 'field', field: 'image', from: 'aaa', to: 'bbb' },
			{ kind: 'field', field: 'replicas', from: '4', to: '6' }
		]);
	});

	it('tracks ConfigMap data keys added, changed and removed, quotes stripped', () => {
		const a = 'kind: ConfigMap\ndata:\n  TTL: "30"\n  OLD: x\n';
		const b = 'kind: ConfigMap\ndata:\n  TTL: "15"\n  WARM: "true"\n';
		expect(manifestChangeParts(a, b)).toEqual([
			{ kind: 'field', field: 'TTL', from: '30', to: '15' },
			{ kind: 'added', name: 'WARM' },
			{ kind: 'removed', name: 'OLD' }
		]);
	});

	it('is empty for identical texts', () => {
		expect(manifestChangeParts('kind: X\n', 'kind: X\n')).toEqual([]);
	});
});

describe('manifestResource', () => {
	it('reads kind and metadata.name', () => {
		expect(manifestResource('apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: edge-config\n  namespace: ns\n')).toEqual({
			kind: 'ConfigMap',
			name: 'edge-config'
		});
	});

	it('ignores a container name further down', () => {
		const m = 'kind: Deployment\nmetadata:\n  labels:\n    app: a\nspec:\n  template:\n    spec:\n      containers:\n        - name: c\n';
		expect(manifestResource(m)).toBeNull();
	});

	it('does not take a label called name for the resource name', () => {
		expect(manifestResource('kind: Service\nmetadata:\n  labels:\n    name: wrong\n  name: right\n')).toEqual({
			kind: 'Service',
			name: 'right'
		});
	});

	it('is null without a kind', () => {
		expect(manifestResource('metadata:\n  name: x\n')).toBeNull();
	});
});
