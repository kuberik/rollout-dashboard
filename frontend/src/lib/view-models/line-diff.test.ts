import { describe, expect, it } from 'vitest';
import { changedSpan, lineDiff, type DiffLineRow } from './line-diff';

const OLD = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout-edge
spec:
  replicas: 4
  template:
    spec:
      containers:
        - name: checkout-edge
          image: ghcr.io/exampleco/checkout-edge:b7e0d41
          ports:
            - containerPort: 8080
`;
const NEW = OLD.replace('replicas: 4', 'replicas: 6').replace(':b7e0d41', ':d09e6f4');

const lines = (rows: ReturnType<typeof lineDiff>['rows']) =>
	rows.filter((r): r is DiffLineRow => r.type === 'line');

describe('lineDiff', () => {
	it('identical texts give no rows', () => {
		const d = lineDiff(OLD, OLD);
		expect(d.rows).toEqual([]);
		expect(d.add).toBe(0);
		expect(d.del).toBe(0);
	});

	it('counts additions and deletions', () => {
		const d = lineDiff(OLD, NEW);
		expect(d.add).toBe(2);
		expect(d.del).toBe(2);
	});

	it('opens every hunk with its own header row, git-formatted', () => {
		const d = lineDiff(OLD, NEW);
		expect(d.rows[0]).toMatchObject({ type: 'hunk', header: '@@ -3,11 +3,11 @@', oldStart: 3, newStart: 3 });
		expect(d.rows[0]).toMatchObject({ hiddenBefore: 2 });
	});

	it('numbers lines on both sides, and the single number is old on a deletion, new otherwise', () => {
		const rows = lines(lineDiff(OLD, NEW).rows);
		const del = rows.find((r) => r.kind === 'del' && r.text.includes('replicas'))!;
		const add = rows.find((r) => r.kind === 'add' && r.text.includes('replicas'))!;
		expect(del).toMatchObject({ oldNo: 6, newNo: null, no: 6 });
		expect(add).toMatchObject({ oldNo: null, newNo: 6, no: 6 });
		const ctx = rows.find((r) => r.kind === 'context' && r.text.includes('template'))!;
		expect(ctx).toMatchObject({ oldNo: 7, newNo: 7, no: 7 });
	});

	it('keeps the indentation in the text and measures it', () => {
		const rows = lines(lineDiff(OLD, NEW).rows);
		const img = rows.find((r) => r.kind === 'add' && r.text.includes('image'))!;
		expect(img.text).toBe('          image: ghcr.io/exampleco/checkout-edge:d09e6f4');
		expect(img.indent).toBe(10);
	});

	it('marks the changed token inside an edited line, widened to the whole sha', () => {
		const rows = lines(lineDiff(OLD, NEW).rows);
		const del = rows.find((r) => r.kind === 'del' && r.text.includes('image'))!;
		const add = rows.find((r) => r.kind === 'add' && r.text.includes('image'))!;
		expect(del.text.slice(...del.mark!)).toBe('b7e0d41');
		expect(add.text.slice(...add.mark!)).toBe('d09e6f4');
		const rd = rows.find((r) => r.kind === 'del' && r.text.includes('replicas'))!;
		expect(rd.text.slice(...rd.mark!)).toBe('4');
	});

	it('does not mark a pure addition', () => {
		const added = OLD.replace('          ports:\n', '          env:\n            - name: X\n          ports:\n');
		const rows = lines(lineDiff(OLD, added).rows);
		const adds = rows.filter((r) => r.kind === 'add');
		expect(adds.map((r) => r.text.trim())).toEqual(['env:', '- name: X']);
		expect(adds.every((r) => r.mark === null)).toBe(true);
	});

	it('reports the unchanged tail after the last hunk', () => {
		const long = OLD + Array.from({ length: 10 }, (_, i) => `  k${i}: v`).join('\n') + '\n';
		const longNew = long.replace('replicas: 4', 'replicas: 6');
		const d = lineDiff(long, longNew);
		expect(d.hiddenAfter).toBeGreaterThan(0);
	});

	it('handles a file that only exists on one side', () => {
		const d = lineDiff('', 'a: 1\nb: 2\n');
		expect(d.add).toBe(2);
		const rows = lines(d.rows);
		expect(rows.map((r) => r.no)).toEqual([1, 2]);
	});
});

describe('changedSpan', () => {
	it('is null when the lines share nothing worth singling out', () => {
		expect(changedSpan('  foo: 1', '  bar: 2')).toBeNull();
	});
	it('marks the middle when prefix and suffix are shared', () => {
		const s = changedSpan('LOG_LEVEL: info', 'LOG_LEVEL: debug')!;
		expect('LOG_LEVEL: info'.slice(...s.a)).toBe('info');
		expect('LOG_LEVEL: debug'.slice(...s.b)).toBe('debug');
	});
});
