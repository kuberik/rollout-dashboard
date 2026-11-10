import { SvelteMap } from 'svelte/reactivity';
export type HeldHere = { count: number; ids: Set<string>; waiting: number; stage: string | null };
/** per rollout (`cluster/ns/name`): the builds its hold refuses HERE, published by a page that fetched the rollout's detail. Until a rollout is
 *  published its count is UNKNOWN (null): a page shows its pending state, never a guess. */
const known = new SvelteMap<string, HeldHere>();
export const heldKey = (cluster: string | undefined, ns: string | undefined, name: string | undefined): string => `${cluster ?? ''}/${ns ?? ''}/${name ?? ''}`;
/** a rollout href (`/rollouts/<cluster>/<ns>/<name>`) -> its key */
export const heldKeyOfHref = (href: string): string | null => { const p = href.split('/').filter(Boolean); return p[0] === 'rollouts' && p.length >= 4 ? heldKey(p[1], p[2], p[3]) : null; };
const same = (a: HeldHere, b: HeldHere) => a.count === b.count && a.waiting === b.waiting && a.stage === b.stage && a.ids.size === b.ids.size && [...a.ids].every((x) => b.ids.has(x));
/** only a CHANGED answer is written: a page re-derives from this store, so an unconditional write would loop */
export const publishHeldHere = (key: string, v: HeldHere | null): void => { const cur = known.get(key); if (v && !(cur && same(cur, v))) known.set(key, v); };
export const heldHereOf = (key: string): HeldHere | null => known.get(key) ?? null;
