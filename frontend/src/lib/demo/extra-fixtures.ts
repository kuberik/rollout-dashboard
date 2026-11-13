/**
 * REGISTRATION HOOKS for opt-in mock fixtures (today: the release-switch apps). state.ts and deps-story.ts read them when they build
 * the fleet; the defaults return nothing, so the demo build and the normal bundle never reference a fixture's name. A fixture module
 * calls `setExtraFixtures` from its `install()`, which only the dev mock server's dynamic import ever runs (dev-mock-api.ts).
 */
type Obj = Record<string, unknown>;
let envs: () => Obj[] = () => [];
let rollouts: () => Obj[] = () => [];
export const setExtraFixtures = (h: { environments: () => Obj[]; rollouts: () => Obj[] } | null): void => {
	envs = h?.environments ?? (() => []);
	rollouts = h?.rollouts ?? (() => []);
};
export const extraEnvironments = (): Obj[] => envs();
export const extraRollouts = (): Obj[] => rollouts();
