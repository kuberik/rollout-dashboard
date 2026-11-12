import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/svelte';
import ChangeVersionModal from './ChangeVersionModal.svelte';
import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import { autoDeployState } from '$lib/view-models/auto-deploy';
import type { Rollout } from '../../types';
import { respond } from '$lib/demo/respond';
import { resetDemoState } from '$lib/demo/state';

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

/**
 * ⭐ (2026-10-09, integration round 4, item follow-up) THE DIALOG'S OWN
 * `/api/rollouts` READ — THE SELF-DERIVATION PATH. `ChangeVersionModal` now
 * builds its own dependency graph off this exact endpoint whenever a caller
 * does not pass `contractHeldVersions` (see that prop's doc comment). Empty
 * by default so every existing test in this file — none of which are about
 * this feature — gets an empty graph and therefore no self-derived holds;
 * the "self-derivation" describe block below overwrites it per test.
 */
let rolloutsListResponse: unknown = {
	rollouts: { items: [] },
	environments: { items: [] },
	rolloutDependencies: { items: [] }
};

const NAMESPACE_LIST_RESPONSE = {
	environments: {
		items: [
			{
				metadata: { name: 'hello-frontend-app', namespace: 'hello-dep-staging' },
				spec: { environment: 'staging' },
				status: {}
			},
			{
				metadata: { name: 'hello-frontend-app', namespace: 'hello-dep-prod' },
				spec: { environment: 'prod' },
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
	rolloutsListResponse = {
		rollouts: { items: [] },
		environments: { items: [] },
		rolloutDependencies: { items: [] }
	};
	fetchMock = vi.fn(async (input: RequestInfo | URL) => {
		const url = typeof input === 'string' ? input : input.toString();
		if (url === '/api/rollouts') {
			return new Response(JSON.stringify(rolloutsListResponse), { status: 200 });
		}
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
			screen.getByText(/This deploys to prod a build that .*still holding back/i)
		).toBeInTheDocument();

		// ⭐ THE TWO RULES, NAMED — not "a rule is holding it".
		await waitFor(() => expect(screen.getByText('hello-frontend-needs-api')).toBeInTheDocument());
		expect(screen.getByText(/needs api \^1\.67\.0, hello-api-app serves 1\.66\.0/)).toBeInTheDocument();

		expect(screen.getByText('after staging')).toBeInTheDocument();
		expect(screen.getByText(/Waiting for staging to deploy it first/)).toBeInTheDocument();
	});

	test('QA #17 — the dialog names a gate by its published pretty name, the same one the Gates tab prints', async () => {
		const rollout = rolloutFixture({
			status: {
				availableReleases: [
					{ tag: 'rel-66', version: '1.66.0-66', created: daysAgo(35) },
					{ tag: 'rel-67', version: '2.67.0-67', created: daysAgo(1) }
				],
				gates: [{ name: 'hello-manual-approval', passing: true, allowedVersions: [] }],
				conditions: [{ type: 'GatesPassing', status: 'False', reason: 'NoAllowedVersions' }],
				history: [{ version: { tag: 'rel-66', version: '1.66.0-66' }, bakeStatus: 'Succeeded', timestamp: daysAgo(4) }]
			}
		});
		const base = fetchMock.getMockImplementation()!;
		fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
			const url = typeof input === 'string' ? input : input.toString();
			if (url.startsWith('/api/rollouts/hello-dep-prod/hello-frontend-app')) {
				return new Response(
					JSON.stringify({ rollout, rolloutGates: { items: [{ metadata: { name: 'hello-manual-approval', annotations: { 'gate.kuberik.com/pretty-name': 'Manual Approval Required' } } }] } }),
					{ status: 200 }
				);
			}
			return base(input);
		});
		renderModal({ rollout });
		await selectRow('2.67.0-67');
		await waitFor(() => expect(screen.getAllByText(/Manual Approval Required/).length).toBeGreaterThan(0));
		expect(screen.queryByText(/Hello manual approval/)).not.toBeInTheDocument();
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

describe('U-5, 2026-10-09, integration round 3, item 3 — a contract-only hold shows HELD too', () => {
	/**
	 * Measured live on `checkout-api`/`prod-us-east-2`: Overview's "Newer
	 * builds" ledger and the Gates tab both mark `4.43.0-43` HELD — the
	 * payments-svc contract, not any entry in `status.gates` — while this
	 * picker read it plain `Ready`. `isDeployable` (this component's only
	 * input before this fix) reads `rollout.status.gates` alone, and a
	 * `RolloutDependency` contract hold is not always published there (the
	 * live fixture's own `status.gates` is empty here on purpose — same
	 * shape as the real one). `contractHeldVersions` is the prop the caller
	 * (rollout detail) now resolves from the SAME dependency graph the
	 * Overview ledger and the Gates tab already read, and it is what this
	 * test is pinning: the row must read HELD with the prop, and — so this
	 * test can actually fail — must NOT read HELD without it, proving the
	 * assertion exercises the new code path rather than some other one.
	 */
	const heldFixture = () =>
		rolloutFixture({
			status: {
				availableReleases: [
					{ tag: 'rel-66', version: '1.66.0-66', created: daysAgo(35) },
					{ tag: 'rel-67', version: '2.67.0-67', created: daysAgo(1) }
				],
				// Nothing in `status.gates` refuses anything — `isDeployable`
				// alone would call `2.67.0-67` plain `Ready`.
				gates: [],
				conditions: [],
				history: [
					{ version: { tag: 'rel-66', version: '1.66.0-66' }, bakeStatus: 'Succeeded', timestamp: daysAgo(4) }
				]
			}
		});

	test('without `contractHeldVersions`, a gate-clear-but-contract-held candidate reads plain Ready (the defect, pinned)', async () => {
		renderModal({ rollout: heldFixture() });
		await waitFor(() => expect(screen.getByText('2.67.0-67')).toBeInTheDocument());
		expect(screen.queryByText('held')).not.toBeInTheDocument();
	});

	test('with `contractHeldVersions`, the same candidate reads HELD — agreeing with Overview and the Gates tab', async () => {
		renderModal({ rollout: heldFixture(), contractHeldVersions: new Set(['2.67.0-67']) });
		await waitFor(() => expect(screen.getByText('2.67.0-67')).toBeInTheDocument());
		expect(screen.getByText('held')).toBeInTheDocument();
	});

	test('the current row is never marked held by a contract set that happens to name its own display version', async () => {
		// `isHeld` also requires `!isCurrent` — a contract hold can only ever
		// apply to a candidate ahead of the rollout, never to what it is
		// already running. Guards against a careless `||` that drops the
		// `!isCurrent` guard.
		renderModal({ rollout: heldFixture(), contractHeldVersions: new Set(['1.66.0-66', '2.67.0-67']) });
		await waitFor(() => expect(screen.getByText('2.67.0-67')).toBeInTheDocument());
		const currentRow = screen.getByText('1.66.0-66').closest('button');
		expect(currentRow).not.toBeNull();
		expect(within(currentRow as HTMLButtonElement).queryByText('held')).not.toBeInTheDocument();
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

		// ⛔ SUPERSEDED, 2026-10-09 (squad-rollout, Lane D, round 2 — "Built
		// 12 minutes ago becomes the right-hand age (12m)"). The row used to
		// print BOTH clocks as full sentences ("Built 35 days ago · Deployed
		// 4 days ago") on a second line; that line is gone — a one-line,
		// 44px row has room for one compact age, and for the CURRENTLY
		// RUNNING build the more relevant clock is when it was DEPLOYED here
		// (`formatTimeAgoCompact`, the same compact form the rest of the
		// product uses), not when the image was built. The full relative
		// sentence survives as the span's own `title` for a reader who wants
		// it (`pickerLine`, unchanged).
		// ⭐ round 8 (AD r7 item 2): one meaning per column. The right-hand
		// age is BUILD age on every row (35d for 1.2.0); the running row's
		// label carries the deploy time ("deployed 4d ago").
		const currentRow = screen.getByText('1.2.0').closest('button') as HTMLButtonElement;
		// round 9 (AD r8, P2): the running row shows ONE age, its deploy
		// time, so its title keeps the width at 390.
		expect(currentRow.textContent).toMatch(/deployed 4d ago/);
		expect(currentRow.textContent).not.toMatch(/35d/);
		expect(currentRow.querySelector('[title*="Deployed"]')?.getAttribute('title')).toMatch(
			/Deployed 4/
		);

		// ⛔ SUPERSEDED, 2026-10-10 (squad-rollout, Lane D, round 4 — AD
		// round 2, item 2: "Drop 'N newer' from every picker row (the group
		// header says it)."). The per-row rank text is gone — the group
		// headers ("Newer than running" / "Running" / "Older") already say
		// which direction a row sits in; this test now asserts its absence
		// instead of its presence, and checks the age survives (the one
		// per-row fact the group header cannot say, since it differs row
		// to row).
		const rowA = screen.getByText('1.0.0').closest('button') as HTMLButtonElement;
		expect(rowA.textContent).not.toMatch(/back|newer/);
		expect(rowA.textContent).toMatch(/40d/);

		const rowD = screen.getByText('1.3.0').closest('button') as HTMLButtonElement;
		expect(rowD.textContent).not.toMatch(/back|newer/);

		// The current row does not print a rank either — the "current" word
		// already says so; a second word for the same fact is noise.
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
	test('rolling back shows "Roll back", "Commits to revert", the pin stated as a sentence, and the older-code consequence sentence', async () => {
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
		// (The dialog's own title now ALSO says "Roll back ..." — see
		// `dialogTitle` — so this is an `getAllByText`, not a uniqueness
		// assertion.)
		expect(screen.getAllByText(/Roll back/).length).toBeGreaterThan(0);
		// (both shas appear twice: once in the hidden picker list behind the
		// selected version, once in the delta summary — `getAllByText` rather
		// than assuming there is only one.)
		expect(screen.getAllByText('064b655').length).toBeGreaterThan(0);
		expect(screen.getAllByText('0afab6f').length).toBeGreaterThan(0);

		// ⛔ SUPERSEDED, 2026-10-09 (squad-rollout, Lane D, round 2, §4 item
		// 9 — "the section header appears only when there are commits").
		// This fixture sets no `status.source`, so there was never a commit
		// list to head in the first place — the header is correctly absent
		// now and the quiet one-line reason takes its place.
		expect(
			screen.getByText('No source repository linked — the commit list is unavailable.')
		).toBeInTheDocument();
		expect(screen.queryByText('Commits to revert')).not.toBeInTheDocument();

		// ⛔ SUPERSEDED, 2026-10-10 (squad-rollout, Lane D, round 4 — AD
		// round 2, item 2: "On a rollback the pin is stated 4×. … the Pin
		// row appears ONLY when pinning is a choice (a toggle); otherwise
		// the one callout sentence carries it."). `mustPin` is true for
		// every rollback, so the whole "Pin build" row (caption + its own
		// "will be pinned to" sentence) no longer renders — the pin fact
		// lives in exactly one place now: the consequence sentence's own
		// `pinNote` clause, asserted below.
		expect(screen.queryByText('Pin build')).not.toBeInTheDocument();
		expect(screen.queryByText(/will be pinned to/)).not.toBeInTheDocument();
		const checkboxes = screen.queryAllByRole('checkbox') as HTMLInputElement[];
		expect(checkboxes.find((cb) => cb.disabled && cb.checked)).toBeUndefined();

		// The consequence sentence, verbatim — including the pin clause,
		// the ONE place it is still said.
		expect(
			screen.getByText(/older code will run against data the newer version has already written/)
		).toBeInTheDocument();
		expect(
			screen.getByText(/It also pins prod to this version/)
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

		// ⛔ SUPERSEDED, 2026-10-10 (squad-rollout, Lane D, round 4 — AD
		// round 2, item 2, same as the test above): no separate "Pin
		// build" row/sentence on a non-production rollback either — the
		// callout's own pin clause is the one place it is said.
		expect(screen.queryByText('Pin build')).not.toBeInTheDocument();
		expect(screen.queryByText(/will be pinned to/)).not.toBeInTheDocument();
		expect(screen.getByText(/It also pins dev to this version/)).toBeInTheDocument();
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

	test('QA #22 — with GitHub not connected the build tile says why there is no commit message, the Pin toggle has a name, and the hint is not the Apple glyph', async () => {
		mockFetch(
			() => new Response(JSON.stringify({ error: 'github_not_connected' }), { status: 401 }),
			{ configured: true, connected: false }
		);
		renderModal({ rollout: sourcedRollout() });
		await selectRow('2.67.0-67');
		await waitFor(() => expect(screen.getAllByText('Commit message unavailable').length).toBeGreaterThan(0));
		expect(screen.queryByText('No commit message')).not.toBeInTheDocument();
		expect(screen.getByRole('checkbox', { name: 'Pin build' })).toBeInTheDocument();
		expect(screen.queryByText('⌘↵')).not.toBeInTheDocument();
	});

	test('GitHub unreachable — "did not answer" as one quiet line, then the error detail (round 3: the "still proceed" suffix dropped, AD item 9)', async () => {
		mockFetch(
			() => new Response(JSON.stringify({ error: 'boom' }), { status: 500 }),
			{ configured: true, connected: true }
		);
		renderModal({ rollout: sourcedRollout() });
		await selectRow('2.67.0-67');

		const line = await screen.findByText(/GitHub did not answer\./);
		await waitFor(() => expect(line).toBeInTheDocument());
		expect(line.className).toMatch(/t-meta/);
		expect(screen.getByText(/boom/)).toBeInTheDocument();
		// ⛔ SUPERSEDED, 2026-10-09 (squad-rollout, Lane D, round 3 — AD item
		// 9: "'GitHub did not answer. You can still proceed.' is 14px
		// t-body: make it one quiet t-meta line, drop 'You can still
		// proceed'."). The deploy footer already proceeds regardless; the
		// tail clause restated a given.
		expect(screen.queryByText(/You can still proceed/)).not.toBeInTheDocument();
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
		const confirmBtn = await screen.findByRole('button', { name: /^Roll back$/i });
		expect(confirmBtn.closest(CHANGELIST_SCROLLER_SELECTOR)).toBeNull();
	});

	test('Cancel is also never a descendant of the scrollable changelist region', async () => {
		renderModal({ rollout: devRollbackRollout(), initialSelectedVersion: 'old' });
		await screen.findByRole('button', { name: /^Roll back$/i });
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
	// ⛔ SUPERSEDED, 2026-10-09 (squad-rollout, Lane D, round 2, §4 item 8):
	// the sha moved from a `<span class="text-danger">` to an inline
	// `<code>` token — `t-code-sm` on `bg-subtle`, the same idiom the
	// "Same commit as the running build" sentence already uses elsewhere
	// in this component. The selector follows the markup, not the other
	// way around.
	const v = label?.querySelector('code')?.textContent?.trim() ?? '';
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

	// ⭐ round 6 (squad-rollout, Lane D, AD round 4 item 11): the placeholder
	// asks the question only; "optional" moved to the field's one helper line
	// (asserted below), said once.
	const NOTE_PLACEHOLDER = 'Why are you rolling back?';

	test('U-23, ledger, 2026-10-08 (supersedes 2026-09-05) — a non-production rollback needs no typed build, note optional, confirm live immediately', async () => {
		// `deploy-risk.ts`'s `confirmLevel` has always graded a non-production
		// rollback `notice`, not `typed` — only `ChangeVersionModal`'s own
		// `needsTypedConfirmation` used to override that and demand the sha
		// anyway ("every version change is confirmed by typing it"). That
		// override is gone: the typed box now appears exactly when
		// `confirmLevel` says `typed`, matching the fast-recovery argument
		// `deploy-risk.ts`'s own doc comment has made all along.
		renderModal({ rollout: devRollbackRollout(), initialSelectedVersion: 'old' });
		const confirmBtn = await screen.findByRole('button', { name: /^Roll back$/i });
		expect(confirmBtn).not.toBeDisabled();
		expect(screen.getByPlaceholderText(NOTE_PLACEHOLDER)).toBeInTheDocument();
		expect(screen.getByText('Optional. Recorded with the rollback.')).toBeInTheDocument();
		expect(screen.queryByText(/above to confirm\./)).toBeNull();
		expect(screen.queryByLabelText(/to confirm$/)).toBeNull();
	});

	test('P5 kept for production — the note is required and the blocker names it once the build is typed', async () => {
		renderModal({ rollout: rolloutFixture(), initialSelectedVersion: 'rel-67' });
		const confirmBtn = await screen.findByRole('button', { name: /Deploy to prod/i });
		await typeConfirmVersion();
		expect(confirmBtn).toBeDisabled();
		expect(screen.getByText(/Add a note — required for a prod change\./)).toBeInTheDocument();
		// ⛔ SUPERSEDED, 2026-10-09 (squad-rollout, Lane D, round 3 — AD item
		// 4: "Note '(required)' in placeholder AND helper line."). The
		// placeholder no longer carries the "(required)" suffix when it IS
		// required — the dedicated helper `<p>` (asserted just above) says
		// so once, not twice.
		// ⛔ SUPERSEDED, round 5 (squad-rollout, Lane D, 2026-10-10, AD round
		// 3 item 2: "Name the rule ONCE, in the callout; today it appears
		// 3×."). Round 4 put the gate's own name in this placeholder too;
		// round 5 moved the ONE naming back to the callout's own `FactList`
		// (measured live naming `promotion-prod-us-east-2` three times on
		// one screen) and this placeholder reverted to the generic
		// question it asked before round 4.
		const note = screen.getByPlaceholderText('Why are you overriding the rules?');
		await fireEvent.input(note, { target: { value: 'hotfix for the outage' } });
		expect(confirmBtn).not.toBeDisabled();
		expect(screen.queryByText(/Add a note/)).toBeNull();
	});

	test('P5 — SUPERSEDED, round 5 (squad-rollout, Lane D, 2026-10-10, AD round 3 item 2): a typed-confirm forward deploy asks the generic "why are you overriding the rules" — the gate ITSELF is named once, in the callout\'s own FactList, not repeated in the placeholder', async () => {
		// The prod fixture from defect 1: forward, held by rules -> `typed`.
		// Round 4 put the gate's own name here; round 5 reverted it (see
		// this test's own doc comment on the sibling test, above) — the
		// gate name still renders, just in the callout's `FactList` row,
		// asserted by the "overriddenGates/FactList" coverage elsewhere.
		renderModal({ rollout: rolloutFixture(), initialSelectedVersion: 'rel-67' });
		await screen.findByRole('button', { name: /Deploy to prod/i });
		expect(screen.getByPlaceholderText('Why are you overriding the rules?')).toBeInTheDocument();
	});

	test('P6 — SUPERSEDED, round 2 (squad-rollout, Lane D, 2026-10-09): a non-production rollback confirm is filled blue too, not an outline that reads as an error', async () => {
		renderModal({ rollout: devRollbackRollout(), initialSelectedVersion: 'old' });
		const confirmBtn = await screen.findByRole('button', { name: /^Roll back$/i });
		// ⛔ SUPERSEDED, 2026-10-09 (squad-rollout, Lane D, round 2 — "The
		// confirm button must be the PRIMARY (filled blue, btn-primary) for
		// both deploy and rollback. A red outline with red text reads as an
		// error.") This test used to require `.btn-danger` here; round 2
		// reverses that call on purpose (`confirmBtnClass`'s own doc comment
		// in the component explains why) — the direction still reads from
		// the header, the icon and the callout's own ink, never from a
		// second "which direction" colour on the one button whose job is
		// "press this to proceed."
		expect(confirmBtn.className).toMatch(/\bbtn-primary\b/);
		expect(confirmBtn.className).not.toMatch(/\bbtn-danger\b/);
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
		// Migrated to `.btn-primary` (2026-10-08) — the design language's one
		// filled action.
		expect(confirmBtn.className).toMatch(/\bbtn-primary\b/);
	});

	test('P6 — SUPERSEDED, round 4 (squad-rollout, Lane D, 2026-10-10, AD round 2 item 2): an older row carries no per-row rank text at all — its group header ("Older") already says the direction, and no chevron — bg-selected is the one "where it lands" mark', async () => {
		renderModal({ rollout: devRollbackRollout() });
		const row = screen.getByText('0afab6f').closest('button');
		expect(row).not.toBeNull();
		// ⛔ SUPERSEDED, round 4 — AD round 2, item 2: "Drop 'N newer' from
		// every picker row (the group header says it)." This test used to
		// require an "N back" span on every older row; the per-row rank is
		// gone now, full stop (both directions), since the group header one
		// level up already names it once for the whole group.
		const rankSpan = Array.from(row!.querySelectorAll('span')).find((s) =>
			/back|newer/.test(s.textContent || '')
		);
		expect(rankSpan, 'no per-row rank text — the group header already says it').toBeUndefined();
		// ⛔ SUPERSEDED A THIRD TIME, 2026-10-09 (squad-rollout, Lane D, round
		// 2 — "Drop the per-row chevron; selection is bg-selected."). The
		// resting chevron this test used to require is gone on purpose: an
		// ordinary older row (no state glyph either) renders no trailing
		// icon at all now — the one "where ↵ lands" mark is `bg-selected`
		// on the active/hovered row.
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
		const confirmBtn = await screen.findByRole('button', { name: /^Roll back$/i });
		await fireEvent.input(screen.getByPlaceholderText(NOTE_PLACEHOLDER), {
			target: { value: 'testing pending state' }
		});
		// U-23, ledger: a non-production rollback is `notice`, not `typed` —
		// no sha to transcribe before this button lives (see the first test
		// in this `describe`).
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

	// ⭐ SUPERSEDED, round 3 (coordinator, whole-product consistency review).
	// This dialog used to suppress flowbite's own corner close icon
	// (`dismissable={false}`) because its header carried a second, hand-rolled
	// "Cancel" text button found nowhere else in the dialog's footer (there
	// wasn't one, at this step). "No second unlabelled ✕" was the right call
	// for THAT shape — the shape itself was the defect. Every other dialog in
	// the lane (Recovery, Retry×2, Clear pin) already pairs flowbite's own
	// close icon with an explicit footer `Cancel`, and this dialog now shares
	// that one shell: a title-only header (no "Cancel" button there any more)
	// plus the SAME close icon, and a footer `Cancel` that is always present,
	// not a per-step special case. Two controls, two different jobs — the
	// icon dismisses from anywhere, the labelled button is reachable without
	// hunting for a small corner target — matching the other four dialogs
	// rather than disagreeing with them.
	test('one dialog shell: flowbite\'s own close icon plus a footer Cancel, same as every other dialog in the lane', async () => {
		const { container } = renderModal({ rollout: devRollbackRollout(), initialSelectedVersion: 'old' });
		await screen.findByRole('button', { name: /^Roll back$/i });
		expect(container.querySelectorAll('button[aria-label="Close"]').length).toBe(1);
		expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
	});
});

/**
 * ⭐ (2026-10-09, integration round 4, item follow-up) THE SELF-DERIVATION
 * PATH, EXERCISED FROM A NON-DETAIL MOUNT. `change-version-held-agreement
 * .test.ts` proves `contractHeldVersionsFor` and the dialog's own `isHeld`
 * formula agree on paper; this proves the MOUNTED component reaches the
 * same answer when it is opened the way history, `/envs/<name>`,
 * `/apps/<name>` and `FailurePanel` actually open it — no
 * `contractHeldVersions` prop, no rollout-detail-only `providerNetwork`
 * wiring, just `rollout` and `cluster` (every one of those four call sites
 * passes both). The fixture is the live hub's own `checkout-api`/
 * `prod-us-east-2` (calm scenario) — the coordinator's original repro.
 */
describe('self-derivation — a non-detail mount agrees with Overview/Gates with no contractHeldVersions prop', () => {
	resetDemoState('calm');
	const list = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}');
	const checkoutApiRollout = (
		list.rollouts.items as Array<{ metadata?: { name?: string; namespace?: string } }>
	).find(
		(r) => r.metadata?.name === 'checkout-api' && r.metadata?.namespace === 'checkout-api-prod-us-east-2'
	) as Rollout | undefined;
	if (!checkoutApiRollout) {
		throw new Error('checkout-api/prod-us-east-2 not found in the calm fixture');
	}

	test('4.43.0-43 (contract-only), 4.44.0-44 and 4.45.0-45 (also gate-blocked) all read HELD', async () => {
		rolloutsListResponse = list;
		// `cluster` is the one extra fact every real non-detail call site
		// passes (history, `/envs/<name>`, `/apps/<name>`, `FailurePanel`) —
		// this rollout is stamped `prod` (see its own `source-cluster`
		// annotation), and the self-built graph's node ids are keyed off
		// that same stamp (`clusterOf`, `dependency-graph.ts`).
		renderModal({ rollout: checkoutApiRollout, cluster: 'prod' });

		for (const wantDv of ['4.43.0-43', '4.44.0-44', '4.45.0-45']) {
			const row = await screen.findByText(wantDv);
			const button = row.closest('button');
			expect(button, `no picker row for ${wantDv}`).not.toBeNull();
			await waitFor(() =>
				expect(within(button as HTMLButtonElement).getByText(/held/i)).toBeInTheDocument()
			);
		}
	});

	test('the currently-deployed build (4.42.0-42) is never marked held', async () => {
		rolloutsListResponse = list;
		renderModal({ rollout: checkoutApiRollout, cluster: 'prod' });

		const row = await screen.findByText('4.42.0-42');
		const button = row.closest('button');
		expect(button).not.toBeNull();
		// Give the self-query time to resolve before asserting the negative.
		await waitFor(() => expect(fetchMock).toHaveBeenCalled());
		expect(within(button as HTMLButtonElement).queryByText('held')).not.toBeInTheDocument();
	});
});

/**
 * ⭐ ITEM (b), coordinator follow-up, 2026-10-09. THE GAP BETWEEN MOUNT AND
 * THE SELF-DERIVED QUERY LANDING. The describe block above proves the dialog
 * agrees with Overview/Gates once `selfHeldGraphQuery` has resolved; this
 * one proves what happens WHILE it hasn't. `4.43.0-43` is held only by the
 * payments-svc contract (no gate in `status.gates` refuses it — see that
 * describe block's own fixture note), so before the dependency graph has
 * loaded this dialog has no way to know it. The defect it used to have:
 * the row read plain (no `held` chip, same as a genuinely free build) for
 * the whole first paint, and Deploy was fully enabled — a reader could
 * click through a hold the dialog simply had not looked up yet.
 */
describe('self-derivation, pending — never shows false "not held" while the graph loads', () => {
	// A deliberately NON-production, no-gates fixture: `checkout-api`'s own
	// contract-hold fixture is a production target, so `confirmLevel`
	// already requires typed confirmation + a note there regardless of this
	// fix — a test built on it could pass even if `selectedVersionHeldPending`
	// were deleted. This fixture isolates the ONE blocker this item adds:
	// everything else about the deploy (dev target, gates open, no typed
	// confirmation needed) is deliberately unremarkable.
	const synthRollout = {
		metadata: { name: 'synth-app', namespace: 'synth-dev', labels: { environment: 'dev' } },
		spec: {},
		status: {
			availableReleases: [
				{ tag: 'rel-66', version: '1.0.0-66' },
				{ tag: 'rel-67', version: '1.1.0-67' }
			],
			gates: [], // same convention `ckGates` uses: the contract gate is not published here either.
			history: [{ version: { tag: 'rel-66', version: '1.0.0-66' }, bakeStatus: 'Succeeded' }]
		}
	} as unknown as Rollout;
	const synthDependency = {
		apiVersion: 'kuberik.com/v1alpha1',
		kind: 'RolloutDependency',
		metadata: { name: 'synth-app-needs-provider', namespace: 'synth-dev' },
		spec: {
			contract: 'provider',
			providerRef: { name: 'synth-provider', namespace: 'synth-dev' },
			rolloutRef: { name: 'synth-app' }
		},
		status: {
			blockedReleases: [{ tag: 'rel-67', requiredVersion: '2.0.0', reason: 'ConstraintNotSatisfied' }],
			gateName: 'dependency-synth-app-needs-provider',
			conditions: []
		}
	};
	const list = {
		rollouts: { items: [synthRollout] },
		environments: { items: [] },
		rolloutDependencies: { items: [synthDependency] }
	};

	test('rel-67 (contract-only hold) shows a loading marker, never "held: false", and Deploy stays disabled; both resolve once the graph lands', async () => {
		rolloutsListResponse = list;
		// Hold the `/api/rollouts` response open — the dialog mounts with
		// the query genuinely pending, same as a cold cache in the real app.
		let resolveRollouts!: (r: Response) => void;
		const deferred = new Promise<Response>((resolve) => {
			resolveRollouts = resolve;
		});
		fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
			const url = typeof input === 'string' ? input : input.toString();
			if (url === '/api/rollouts') return deferred;
			if (url.startsWith('/api/rollouts?namespace=')) {
				return new Response(JSON.stringify(NAMESPACE_LIST_RESPONSE), { status: 200 });
			}
			return new Response(JSON.stringify({}), { status: 200 });
		});

		// No `contractHeldVersions`, no `autoDeploy` — the self-derivation path.
		renderModal({ rollout: synthRollout, environmentName: 'dev' });

		const row = await screen.findByText('1.1.0-67');
		const button = row.closest('button') as HTMLButtonElement;
		expect(button).not.toBeNull();

		// While pending: never the false negative, and never the real chip
		// either — only the loading marker. `sr-only` text names it for
		// assistive tech since the visible skeleton is `aria-hidden`.
		expect(within(button).queryByText('held')).not.toBeInTheDocument();
		expect(within(button).getByText('Checking whether this build is held')).toBeInTheDocument();

		await fireEvent.click(button);
		const deployButton = screen.getByRole('button', { name: /^Deploy/ });
		// This fixture has no gate, no production tier and no typed-confirm
		// requirement — the ONLY thing that can be disabling Deploy here is
		// the pending held state.
		expect(deployButton).toBeDisabled();
		expect(screen.getByText('Checking whether this build is held…')).toBeInTheDocument();

		// Resolve the graph query — the row flips to the real (held) answer
		// and Deploy re-enables (a KNOWN contract hold is the operator's
		// manual-override call, same as every other held build in this
		// dialog; only the UNKNOWN window disables it).
		resolveRollouts(new Response(JSON.stringify(list), { status: 200 }));

		// ⛔ A bare `/held/i` text matcher also matches the PENDING state's
		// own `sr-only` "Checking whether this build is held" span — too
		// loose once the held row can say a specific reason
		// (`heldReasonFor`, round 3) instead of the bare word. Matching on
		// the `.text-held` class (the resolved mark's own ink, never the
		// pending skeleton's) is what actually distinguishes "resolved
		// held" from "still checking."
		await waitFor(() =>
			expect(
				within(button).getByText(
					(_, el) =>
						el?.tagName === 'SPAN' &&
						(el?.classList.contains('text-held') ?? false) &&
						/held/i.test(el?.textContent ?? '')
				)
			).toBeInTheDocument()
		);
		expect(within(button).queryByText('Checking whether this build is held')).not.toBeInTheDocument();
		await waitFor(() => expect(deployButton).not.toBeDisabled());
	});
});

/**
 * ⭐ ITEM 2 (coordinator, 2026-10-09). "Checking…" MUST NOT MEAN FOREVER.
 * Before this fix, a failed `/api/rollouts` read exactly like the node-missing
 * case above — settled, no data, no node — so `heldStatePending` never
 * cleared and `Deploy` stayed disabled with "Checking whether this build is
 * held…" under it permanently. Same non-production, no-gates fixture as the
 * pending-state block above (deliberately unremarkable everywhere except the
 * one thing under test): proves the typed-confirmation path fires here even
 * with no production tier and no gate hold — ONLY the errored contract check
 * can be forcing it.
 */
describe('self-derivation, errored — a hold that could not be checked counts as risk, never a permanent disable (item 2)', () => {
	const synthRollout = {
		metadata: { name: 'synth-app', namespace: 'synth-dev', labels: { environment: 'dev' } },
		spec: {},
		status: {
			availableReleases: [
				{ tag: 'rel-66', version: '1.0.0-66' },
				{ tag: 'rel-67', version: '1.1.0-67' }
			],
			gates: [],
			history: [{ version: { tag: 'rel-66', version: '1.0.0-66' }, bakeStatus: 'Succeeded' }]
		}
	} as unknown as Rollout;

	function mockListFailure() {
		fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
			const url = typeof input === 'string' ? input : input.toString();
			if (url === '/api/rollouts') throw new Error('network error');
			if (url.startsWith('/api/rollouts?namespace=')) {
				return new Response(JSON.stringify(NAMESPACE_LIST_RESPONSE), { status: 200 });
			}
			return new Response(JSON.stringify({}), { status: 200 });
		});
	}

	test('a rejected /api/rollouts shows the error text on the row and in the footer, requires typed confirmation, and Deploy works once typed', async () => {
		mockListFailure();
		// No `contractHeldVersions`, no `autoDeploy` — the self-derivation path.
		renderModal({ rollout: synthRollout, environmentName: 'dev' });

		const row = await screen.findByText('1.1.0-67');
		const button = row.closest('button') as HTMLButtonElement;
		expect(button).not.toBeNull();

		// The row settles on the error text, never stuck on the loading
		// marker and never the real chip (we genuinely do not know).
		await waitFor(() =>
			expect(within(button).getByText("Couldn't check dependency holds")).toBeInTheDocument()
		);
		expect(within(button).queryByText('Checking whether this build is held')).not.toBeInTheDocument();
		expect(within(button).queryByText('held')).not.toBeInTheDocument();

		await fireEvent.click(button);

		// The dedicated, separate-from-`confirmNotice` alert states the error
		// plainly — it must never say "no rule currently allows this build"
		// (that would be a false claim about the GATES, which this failure
		// says nothing about).
		expect(
			await screen.findByText("Couldn't check dependency holds for this build.")
		).toBeInTheDocument();

		// Typed confirmation is required even though this fixture has no
		// gate hold and no production tier — the ONLY thing that can be
		// requiring it here is the errored contract check.
		const deployButton = screen.getByRole('button', { name: /^Deploy/ });
		expect(screen.getByLabelText(/^Type/, { exact: false })).toBeTruthy();
		expect(document.getElementById('cvm-confirm-version')).not.toBeNull();
		expect(deployButton).toBeDisabled();
		expect(screen.queryByText('Checking whether this build is held…')).not.toBeInTheDocument();

		// Never a permanent disable: typing the build's own version unblocks
		// Deploy exactly as any other typed-confirmation deploy does.
		await typeConfirmVersion();
		await waitFor(() => expect(deployButton).not.toBeDisabled());
	});

	test('the dev console.warn names a list failure, distinct from a node-missing lookup miss', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		mockListFailure();
		renderModal({ rollout: synthRollout, environmentName: 'dev' });
		await screen.findByText('1.1.0-67');

		await waitFor(() =>
			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('a list failure, not a lookup miss'))
		);
		expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('a lookup miss, not a list failure'));
		warnSpy.mockRestore();
	});
});

/**
 * ⭐ ITEM (c), coordinator follow-up, 2026-10-09. THE NODE LOOKUP MUST
 * SURVIVE AN UNSTAMPED CLUSTER. `graphNodeForRollout` (`app-tasks.ts`)
 * matches a node on namespace + name alone, the same lookup `/apps/[name]`
 * already uses — see that function's own doc comment: a hub-local
 * rollout's node id is built off its RAW `source-cluster` annotation
 * (empty string when absent), while a caller's `cluster` prop on the page
 * is the page's OWN name for "here" (`localClusterName`, never `''`) — the
 * two conventions coincide only by accident.
 */
describe('self-derivation — the node lookup is robust to an unstamped cluster (item c)', () => {
	// Same no-gates, non-production shape as the pending-state fixture above,
	// but this rollout carries NO `source-cluster` annotation at all — the
	// hub-local case — while the dialog is opened with a non-empty `cluster`
	// prop, exactly the mismatch the coordinator named.
	const hubLocalRollout = {
		metadata: { name: 'alpha-app', namespace: 'alpha-dev', labels: { environment: 'dev' } },
		spec: {},
		status: {
			availableReleases: [
				{ tag: 'rel-10', version: '1.0.0-10' },
				{ tag: 'rel-11', version: '1.1.0-11' }
			],
			gates: [],
			history: [{ version: { tag: 'rel-10', version: '1.0.0-10' }, bakeStatus: 'Succeeded' }]
		}
	} as unknown as Rollout;
	const hubLocalDependency = {
		apiVersion: 'kuberik.com/v1alpha1',
		kind: 'RolloutDependency',
		metadata: { name: 'alpha-app-needs-provider', namespace: 'alpha-dev' },
		spec: {
			contract: 'provider',
			providerRef: { name: 'alpha-provider', namespace: 'alpha-dev' },
			rolloutRef: { name: 'alpha-app' }
		},
		status: {
			blockedReleases: [{ tag: 'rel-11', requiredVersion: '2.0.0', reason: 'ConstraintNotSatisfied' }],
			gateName: 'dependency-alpha-app-needs-provider',
			conditions: []
		}
	};

	test('a hub-local rollout (no source-cluster annotation) still resolves its held state when the caller passes a non-empty cluster prop', async () => {
		rolloutsListResponse = {
			rollouts: { items: [hubLocalRollout] },
			environments: { items: [] },
			rolloutDependencies: { items: [hubLocalDependency] }
		};
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		// `cluster: 'rollout-a'` reproduces the mismatch: the graph's own node
		// id for this rollout is keyed on `''` (no annotation), never on a
		// caller-supplied spoke name. Before `graphNodeForRollout`, this built
		// `"rollout-a/alpha-dev/alpha-app"` and never matched the graph's
		// `"/alpha-dev/alpha-app"` node, so the hold was never found, even
		// once the query resolved.
		renderModal({ rollout: hubLocalRollout, cluster: 'rollout-a', environmentName: 'dev' });

		const row = await screen.findByText('1.1.0-11');
		const button = row.closest('button') as HTMLButtonElement;
		await waitFor(() => expect(within(button).getByText(/held/i)).toBeInTheDocument());

		// A found node is not a missing one — no dev warning for this case.
		expect(warnSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	/**
	 * ⛔ SUPERSEDED, 2026-10-09 (squad-rollout, Lane D — §4: "fix today's
	 * defect: an empty 40×16 grey box renders beside every sha… a skeleton
	 * that never resolves"). This test used to assert the defect itself: the
	 * row stuck on "Checking whether this build is held" and Deploy
	 * permanently disabled with no way out, because a node that is simply
	 * never going to be found read identically to one still in flight. That
	 * is precisely the "skeleton that never resolves" the live product
	 * showed on `checkout-edge-prod/checkout-edge` (a `SkeletonBar` beside
	 * every row, forever). `heldStateErrored` now also covers a settled,
	 * node-missing graph — same as an outright failed request — so the row
	 * settles on the same "couldn't check" words `heldStateErrored` already
	 * gives a rejected `/api/rollouts`, and Deploy becomes reachable again
	 * via the typed-confirmation path rather than staying dead forever. The
	 * dev `console.warn` (for whoever wired the new call site) is unchanged.
	 */
	test('a rollout genuinely absent from its own /api/rollouts payload warns in dev, settles on "couldn\'t check" (never stuck "Checking…", never "not held"), and Deploy is reachable via typed confirmation', async () => {
		// The dialog's own rollout is NOT in the list this fetch returns —
		// the graph settles with no node for it at all.
		rolloutsListResponse = {
			rollouts: { items: [] },
			environments: { items: [] },
			rolloutDependencies: { items: [] }
		};
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		renderModal({ rollout: hubLocalRollout, cluster: 'rollout-a', environmentName: 'dev' });

		const row = await screen.findByText('1.1.0-11');
		const button = row.closest('button') as HTMLButtonElement;

		// The query settles (fetchMock resolves synchronously by default in
		// this file's `beforeEach`) and the row settles too — on the known-
		// unknown text, never stuck on the loading marker and never the real
		// `held` chip (we genuinely do not know).
		await waitFor(() =>
			expect(within(button).getByText("Couldn't check dependency holds")).toBeInTheDocument()
		);
		expect(within(button).queryByText('Checking whether this build is held')).not.toBeInTheDocument();
		expect(within(button).queryByText('held')).not.toBeInTheDocument();

		await fireEvent.click(button);
		const deployButton = screen.getByRole('button', { name: /^Deploy/ });
		// Disabled until typed — a known unknown is risk, not a permanent
		// dead end (the same guarantee `heldStateErrored`'s own test gives a
		// failed request).
		expect(deployButton).toBeDisabled();
		const confirmInput = document.getElementById('cvm-confirm-version') as HTMLInputElement;
		expect(confirmInput).not.toBeNull();
		await fireEvent.input(confirmInput, { target: { value: '1.1.0-11' } });
		expect(deployButton).not.toBeDisabled();

		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('alpha-dev/alpha-app'));
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('never Ready'));
		warnSpy.mockRestore();
	});
});

/**
 * ⭐ round 6 (squad-rollout, Lane D, AD round 4 items 2 and 9): recovery mode
 * carries into the rollback confirm as one line, and both tiles draw one
 * anatomy — the failed running build says "Failed" in words, the target its
 * own state, never a rule name.
 */
describe('round 6 — the confirm carries recovery mode and one tile anatomy', () => {
	function failedDevRollout() {
		return rolloutFixture({
			metadata: { name: 'hello-world-app', namespace: 'hello-world-dev', labels: { environment: 'dev' } },
			status: {
				availableReleases: [
					{ tag: 'old', version: '0afab6f', created: daysAgo(10) },
					{ tag: 'new', version: '064b655', created: daysAgo(1) }
				],
				gates: [{ name: 'ghd-open', passing: true, allowedVersions: null }],
				conditions: [{ type: 'GatesPassing', status: 'True' }],
				history: [
					{ version: { tag: 'new', version: '064b655' }, bakeStatus: 'Failed', timestamp: daysAgo(1) },
					{ version: { tag: 'old', version: '0afab6f' }, bakeStatus: 'Succeeded', timestamp: daysAgo(10) }
				]
			}
		});
	}

	test('a failed running build: the rollback confirm says recovery mode once, the from tile says Failed', async () => {
		renderModal({ rollout: failedDevRollout(), initialSelectedVersion: 'old' });
		await screen.findByRole('button', { name: /^Roll back$/i });
		expect(screen.getAllByText(/waits for health checks instead of failing/)).toHaveLength(1);
		expect(screen.getByText('Failed')).toBeInTheDocument();
		expect(screen.getByText('Ran here before')).toBeInTheDocument();
	});

	test('recoveryMode={false} from the caller wins over the derived default', async () => {
		renderModal({ rollout: failedDevRollout(), initialSelectedVersion: 'old', recoveryMode: false });
		await screen.findByRole('button', { name: /^Roll back$/i });
		expect(screen.queryByText(/waits for health checks instead of failing/)).toBeNull();
	});
});

/**
 * batch4 #128 (owner 2026-11-12): every VISIBLE surface draws a promotion gate through GateLabel (the » glyph and the source chip,
 * or the word "Promotion"); the "Held by" line of this dialog is one of them. It never reads "Promotion from <env>" as text.
 */
describe('a promotion-held build row draws the label, never the text "Promotion from"', () => {
	test('the picker row says Held by » Promotion (drawn), not a sentence', async () => {
		const rollout = rolloutFixture({
			status: {
				availableReleases: [
					{ tag: 'rel-66', version: '1.66.0-66', created: daysAgo(35) },
					{ tag: 'rel-67', version: '2.67.0-67', created: daysAgo(1) }
				],
				gates: [{ name: 'ghd-promo', kind: 'promotion', passing: true, allowedVersions: ['rel-66'] }],
				conditions: [{ type: 'GatesPassing', status: 'False', reason: 'NoAllowedVersions' }],
				history: [{ version: { tag: 'rel-66', version: '1.66.0-66' }, bakeStatus: 'Succeeded', timestamp: daysAgo(4) }]
			}
		});
		const { container } = renderModal({ rollout });
		const held = await waitFor(() => {
			const el = [...container.querySelectorAll('span.text-held')].find((e) => /Held by/.test(e.textContent ?? ''));
			expect(el).toBeTruthy();
			return el as HTMLElement;
		});
		expect(held.querySelector('[data-gate-label="promotion"]')).not.toBeNull();
		expect(held.textContent).not.toContain('Promotion from');
	});
});
