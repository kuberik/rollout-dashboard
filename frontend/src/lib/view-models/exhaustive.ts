/**
 * Compile-time exhaustiveness for switches and maps over a closed union (NodeState, ToneState, ...).
 * Put it in the `default` branch: `default: return exhaustive(state, 'fallback')`. When a member is added to the union and a
 * switch is not updated, `state` is no longer `never` there and svelte-check fails, instead of the new state quietly
 * falling through to the last branch (a paused bake drawn as the done dot). At run time it returns the fallback.
 */
export function exhaustive<T>(_unhandled: never, fallback: T): T {
	return fallback;
}
