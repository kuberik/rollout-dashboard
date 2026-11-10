/**
 * r42 VISUAL ATOMS (owner-picked 2026-11-08): the check-timer pie + step pie (StatusMark progress), the region meter on
 * approval cards, and the lead bar on landed changes draw on every product page from live data. This context is only
 * the gallery's switch: /design/atoms renders the "today" copy under an empty scope. The error-rate trend spark was
 * not picked and is gone.
 */
import { getContext, setContext } from 'svelte';
import { liveProgress } from './atoms-live.svelte';

export type Atoms = {
	/** keyed `ns/name`: progress fraction + the row's "N min left" */
	progress?: Map<string, { fraction: number; words: string | null }>;
	regions?: boolean;
	lead?: boolean;
};
const KEY = Symbol.for('kuberik-r42-atoms');
export const setAtoms = (a: Atoms): Atoms => setContext(KEY, a);
/** no context = the product default (all picked atoms on); `{}` = the gallery's "today" (all off) */
export const atoms = (): Atoms =>
	getContext<Atoms | undefined>(KEY) ?? { regions: true, lead: true, get progress() { return liveProgress(); } };
