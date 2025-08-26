#!/bin/bash

# Exit on error
set -eEuo pipefail
set -x

count=${1:-5}

# Set custom Docker config path
SCRIPT_DIR=$(dirname "$0")
PROJECT_ROOT=$(dirname "$SCRIPT_DIR")

BASE_DIR="example/hello-world"
OCI_ARTIFACT_NAME="hello-world"

# Define environments and versions
ENVIRONMENTS="dev staging prod"

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
    flux push artifact --insecure-registry \
      "oci://localhost:5001/examples/${OCI_ARTIFACT_NAME}/${env}/manifests:${tag}" \
      --path "${temp_dir}" \
      --source="$(git config --get remote.origin.url)" \
      --revision="$(git tag --points-at HEAD)@sha1:$(git rev-parse HEAD)" \
       --annotations="org.opencontainers.image.version=${version}" \
    echo "Successfully pushed ${OCI_ARTIFACT_NAME}/${env}/manifests:${tag}"
    # echo "$temp_dir"
    # exit 0
    rm -rf $temp_dir
    rm -rf "${temp_dir}.tar.gz"
}

temp_dir=$(mktemp -d)
trap "rm -rf $temp_dir" EXIT

cp -r example/hello-world/* $temp_dir
(
    cd $temp_dir
    git init
    git add .
    git commit -m "Initial commit"
    git remote add origin "https://github.com/kuberik/rollout-example.git"

    for count in {1..$count}; do
        (
            cd app/base
            kustomize edit set annotation "date:$(date +%s)"
            git add .
            git commit -m "Add patch${count}"
        )

        version=$(git rev-parse HEAD)
        tag="main-$(git log --format=%ct -1 )-${version}"

        # Use crane to annotate the image with the desired annotations
        for t in $tag $version; do
          docker buildx build --push \
            -t "localhost:5001/examples/${OCI_ARTIFACT_NAME}/app:${t}" \
            .
          crane mutate \
            --annotation "org.opencontainers.image.version=${version}" \
            --annotation "org.opencontainers.image.source=https://github.com/kuberik/rollout-example.git" \
            --annotation "org.opencontainers.image.revision=${version}" \
            --annotation "org.opencontainers.image.created=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
            --annotation "org.opencontainers.image.description=Hello World app" \
            --annotation "org.opencontainers.image.licenses=MIT" \
            --annotation "org.opencontainers.image.authors=Kuberik" \
            --annotation "org.opencontainers.image.vendor=Kuberik" \
            --annotation "org.opencontainers.image.url=https://kuberik.com" \
            "localhost:5001/examples/${OCI_ARTIFACT_NAME}/app:${t}"

          docker tag "localhost:5001/examples/${OCI_ARTIFACT_NAME}/app:${t}" "registry.registry.svc.cluster.local/examples/${OCI_ARTIFACT_NAME}/app:${t}"
          kind load docker-image "registry.registry.svc.cluster.local/examples/${OCI_ARTIFACT_NAME}/app:${t}" --name rollout-dev
        done


        for env in $ENVIRONMENTS; do
            build_and_push $env
        done
    done
)
