import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import MiniPipeline from './MiniPipeline.svelte';
import { connector, nodesOfSteps, strandWidth } from './mini-pipeline';
import type { MiniNode } from './mini-pipeline';

const lefts = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('li[data-node]')].map((e) => parseFloat(e.style.left));
const mk = (states: MiniNode['state'][], label = false): MiniNode[] => states.map((state, i) => ({ state, label: label ? `S${i}` : undefined }));

describe('MiniPipeline equal pitch', () => {
	it('xs: nodes sit on a constant 22px pitch, the connector is 12px, the width is (n-1)*22+10', () => {
		const { container } = render(MiniPipeline, { nodes: mk(['done', 'done', 'current', 'pending']), size: 'xs' });
		expect(lefts(container)).toEqual([0, 22, 44, 66]);
		const root = container.querySelector<HTMLElement>('[data-strand]')!;
		expect(root.style.width).toBe(`${strandWidth('xs', 4)}px`);
		expect(connector('xs')).toBe(12);
		for (const seg of container.querySelectorAll<HTMLElement>('.mp-seg')) expect(seg.style.left).toMatch(/px/);
		expect(container.querySelectorAll('.mp-seg')).toHaveLength(3);
	});
	it('sm: 56px pitch, 32px connector, labels add 14px of air each side but never change the pitch', () => {
		const { container } = render(MiniPipeline, { nodes: mk(['done', 'checking', 'pending'], true), size: 'sm' });
		expect(lefts(container)).toEqual([14, 70, 126]);
		expect(container.querySelector<HTMLElement>('[data-strand]')!.dataset.lead).toBe('14');
		expect(connector('sm')).toBe(32);
	});
	it('a ring and a dot occupy the same slot: every state draws at d x d', () => {
		const states: MiniNode['state'][] = ['done', 'current', 'pending', 'failed', 'held', 'approval', 'checking', 'rest'];
		const { container } = render(MiniPipeline, { nodes: mk(states), size: 'xs' });
		expect(lefts(container)).toEqual(states.map((_, i) => i * 22));
	});
	it('overflow folds a run that never holds the first, last or frontier node, and keeps the pitch', () => {
		const states: MiniNode['state'][] = ['done', 'done', 'done', 'done', 'current', 'pending', 'pending', 'pending'];
		const { container } = render(MiniPipeline, { nodes: mk(states), size: 'xs', max: 6 });
		expect(container.querySelector('[data-fold]')).not.toBeNull();
		expect(lefts(container)).toEqual([0, 22, 44, 66, 88, 110]);
		expect(container.querySelector('[data-node="current"]')).not.toBeNull();
		expect(container.querySelector('[data-node="failed"]')).toBeNull();
		expect(container.querySelectorAll('[data-node]')).toHaveLength(6);
	});
	it('a frontier-only middle is not folded away', () => {
		const states: MiniNode['state'][] = ['done', 'failed', 'held', 'current', 'checking', 'pending', 'pending'];
		const { container } = render(MiniPipeline, { nodes: mk(states), size: 'xs', max: 4 });
		expect(container.querySelector('[data-fold]')).toBeNull();
		expect(container.querySelectorAll('[data-node]')).toHaveLength(7);
	});
	it('decorative keeps geometry but drops step vocabulary and the accessible name', () => {
		const { container } = render(MiniPipeline, { nodes: [{ state: 'done', step: 'Started', stepState: 'done' }, { state: 'current' }], size: 'xs', decorative: true });
		const root = container.querySelector('[data-strand]')!;
		expect(root.getAttribute('aria-hidden')).toBe('true');
		expect(container.querySelector('[data-step]')).toBeNull();
		expect(container.querySelectorAll('[data-node]')).toHaveLength(2);
	});
});

describe('nodesOfSteps', () => {
	it('maps the tab vocabulary and keeps it on the DOM', () => {
		const n = nodesOfSteps([{ name: 'Started', state: 'done' }, { name: 'Stage 1', state: 'active' }, { name: 'Check', state: 'todo' }, { name: 'X', state: 'fail' }, { name: 'G', state: 'hold' }], 'deploying', true);
		expect(n.map((x) => x.state)).toEqual(['done', 'current', 'pending', 'failed', 'held']);
		expect(n[1]).toMatchObject({ label: 'Stage 1', step: 'Stage 1', stepState: 'active' });
		expect(nodesOfSteps([{ name: 'Check', state: 'active' }], 'checking')[0].state).toBe('checking');
		expect(nodesOfSteps([{ name: 'Check', state: 'active' }], 'deploying')[0].state).toBe('current');
	});
});
