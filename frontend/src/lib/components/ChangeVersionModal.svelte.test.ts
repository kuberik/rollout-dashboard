import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
import ChangeVersionModal from './ChangeVersionModal.svelte';
import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import { autoDeployState } from '$lib/view-models/auto-deploy';
import type { Rollout } from '../../types';

// jsdom has neither the Web Animations API nor a working `<dialog>` —
// `flowbite`'s transitions and its `Dialog` both throw on mount without
// these. Same polyfill as `lib/messages/subject-uncovered.svelte.test.ts`,
// the first place this component was ever exercised in a test.
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
 * ⭐ FOUR DEFECTS FROM ONE LIVE OPERATOR WALK, ALL LOCATED IN THIS DIALOG.
 *
 * The fixtures below are the live hub's own shapes (`hello-frontend-app`
 * prod, held by `hello-frontend-needs-api` and by `after staging`; a rollout
 * whose deployed build is also its newest, where `GatesPassing` reads
 * `False` for a reason that is not a hold at all). Confirmed against the
 * running cluster on 2026-09-02, not invented.
 */

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000 - 60 * 60 * 1000).toISOString();

function rolloutFixture(over: Record<string, unknown> = {}): Rollout {
	return {
		metadata: {
			name: 'hello-frontend-app',
			namespace: 'hello-dep-prod',
			labels: { environment: 'prod' }
		},
		spec: {},
		status: {
			// oldest-first, exactly as the API publishes it.
			availableReleases: [
				{ tag: 'rel-66', version: '1.66.0-66', created: daysAgo(35) },
				{ tag: 'rel-67', version: '2.67.0-67', created: daysAgo(1) }
			],
			gates: [
				{ name: 'dependency-hello-frontend-needs-api', passing: true, allowedVersions: ['rel-66'] },
				{ name: 'ghd-5b2wn', passing: true, allowedVersions: [] }
			],
			conditions: [{ type: 'GatesPassing', status: 'False', reason: 'NoAllowedVersions' }],
			history: [
				{ version: { tag: 'rel-66', version: '1.66.0-66' }, bakeStatus: 'Succeeded', timestamp: daysAgo(4) }
			]
		},
		...over
	} as unknown as Rollout;
}

let fetchMock: ReturnType<typeof vi.fn>;

const NAMESPACE_LIST_RESPONSE = {
	environments: {
		items: [
			{
				metadata: { name: 'hello-frontend-app', namespace: 'hello-dep-prod' },
				spec: { relationship: { environment: 'staging', type: 'After' } },
				status: { rolloutGateRef: { name: 'ghd-5b2wn' } }
			}
		]
	},
	rolloutDependencies: {
		items: [
			{
				metadata: { name: 'hello-frontend-needs-api', namespace: 'hello-dep-prod' },
				spec: { contract: 'api', providerRef: { name: 'hello-api-app', namespace: 'hello-dep-prod' } },
				status: {
					gateName: 'dependency-hello-frontend-needs-api',
					providedVersion: '1.66.0',
					blockedReleases: [{ tag: 'rel-67', requiredVersion: '^1.67.0', reason: 'ConstraintNotSatisfied' }]
				}
			}
		]
	}
};

beforeEach(() => {
	fetchMock = vi.fn(async (input: RequestInfo | URL) => {
		const url = typeof input === 'string' ? input : input.toString();
		if (url.startsWith('/api/rollouts?namespace=')) {
			return new Response(JSON.stringify(NAMESPACE_LIST_RESPONSE), { status: 200 });
		}
		// Everything else (annotations, tags) — honestly empty, unused by these tests.
		return new Response(JSON.stringify({}), { status: 200 });
	});
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

function renderModal(props: Record<string, unknown>) {
	return render(WithQueryClient, {
		props: {
			component: ChangeVersionModal as never,
			props: { open: true, onSuccess: () => {}, onError: () => {}, ...props }
		}
	});
}

async function selectRow(displayVersion: string) {
	const row = screen.getByText(displayVersion).closest('button');
	expect(row, `no picker row for ${displayVersion}`).not.toBeNull();
	await fireEvent.click(row as HTMLButtonElement);
}

describe('defect 1 — the prod force-deploy dialog names what it overrides', () => {
	test('picking the held build shows a FactList naming the dependency and the promotion rule, not a bare "a rule is holding it"', async () => {
		renderModal({ rollout: rolloutFixture() });

		await selectRow('2.67.0-67');

		// The consequence sentence still fires (kept, not replaced).
		expect(
			screen.getByText(/This ships to production a build that no rule currently allows/i)
		).toBeInTheDocument();

		// ⭐ THE TWO RULES, NAMED — not "a rule is holding it".
		await waitFor(() => expect(screen.getByText('hello-frontend-needs-api')).toBeInTheDocument());
		expect(screen.getByText(/needs api \^1\.67\.0, hello-api-app serves 1\.66\.0/)).toBeInTheDocument();

		expect(screen.getByText('after staging')).toBeInTheDocument();
		expect(screen.getByText(/staging has not taken this build/)).toBeInTheDocument();
	});

	test('a plain vouched deploy shows no override list at all', async () => {
		// Nothing held: both gates allow everything, so `level` never reaches
		// `typed` and the FactList must not render an empty shell.
		const open = rolloutFixture({
			status: {
				availableReleases: [
					{ tag: 'rel-66', version: '1.66.0-66', created: daysAgo(35) },
					{ tag: 'rel-67', version: '2.67.0-67', created: daysAgo(1) }
				],
				gates: [{ name: 'ghd-open', passing: true, allowedVersions: null }],
				conditions: [{ type: 'GatesPassing', status: 'True' }],
				history: [{ version: { tag: 'rel-66', version: '1.66.0-66' }, bakeStatus: 'Succeeded', timestamp: daysAgo(4) }]
			}
		});
		renderModal({ rollout: open });

		await selectRow('2.67.0-67');

		expect(screen.queryByText('hello-frontend-needs-api')).not.toBeInTheDocument();
		expect(screen.queryByText('after staging')).not.toBeInTheDocument();
	});
});

describe('defect 4 — "held right now" agrees with promotionBlock, not the bare GatesPassing condition', () => {
	test('a deployed build that is also the newest release is not "held right now"', async () => {
		const rollout = rolloutFixture({
			status: {
				// ONE release, already deployed — nothing newer exists, so
				// `GatesPassing` reads False (`NoAllowedVersions`) for a reason
				// that is not a hold on anything: there is nothing to hold.
				availableReleases: [{ tag: 'rel-66', version: '1.66.0-66', created: daysAgo(35) }],
				gates: [
					{ name: 'schedule-gate-fk44d', passing: true, allowedVersions: null },
					{ name: 'ghd-pnb8h', passing: true, allowedVersions: null }
				],
				conditions: [{ type: 'GatesPassing', status: 'False', reason: 'NoAllowedVersions' }],
				history: [{ version: { tag: 'rel-66', version: '1.66.0-66' }, bakeStatus: 'Succeeded', timestamp: daysAgo(4) }]
			}
		});

		// The bug this locks: the RAW predicate `autoDeployState` reads says
		// paused. The dialog must not say so — it has to look past the blunt
		// condition to whether anything is actually held.
		expect(autoDeployState(rollout).paused).toBe(true);

		renderModal({ rollout });
		// The gate note lives in the deploy footer, which only draws once a
		// version is picked — select the only row (the running build itself,
		// same shape as re-opening the dialog on what is already deployed).
		await selectRow('1.66.0-66');

		expect(screen.queryByText(/held right now/i)).not.toBeInTheDocument();
	});

	test('a genuinely held build still says so', async () => {
		// Same shape, but there IS a newer candidate and a gate refuses it —
		// `promotionBlock` agrees this time, so the note must still fire.
		const rollout = rolloutFixture({
			status: {
				availableReleases: [
					{ tag: 'rel-66', version: '1.66.0-66', created: daysAgo(35) },
					{ tag: 'rel-67', version: '2.67.0-67', created: daysAgo(1) }
				],
				gates: [{ name: 'dependency-hello-frontend-needs-api', passing: true, allowedVersions: ['rel-66'] }],
				conditions: [{ type: 'GatesPassing', status: 'False', reason: 'NoAllowedVersions' }],
				history: [{ version: { tag: 'rel-66', version: '1.66.0-66' }, bakeStatus: 'Succeeded', timestamp: daysAgo(4) }]
			}
		});

		renderModal({ rollout });
		// Picking the SAME build the gate table above described — the note
		// rides inside the consequence alert (`gateWhy`) once a candidate is
		// selected, the same sentence fragment either way.
		await selectRow('1.66.0-66');

		expect(screen.getByText(/held right now/i)).toBeInTheDocument();
	});
});

describe('defect 3 — the version picker labels build age vs deploy age, and ranks every row', () => {
	test('the current row shows both clocks; other rows show their relative rank', async () => {
		const rollout = rolloutFixture({
			status: {
				availableReleases: [
					{ tag: 'a', version: '1.0.0', created: daysAgo(40) },
					{ tag: 'b', version: '1.1.0', created: daysAgo(10) },
					{ tag: 'c', version: '1.2.0', created: daysAgo(35) },
					{ tag: 'd', version: '1.3.0', created: daysAgo(2) }
				],
				gates: [{ name: 'ghd-open', passing: true, allowedVersions: null }],
				conditions: [{ type: 'GatesPassing', status: 'True' }],
				history: [{ version: { tag: 'c', version: '1.2.0' }, bakeStatus: 'Succeeded', timestamp: daysAgo(4) }]
			}
		});
		renderModal({ rollout });

		// The CURRENT row (c, 1.2.0): built 35d ago, but DEPLOYED here 4d ago —
		// the exact mismatch the operator walk reported.
		const currentRow = screen.getByText('1.2.0').closest('button') as HTMLButtonElement;
		expect(currentRow.textContent).toMatch(/Built 35/);
		expect(currentRow.textContent).toMatch(/Deployed 4/);

		// a (idx 0) is two releases older than c (idx 2, current).
		const rowA = screen.getByText('1.0.0').closest('button') as HTMLButtonElement;
		expect(rowA.textContent).toMatch(/2 back/);

		// b (idx 1) is one release older than c.
		const rowB = screen.getByText('1.1.0').closest('button') as HTMLButtonElement;
		expect(rowB.textContent).toMatch(/1 back/);

		// d (idx 3) is one release newer than c.
		const rowD = screen.getByText('1.3.0').closest('button') as HTMLButtonElement;
		expect(rowD.textContent).toMatch(/1 newer/);

		// The current row does not also print a rank — the green "Current"
		// badge already says so; a second word for the same fact is noise.
		expect(currentRow.textContent).not.toMatch(/back|newer/);
	});
});

describe('defect 5 — rollback direction copy (locked)', () => {
	/**
	 * ⭐ SUPERSEDED 2026-09-03 (B3, operator walk): A LOCKED PIN IS A
	 * SENTENCE, NOT A DISABLED TOGGLE. `mustPin` is true for EVERY rollback
	 * (`direction === 'rollback'`, dev or production alike) — a rollback in
	 * this product always pins — so this test used to assert a
	 * disabled+checked checkbox, which a live walk found reads as OFF at a
	 * glance regardless of its fill: a muted grey track is this product's
	 * own vocabulary for "not set" everywhere else it appears. A control
	 * with only one possible value is not a control, so `ChangeVersionModal`
	 * now renders the fact as words (`"${target} will be pinned to
	 * ${version}."`) instead of a switch nobody can operate. See
	 * `ChangeVersionModal.svelte`'s own note beside the toggle.
	 */
	test('rolling back shows "Rollback", "Commits to revert", the pin stated as a sentence, and the older-code consequence sentence', async () => {
		const rollout = rolloutFixture({
			metadata: { name: 'hello-world-app', namespace: 'hello-world-prod', labels: { environment: 'prod' } },
			status: {
				availableReleases: [
					{ tag: 'old', version: '0afab6f', created: daysAgo(10) },
					{ tag: 'new', version: '064b655', created: daysAgo(1) }
				],
				gates: [{ name: 'ghd-open', passing: true, allowedVersions: null }],
				conditions: [{ type: 'GatesPassing', status: 'True' }],
				history: [{ version: { tag: 'new', version: '064b655' }, bakeStatus: 'Succeeded', timestamp: daysAgo(1) }]
			}
		});
		renderModal({ rollout, initialSelectedVersion: 'old' });

		// Delta summary: direction word + the two versions, arrow between them.
		expect(screen.getByText(/Rollback/)).toBeInTheDocument();
		// (both shas appear twice: once in the hidden picker list behind the
		// selected version, once in the delta summary — `getAllByText` rather
		// than assuming there is only one.)
		expect(screen.getAllByText('064b655').length).toBeGreaterThan(0);
		expect(screen.getAllByText('0afab6f').length).toBeGreaterThan(0);

		// Changelist heading.
		expect(screen.getByText('Commits to revert')).toBeInTheDocument();

		// Pin build: stated as a fact, not offered as a switch.
		expect(screen.getByText('Pin build')).toBeInTheDocument();
		expect(screen.getByText(/Production will be pinned to 0afab6f\./)).toBeInTheDocument();
		const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
		expect(checkboxes.find((cb) => cb.disabled && cb.checked)).toBeUndefined();

		// The consequence sentence, verbatim.
		expect(
			screen.getByText(/older code will run against data the newer version has already written/)
		).toBeInTheDocument();
	});

	// A rollback out of a NON-production environment pins too (`mustPin`
	// does not read `intent.production`), so it gets the same sentence, not
	// the toggle either — the shape is uniform, only the target word and the
	// tier (`notice` here, `typed` in the test above) differ.
	test('rolling back a non-production rollout states the pin as a sentence too', async () => {
		const rollout = rolloutFixture({
			metadata: { name: 'hello-world-app', namespace: 'hello-world-dev', labels: { environment: 'dev' } },
			status: {
				availableReleases: [
					{ tag: 'old', version: '0afab6f', created: daysAgo(10) },
					{ tag: 'new', version: '064b655', created: daysAgo(1) }
				],
				gates: [{ name: 'ghd-open', passing: true, allowedVersions: null }],
				conditions: [{ type: 'GatesPassing', status: 'True' }],
				history: [{ version: { tag: 'new', version: '064b655' }, bakeStatus: 'Succeeded', timestamp: daysAgo(1) }]
			}
		});
		renderModal({ rollout, initialSelectedVersion: 'old' });

		expect(screen.getByText(/Dev will be pinned to 0afab6f\./)).toBeInTheDocument();
	});
});

describe('defect 6 — the commits block speaks GitHub\'s absence in the shared wording (F10, design pass 2 re-check)', () => {
	// All three scenarios need a `source` (or the dialog never reaches the
	// commits block at all — it shows "No source repository linked" first)
	// and a `revision` on the picked release (or "No commit revision known").
	function sourcedRollout() {
		return rolloutFixture({
			status: {
				source: 'https://github.com/org/repo',
				availableReleases: [
					{ tag: 'rel-66', version: '1.66.0-66', created: daysAgo(35), revision: 'a'.repeat(40) },
					{ tag: 'rel-67', version: '2.67.0-67', created: daysAgo(1), revision: 'b'.repeat(40) }
				],
				gates: [{ name: 'ghd-open', passing: true, allowedVersions: null }],
				conditions: [{ type: 'GatesPassing', status: 'True' }],
				history: [
					{
						version: { tag: 'rel-66', version: '1.66.0-66', revision: 'a'.repeat(40) },
						bakeStatus: 'Succeeded',
						timestamp: daysAgo(4)
					}
				]
			}
		});
	}

	function mockFetch(commitsResponse: () => Response, statusBody: object) {
		fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
			const url = typeof input === 'string' ? input : input.toString();
			if (url.startsWith('/api/rollouts?namespace=')) {
				return new Response(JSON.stringify(NAMESPACE_LIST_RESPONSE), { status: 200 });
			}
			if (url.includes('/auth/github/status')) {
				return new Response(JSON.stringify(statusBody), { status: 200 });
			}
			if (url.includes('/commits')) {
				return commitsResponse();
			}
			return new Response(JSON.stringify({}), { status: 200 });
		});
	}

	test('GitHub not configured at all — the shared sentence, no button', async () => {
		mockFetch(
			() => new Response(JSON.stringify({ error: 'github_not_connected' }), { status: 401 }),
			{ configured: false, connected: false }
		);
		renderModal({ rollout: sourcedRollout() });
		await selectRow('2.67.0-67');

		await waitFor(() =>
			expect(screen.getByText('GitHub is not configured for this dashboard.')).toBeInTheDocument()
		);
		expect(screen.queryByRole('button', { name: /Connect GitHub/i })).not.toBeInTheDocument();
	});

	test('configured but not connected — the shared sentence prefixes the CTA, and the button appears', async () => {
		mockFetch(
			() => new Response(JSON.stringify({ error: 'github_not_connected' }), { status: 401 }),
			{ configured: true, connected: false }
		);
		renderModal({ rollout: sourcedRollout() });
		await selectRow('2.67.0-67');

		await waitFor(() =>
			expect(
				screen.getByText(/GitHub is not connected for this dashboard\./)
			).toBeInTheDocument()
		);
		expect(
			screen.getByText(/Connect your GitHub account to see which commits will deploy/)
		).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Connect GitHub/i })).toBeInTheDocument();
	});

	test('GitHub unreachable — "did not answer", the error detail, then the dialog-only "still proceed" suffix', async () => {
		mockFetch(
			() => new Response(JSON.stringify({ error: 'boom' }), { status: 500 }),
			{ configured: true, connected: true }
		);
		renderModal({ rollout: sourcedRollout() });
		await selectRow('2.67.0-67');

		await waitFor(() => expect(screen.getByText(/GitHub did not answer\./)).toBeInTheDocument());
		expect(screen.getByText(/boom/)).toBeInTheDocument();
		expect(screen.getByText(/You can still proceed\./)).toBeInTheDocument();
	});
});

/**
 * ⭐ THE BLOCKING CLIP REGRESSION (F6, fifth re-check), STRUCTURALLY, NOT BY
 * PIXELS. jsdom computes no real layout — `scrollHeight`/`clientHeight` are
 * both always 0 — so the actual bug (a JS-measured `max-height` on the right
 * pane that excluded the footer's own height, painting over the confirm
 * button under `overflow: hidden`) cannot be reproduced by measurement here.
 * What CAN be asserted without real layout is the structural invariant the
 * fix depends on: the footer holding Cancel/confirm is a SIBLING of the one
 * `overflow-y-auto` scroller in the right pane (the delta summary +
 * changelist), never nested inside it. A future pass that moves the footer
 * back inside the scroller, or reintroduces a content-only height measurement
 * that ignores the footer, would reproduce the clip; this fails immediately
 * if the footer stops being the scroller's sibling.
 */
describe('F6, fifth re-check — the confirm button structurally cannot be clipped', () => {
	function devRollbackRollout() {
		return rolloutFixture({
			metadata: { name: 'hello-world-app', namespace: 'hello-world-dev', labels: { environment: 'dev' } },
			status: {
				availableReleases: [
					{ tag: 'old', version: '0afab6f', created: daysAgo(10) },
					{ tag: 'new', version: '064b655', created: daysAgo(1) }
				],
				gates: [{ name: 'ghd-open', passing: true, allowedVersions: null }],
				conditions: [{ type: 'GatesPassing', status: 'True' }],
				history: [{ version: { tag: 'new', version: '064b655' }, bakeStatus: 'Succeeded', timestamp: daysAgo(1) }]
			}
		});
	}

	// The scroller under test is `rightContentEl` specifically -- flowbite's
	// own Modal body wrapper ALSO carries `overflow-y-auto` (its default
	// chrome, present on every modal in the product, harmless because it is
	// never height-capped below its content) and the left picker list does
	// too (`cvm-scroll-fade flex-1 overflow-y-auto pb-4`). Only `rightContentEl`
	// carries BOTH `overflow-y-auto` AND `min-h-0` together (see
	// `ChangeVersionModal.svelte`'s markup), which is what makes this
	// selector point at the one scroller the fix is actually about.
	const CHANGELIST_SCROLLER_SELECTOR = '.overflow-y-auto.min-h-0';

	test('the confirm button is never a descendant of the scrollable changelist region', async () => {
		renderModal({ rollout: devRollbackRollout(), initialSelectedVersion: 'old' });
		const confirmBtn = await screen.findByRole('button', { name: /Roll back dev/i });
		expect(confirmBtn.closest(CHANGELIST_SCROLLER_SELECTOR)).toBeNull();
	});

	test('Cancel is also never a descendant of the scrollable changelist region', async () => {
		renderModal({ rollout: devRollbackRollout(), initialSelectedVersion: 'old' });
		await screen.findByRole('button', { name: /Roll back dev/i });
		const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
		expect(cancelBtn.closest(CHANGELIST_SCROLLER_SELECTOR)).toBeNull();
	});
});

/**
 * ⭐ FOUR MORE DEFECTS FROM THE SAME OPERATOR WALK (2026-09-03), ALL ON THIS
 * DIALOG: B3 (no feedback for 5-8s after confirming), P6 (a rollback confirm
 * read as the identical blue as an ordinary forward deploy, and the picker
 * had no resting affordance), P5 (the note field said "(optional)" on a
 * production change or a rollback), and a cosmetic duplicate close control.
 */

/** Every version change is confirmed by typing it (2026-09-03). The label
 *  prints the version in its own span; type exactly that. */
async function typeConfirmVersion() {
	const label = document.querySelector('label[for="cvm-confirm-version"]');
	const v = label?.querySelector('span')?.textContent?.trim() ?? '';
	expect(v).not.toBe('');
	await fireEvent.input(document.getElementById('cvm-confirm-version') as HTMLInputElement, {
		target: { value: v }
	});
}

describe('operator walk, 2026-09-03 — B3/P5/P6/cosmetic', () => {
	function devRollbackRollout() {
		return rolloutFixture({
			metadata: { name: 'hello-world-app', namespace: 'hello-world-dev', labels: { environment: 'dev' } },
			status: {
				availableReleases: [
					{ tag: 'old', version: '0afab6f', created: daysAgo(10) },
					{ tag: 'new', version: '064b655', created: daysAgo(1) }
				],
				gates: [{ name: 'ghd-open', passing: true, allowedVersions: null }],
				conditions: [{ type: 'GatesPassing', status: 'True' }],
				history: [{ version: { tag: 'new', version: '064b655' }, bakeStatus: 'Succeeded', timestamp: daysAgo(1) }]
			}
		});
	}

	const NOTE_PLACEHOLDER = 'Why are you rolling back? (optional)';

	test('2026-09-05 — a non-production rollback needs the typed build only; the note is optional', async () => {
		renderModal({ rollout: devRollbackRollout(), initialSelectedVersion: 'old' });
		const confirmBtn = await screen.findByRole('button', { name: /Roll back dev/i });
		expect(confirmBtn).toBeDisabled();
		expect(screen.getByPlaceholderText(NOTE_PLACEHOLDER)).toBeInTheDocument();
		// While disabled, the reason is printed under the button.
		expect(screen.getByText(/Type .* above to confirm\./)).toBeInTheDocument();
		await typeConfirmVersion();
		expect(confirmBtn).not.toBeDisabled();
		expect(screen.queryByText(/above to confirm\./)).toBeNull();
	});

	test('P5 kept for production — the note is required and the blocker names it once the build is typed', async () => {
		renderModal({ rollout: rolloutFixture(), initialSelectedVersion: 'rel-67' });
		const confirmBtn = await screen.findByRole('button', { name: /Deploy to production/i });
		await typeConfirmVersion();
		expect(confirmBtn).toBeDisabled();
		expect(screen.getByText(/Add a note — required for a production change\./)).toBeInTheDocument();
		const note = screen.getByPlaceholderText('Why are you overriding the rules? (required)');
		await fireEvent.input(note, { target: { value: 'hotfix for the outage' } });
		expect(confirmBtn).not.toBeDisabled();
		expect(screen.queryByText(/Add a note/)).toBeNull();
	});

	test('P5 — a typed-confirm forward deploy asks "why are you overriding the rules", not "(optional)"', async () => {
		// The prod fixture from defect 1: forward, held by rules -> `typed`.
		renderModal({ rollout: rolloutFixture(), initialSelectedVersion: 'rel-67' });
		await screen.findByRole('button', { name: /Deploy to production/i });
		expect(
			screen.getByPlaceholderText('Why are you overriding the rules? (required)')
		).toBeInTheDocument();
	});

	test('P6 — a non-production rollback confirm is outlined red, not the forward-deploy blue', async () => {
		renderModal({ rollout: devRollbackRollout(), initialSelectedVersion: 'old' });
		const confirmBtn = await screen.findByRole('button', { name: /Roll back dev/i });
		expect(confirmBtn.className).toMatch(/border-red-700/);
		expect(confirmBtn.className).toMatch(/bg-transparent/);
		expect(confirmBtn.className).not.toMatch(/bg-blue-700/);
	});

	test('P6 — an ordinary forward deploy confirm stays filled blue', async () => {
		const rollout = rolloutFixture({
			metadata: { name: 'hello-world-app', namespace: 'hello-world-dev', labels: { environment: 'dev' } },
			status: {
				availableReleases: [
					{ tag: 'old', version: '0afab6f', created: daysAgo(10) },
					{ tag: 'new', version: '064b655', created: daysAgo(1) }
				],
				gates: [{ name: 'ghd-open', passing: true, allowedVersions: null }],
				conditions: [{ type: 'GatesPassing', status: 'True' }],
				history: [{ version: { tag: 'old', version: '0afab6f' }, bakeStatus: 'Succeeded', timestamp: daysAgo(4) }]
			}
		});
		renderModal({ rollout, initialSelectedVersion: 'new' });
		const confirmBtn = await screen.findByRole('button', { name: /Deploy to dev/i });
		expect(confirmBtn.className).toMatch(/bg-blue-700/);
	});

	test('P6 — a picker row marks its "N back" distance in warm ink and carries a resting chevron', async () => {
		renderModal({ rollout: devRollbackRollout() });
		const row = screen.getByText('0afab6f').closest('button');
		expect(row).not.toBeNull();
		const rankSpan = Array.from(row!.querySelectorAll('span')).find((s) =>
			/back/.test(s.textContent || '')
		);
		expect(rankSpan, 'no "N back" span on the older row').not.toBeUndefined();
		expect(rankSpan?.className).toMatch(/text-amber-700/);
		// The resting chevron -- present at rest, not only on `:hover` (hover
		// does not exist on touch).
		expect(row!.querySelector('svg')).not.toBeNull();
	});

	test('B3 — confirming shows a pending state until the request resolves, and cannot double-submit', async () => {
		let resolveDeploy: (r: Response) => void = () => {};
		fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
			const url = typeof input === 'string' ? input : input.toString();
			if (url.startsWith('/api/rollouts?namespace=')) {
				return new Response(JSON.stringify(NAMESPACE_LIST_RESPONSE), { status: 200 });
			}
			if (url.includes('/change-version')) {
				return new Promise<Response>((resolve) => {
					resolveDeploy = resolve;
				});
			}
			return new Response(JSON.stringify({}), { status: 200 });
		});

		let startedCount = 0;
		// ⛔ SUCCESS IS ASSERTED VIA `onSuccess`, NOT VIA THE DIALOG UNMOUNTING.
		// jsdom has no real animation-frame pump, and flowbite's `Dialog`
		// gates its actual DOM removal on the `fade` OUTRO transition
		// finishing -- which never settles here (the test file's own
		// polyfills at the top only stub `Element.animate`/`HTMLDialogElement`,
		// not `requestAnimationFrame`), so `open = false` can be TRUE in
		// state while the old markup is still painted. `onSuccess` fires
		// synchronously, before `open = false`, inside `handleDeploy`'s own
		// success branch -- the one signal that does not depend on a
		// transition jsdom cannot run.
		let successMessage: string | null = null;
		renderModal({
			rollout: devRollbackRollout(),
			initialSelectedVersion: 'old',
			onDeployStart: () => startedCount++,
			onSuccess: (message: string) => {
				successMessage = message;
			}
		});
		const confirmBtn = await screen.findByRole('button', { name: /Roll back dev/i });
		await fireEvent.input(screen.getByPlaceholderText(NOTE_PLACEHOLDER), {
			target: { value: 'testing pending state' }
		});
		await typeConfirmVersion();
		expect(confirmBtn).not.toBeDisabled();

		await fireEvent.click(confirmBtn);

		// `onDeployStart` fires before the response lands, so a caller (rollout
		// detail's Overview) can show its own banner immediately.
		expect(startedCount).toBe(1);
		await waitFor(() => expect(screen.getByText('Rolling back…')).toBeInTheDocument());
		expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
		expect(document.querySelector('.animate-spin')).not.toBeNull();

		// A second click while pending must not fire a second request -- both
		// the `disabled` attribute and `handleDeploy`'s own `deploying` guard
		// cover this.
		await fireEvent.click(confirmBtn);
		expect(
			fetchMock.mock.calls.filter((c) => String(c[0]).includes('/change-version')).length
		).toBe(1);

		resolveDeploy(new Response(JSON.stringify({}), { status: 200 }));
		await waitFor(() => expect(successMessage).not.toBeNull());
	});

	test('cosmetic — exactly one explicit close affordance (Cancel), no second unlabelled ✕', async () => {
		const { container } = renderModal({ rollout: devRollbackRollout(), initialSelectedVersion: 'old' });
		await screen.findByRole('button', { name: /Roll back dev/i });
		expect(container.querySelectorAll('button[aria-label="Close"]').length).toBe(0);
		expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
	});
});
