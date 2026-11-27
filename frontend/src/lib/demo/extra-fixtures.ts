/**
 * REGISTRATION HOOKS for opt-in mock fixtures (today: the release-switch apps). state.ts and deps-story.ts read them when they build
 * the fleet; the defaults return nothing, so the demo build and the normal bundle never reference a fixture's name. A fixture module
 * calls `setExtraFixtures` from its `install()`, which only the dev mock server's dynamic import ever runs (dev-mock-api.ts).
 */
type Obj = Record<string, unknown>;
type Hook = { environments: () => Obj[]; rollouts: () => Obj[]; /** RolloutDependency objects the fixture set adds to the hub's `rolloutDependencies` (rollback-deps) */ dependencies?: () => Obj[]; /** re-stamp a cached rollout's times to the moment of THIS read (health-failures: every time is relative to the request) */ restamp?: (r: Obj) => void };
/** one slot per opt-in fixture set (`release-switch`, `health-failures`), so both can be on together */
const hooks = new Map<string, Hook>();
export const setExtraFixtures = (key: string, h: Hook | null): void => {
	if (h) hooks.set(key, h);
	else hooks.delete(key);
};
export const extraEnvironments = (): Obj[] => [...hooks.values()].flatMap((h) => h.environments());
export const restampExtra = (r: Obj): void => void hooks.forEach((h) => h.restamp?.(r));
export const extraDependencies = (): Obj[] => [...hooks.values()].flatMap((h) => h.dependencies?.() ?? []);
export const extraRollouts = (): Obj[] => [...hooks.values()].flatMap((h) => h.rollouts());

/** rollouts whose `Failed` head must survive the scenario heal (`healRolloutFailures`): the health-failures cases ARE the failure */
const kept = new Set<string>();
export const keepFailed = (ns: string, name: string, on: boolean): void => void (on ? kept.add(`${ns}/${name}`) : kept.delete(`${ns}/${name}`));
export const isKeptFailed = (ns?: string, name?: string): boolean => kept.has(`${ns}/${name}`);

/** opt-in HealthCheck answers (health-failures): per rollout, and the fleet the fleet health-check list endpoint; both undefined unless a fixture set installs them */
type HcHooks = { one: (ns: string, name: string) => Obj | undefined; fleet: () => Obj };
let hcHooks: HcHooks | null = null;
export const setExtraHealthChecks = (h: HcHooks | null): void => void (hcHooks = h);
export const extraHealthChecks = (ns: string, name: string): Obj | undefined => hcHooks?.one(ns, name);
export const extraFleetHealthChecks = (): Obj | undefined => hcHooks?.fleet();

/** opt-in answer to GET /api/rollouts/:ns/:name/rollback-check?tag=: the dependencies a rollback to `tag` would break (rollback-deps); undefined unless a fixture set installs it */
type RollbackCheck = (ns: string, name: string, tag: string) => { breaks: Obj[]; hiddenConsumers?: number } | undefined;
let rollbackCheck: RollbackCheck | null = null;
export const setExtraRollbackCheck = (f: RollbackCheck | null): void => void (rollbackCheck = f);
export const extraRollbackCheck = (ns: string, name: string, tag: string): { breaks: Obj[]; hiddenConsumers?: number } | undefined => rollbackCheck?.(ns, name, tag);
