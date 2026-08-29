#!/usr/bin/env bash
# Record demo videos for the Kuberik website.
# Outputs MP4s to demos/ at 1.5x speed, web-optimized.
set -euo pipefail

cd "$(dirname "$0")"

CHROMIUM="${HOME}/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell"
if [ ! -f "$CHROMIUM" ]; then
  echo "Chromium headless shell not found at $CHROMIUM"
  echo "Run: node_modules/.bin/playwright install chromium"
  exit 1
fi

echo "==> Recording scenes with Playwright (mock API)..."
node_modules/.bin/playwright test --config=playwright.record.config.ts

echo "==> Converting to web-optimized MP4 (1.5x speed)..."
mkdir -p demos

declare -A NAME_MAP=(
  ["01-dashboard.ts-01-dashboard"]="01-dashboard-overview"
  ["02-rollout-detail.ts-02-rollout-detail"]="02-rollout-detail"
  ["03-history.ts-03-history"]="03-deployment-history"
  ["04-logs.ts-04-logs"]="04-live-logs"
)

for dir in recordings-raw/*/; do
  dirname=$(basename "$dir")
  clean="${NAME_MAP[$dirname]:-$dirname}"
  input="$dir/video.webm"
  output="demos/${clean}.mp4"

  ffmpeg -y -i "$input" \
    -vf "setpts=0.667*PTS" \
    -c:v libx264 -crf 20 -preset medium \
    -movflags +faststart -pix_fmt yuv420p \
    -an \
    "$output" 2>/dev/null

  duration=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$output" 2>/dev/null | xargs printf '%.1fs')
  size=$(du -sh "$output" | cut -f1)
  echo "  $clean.mp4  $duration  $size"
done

echo ""
echo "Done. Videos in demos/"
ls -lh demos/*.mp4
