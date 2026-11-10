/** r3-filters: the state chips are gone, so an old /rollouts?state=failing,held link lands on the section that state lives in now
 *  (r39: #attention, #in-flight, #waiting, #held, #at-rest); other params (?calm=1) are kept. A redirect, so the old address never renders a page it cannot narrow. */
import { redirect } from '@sveltejs/kit';
const ANCHOR: Record<string, string> = { failing: 'attention', progress: 'in-flight', waiting: 'waiting', held: 'held', rest: 'at-rest' };
export const load = ({ url }: { url: URL }) => {
	const v = url.searchParams.get('state');
	if (v == null) return;
	const u = new URL(url);
	u.searchParams.delete('state');
	u.hash = v.split(',').map((x) => ANCHOR[x]).find(Boolean) ?? 'in-flight';
	redirect(307, u.pathname + u.search + u.hash);
};
