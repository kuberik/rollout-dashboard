/**
 * TEST-ONLY. A reactive stand-in for `$app/state`'s `page`, so a page test can
 * perform a CLIENT NAVIGATION on one mounted component: assign `params`/`url`
 * and the page's `$derived` reads of `page.params` re-evaluate, as in the app.
 * (The plain-object mocks other page tests use are not reactive, which is right
 * for them: they never navigate.)
 */
export const reactivePage = $state({
	params: {} as Record<string, string>,
	url: new URL('http://localhost/'),
	route: { id: null as string | null },
	status: 200,
	error: null as unknown,
	data: {} as Record<string, unknown>,
	form: null as unknown
});
