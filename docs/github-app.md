# GitHub App for the dashboard

The dashboard signs users in to GitHub with a **GitHub App** so it can show what a deploy
actually changes: the commit list and diffstat between the running build and the one you
are about to deploy (the *Commits deployed* panel in Change Version, the commit links on
rollout detail and `/activity`). Every call is made **as the viewing user** — the app's
user-authorization flow, `pkg/githubapp` — so a person only ever sees history of repos
they can already read on GitHub.

Without it the dashboard runs fine; the navbar shows **Not configured** and those panels
say "GitHub is not configured for this dashboard".

This is separate from the `github-token` Secret the environment-controller uses for
GitHub Deployments. That one is a PAT per namespace; this one is app credentials on the
dashboard alone.

## 1. Create the app

GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App** (on the org
that owns your source repos, or on your user).

| Field | Value |
|---|---|
| GitHub App name | anything, e.g. `kuberik-dashboard` |
| Homepage URL | `https://<hub-host>` |
| Callback URL | `https://<hub-host>/api/auth/github/callback` |
| Expire user authorization tokens | **unchecked** — the dashboard stores a non-expiring user token in an httpOnly cookie and does not refresh |
| Request user authorization (OAuth) during installation | optional |
| Webhook | **Active unchecked** — the dashboard receives no webhooks |
| Repository permissions | **Contents: Read-only** (commit compare), **Metadata: Read-only** (added automatically) |
| Where can this GitHub App be installed? | *Only on this account* is enough for one org |

`<hub-host>` is the host the browser loads the UI from. In a multi-cluster setup only the
**hub** needs the callback and the credentials — spokes redirect the browser to the hub
and the hub proxies their `/api` calls with the user's cookie.

## 2. Install it

On the app's page: **Install App** → pick the org/user → *All repositories* or the repos
your rollouts are built from. A user who is not a member of that org (or lacks read
access to a repo) gets an empty commit list with an explanation, never someone else's
history.

## 3. Get the credentials

On the app's **General** page:

- **Client ID** — shown at the top (`Iv23…`). It is public.
- **Client secret** — **Generate a new client secret**. GitHub shows it once.

The `.pem` private key is *not* needed by the dashboard.

## 4. Give them to the dashboard

The dashboard reads `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET` from its
environment; the manifests in `deploy/base` source both from a Secret named
`github-app-credentials` (marked optional, so the dashboard starts without it):

```bash
kubectl -n kuberik-system create secret generic github-app-credentials \
  --from-literal=clientId='<client id>' \
  --from-literal=clientSecret='<client secret>' \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n kuberik-system rollout restart deploy/rollout-dashboard
```

Hub cluster only. Spokes need nothing.

### Local dev clusters

Put both in `rollout-dashboard/.env` (gitignored):

```
GITHUB_APP_CLIENT_ID=Iv23…
GITHUB_APP_CLIENT_SECRET=…
```

`scripts/setup-dev-environment.sh` (and `setup-multi-cluster-dev.sh`, which calls it)
sources that file and creates the Secret on every setup. If the file is missing the
script prints `skipping github-app-credentials Secret` and the dashboard reports
**Not configured** — that line in the setup log is the thing to look for.

## 5. Verify

```bash
curl -sk https://<hub-host>/api/auth/github/status
# {"configured":true,"connected":false}
```

The navbar switches from **Not configured** to **Connect GitHub**. After signing in it
shows your GitHub login; the *Commits deployed* panel fills on the next Change Version.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Navbar says **Not configured** (click it for the sentence) | env vars empty: the Secret is missing, in the wrong namespace, or the pod predates it — restart the deployment |
| GitHub says `redirect_uri is not associated with this application` | Callback URL on the app ≠ `https://<hub-host>/api/auth/github/callback` (scheme and host must match exactly) |
| Signed in, but "you don't have access" on a rollout's commits | the app is not installed on that repo, or your GitHub user cannot read it |
| Signed in yesterday, **Connect GitHub** again today | the token was revoked (app uninstalled, secret rotated, or *Expire user authorization tokens* is on) |
