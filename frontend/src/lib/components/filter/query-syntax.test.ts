import { describe, it, expect } from 'vitest';
import { parseText, spell, contextAt, applyKey, applyValue, tokenize, type SyntaxDef, type Known } from './query-syntax';
import type { FilterQuery } from './filter-model';

const defs: SyntaxDef[] = [
	{ key: 'state', label: 'State', values: ['progress', 'waiting', 'held', 'rest'], slug: (v) => ({ progress: 'in-flight', rest: 'at-rest' } as Record<string, string>)[v] ?? v, aliases: { moving: 'progress' } },
	{ key: 'env', label: 'Environment' },
	{ key: 'ns', label: 'Namespace' }
];
const known: Known = { env: ['prod', 'dev'], ns: ['payments', 'billing-dev', 'my ns'] };

describe('parseText', () => {
	it('key:value, any-of, negation, free words', () => {
		const { query } = parseText('state:held,in-flight -ns:payments env:prod api server', defs, known);
		expect(query).toEqual({ q: 'api server', clauses: [{ key: 'state', op: 'is', values: ['held', 'progress'] }, { key: 'ns', op: 'not', values: ['payments'] }, { key: 'env', op: 'is', values: ['prod'] }] });
	});
	it('aliases, case, quoted values', () => {
		expect(parseText('STATE:Moving ns:"my ns"', defs, known).query.clauses).toEqual([{ key: 'state', op: 'is', values: ['progress'] }, { key: 'ns', op: 'is', values: ['my ns'] }]);
	});
	it('unknown key and unknown value stay in the text, are marked, and are not applied', () => {
		const p = parseText('foo:bar ns:nope env:prod', defs, known);
		expect(p.query.clauses).toEqual([{ key: 'env', op: 'is', values: ['prod'] }]);
		expect(p.tokens[0]!.problem).toMatch(/No filter/);
		expect(p.tokens[1]!.problem).toBe('No namespace named “nope”');
	});
	it('the token being typed is judged leniently', () => {
		const t = 'ns:pay';
		expect(parseText(t, defs, known, 6).tokens[0]!.problem).toBeUndefined();
		expect(parseText(t, defs, known, 6).query.clauses).toEqual([]);
		expect(parseText('ns:payments', defs, known, 11).query.clauses).toEqual([{ key: 'ns', op: 'is', values: ['payments'] }]);
	});
	it('the same key with the other operator conflicts', () => {
		const p = parseText('env:prod -env:dev env:dev', defs, known);
		expect(p.query.clauses).toEqual([{ key: 'env', op: 'is', values: ['prod', 'dev'] }]);
		expect(p.tokens[1]!.problem).toMatch(/Conflicts/);
	});
});
describe('spell', () => {
	it('round-trips', () => {
		const q: FilterQuery = { q: 'api', clauses: [{ key: 'state', op: 'is', values: ['held', 'progress'] }, { key: 'ns', op: 'not', values: ['my ns', 'payments'] }] };
		const text = spell(q, defs);
		expect(text).toBe('state:held,in-flight -ns:"my ns",payments api');
		expect(parseText(text, defs, known).query).toEqual(q);
	});
	it('empty is empty', () => expect(spell({ q: '', clauses: [] }, defs)).toBe(''));
});
describe('contextAt + edits', () => {
	it('empty token = keys; after colon = values', () => {
		expect(contextAt('', 0, defs, known)).toMatchObject({ mode: 'key', prefix: '' });
		expect(contextAt('state:held ', 11, defs, known)).toMatchObject({ mode: 'key', prefix: '' });
		expect(contextAt('ns:pay', 6, defs, known)).toMatchObject({ mode: 'value', key: 'ns', fragment: 'pay' });
		expect(contextAt('foo:x', 5, defs, known).mode).toBe('badkey');
	});
	it('accepting a key and a value', () => {
		const k = contextAt('-ns', 3, defs, known);
		expect(k.mode).toBe('key');
		expect(applyKey('-ns', k as never, 'ns')).toEqual({ text: '-ns:', caret: 4 });
		const v = contextAt('env:prod ns:pay', 15, defs, known) as never;
		expect(applyValue('env:prod ns:pay', v, 'payments')).toEqual({ text: 'env:prod ns:payments ', caret: 21 });
		const m = contextAt('ns:payments,bi', 14, defs, known) as never;
		expect(applyValue('ns:payments,bi', m, 'billing-dev')).toEqual({ text: 'ns:payments,billing-dev ', caret: 24 });
	});
	it('tokenize offsets', () => {
		const t = tokenize('-ns:a,b x', defs, known);
		expect(t.map((x) => [x.start, x.end, x.kind])).toEqual([[0, 7, 'qual'], [8, 9, 'word']]);
	});
});
