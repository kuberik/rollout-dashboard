#!/bin/bash

# Exit on error
set -eEuo pipefail
set -x

count=${1:-5}

# Set custom Docker config path
SCRIPT_DIR=$(realpath $(dirname "$0"))
PROJECT_ROOT=$(dirname "$SCRIPT_DIR")

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
    git add .
    git commit -m "Initial commit"

    for count in {1..$count}; do
        sleep 1
        (
            cd app/base
            echo "timestamp=date:$(date +%s)" > app.env
            git add .
            git commit -m "Add patch${count}"
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

          kind load docker-image "${REGISTRY}/${OCI_ARTIFACT_NAME}/app:${t}" --name rollout-dev
        done


        for env in $ENVIRONMENTS; do
            build_and_push "$env" "app/deployments/${env}" "hello-world" "Hello World"
            build_and_push "$env" "multi/app/deployments/${env}" "hello-multi" "Hello Multi"
        done
    done
)
