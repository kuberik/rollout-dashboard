# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```bash
# create a new project in the current directory
npx sv create

# create a new project in my-app
npx sv create my-app
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```bash
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```bash
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

## Dev-only GitHub auth (`GITHUB_DEV_TOKEN`)

The GitHub-backed endpoints (`/api/github/...`, the commits panel on rollout
detail) read the viewing user's GitHub access token from a `gh_token`
cookie, normally set by the real OAuth round-trip at
`/api/auth/github/login`. That flow needs a registered callback URL and a
browser redirect, which is friction for a dev loop that just wants to see a
GitHub-backed page render.

Set `GITHUB_DEV_TOKEN` to a personal access token (or a GitHub App user
token you've minted once by hand) before starting `npm run dev`, and
`dev-auth.ts`'s Vite plugin appends `Cookie: gh_token=<token>` to every
proxied `/api` request — never `/oauth2`, which is the unrelated OIDC login
flow this same plugin already impersonates. The dashboard backend then reads
it exactly as it would a real OAuth-issued cookie; no dev-mode branch exists
anywhere else in the app.

```bash
GITHUB_DEV_TOKEN=ghp_xxx npm run dev
```

Unset by default — nothing changes for a `GITHUB_DEV_TOKEN`-less `npm run
dev`. See `dev-auth.ts`'s own header comment for the exact mechanics.

## The demo build (`/demo/`, embedded by kuberik.com)

`scripts/build-demo.sh` produces a static dashboard that runs entirely in the
browser on mock data, with **no backend, no cluster, no login and no GitHub**.
kuberik.com's landing page serves it under `/demo/` and embeds it in an iframe
per showcase, so the "interactive showcase" on the front page is the real
dashboard rather than a screenshot.

```bash
# builds into frontend/build-demo, then copies it to ../../website/static/demo
./scripts/build-demo.sh
```

Three things make it work, and nothing else about the app changes:

- **The mock is a module, not a server.** `src/lib/demo/mock-data.ts` holds the
  fixtures and `src/lib/demo/respond.ts` maps a request line to a JSON body or
  a stream. `dev-mock-api.ts` (the `MOCK_API=1 vite dev` middleware) and
  `src/lib/demo/install.ts` (the demo build's `fetch` shim) are two thin
  adapters over that one routing table — change a fixture once and both move.
  The shim covers SSE too: `eventsource-client` reads `globalThis.fetch`, so a
  `Response` with a `ReadableStream` body *is* an event stream to it.
- **`VITE_DEMO=1`** makes `src/hooks.client.ts` install that shim before the
  router starts. In a normal build the flag is a build-time literal, the branch
  is unreachable, and Rollup drops the fixtures entirely — verified: no fixture
  string appears in `build/`.
- **`DEMO_BASE=/demo`** sets `paths.base`, so every asset and route resolves
  under the sub-path. GitHub Pages cannot rewrite `/demo/rollouts/...` to
  `index.html`, so each showcase opens **`/demo/?page=<app path>`** and the
  root layout's `load` redirects before anything renders.

### The embed contract

On mount, the demo build sets exactly this and nothing more:

```ts
window.kuberikDemo = { goto(path: string): Promise<void>, ready: Promise<void> }
window.parent.postMessage({ type: 'kuberik-demo-ready' }, '*')   // once
```

`goto` takes an app path without the base. The parent is same-origin, so it
reads the iframe's DOM itself to place tour hotspots — that is deliberate, and
the reason there is no hotspot API here.

`?theme=light` / `?theme=dark` on any dashboard URL (not just the demo) sets
the theme the same way the toggle does, before the first paint.
