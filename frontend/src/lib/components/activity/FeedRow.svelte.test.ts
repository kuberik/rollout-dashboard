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
	const mark = (extra: Record<string, unknown>) => {
		const { container } = render(FeedRow, { props: { ...base, ...extra } });
		const m = container.querySelector('.fr-mk')!.cloneNode(true) as HTMLElement;
		m.querySelectorAll('.sr-only').forEach((e) => e.remove());
		m.querySelectorAll('[title]').forEach((e) => e.removeAttribute('title'));
		return { html: m.innerHTML, verb: container.querySelector('.fr-v')!.className };
	};
	test('words go neutral while the mark stays the failed mark; only a superseded failure takes the resolved mark', () => {
		const live = mark({ live: true });
		const recovered = mark({ live: false, markLive: true });
		const superseded = mark({ live: false, markLive: false });
		expect(recovered.html).toBe(live.html);
		expect(recovered.verb).not.toContain('text-danger');
		expect(live.verb).toContain('text-danger');
		expect(superseded.html).not.toBe(live.html);
		expect(mark({ live: false }).html).toBe(superseded.html);
	});
});
