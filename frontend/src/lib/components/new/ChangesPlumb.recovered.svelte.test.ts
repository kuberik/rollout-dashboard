import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import ChangesPlumb from './ChangesPlumb.svelte';
import type { Plumb, PlumbRow } from './changes-plumb';

vi.mock('$app/state', () => ({ page: { url: new URL('http://x/changes') } }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
const plumb = vi.hoisted(() => ({ value: null as unknown as Plumb }));
vi.mock('./changes-plumb', async (orig) => ({ ...(await orig<typeof import('./changes-plumb')>()), plumbOf: () => plumb.value }));

/** The Changes plumb: a failed change whose checks recovered is the ring on its row; a failed service of a multi-service change is the ring on its own mark; failing now is the solid disc. */
describe('ChangesPlumb: the failed marks', () => {
	const svc = (app: string, recovered: boolean) => ({ app, tier: 'prod', state: 'failed' as const, next: null, since: 1, href: `/${app}`, done: false, recovered });
	const row = (key: string, extra: Partial<PlumbRow>): PlumbRow => ({ key, repo: 'acme/widget', ref: '#1', title: key, href: `/c/${key}`, state: 'failed', col: 'prod', age: '3m', since: 1, worst: null, services: null, ...extra });
	const draw = (rows: PlumbRow[]) => {
		plumb.value = { stops: [{ col: 'prod', rows }], total: rows.length, chips: [], landed: [] };
		return render(ChangesPlumb, { props: { state: 'incident' } }).container;
	};
	const chip = (c: HTMLElement, sel: string) => c.querySelector(`${sel} span.rounded-full.ring-inset`)!.className;
	it('row: recovered = ring, failing now = solid, a recovered flag on a non-failed row changes nothing', () => {
		const c = draw([row('rec', { recovered: true }), row('live', {}), row('move', { state: 'deploying', recovered: true })]);
		expect(chip(c, '[data-key="rec"]')).toContain('ring-[1.5px]');
		expect(chip(c, '[data-key="rec"]')).not.toContain('bg-danger-solid');
		expect(chip(c, '[data-key="live"]')).toContain('bg-danger-solid');
		expect(chip(c, '[data-key="move"]')).not.toContain('ring-[1.5px]');
	});
	it('row word: a recovered failure reads Failed in neutral ink, failing now reads Failing in danger ink', () => {
		const c = draw([row('rec', { recovered: true }), row('live', {})]);
		const word = (k: string) => c.querySelector(`[data-key="${k}"] .plb-word > span:last-child`)!;
		expect(word('rec').textContent).toBe('Failed');
		expect(word('rec').className).toContain('text-fg-muted');
		expect(word('rec').className).not.toContain('text-danger');
		expect(word('live').textContent).toBe('Failing');
		expect(word('live').className).toContain('text-danger');
	});
	it('service marks: a recovered service is the ring, one failing now the solid disc', async () => {
		const c = draw([row('multi', { services: [svc('indexer', true), svc('worker', false)], worst: 'worker' })]);
		(c.querySelector('.plb-spread') as HTMLElement).click();
		await vi.waitFor(() => expect(c.querySelectorAll('.plb-svc').length).toBe(2));
		const marks = [...c.querySelectorAll('.plb-svc')].map((li) => li.querySelector('span.rounded-full.ring-inset')!.className);
		expect(marks[0]).toContain('ring-[1.5px]');
		expect(marks[1]).toContain('bg-danger-solid');
		const words = [...c.querySelectorAll('.plb-svc-word')];
		expect(words[0].textContent).toMatch(/^Failed/);
		expect(words[0].className).toContain('text-fg-muted');
		expect(words[0].className).not.toContain('text-danger');
		expect(words[1].className).toContain('text-danger');
	});
});
