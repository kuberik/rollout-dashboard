import { describe, it, expect } from 'vitest';
import { isReportableStreamError } from './logs';

describe('isReportableStreamError', () => {
	it('is silent once the stream is closed (navigation abort)', () => {
		expect(isReportableStreamError(true)).toBe(false);
	});
	it('reports failures on a live stream', () => {
		expect(isReportableStreamError(false)).toBe(true);
	});
});
