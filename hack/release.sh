#!/usr/bin/env bash

set -euo pipefail

BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Prefer local tags; fall back to latest GitHub release (dashboard was released without tagging)
LATEST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || gh release view --json tagName -q .tagName 2>/dev/null || echo "v0.0.0")

IFS='.' read -r -a VERSION_PARTS <<< "${LATEST_TAG#v}"
MAJOR="${VERSION_PARTS[0]}"
MINOR="${VERSION_PARTS[1]}"
PATCH="${VERSION_PARTS[2]}"

if [[ "$BRANCH" == "main" ]]; then
    NEW_VERSION="v${MAJOR}.$((MINOR + 1)).0"
    RELEASE_BRANCH="release-${MAJOR}.$((MINOR + 1))"
elif [[ "$BRANCH" =~ ^release- ]]; then
    NEW_VERSION="v${MAJOR}.${MINOR}.$((PATCH + 1))"
else
    echo "Error: Must be on main or release-* branch to create a release"
    exit 1
fi

echo "Current version: ${LATEST_TAG}"
echo "New version: ${NEW_VERSION}"

git tag -a "${NEW_VERSION}" -m "Release ${NEW_VERSION}"

if [[ "$BRANCH" == "main" ]]; then
    git checkout -b "${RELEASE_BRANCH}"
    echo "Created release branch: ${RELEASE_BRANCH}"
fi

echo "Created release ${NEW_VERSION}"
echo "To trigger the release, run:"
if [[ "$BRANCH" == "main" ]]; then
    echo "  git push origin main"
    echo "  git push origin ${RELEASE_BRANCH}"
fi
echo "  git push origin ${NEW_VERSION}"
