import { redirect } from '@sveltejs/kit';
/** r39 — "Needs you" became Home: 308 to "/" keeping the query (?calm=1, ?quiet=1, …). */
export const needsYouRedirect = (url: URL): string => `/${url.search}`;
export const load = ({ url }: { url: URL }) => {
	redirect(308, needsYouRedirect(url));
};
