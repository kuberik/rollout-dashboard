/**
 * The mock API's scenario, chosen from the page URL (r39). `?scenario=calm|quiet|incident` (and the old lens spellings `?calm=1`, `?quiet=1`) set a
 * cookie the dev mock server reads on every request (dev-mock-api.ts), then the page reloads once so every query re-reads under it. It does nothing
 * on a real backend (the cookie is ignored), and nothing without one of those params. The cookie is sticky so in-app navigation keeps the scenario.
 */
const NAME = 'kuberik_scenario';

/** the scenario a URL asks for ('incident' | 'calm' | 'quiet'), null when it asks for none */
export function scenarioParam(url: URL): 'incident' | 'calm' | 'quiet' | null {
	const v = url.searchParams.get('scenario')?.replace(/^home-/, '');
	if (v === 'incident' || v === 'calm' || v === 'quiet') return v;
	if (url.searchParams.get('quiet') === '1') return 'quiet';
	if (url.searchParams.get('calm') === '1') return 'calm';
	return null;
}

/** browser only: write the cookie when the URL asks for a scenario that differs from it, and reload once */
export function syncMockScenario(url: URL): void {
	if (typeof document === 'undefined') return;
	const want = scenarioParam(url);
	if (!want) return;
	const have = new RegExp(`(?:^|;\\s*)${NAME}=([^;]+)`).exec(document.cookie)?.[1] ?? null;
	if (have === want) return;
	document.cookie = `${NAME}=${want}; path=/; max-age=86400; samesite=lax`;
	location.reload();
}
