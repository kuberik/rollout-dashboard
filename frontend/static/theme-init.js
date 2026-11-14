/*
 * Theme bootstrap, extracted from app.html so the page can ship a
 * Content-Security-Policy with script-src 'self' and no inline-script hash.
 * Still synchronous and blocking (a classic <script src> in <head>), so it
 * runs before first paint exactly as the inline version did. The demo flag
 * is read from <meta name="kuberik-demo"> (PUBLIC_DEMO is substituted into
 * app.html at build time; a static file cannot be).
 * See app.html for the full rationale.
 */
(function () {
	try {
		/*
			⭐ `?theme=light|dark` SETS THE THEME — DEMO BUILDS ONLY.
			(2026-09-12) The kuberik.com showcases need it: the landing is
			light everywhere, its iframes cannot reach inside the demo build
			to press the toggle, and a visitor whose OS is dark would
			otherwise get a dark dashboard inside a light page.

			⛔ AND IT IS GATED, BECAUSE IT PERSISTS. It writes the same key
			the toggle writes — which is the only thing that makes the choice
			survive the next navigation, since the query string does not — so
			on a REAL dashboard a shared link carrying `?theme=dark` would
			silently overwrite a colleague's saved preference, with no UI
			anywhere saying why their dashboard changed. That is a fine trade
			inside an iframe nobody owns and a bad one on the dashboard people
			live in. `PUBLIC_DEMO` is set only by `scripts/build-demo.sh`;
			everywhere else this replaces with an empty string and the whole
			branch is dead.
		*/
		var demoMeta = document.querySelector('meta[name="kuberik-demo"]');
		var demo = !!demoMeta && demoMeta.getAttribute('content') === '1';
		if (demo) {
			var forced = new URLSearchParams(location.search).get('theme');
			if (forced === 'light' || forced === 'dark') localStorage.setItem('theme', forced);
		}
		var stored = localStorage.getItem('theme');
		var prefersDark =
			window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
		var dark = stored ? stored === 'dark' : prefersDark;
		var html = document.documentElement;
		html.style.colorScheme = dark ? 'dark' : 'light';
		html.style.backgroundColor = dark ? 'oklch(0.195 0.014 222)' : 'oklch(0.975 0.004 222)';
		if (dark) html.classList.add('dark');
	} catch (e) {
		/* localStorage/matchMedia unavailable — fall back to the light shell. */
	}
})();
