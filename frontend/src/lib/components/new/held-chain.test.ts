import { describe, it, expect } from 'vitest';
import { heldChain } from './held-chain';
import type { RolloutGraph, GraphNode, GraphEdge } from '$lib/view-models/dependency-graph';

const node = (name: string, env = 'prod'): GraphNode => ({ id: `c/${env}/${name}`, cluster: 'c', namespace: env, name, env, envRank: 0, unresolved: false, build: '1', candidateCount: 0, waiting: false, blocked: false, holds: [] });
const edge = (from: GraphNode, to: GraphNode, o: Partial<GraphEdge> = {}): GraphEdge => ({ key: `${from.id}>${to.id}`, from: from.id, to: to.id, writer: 'contract', gate: 'g', state: 'blocked', contract: 'api', requiredVersion: '^6.0.0', providedVersion: '5.1.0', edgeKind: null, message: 'm', cyclic: false, held: [], ...o });
const ledger = node('ledger-core'), pay = node('payments-svc'), co = node('checkout-api');
const g = (edges: GraphEdge[]): RolloutGraph => ({ nodes: [ledger, pay, co], edges, envs: [], blockedEdges: [], hasCycle: false, unlinkedRollouts: 0 });
const row = { app: 'checkout-api' };

describe('heldChain', () => {
	it('names a holder that is itself held, linked to its rollout', () => {
		const l = heldChain([{ key: 'p', cause: 'Waiting on payments-svc', rows: [row] }], g([edge(ledger, pay)]));
		expect(l).toEqual([{ provider: 'payments-svc', upstream: 'ledger-core', text: 'payments-svc is itself waiting on ledger-core', href: '/rollouts/c/prod/ledger-core' }]);
	});
	it('shows nothing when the holder is not held', () => {
		expect(heldChain([{ key: 'p', cause: 'Waiting on payments-svc', rows: [row] }], g([]))).toEqual([]);
		expect(heldChain([{ key: 'p', cause: 'Waiting on payments-svc', rows: [row] }], g([edge(ledger, pay, { state: 'ok' as never })]))).toEqual([]);
	});
	it('ignores causes that are not a holder and empty input', () => {
		expect(heldChain([{ key: 'a', cause: 'Waiting for approval', rows: [row] }], g([edge(ledger, pay)]))).toEqual([]);
		expect(heldChain([], g([edge(ledger, pay)]))).toEqual([]);
	});
});
