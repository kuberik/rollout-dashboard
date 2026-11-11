import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import Facia from './Facia.svelte';
import { laneOf } from './Footprint.svelte';
import { apps } from './data';

describe('the lead tile banner names its place for an approval (approvalIn, no copy)', () => {
	it.each(['payments-core', 'telemetry-indexer'])('%s: "Needs your / Waiting for approval in <place>", never the bare words', (name) => {
		const m = apps('incident');
		const item = m.items.find((a) => a.app === name)!;
		const { lane, last } = laneOf(item, m.R.c.m as never, m.R.c.events as never);
		const { container } = render(Facia, { props: { item, lane, approvals: m.R.rows, scenario: 'incident', lead: true, attention: true, last, recent: [] } as never });
		const banner = container.querySelector('[data-ad-statement]') ?? container;
		const text = banner.textContent ?? '';
		expect(text).toMatch(/(Needs your|Waiting for) approval in \S+/);
		expect(text).not.toMatch(/(Needs your|Waiting for) approval(?! in)/);
	});
});
