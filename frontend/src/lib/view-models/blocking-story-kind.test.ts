import { describe, it, expect } from 'vitest';
import { classifyGate, EMPTY_GATE_CONTEXT, type GateContext } from './blocking-story';

/* The backend's `kind` is the classification when present. Approval-by-elimination (every join consulted, none claimed it) is only the fallback for a payload WITHOUT kind. */
const complete: GateContext = { ...EMPTY_GATE_CONTEXT, sources: { ...EMPTY_GATE_CONTEXT.sources, environments: true, dependencies: true } };
describe('classifyGate defers to the backend kind', () => {
	it('kind unknown is never a person, even when every join missed', () => {
		const c = classifyGate({ name: 'mystery', kind: 'unknown', allowedVersions: [] }, 'ns', complete);
		expect(c.kind).toBe('unknown');
		expect(c.clears).not.toBe('person');
	});
	it('kind approval is a person even when the joins were not all consulted', () => {
		const c = classifyGate({ name: 'mystery', kind: 'approval', allowedVersions: [] }, 'ns', EMPTY_GATE_CONTEXT);
		expect(c.kind).toBe('approval');
		expect(c.clears).toBe('person');
	});
	it('no kind field (an older backend): elimination still applies', () => {
		expect(classifyGate({ name: 'mystery', allowedVersions: [] }, 'ns', complete).kind).toBe('approval');
	});
	it('a kind the backend named (promotion, dependency, schedule) that no join claimed is never turned into a person by elimination', () => {
		for (const kind of ['promotion', 'dependency', 'schedule']) {
			const c = classifyGate({ name: `x-${kind}`, kind, allowedVersions: [] }, 'ns', complete);
			expect(c.clears, kind).not.toBe('person');
		}
	});
});
