import { describe, expect, test } from 'vitest';
import { distinctRevisions, rowsFromDistinct } from './history-commit-rows';

describe('history commit rows', () => {
	test('a rollback revision is asked for once and answers both rows', () => {
		const rows = ['c3', 'b2', 'c3', 'a1', undefined, ''];
		const distinct = distinctRevisions(rows);
		expect(distinct).toEqual(['c3', 'b2', 'a1']);
		const out = rowsFromDistinct(rows, distinct, [{ data: 'C' }, { data: 'B' }, { data: 'A' }]);
		expect(out.map((r) => r.data)).toEqual(['C', 'B', 'C', 'A', undefined, undefined]);
	});

	test('fewer results than revisions (still loading) leaves the rest empty', () => {
		const out = rowsFromDistinct(['x', 'y'], ['x', 'y'], [{ data: 1 }]);
		expect(out.map((r) => r.data)).toEqual([1, undefined]);
	});
});
