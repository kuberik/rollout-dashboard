#!/bin/bash

# Exit on error
set -eEuo pipefail
set -x

count=${1:-5}

# Set custom Docker config path
SCRIPT_DIR=$(realpath $(dirname "$0"))
PROJECT_ROOT=$(dirname "$SCRIPT_DIR")

# hello-dep publishes a pair of releases per iteration: hello-api provides the
# "api" contract, hello-frontend consumes it and declares a caret constraint on
# the version it was built against.
#
# Unlike hello-world and hello-multi, which record a git short SHA in
# org.opencontainers.image.version, hello-dep records a real semantic version:
# the dependency gate compares those versions, so they have to be orderable.

BASE_DIR="example/hello-world"
OCI_ARTIFACT_NAME="hello-world"

# Define environments and versions
ENVIRONMENTS="dev staging prod"

# Get GitHub username and set up repository
GITHUB_USER=$(gh api user --jq .login | tr '[:upper:]' '[:lower:]')
REPO_NAME="${GITHUB_USER}/kuberik-testing"
REGISTRY="ghcr.io/${GITHUB_USER}"

# Authenticate Docker with GitHub Container Registry
echo "$(gh auth token)" | docker login ghcr.io -u "$GITHUB_USER" --password-stdin

# Check if repository exists, create if it doesn't
if ! gh repo view "$REPO_NAME" &>/dev/null; then
    echo "Repository $REPO_NAME does not exist. Creating as private repository..."
    gh repo create "$REPO_NAME" --private --confirm
else
    echo "Repository $REPO_NAME already exists."
fi

# Function to build and push manifest OCI for a specific environment.
# $1 = env, $2 = kustomize base path inside repo (e.g. "app/deployments/dev"),
# $3 = OCI artifact name (e.g. "hello-world"), $4 = human-readable title prefix.
build_and_push() {
    local env=$1
    local kustomize_path=$2
    local artifact_name=$3
    local title_prefix=$4
    local version=$(git rev-parse HEAD)
    local version_short=$(git rev-parse --short HEAD)
    local tag="main-$(git log --format=%ct -1 )-${version}"
    temp_dir=$(mktemp -d)

    echo "Building and pushing ${artifact_name} for environment: $env, version: $version"

    kustomize build "${kustomize_path}" -o "${temp_dir}"
    flux push artifact \
      "oci://${REGISTRY}/${artifact_name}/${env}/manifests:${tag}" \
      --path "${temp_dir}" \
      --source="$(git config --get remote.origin.url)" \
      --revision="$(git rev-parse HEAD)" \
      --annotations="org.opencontainers.image.version=${version_short}" \
      --annotations="org.opencontainers.image.title=${title_prefix} manifests / ${env}" \
      --annotations="org.opencontainers.image.description=${title_prefix} manifests / ${env}"
    echo "Successfully pushed ${artifact_name}/${env}/manifests:${tag}"

    rm -rf $temp_dir
    rm -rf "${temp_dir}.tar.gz"
}

# Publish one hello-dep service release.
# $1 = role (api|frontend), $2 = release ordinal, $3 = contract version triple,
# $4 = git revision, remaining args are extra buildx annotations.
#
# The ordinal is appended to the triple as a SemVer *pre-release* identifier
# (1.0.0-3), never as build metadata (1.0.0+3): build metadata is ignored for
# precedence, so every build of one triple would tie. The dependency gate
# strips the suffix and compares triples only.
#
# The ordinal must NOT be used as org.opencontainers.image.revision: the
# environment controller passes that value to the GitHub Deployments API as the
# deployment ref, which 422s on anything that is not a real git ref.
publish_dep_image() {
    local role=$1 seq=$2 triple=$3 revision=$4
    shift 4

    local image="${REGISTRY}/hello-dep/${role}"
    local tag="rel-${seq}"

    echo "Publishing ${image}:${tag} (contract version ${triple}-${seq})"
    docker buildx build --push \
      --platform linux/amd64 \
      --provenance true \
      --annotation "index:org.opencontainers.image.version=${triple}-${seq}" \
      --annotation "index:org.opencontainers.image.source=https://github.com/${REPO_NAME}" \
      --annotation "index:org.opencontainers.image.revision=${revision}" \
      --annotation "index:org.opencontainers.image.created=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      --annotation "index:org.opencontainers.image.title=Hello Dep ${role}" \
      --annotation "index:org.opencontainers.image.description=hello-dep ${role} service, release ${tag}" \
      "$@" \
      -t "${image}:${tag}" \
      dep

    kind load docker-image "${image}:${tag}" --name "${KIND_CLUSTER_NAME:-rollout-dev}" || true
}

# Publish one hello-dep release pair.
#
# The ordinal is the commit height of the kuberik-testing repo, which advances
# on every iteration AND across runs. Deriving it from the loop index instead
# would pin the tags to rel-1..rel-N, so a second run would republish the same
# tags and the rollouts would never see a new release — the same reason
# hello-world keys its tags off the commit sha rather than the iteration.
#
# Both services bump their contract together and the frontend requires the api
# release published alongside it, so the dependency gate holds the frontend on
# every iteration until the api half has baked. That is the topological
# ordering being demonstrated, and it now happens continuously rather than once.
publish_dep_releases() {
    local revision=$1
    local seq
    seq=$(git rev-list --count HEAD)

    # Contract versions advance with the ordinal so they are monotonic across
    # runs, which is what the gate compares.
    local api_contract="1.${seq}.0"
    local frontend_contract="2.${seq}.0"

    publish_dep_image api "${seq}" "${api_contract}" "${revision}"
    publish_dep_image frontend "${seq}" "${frontend_contract}" "${revision}" \
      --annotation "index:com.kuberik.rollout.requires.api=^${api_contract}"
}

# hello-dep manifests are published under a fixed "latest" tag: neither of its
# rollouts drives the manifest OCIRepository, they only substitute the image
# versions into it.
push_dep_manifests() {
    for env in $ENVIRONMENTS; do
        local temp_dir
        temp_dir=$(mktemp -d)
        echo "Pushing hello-dep manifests for environment: $env"
        kustomize build "dep/app/deployments/${env}" -o "${temp_dir}"
        flux push artifact \
          "oci://${REGISTRY}/hello-dep/${env}/manifests:latest" \
          --path "${temp_dir}" \
          --source="https://github.com/${REPO_NAME}" \
          --revision="latest" \
          --annotations="org.opencontainers.image.title=Hello Dep manifests / ${env}" \
          --annotations="org.opencontainers.image.description=Hello Dep manifests / ${env}"
        rm -rf "${temp_dir}"
    done
}

temp_dir=$(mktemp -d)
trap "rm -rf $temp_dir" EXIT

(
    cd $temp_dir
    gh repo clone $REPO_NAME .
    cp -r $PROJECT_ROOT/example/hello-world/* .
    # Second example (multi KruiseRollouts) is copied under its own subdir
    # so its paths don't collide with hello-world.
    mkdir -p multi
    cp -r $PROJECT_ROOT/example/hello-multi/* multi/
    # Third example (dependency-gated rollouts) likewise gets its own subdir.
    mkdir -p dep
    cp -r $PROJECT_ROOT/example/hello-dep/* dep/
    git add .
    git commit -m "Initial commit"

    push_dep_manifests

    # NOTE: brace expansion happens before parameter expansion, so `{1..$count}`
    # expands to the literal string "{1..5}" and iterates exactly once. Use seq.
    for iteration in $(seq 1 "$count"); do
        sleep 1
        (
            cd app/base
            echo "timestamp=date:$(date +%s)" > app.env
            git add .
            git commit -m "Add patch${iteration}"
        )

        # Push commits to the repository
        branch=$(git branch --show-current)
        git push -u origin "$branch" 2>/dev/null

        version=$(git rev-parse HEAD)
        version_short=$(git rev-parse --short HEAD)
        tag="main-$(git log --format=%ct -1 )-${version}"

        # Use crane to annotate the image with the desired annotations
        for t in $tag $version; do
          docker buildx build --push \
            --platform linux/amd64 \
            --provenance true \
            --annotation "index:org.opencontainers.image.version=${version_short}" \
            --annotation "index:org.opencontainers.image.source=https://github.com/${REPO_NAME}" \
            --annotation "index:org.opencontainers.image.revision=${version}" \
            --annotation "index:org.opencontainers.image.created=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
            --annotation "index:org.opencontainers.image.title=Hello World app" \
            --annotation "index:org.opencontainers.image.description=This app is a simple hello world app. It is used to test the rollout controller. It is not meant to be used in production. Have fun!" \
            --annotation "index:org.opencontainers.image.licenses=MIT" \
            --annotation "index:org.opencontainers.image.authors=Kuberik" \
            --annotation "index:org.opencontainers.image.vendor=Kuberik" \
            --annotation "index:org.opencontainers.image.url=https://kuberik.com" \
            -t "${REGISTRY}/${OCI_ARTIFACT_NAME}/app:${t}" \
            .

          kind load docker-image "${REGISTRY}/${OCI_ARTIFACT_NAME}/app:${t}" --name "${KIND_CLUSTER_NAME:-rollout-dev}"
        done


        for env in $ENVIRONMENTS; do
            build_and_push "$env" "app/deployments/${env}" "hello-world" "Hello World"
            build_and_push "$env" "multi/app/deployments/${env}" "hello-multi" "Hello Multi"
        done

        publish_dep_releases "${version}"
    done
)
