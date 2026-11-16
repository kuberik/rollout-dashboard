/** The Deployment pipeline card's header dot follows the place: a failure whose checks are all OK again draws the recovered ring; the step marks keep the step history. */
import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const s = readFileSync(resolve(__dirname, 'DeploymentPipelineCard.svelte'), 'utf8');
const header = s.slice(s.indexOf('{#if summary.failed > 0 && headerRecovered}'), s.indexOf('<h2 class="t-card-title text-fg">Deployment pipeline</h2>'));

it('the header dot draws the recovered ring when the head failure recovered, the solid failed mark otherwise', () => {
	expect(s).toMatch(/headerRecovered = \$derived\(bakeIsFailed && healthChecks\.length > 0 && allHCHealthy && !hcUnknown\)/);
	expect(header).toMatch(/<StatusMark state="failed" recovered \/>/);
	expect(header).toMatch(/ExclamationCircleSolid class="h-4 w-4 text-danger"/);
	expect(header.indexOf('headerRecovered')).toBeLessThan(header.indexOf('ExclamationCircleSolid'));
});
it('only the header follows: the step marks still draw the step failure', () => {
	expect(s.match(/headerRecovered/g)?.length).toBe(2);
});
