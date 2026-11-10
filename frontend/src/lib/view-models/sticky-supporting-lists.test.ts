import { it, expect } from 'vitest';
import { stickyList } from './sticky-supporting-lists';
it('an empty list after a populated one keeps the populated one while rollouts exist', () => {
	expect(stickyList(['kr'], [], true)).toEqual(['kr']);
});
it('a populated list wins; with no rollouts, or nothing before, empty stays empty', () => {
	expect(stickyList(['a'], ['b'], true)).toEqual(['b']);
	expect(stickyList(['kr'], [], false)).toEqual([]);
	expect(stickyList(null, [], true)).toEqual([]);
});
