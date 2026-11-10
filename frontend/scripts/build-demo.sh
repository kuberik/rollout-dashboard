#!/usr/bin/env bash
#
# Builds the DEMO dashboard — the static, backend-free build that kuberik.com
# embeds in an iframe per showcase — and copies it into the website repo's
# static tree.
#
# The demo is the real dashboard. The only three differences are:
#   VITE_DEMO=1   src/hooks.client.ts installs the mock as a `fetch` shim
#   PUBLIC_DEMO=1 app.html honours `?theme=light|dark` (demo builds only — it
#                 persists to localStorage, so a real dashboard must not have it)
#   DEMO_BASE     paths.base, so every asset and route resolves under /demo
#   DEMO_OUT      a separate output dir, so this never stomps `build/`
#
# Pass --force. The copy step REMOVES the contents of the destination first, and
# the destination is in the website repo.
#
# ⚠️ RUN WITH THE AGENT SANDBOX DISABLED. A paraglide compile fetches its
# message-format plugin over the network; inside the sandbox that fetch fails,
# paraglide reports success having compiled ZERO messages, and it overwrites
# src/lib/paraglide/messages/en.js with an 18-byte stub that silently empties
# every string in the app. The check at the bottom of this script is the alarm.
# Full write-up: frontend/DESIGN.md, .agents-context/ENVIRONMENT.md.
set -euo pipefail

FORCE=0
for arg in "$@"; do
	case "$arg" in
		--force) FORCE=1 ;;
		*) echo "usage: $0 [--force]" >&2; exit 2 ;;
	esac
done

cd "$(dirname "$0")/.."
FRONTEND="$PWD"

DEMO_BASE="${DEMO_BASE:-/demo}"
DEMO_OUT="${DEMO_OUT:-build-demo}"
DEST="${DEMO_DEST:-$FRONTEND/../../website/static/demo}"

# ⛔ THIS SCRIPT DELETES A DIRECTORY IN A REPO IT DOES NOT OWN. `$DEST` lives in
# the website repo, and a stale file left behind from an older build is worse
# than an error — it is served. So the wipe is real, and it is therefore behind
# an explicit flag rather than something you discover by having run the script.
if [ -e "$DEST" ] && [ "$FORCE" -ne 1 ]; then
	echo "refusing to overwrite $DEST without --force." >&2
	echo "  It already exists and this script REMOVES ITS CONTENTS before copying," >&2
	echo "  and it is in the website repo, which this repo does not own." >&2
	echo "  Re-run as: $0 --force   (or set DEMO_DEST to somewhere else)" >&2
	exit 1
fi

echo "==> building demo (base=$DEMO_BASE, out=$DEMO_OUT)"
rm -rf "$DEMO_OUT"
VITE_DEMO=1 PUBLIC_DEMO=1 DEMO_BASE="$DEMO_BASE" DEMO_OUT="$DEMO_OUT" pnpm exec vite build

# THE PARAGLIDE ALARM. The failure mode is SILENT: the build exits 0 having
# compiled ZERO messages. Count the compiled message modules and compare them
# against the source catalogue rather than trusting the exit code. (The path is
# `src/lib/paraglide/messages/<key>.js` on paraglide 2.x — the `en.js` the older
# write-ups name is a 1.x artefact.)
SRC_KEYS=$(node -e 'const m=require("./messages/en.json");console.log(Object.keys(m).filter(k=>k[0]!=="$").length)')
OUT_KEYS=$(find "$FRONTEND/src/lib/paraglide/messages" -name '*.js' ! -name '_index.js' 2>/dev/null | wc -l)
echo "==> paraglide: ${OUT_KEYS}/${SRC_KEYS} messages compiled"
if [ "$OUT_KEYS" -lt "$SRC_KEYS" ]; then
	echo "FATAL: paraglide compiled ${OUT_KEYS} of ${SRC_KEYS} messages." >&2
	echo "       Re-run with the agent sandbox disabled / network reachable." >&2
	exit 1
fi

test -f "$DEMO_OUT/index.html" || { echo "FATAL: no $DEMO_OUT/index.html" >&2; exit 1; }

echo "==> copying to $DEST"
# The website is a SIBLING REPO owned by someone else. This script writes the
# built artifact into its static tree and commits NOTHING there — whether
# `static/demo/` is tracked or gitignored is the website's call to make.
mkdir -p "$DEST"
rm -rf "${DEST:?}/"* "${DEST:?}/".[!.]* 2>/dev/null || true
cp -R "$DEMO_OUT/." "$DEST/"

echo "==> done: $DEST/index.html"
