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

# Function to build and push for a specific environment and version
build_and_push() {
    local env=$1
    local version=$(git rev-parse HEAD)
    local tag="main-$(git log --format=%ct -1 )-${version}"
    temp_dir=$(mktemp -d)

    echo "Building and pushing for environment: $env, version: $version"

    # Build with kustomize for the specific environment and version
    kustomize build "app/deployments/${env}" -o "${temp_dir}"
    # Build OCI image with crane
    flux push artifact \
      "oci://${REGISTRY}/${OCI_ARTIFACT_NAME}/${env}/manifests:${tag}" \
      --path "${temp_dir}" \
      --source="$(git config --get remote.origin.url)" \
      --revision="$(git rev-parse HEAD)" \
      --annotations="org.opencontainers.image.version=${version}" \
      --annotations="org.opencontainers.image.title=Hello World manifests / ${env}" \
      --annotations="org.opencontainers.image.description=Hello World manifests / ${env}" \
    echo "Successfully pushed ${OCI_ARTIFACT_NAME}/${env}/manifests:${tag}"
    # echo "$temp_dir"
    # exit 0
    rm -rf $temp_dir
    rm -rf "${temp_dir}.tar.gz"
}

temp_dir=$(mktemp -d)
trap "rm -rf $temp_dir" EXIT

(
    cd $temp_dir
    gh repo clone $REPO_NAME .
    cp -r $PROJECT_ROOT/example/hello-world/* .
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
        tag="main-$(git log --format=%ct -1 )-${version}"

        # Use crane to annotate the image with the desired annotations
        for t in $tag $version; do
          docker buildx build --push \
            -t "${REGISTRY}/${OCI_ARTIFACT_NAME}/app:${t}" \
            .
          crane mutate \
            --annotation "org.opencontainers.image.version=${version}" \
            --annotation "org.opencontainers.image.source=https://github.com/${REPO_NAME}.git" \
            --annotation "org.opencontainers.image.revision=${version}" \
            --annotation "org.opencontainers.image.created=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
            --annotation "org.opencontainers.image.title=Hello World app" \
            --annotation "org.opencontainers.image.description=This app is a simple hello world app. It is used to test the rollout controller. It is not meant to be used in production. Have fun!" \
            --annotation "org.opencontainers.image.licenses=MIT" \
            --annotation "org.opencontainers.image.authors=Kuberik" \
            --annotation "org.opencontainers.image.vendor=Kuberik" \
            --annotation "org.opencontainers.image.url=https://kuberik.com" \
            "${REGISTRY}/${OCI_ARTIFACT_NAME}/app:${t}"

          kind load docker-image "${REGISTRY}/${OCI_ARTIFACT_NAME}/app:${t}" --name rollout-dev
        done


        for env in $ENVIRONMENTS; do
            build_and_push $env
        done
    done
)
