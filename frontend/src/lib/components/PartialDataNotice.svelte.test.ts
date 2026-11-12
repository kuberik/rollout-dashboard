import { test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import PartialDataNotice from './PartialDataNotice.svelte';

const raw = 'Get "https://10.0.0.5:6443/api": dial tcp: i/o timeout';
const entry = (extra: Record<string, unknown>) => ({ url: 'https://prod', name: 'prod', error: raw, ...extra }) as never;

test('a fully typed entry prints its words and not the raw server text', () => {
	render(PartialDataNotice, { props: { errors: [entry({ kind: 'rejected', status: 403 })] } });
	expect(screen.getByText(/prod refused the hub \(HTTP 403\)\./)).toBeInTheDocument();
	expect(screen.queryByText(raw)).toBeNull();
});

test('an entry whose typed words name no cause keeps the raw text beneath them', () => {
	render(PartialDataNotice, { props: { errors: [entry({ kind: 'bad_answer' })] } });
	expect(screen.getByText(/prod answered with something the dashboard could not read\./)).toBeInTheDocument();
	expect(screen.getByText(raw)).toBeInTheDocument();
});
