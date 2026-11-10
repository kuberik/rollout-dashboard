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
	test("title and body both name the environment, as written — never uppercase", () => {
		// ⭐ ROUND 2 (2026-10-08, design review 4): environment identity is
		// drawn ONE way everywhere — the name AS WRITTEN (principle 11).
		// `.toUpperCase()` on the dialog's own `envLabel` broke that; this
		// fixture's `dev` must print `dev`, not `DEV`.
		render(ClearPinModal, { open: true, rollout: devRollout() });

		// The title — a reader deciding whether to press has the answer before
		// reading the body.
		expect(screen.getByText('Clear the pin on hello-world-app in dev?')).toBeInTheDocument();
		// The body repeats it as a fact, not just in the heading. Emphasis is
		// colour (`text-fg`), never weight — no `<strong>` any more.
		expect(screen.getByText('dev', { selector: 'span' })).toBeInTheDocument();
	});

	test('a different environment on the same rollout shape says so, not "dev" by accident', () => {
		render(ClearPinModal, {
			open: true,
			rollout: devRollout({
				metadata: {
					name: 'hello-world-app',
					namespace: 'hello-world-prod',
					labels: { environment: 'prod' }
				}
			})
		});

		expect(screen.getByText('Clear the pin on hello-world-app in prod?')).toBeInTheDocument();
		expect(screen.queryByText(/in dev\?/)).not.toBeInTheDocument();
	});

	test('a spoke cluster name rides along, for the ambiguous case', () => {
		// A genuinely different cluster from the environment word — the case
		// the suffix exists for.
		render(ClearPinModal, { open: true, rollout: devRollout(), cluster: 'eu-spoke-1' });

		expect(screen.getByText(/on the eu-spoke-1 cluster/)).toBeInTheDocument();
	});

	test('no cluster prop: no cluster clause at all — the hub is unambiguous on its own', () => {
		render(ClearPinModal, { open: true, rollout: devRollout() });

		expect(screen.queryByText(/on the .* cluster/)).not.toBeInTheDocument();
	});

	test('cluster equal to the environment word, same case: no stutter', () => {
		// ⭐ THE COORDINATOR'S RESIDUE. (2026-09-03) `devRollout()` is
		// `environment: 'dev'`; a cluster ALSO literally named `dev`
		// disambiguates nothing and must not repeat the environment word.
		render(ClearPinModal, { open: true, rollout: devRollout(), cluster: 'dev' });

		expect(screen.queryByText(/on the .* cluster/)).not.toBeInTheDocument();
	});

	test('cluster equal to the environment word, different case: still no stutter', () => {
		render(ClearPinModal, { open: true, rollout: devRollout(), cluster: 'DEV' });  // cluster names stay whatever case the caller gives

		expect(screen.queryByText(/on the .* cluster/)).not.toBeInTheDocument();
	});
});

/**
 * ⭐ NO MODAL IN THIS PRODUCT HAD `role="dialog"`/`aria-modal`/A LABELLED
 * TITLE. (operator walk, 2026-09-03) flowbite's `Dialog` renders a native
 * `<dialog>` with neither attribute, and a live accessibility check found
 * every open dialog's computed role coming back `group`/`alert`/`status` —
 * never `dialog`. This is the one assertion `ChangeVersionModal`'s own test
 * cannot make for every modal in the product; each dialog gets it locked
 * here so the underlying `<Modal role="dialog" aria-modal="true">` cannot
 * quietly drop back to relying on implicit semantics.
 */
describe('the dialog has role="dialog", aria-modal and a labelled name', () => {
	test('role, aria-modal and an accessible name are all present on the open dialog', () => {
		render(ClearPinModal, { open: true, rollout: devRollout() });

		const dialog = document.querySelector('dialog');
		expect(dialog, 'no <dialog> rendered').not.toBeNull();
		expect(dialog?.getAttribute('role')).toBe('dialog');
		expect(dialog?.getAttribute('aria-modal')).toBe('true');
		// The dialog's own header (`<h2>`, §3.14) has no `id` for
		// `aria-labelledby` to reference — `aria-label` gives the dialog an
		// accessible name directly, and it is the same words the visible
		// header shows, verbatim.
		expect(dialog?.getAttribute('aria-label')).toBe('Clear the pin on hello-world-app in dev?');
	});
});
