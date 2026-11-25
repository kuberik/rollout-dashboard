/** /rollouts?state= is a FILTER now (progress, waiting, held, rest: the list's own groups; see rollouts-filter.ts). Only `failing` has no group in the list
 *  (a failing rollout is in the banner or Attention), so an old /rollouts?state=failing link still lands on #attention; any other state words stay as a filter. */
import { redirect } from '@sveltejs/kit';
export const load = ({ url }: { url: URL }) => {
	const v = url.searchParams.get('state');
	if (v == null) return;
	const words = v.split(',').map((x) => x.trim()).filter(Boolean);
	if (!words.includes('failing')) return;
	const u = new URL(url);
	const left = words.filter((x) => x !== 'failing');
	if (left.length) u.searchParams.set('state', left.join(',')); else u.searchParams.delete('state');
	u.hash = 'attention';
	redirect(307, u.pathname + u.search + u.hash);
};
