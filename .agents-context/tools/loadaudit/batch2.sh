#!/bin/bash
W=$1
ROUTES="
home:/
rollouts:/rollouts
rd-overview:/rollouts/prod/hello-world-prod/hello-world-app
rd-history:/rollouts/prod/hello-world-prod/hello-world-app/history
rd-deps:/rollouts/prod/hello-world-prod/hello-world-app/dependencies
rd-logs:/rollouts/prod/hello-world-prod/hello-world-app/logs
apps:/apps
app-detail:/apps/hello-world-app
environments:/environments
env-prod:/envs/prod
revisions:/revisions
rev-detail:/revisions/github.com/littlechimera/kuberik-testing/064b655b5159
activity:/activity
dependencies:/dependencies
"
for line in $ROUTES; do
  k=${line%%:*}; u=${line#*:}
  node pair.mjs --url "https://127.0.0.1:5173$u" --w $W --tag "$k-$W" > "pair-$k-$W.txt" 2>&1
  echo "done $k-$W"
done
