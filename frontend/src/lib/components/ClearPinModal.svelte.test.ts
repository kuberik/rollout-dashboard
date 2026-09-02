import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import ClearPinModal from './ClearPinModal.svelte';
import type { Rollout } from '../../types';

// See the identical note in `ChangeVersionModal.svelte.test.ts` — jsdom has
// neither the Web Animations API nor a working `<dialog>`.
if (!Element.prototype.animate) {
	// Svelte's `fly`/`fade` transitions call the Web Animations API, which
	// jsdom does not implement. A no-op that resolves immediately is enough:
	// the assertion is about the words, not the motion.
	Element.prototype.animate = function () {
		return {
			cancel() {},
			finish() {},
			set onfinish(_fn: unknown) {},
			currentTime: 0,
			playState: 'finished'
		} as unknown as Animation;
	};
}

if (!HTMLDialogElement.prototype.showModal) {
	HTMLDialogElement.prototype.showModal = function () {
		this.open = true;
	};
	HTMLDialogElement.prototype.show = function () {
		this.open = true;
	};
	HTMLDialogElement.prototype.close = function () {
		this.open = false;
	};
}

/**
 * ⭐ DEFECT 2 — "REMOVE THE VERSION PIN FOR hello-world-app?" NAMED NO
 * ENVIRONMENT. (2026-09-02, operator walk)
 *
 * Reached from `/apps/hello-world-app`, a page listing THREE environments,
 * with the banner naming DEV as the pinned one. The dialog already unpins
 * only the one rollout it was opened for; the words did not say so before
 * the press. `rolloutEnvironmentName` reads `metadata.labels.environment`
 * first — the live fixture below is that shape, unmodified.
 */

function devRollout(over: Record<string, unknown> = {}): Rollout {
	return {
		metadata: {
			name: 'hello-world-app',
			namespace: 'hello-world-dev',
			labels: { environment: 'dev' }
		},
		spec: { wantedVersion: 'main-abc123' },
		status: {
			availableReleases: [{ tag: 'main-abc123', version: 'abc1234' }],
			gates: [],
			history: [{ version: { tag: 'main-abc123', version: 'abc1234' }, bakeStatus: 'Succeeded' }]
		},
		...over
	} as unknown as Rollout;
}

describe('defect 2 — Clear Version Pin names the environment it acts on', () => {
	test('title and body both name the environment, in the product\'s own case', () => {
		render(ClearPinModal, { open: true, rollout: devRollout() });

		// The title — a reader deciding whether to press has the answer before
		// reading the body.
		expect(screen.getByText('Remove the pin on hello-world-app in DEV?')).toBeInTheDocument();
		// The body repeats it as a fact, not just in the heading.
		expect(screen.getByText('DEV', { selector: 'strong' })).toBeInTheDocument();
	});

	test('a different environment on the same rollout shape says so, not "DEV" by accident', () => {
		render(ClearPinModal, {
			open: true,
			rollout: devRollout({
				metadata: { name: 'hello-world-app', namespace: 'hello-world-prod', labels: { environment: 'prod' } }
			})
		});

		expect(screen.getByText('Remove the pin on hello-world-app in PROD?')).toBeInTheDocument();
		expect(screen.queryByText(/in DEV\?/)).not.toBeInTheDocument();
	});

	test('a spoke cluster name rides along, for the ambiguous case', () => {
		render(ClearPinModal, { open: true, rollout: devRollout(), cluster: 'dev' });

		expect(screen.getByText(/on the dev cluster/)).toBeInTheDocument();
	});

	test('no cluster prop: no cluster clause at all — the hub is unambiguous on its own', () => {
		render(ClearPinModal, { open: true, rollout: devRollout() });

		expect(screen.queryByText(/on the .* cluster/)).not.toBeInTheDocument();
	});
});
