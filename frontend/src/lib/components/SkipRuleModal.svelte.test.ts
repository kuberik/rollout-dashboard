import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import SkipRuleModal from './SkipRuleModal.svelte';
import SkipRuleModalHost from '$lib/testing/SkipRuleModalHost.svelte';
import type { SkipRow, SkipTarget } from '$lib/view-models/skip-rule';

// jsdom has neither the Web Animations API nor a working <dialog> (see ClearPinModal.svelte.test.ts).
if (!Element.prototype.animate) {
	Element.prototype.animate = function () {
		return { cancel() {}, finish() {}, set onfinish(_f: unknown) {}, currentTime: 0, playState: 'finished' } as unknown as Animation;
	};
}
if (!HTMLDialogElement.prototype.showModal) {
	HTMLDialogElement.prototype.showModal = function () { this.open = true; };
	HTMLDialogElement.prototype.show = function () { this.open = true; };
	HTMLDialogElement.prototype.close = function () { this.open = false; };
}

const RULE = { kind: 'ClusterRolloutSchedule', name: 'business-hours' };
const target: SkipTarget = { rule: RULE, ruleLabel: 'Business hours', tag: 'm-62', build: '5.8.0-62', gateNames: ['business-hours-ledger-api'] };
const row = (cluster: string, ns: string, name: string, env: string, tag = 'm-62', build = '5.8.0-62'): SkipRow => ({
	key: `${cluster}/${ns}/${name}`,
	cluster,
	namespace: ns,
	name,
	env,
	tag,
	build,
	gateNames: [`business-hours-${name}`]
});
const here = { cluster: 'staging', namespace: 'ledger-api-staging', name: 'ledger-api', env: 'staging' };

let posts: { url: string; body: Record<string, unknown> }[] = [];
let failFor: string | null = null;

beforeEach(() => {
	posts = [];
	failFor = null;
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			if (init?.method === 'POST') {
				posts.push({ url, body: JSON.parse(String(init.body)) });
				if (failFor && url.includes(failFor)) return new Response(JSON.stringify({ error: 'version is not a release candidate' }), { status: 409 });
				return new Response(JSON.stringify({ version: 'm-62', gates: ['g'], scope: 'only' }), { status: 200 });
			}
			// permissions and everything else: allowed
			return new Response(JSON.stringify({ permissions: { update: true, patch: true } }), { status: 200 });
		})
	);
});
afterEach(() => vi.unstubAllGlobals());

function renderModal(rows: SkipRow[]) {
	return render(WithQueryClient, { props: { component: SkipRuleModal as never, props: { open: true, target, here, rows } } });
}

describe('SkipRuleModal', () => {
	test('one rollout: the one sentence, no list, no typing, one POST with version + rule and never gates', async () => {
		renderModal([row('staging', 'ledger-api-staging', 'ledger-api', 'staging')]);
		expect(screen.getByText('Skip Business hours once')).toBeInTheDocument();
		expect(document.querySelector('[data-skip-list]')).toBeNull();
		expect(document.querySelector('[data-skip-typed]')).toBeNull();
		expect(document.querySelector('[data-skip-sentence]')?.textContent).toBe('Business hours lets 5.8.0-62 through to ledger-api in staging once.');
		await fireEvent.click(screen.getByRole('button', { name: /Skip for 1 rollout/ }));
		await waitFor(() => expect(posts).toHaveLength(1));
		expect(posts[0].url).toBe('/api/clusters/staging/rollouts/ledger-api-staging/ledger-api/bypass-gates');
		expect(posts[0].body).toEqual({ version: 'm-62', rule: RULE });
	});

	test('production selected: typed confirm; one shared build asks for the build, several builds ask for the rule', async () => {
		const rows = [
			row('staging', 'ledger-api-staging', 'ledger-api', 'staging'),
			row('prod', 'ledger-api-prod', 'ledger-api', 'prod'),
			row('prod', 'invoice-worker-prod', 'invoice-worker', 'prod', 'w-31', '2.3.0-31')
		];
		renderModal(rows);
		const go = () => screen.getByRole('button', { name: /Skip for/ });
		expect(go()).not.toBeDisabled(); // only this (staging) rollout: nothing to type
		await fireEvent.click(document.querySelector('[data-skip-row="prod/ledger-api-prod/ledger-api"] input')!);
		expect(document.querySelector('[data-skip-typed]')).not.toBeNull();
		expect(document.querySelector('[data-skip-typed]')?.textContent).toContain('5.8.0-62');
		expect(go()).toBeDisabled();
		const input = document.getElementById('srm-confirm') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: '5.8.0-62' } });
		expect(go()).not.toBeDisabled();
		// a second production rollout on a DIFFERENT build: type the rule, and say why
		await fireEvent.click(document.querySelector('[data-skip-row="prod/invoice-worker-prod/invoice-worker"] input')!);
		expect(document.querySelector('[data-skip-why]')?.textContent).toBe("Several builds are selected, so type the rule's name.");
		expect(go()).toBeDisabled(); // what was typed was the build
		expect(document.getElementById('srm-confirm')).toHaveValue(''); // and the question changed, so the answer is cleared
		await fireEvent.input(document.getElementById('srm-confirm')!, { target: { value: 'business-hours' } });
		expect(go()).not.toBeDisabled();
	});

	test('the list dialog opens with Cancel focused, not Select all', async () => {
		renderModal([row('staging', 'ledger-api-staging', 'ledger-api', 'staging'), row('staging', 'a-staging', 'a', 'staging')]);
		await waitFor(() => expect(document.querySelector('[data-skip-list]')).not.toBeNull());
		await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })));
		expect(screen.getByRole('button', { name: 'Select all' })).toHaveClass('hit-32');
	});

	test('partial failure: the failed row says why, the primary recounts to it, and only it is retried', async () => {
		failFor = 'invoice-worker-staging';
		const rows = [
			row('staging', 'ledger-api-staging', 'ledger-api', 'staging'),
			row('staging', 'invoice-worker-staging', 'invoice-worker', 'staging', 'w-31', '2.3.0-31')
		];
		renderModal(rows);
		await fireEvent.click(document.querySelector('[data-skip-row="staging/invoice-worker-staging/invoice-worker"] input')!);
		await fireEvent.click(screen.getByRole('button', { name: /Skip for 2 rollouts/ }));
		await waitFor(() => expect(document.querySelector('[data-skip-summary]')).not.toBeNull());
		expect(document.querySelector('[data-skip-summary]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('1 of 2 skipped. 1 failed.');
		expect(document.querySelector('[data-skip-row="staging/invoice-worker-staging/invoice-worker"] [data-skip-error]')?.textContent).toContain("isn't waiting to deploy here any more.");
		expect(screen.getByText('Close', { selector: 'button.btn' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Skip for 1 rollout/ })).not.toBeDisabled();
		failFor = null;
		await fireEvent.click(screen.getByRole('button', { name: /Skip for 1 rollout/ }));
		await waitFor(() => expect(posts).toHaveLength(3));
		expect(posts[2].url).toContain('invoice-worker-staging');
	});

	test('reopens for another rule with fewer rows after the dialog was closed', async () => {
		// Regression: the page reopens the dialog with a NEW, shorter rows list. createQueries threw (`deleteProperty on proxy`) when its
		// array shrank, which killed the component's reactivity: `open` never reached it again and no <dialog> appeared.
		const five = [
			row('staging', 'ledger-api-staging', 'ledger-api', 'staging'),
			row('staging', 'a-staging', 'a', 'staging'),
			row('staging', 'b-staging', 'b', 'staging'),
			row('prod', 'c-prod', 'c', 'prod'),
			row('prod', 'd-prod', 'd', 'prod')
		];
		const target2: SkipTarget = { rule: { kind: 'RolloutGate', name: 'ledger-signoff' }, ruleLabel: 'Ledger sign-off', tag: 'm-63', build: '5.8.0-63', gateNames: ['ledger-signoff'] };
		const one = [row('staging', 'ledger-api-staging', 'ledger-api', 'staging', 'm-63', '5.8.0-63')];
		render(SkipRuleModalHost, { props: { first: { target, rows: five }, second: { target: target2, rows: one }, here } });
		await fireEvent.click(document.querySelector('[data-open-first]')!);
		await waitFor(() => expect(document.querySelectorAll('[data-skip-row]')).toHaveLength(5));
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		await new Promise((r) => setTimeout(r, 300));
		await fireEvent.click(document.querySelector('[data-open-second]')!);
		await waitFor(() => expect(screen.getByText('Skip Ledger sign-off once')).toBeInTheDocument());
		expect(document.querySelector('dialog')?.open).toBe(true);
	});
});
