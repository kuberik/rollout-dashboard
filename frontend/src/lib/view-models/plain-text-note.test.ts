import { describe, expect, it } from 'vitest';
import { stripEmphasisMarkers } from './plain-text-note';

describe('stripEmphasisMarkers', () => {
	it('strips single-asterisk emphasis', () => {
		expect(stripEmphasisMarkers('*Automatic deployment*')).toBe('Automatic deployment');
	});

	it('strips double-asterisk (bold) emphasis', () => {
		expect(stripEmphasisMarkers('**urgent**')).toBe('urgent');
	});

	it('strips single-underscore emphasis', () => {
		expect(stripEmphasisMarkers('_deploy now_')).toBe('deploy now');
	});

	it('strips double-underscore emphasis', () => {
		expect(stripEmphasisMarkers('__deploy now__')).toBe('deploy now');
	});

	it('strips mixed markers in one string', () => {
		expect(stripEmphasisMarkers('Mixed *italic* and **bold**')).toBe('Mixed italic and bold');
	});

	it('never touches an identifier with underscores', () => {
		expect(stripEmphasisMarkers('Bump snake_case_variable name')).toBe('Bump snake_case_variable name');
	});

	it('leaves plain text untouched', () => {
		expect(stripEmphasisMarkers('Warm the edge cache before the region cutover')).toBe(
			'Warm the edge cache before the region cutover'
		);
	});

	it('passes through empty and nullish input', () => {
		expect(stripEmphasisMarkers('')).toBe('');
		// @ts-expect-error — defensive: some callers pass a possibly-undefined field
		expect(stripEmphasisMarkers(undefined)).toBe(undefined);
	});
});
