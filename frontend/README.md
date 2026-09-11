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
