/**
 * THE WAVES STORY, STEPPED. (2026-11-12.)
 *
 * `hello-waves-app` (FIXTURE E in mock-data.ts) walks change c6f19d2 (exampleco/hello-waves PR #21,
 * "Cache region config at startup") across its sites, one synchronous beat per call, the same shape
 * as `/api/demo/deps?step=` (no timers, so a capture script drives beat -> screenshot -> beat):
 *
 *   arm         dev Succeeded on c6f19d2; staging runs it, baking ("checking"); every prod site on 0f1f88a.
 *               Prod is HELD by its promotion gate (the gate reads staging's Succeeded history, which
 *               does not have c6f19d2 yet) -- computed from the topology, no extra fixture.
 *   staging     staging Succeeded on c6f19d2; prod untouched.
 *   wave1       prod eu-west-1 (leader) baking c6f19d2, us-east-1 (follower) Deploying it, ap-south-1 on 0f1f88a.
 *   wave1-done  eu-west-1 + us-east-1 Succeeded; ap-south-1 (wave 2) still on 0f1f88a.
 *   wave2       ap-south-1 baking c6f19d2.
 *   done        every site Succeeded on c6f19d2.
 *
 * Any beat may be fired in any order. Until one is, the calm/incident/wide scenario rules are
 * untouched; `/api/demo/reset` clears the story (back to the scenario). `?step` omitted reports the beat.
 */
import { HWV_BEATS, HWV_PLACES, setHwvBeat, type HwvBeat } from './mock-data';

export const WAVES_STEPS = HWV_BEATS;
export type WavesStep = HwvBeat;

let at: WavesStep | null = null;
export const wavesStoryStep = (): WavesStep | null => at;
export function resetWavesStory(): void {
	at = null;
	setHwvBeat(null);
}
export function setWavesStep(step: WavesStep): void {
	at = step;
	setHwvBeat(step);
}
/** The (namespace, cluster) of every place a beat can move. */
export const wavesPlaces = () => HWV_PLACES.map((p) => ({ namespace: p.ns, cluster: p.cluster }));
