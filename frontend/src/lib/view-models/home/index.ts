/**
 * `$lib/view-models/home` — the Home page's data, pure and tested.
 *
 *   const model = buildHomeModel({ changes, rollouts, environments,
 *     rolloutDependencies, kustomizations, kruiseRollouts, me, now, starredApps });
 *   const home = buildLumenHome(model, now, { starredApps });
 *
 * `home` is everything the route draws; the route derives nothing.
 */
export { buildHomeModel } from '../home-model';
export type {
	HomeModel,
	HomeModelInput,
	AppModel,
	AppEnv,
	EnvChange,
	EnvState,
	HoldReason,
	NeedsYouEntry,
	Signal
} from '../home-model';
export type { SignalFacts } from '../fleet-signals';
export { buildLumenHome, watchSub, WATCH_SHOWN } from './lumen';
export type {
	LumenHome,
	LumenOptions,
	LumenStatus,
	LumenTotals,
	WatchLine,
	OtherLine,
	RollingLine,
	QuietApp,
	LandedChange,
	LandedGroup,
	AppFlights,
	Flight,
	LiveChange,
	Tier,
	Kind,
	Need,
	WatchFacts
} from './lumen';
export { TIERS } from './lumen-model';
