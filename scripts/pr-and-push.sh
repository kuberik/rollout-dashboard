#!/bin/bash
# Produce real, merged (and one deliberately open) pull requests on the
# kuberik-testing example repos, so the dashboard's PR view has real PRs to
# show instead of a history of direct pushes.
#
# Each iteration: branch off the default branch, make one small real code
# change in the relevant service dir, commit with a conventional message,
# push, `gh pr create`, merge it (squash/merge/rebase, rotating through all
# three strategies), then build+push images/manifests from the MERGE COMMIT
# exactly as build-and-push.sh does for its own "Add patchN" commits -
# revision = merge sha, version = short sha (or, for hello-dep, the next
# semver contract triple).
#
# Reuses build-and-push.sh's build/annotate functions via scripts/lib/build.sh
# rather than duplicating them. build-and-push.sh itself is untouched.
#
# Usage:
#   scripts/pr-and-push.sh [count] [REPO_SUFFIX]
#
#   count        - how many PRs to create this run (default 3)
#   REPO_SUFFIX  - kuberik-testing (default) | kuberik-testing-second
#
# On REPO_SUFFIX=kuberik-testing the PRs cycle through a fixed plan so the
# three merge strategies and the hello-dep hold/satisfy pair all appear:
#   1. hello-world change            --squash
#   2. hello-multi change            --merge   (real merge commit)
#   3. hello-dep: advance hello-api  --rebase  (satisfies the current hold)
#   4. hello-dep: advance frontend   --squash  (reintroduces a newer hold)
#   5. hello-world change            left OPEN, never merged
# Pass count=5 to run the whole plan; count=3 (default) stops after the
# strategy trio. START (env var, default 1) selects which plan step to begin
# at, so a second run can pick up steps 4-5 with `START=4 count=2`.
#
# On any other REPO_SUFFIX the plan is N copies of a hello-second change,
# cycling squash/merge/rebase, all merged.
#
# Env vars:
#   PR_WORKDIR     - scratch dir for the persistent checkout (default
#                    /tmp/claude/pr/data)
#   START          - 1-indexed plan step to start at (default 1)
#   KIND_CLUSTER_NAME - which kind cluster to `kind load docker-image` into
#                    (default rollout-dev, same default as build-and-push.sh)
set -eEuo pipefail
set -x

count=${1:-3}
REPO_SUFFIX=${2:-kuberik-testing}
START=${START:-1}

SCRIPT_DIR=$(realpath "$(dirname "$0")")
PROJECT_ROOT=$(dirname "$SCRIPT_DIR")
# shellcheck source=lib/build.sh
source "$SCRIPT_DIR/lib/build.sh"

GITHUB_USER=$(gh api user --jq .login | tr '[:upper:]' '[:lower:]')
REPO_NAME="${GITHUB_USER}/${REPO_SUFFIX}"
REGISTRY="ghcr.io/${GITHUB_USER}"
ENVIRONMENTS="dev staging prod"

# The identity that shows up as the PR/commit author. gh is logged in as
# LittleChimera; use that account's own name/email rather than whatever the
# host's global git config happens to say, and set it LOCALLY to this
# checkout only (never touches ~/.gitconfig).
AUTHOR_NAME=$(gh api user --jq .name)
AUTHOR_EMAIL=$(gh api user --jq .email)

docker_login
ensure_repo "$REPO_NAME"

WORKDIR=${PR_WORKDIR:-/tmp/claude/pr/data}
CHECKOUT="$WORKDIR/checkout-${REPO_SUFFIX}"
mkdir -p "$WORKDIR"

if [ ! -d "$CHECKOUT/.git" ]; then
    gh repo clone "$REPO_NAME" "$CHECKOUT"
fi
cd "$CHECKOUT"
git config user.name "$AUTHOR_NAME"
git config user.email "$AUTHOR_EMAIL"

DEFAULT_BRANCH=$(gh repo view "$REPO_NAME" --json defaultBranchRef -q .defaultBranchRef.name)
git fetch origin "$DEFAULT_BRANCH"
git checkout "$DEFAULT_BRANCH"
git reset --hard "origin/$DEFAULT_BRANCH"

# --- per-service edit functions -------------------------------------------
# Each sets PR_TITLE / PR_BODY / COMMIT_MSG and makes exactly one small real
# change to the service's ConfigMap-embedded script.

edit_hello_world() {
    local f="app/base/resources.yaml"
    # Add a response header so callers can see which version answered without
    # parsing the body.
    sed -i '/self.send_header("Content-type", "text\/plain")$/{
        /X-App-Version/!{
            N
            s/self.send_header("Content-type", "text\/plain")\n\(.*\)self.end_headers()/self.send_header("Content-type", "text\/plain")\n\1self.send_header("X-App-Version", VERSION)\n\1self.end_headers()/
        }
    }' "$f"
    grep -q 'X-App-Version' "$f"
    COMMIT_MSG="feat(hello-world): add X-App-Version response header"
    PR_TITLE="feat(hello-world): add X-App-Version response header"
    PR_BODY="Adds an X-App-Version response header to hello-python so callers can check the serving version without parsing the body."
}

edit_hello_multi() {
    local f="multi/app/base/resources.yaml"
    python3 - "$f" <<'EOF'
import sys
path = sys.argv[1]
with open(path) as fh:
    text = fh.read()
old = '''    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-type", "text/plain")
            self.end_headers()
            self.wfile.write(f"Hello from {ROLE}!\\nVersion: {VERSION}\\n".encode())'''
new = '''    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/healthz":
                self.send_response(200)
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-type", "text/plain")
            self.end_headers()
            self.wfile.write(f"Hello from {ROLE}!\\nVersion: {VERSION}\\n".encode())'''
assert old in text, "hello-multi handler shape changed, update pr-and-push.sh"
text = text.replace(old, new, 1)
with open(path, "w") as fh:
    fh.write(text)
EOF
    grep -q '/healthz' "$f"
    COMMIT_MSG="feat(hello-multi): add /healthz endpoint"
    PR_TITLE="feat(hello-multi): add /healthz endpoint"
    PR_BODY="Adds a fast /healthz path to hello-api/hello-worker that skips the hello response body, for use as a cheaper readiness check."
}

edit_dep_api() {
    local f="dep/app/base/resources.yaml"
    python3 - "$f" <<'EOF'
import sys
path = sys.argv[1]
with open(path) as fh:
    text = fh.read()
old = '''    def upstream_state():
        """Report what the provider we depend on is currently serving."""
        if not UPSTREAM:
            return None
        try:
            with urllib.request.urlopen(UPSTREAM, timeout=2) as response:
                return json.loads(response.read().decode())
        except (urllib.error.URLError, ValueError, OSError) as err:
            return {"error": str(err)}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            body = {'''
new = '''    UPSTREAM_TIMEOUT = float(os.environ.get("UPSTREAM_TIMEOUT", "2"))

    def upstream_state():
        """Report what the provider we depend on is currently serving."""
        if not UPSTREAM:
            return None
        try:
            with urllib.request.urlopen(UPSTREAM, timeout=UPSTREAM_TIMEOUT) as response:
                return json.loads(response.read().decode())
        except (urllib.error.URLError, ValueError, OSError) as err:
            return {"error": str(err)}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/healthz":
                self.send_response(200)
                self.end_headers()
                return
            body = {'''
assert old in text, "hello-dep handler shape changed, update pr-and-push.sh"
text = text.replace(old, new, 1)
with open(path, "w") as fh:
    fh.write(text)
EOF
    grep -q '/healthz' "$f"
    COMMIT_MSG="feat(api): add /healthz timeout"
    PR_TITLE="feat(api): add /healthz timeout"
    PR_BODY="Adds a fast /healthz path to hello-api that skips the upstream check, plus an UPSTREAM_TIMEOUT env var so the upstream probe timeout is tunable instead of hardcoded."
}

edit_dep_frontend() {
    local f="dep/app/base/resources.yaml"
    python3 - "$f" <<'EOF'
import sys
path = sys.argv[1]
with open(path) as fh:
    text = fh.read()
old = '''    def upstream_state():
        """Report what the provider we depend on is currently serving."""
        if not UPSTREAM:
            return None
        try:
            with urllib.request.urlopen(UPSTREAM, timeout=UPSTREAM_TIMEOUT) as response:
                return json.loads(response.read().decode())
        except (urllib.error.URLError, ValueError, OSError) as err:
            return {"error": str(err)}'''
new = '''    def upstream_state():
        """Report what the provider we depend on is currently serving.

        Retries once: a single dropped connection or 502 from a rolling
        upstream shouldn't flip the frontend's own health check.
        """
        if not UPSTREAM:
            return None
        last_err = None
        for _attempt in range(2):
            try:
                with urllib.request.urlopen(UPSTREAM, timeout=UPSTREAM_TIMEOUT) as response:
                    return json.loads(response.read().decode())
            except (urllib.error.URLError, ValueError, OSError) as err:
                last_err = err
        return {"error": str(last_err)}'''
assert old in text, "hello-dep upstream_state shape changed (expected edit_dep_api to have landed first), update pr-and-push.sh"
text = text.replace(old, new, 1)
with open(path, "w") as fh:
    fh.write(text)
EOF
    grep -q 'Retries once' "$f"
    COMMIT_MSG="fix(frontend): retry on 502"
    PR_TITLE="fix(frontend): retry on 502"
    PR_BODY="hello-frontend's upstream check now retries once before reporting an error, so a single transient 502/dropped connection from a rolling hello-api doesn't flip the frontend's own reported health."
}

edit_hello_world_bump() {
    local f="app/base/app.env"
    echo "timestamp=date:$(date +%s)" > "$f"
    COMMIT_MSG="chore(hello-world): bump base image"
    PR_TITLE="chore(hello-world): bump base image"
    PR_BODY="Routine base image bump for hello-world. Left open deliberately to exercise the not-yet-merged PR state on the dashboard."
}

edit_hello_second() {
    local f="app/base/resources.yaml"
    sed -i '/self.send_header("Content-type", "text\/plain")$/{
        /X-App-Version/!{
            N
            s/self.send_header("Content-type", "text\/plain")\n\(.*\)self.end_headers()/self.send_header("Content-type", "text\/plain")\n\1self.send_header("X-App-Version", VERSION)\n\1self.end_headers()/
        }
    }' "$f"
    grep -q 'X-App-Version' "$f"
    COMMIT_MSG="feat(hello-second): add X-App-Version response header"
    PR_TITLE="feat(hello-second): add X-App-Version response header"
    PR_BODY="Adds an X-App-Version response header, mirroring hello-world, so the Revisions page's second source repo has its own real change history."
}

edit_hello_second_healthz() {
    local f="app/base/resources.yaml"
    python3 - "$f" <<'EOF'
import sys
path = sys.argv[1]
with open(path) as fh:
    text = fh.read()
old = '''    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)'''
new = '''    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/healthz":
                self.send_response(200)
                self.end_headers()
                return
            self.send_response(200)'''
assert old in text, "hello-second handler shape changed, update pr-and-push.sh"
text = text.replace(old, new, 1)
with open(path, "w") as fh:
    fh.write(text)
EOF
    grep -q '/healthz' "$f"
    COMMIT_MSG="feat(hello-second): add /healthz endpoint"
    PR_TITLE="feat(hello-second): add /healthz endpoint"
    PR_BODY="Adds a fast /healthz path, mirroring hello-multi's, as a cheaper readiness check."
}

# --- post-merge build dispatch ---------------------------------------------
# Called after landing on the merge commit (detached HEAD at $1 = merge sha).

build_hello_world() {
    local merge_sha=$1
    build_app_image "hello-world" "Hello World app" \
        "This app is a simple hello world app. It is used to test the rollout controller. It is not meant to be used in production. Have fun!"
    for env in $ENVIRONMENTS; do
        build_and_push_manifests "$env" "app/deployments/${env}" "hello-world" "Hello World"
    done
}

build_hello_multi() {
    local merge_sha=$1
    # hello-multi-app has no manifests-tracked Rollout of its own: its
    # OCIRepository/ImagePolicy watches the SHARED hello-world/app image
    # (confirmed via `status.artifactType: image.index` + `status.source`
    # pointing at the repo root, and its availableReleases tracking
    # hello-world/app tags) rather than a hello-multi manifests artifact. A
    # hello-multi-only change is therefore only visible on the cluster if a
    # new hello-world/app image tag is published too, revisioned to THIS
    # merge sha - matching build-and-push.sh, which always rebuilds the app
    # image every iteration regardless of which dir a commit touched.
    build_app_image "hello-world" "Hello World app" \
        "This app is a simple hello world app. It is used to test the rollout controller. It is not meant to be used in production. Have fun!"
    for env in $ENVIRONMENTS; do
        build_and_push_manifests "$env" "multi/app/deployments/${env}" "hello-multi" "Hello Multi"
    done
}

build_dep_api() {
    local merge_sha=$1
    local seq=67
    publish_dep_image api "$seq" "1.${seq}.0" "$merge_sha"
}

build_dep_frontend() {
    local merge_sha=$1
    local seq=68
    publish_dep_image frontend "$seq" "2.${seq}.0" "$merge_sha" \
        --annotation "index:com.kuberik.rollout.requires.api=^1.${seq}.0"
}

build_hello_second() {
    local merge_sha=$1
    local app_dir_name=${REPO_SUFFIX#kuberik-testing-}
    local artifact_name="hello-${app_dir_name}"
    build_app_image "$artifact_name" "Hello Second app" \
        "Standalone twin of hello-world, published from its own repository (${REPO_NAME}) so the Revisions page has a second source repo to group by."
    for env in $ENVIRONMENTS; do
        build_and_push_manifests "$env" "app/deployments/${env}" "$artifact_name" "Hello Second"
    done
}

# --- plan -------------------------------------------------------------------

if [ "$REPO_SUFFIX" = "kuberik-testing" ]; then
    PLAN_EDIT=(edit_hello_world edit_hello_multi edit_dep_api edit_dep_frontend edit_hello_world_bump)
    PLAN_BUILD=(build_hello_world build_hello_multi build_dep_api build_dep_frontend build_hello_world)
    PLAN_STRATEGY=(squash merge rebase squash squash)
    PLAN_OPEN=(0 0 0 0 1)
else
    PLAN_EDIT=()
    PLAN_BUILD=()
    PLAN_STRATEGY=()
    PLAN_OPEN=()
    strategies=(squash merge rebase)
    edits=(edit_hello_second edit_hello_second_healthz)
    for ((i = 0; i < count; i++)); do
        PLAN_EDIT+=("${edits[$((i % ${#edits[@]}))]}")
        PLAN_BUILD+=(build_hello_second)
        PLAN_STRATEGY+=("${strategies[$((i % 3))]}")
        PLAN_OPEN+=(0)
    done
fi

end=$((START + count - 1))
plan_len=${#PLAN_EDIT[@]}
if [ "$end" -gt "$plan_len" ]; then
    end=$plan_len
fi

echo "RESULTS (PR#, title, strategy, merge_sha, service, status)"
for ((idx = START; idx <= end; idx++)); do
    i=$((idx - 1))
    edit_fn=${PLAN_EDIT[$i]}
    build_fn=${PLAN_BUILD[$i]}
    strategy=${PLAN_STRATEGY[$i]}
    leave_open=${PLAN_OPEN[$i]}

    cd "$CHECKOUT"
    git checkout "$DEFAULT_BRANCH"
    git reset --hard "origin/$DEFAULT_BRANCH"

    branch="pr/step${idx}-$(date +%s)"
    git checkout -b "$branch"

    "$edit_fn"

    git add -A
    git commit -m "$COMMIT_MSG"
    git push -u origin "$branch"

    pr_url=$(gh pr create --title "$PR_TITLE" --body "$PR_BODY" --base "$DEFAULT_BRANCH" --head "$branch")
    pr_number=$(basename "$pr_url")

    if [ "$leave_open" = "1" ]; then
        echo "$pr_number | $PR_TITLE | (left open) | n/a | $edit_fn | OPEN"
        continue
    fi

    gh pr merge "$pr_number" "--${strategy}" --delete-branch
    merge_sha=$(gh pr view "$pr_number" --json mergeCommit -q .mergeCommit.oid)

    cd "$CHECKOUT"
    git fetch origin "$DEFAULT_BRANCH"
    git checkout "$merge_sha"

    "$build_fn" "$merge_sha"

    echo "$pr_number | $PR_TITLE | --${strategy} | $merge_sha | $edit_fn | MERGED"
done

cd "$CHECKOUT"
git checkout "$DEFAULT_BRANCH"
git reset --hard "origin/$DEFAULT_BRANCH"
