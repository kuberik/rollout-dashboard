import { redirect } from '@sveltejs/kit';
import { needsYouRedirect } from '$lib/view-models/needs-you-redirect';
export const load = ({ url }: { url: URL }) => {
	redirect(308, needsYouRedirect(url));
};
