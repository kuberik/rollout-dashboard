import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import FeedRow from './FeedRow.svelte';

describe('FeedRow manual deploy (QA #14 review)', () => {
	const props = { app: 'hello', href: '/x', verb: 'deployed', chip: 'prod', from: 'aaa1111', to: 'bbb2222', age: '14:10', mark: 'manual' as const, actor: { kind: 'person' as const, name: 'alice' } };
	test('one mark part: the word, no second person glyph (the avatar is the glyph)', () => {
		const { container } = render(FeedRow, { props });
		expect(container.querySelectorAll('[data-manual-deploy]')).toHaveLength(1);
		expect(screen.getByText('manual')).toBeInTheDocument();
		expect(container.querySelector('.fr-what svg')).toBeNull();
	});
	test('the person name is printed, not hidden', () => {
		const { container } = render(FeedRow, { props });
		const n = container.querySelector('.fr-who-in .fr-who-n') as HTMLElement;
		expect(n.textContent).toBe('alice');
	});
	test('the target build is its own never-truncated span', () => {
		const { container } = render(FeedRow, { props });
		expect(container.querySelector('.fr-to')?.textContent).toBe('bbb2222');
		expect(container.querySelector('.fr-from')?.textContent).toBe('aaa1111');
	});
});

describe('FeedRow recovered failure', () => {
	const base = { app: 'hello', href: '/x', verb: 'failed its health check', tone: 'failed' as const, age: '14:10' };
	const chip = (extra: Record<string, unknown>) => render(FeedRow, { props: { ...base, ...extra } }).container.querySelector('.fr-mk span.rounded-full')!.className;
	test('failing now = solid; current failure with checks OK again = ring; superseded = resolved; unknown stays solid', () => {
		const solid = chip({ live: true });
		expect(solid).toContain('bg-danger-solid');
		const ring = chip({ live: false, markLive: true, markRecovered: true });
		expect(ring).toContain('ring-[1.5px]');
		expect(ring).not.toContain('bg-danger-solid');
		const superseded = chip({ live: false, markLive: false });
		expect(superseded).toContain('ring-line');
		expect(chip({ live: false, markLive: false, markRecovered: true })).toBe(superseded);
		// a current failure with no health evidence kept: the explicit flag is absent, so it stays the solid disc
		expect(chip({ live: false, markLive: true })).toBe(solid);
	});
	test('the words go neutral for a recovered failure, the mark does not follow them', () => {
		const verb = (extra: Record<string, unknown>) => render(FeedRow, { props: { ...base, ...extra } }).container.querySelector('.fr-v')!.className;
		expect(verb({ live: false, markLive: true, markRecovered: true })).not.toContain('text-danger');
		expect(verb({ live: true })).toContain('text-danger');
	});
	test('a recovered failure passed as live (the app page feed) still words it in neutral ink, not danger', () => {
		const verb = (extra: Record<string, unknown>) => render(FeedRow, { props: { ...base, ...extra } }).container.querySelector('.fr-v')!.className;
		expect(verb({ live: true, markRecovered: true })).toContain('text-fg-muted');
		expect(verb({ live: true, markRecovered: true })).not.toContain('text-danger');
		expect(verb({ live: false, markLive: true, markRecovered: true })).toContain('text-fg-muted');
	});
});
