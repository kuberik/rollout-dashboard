#!/bin/bash
# Shared build/annotate/publish helpers for the hello-world / hello-multi /
# hello-dep / hello-second example services.
#
# Extracted from build-and-push.sh so pr-and-push.sh can reuse the exact same
# OCI annotation contracts (image.revision = git sha, image.version = short
# sha or, for hello-dep, a real semver triple) without duplicating them or
# risking drift between the two scripts. build-and-push.sh is NOT changed and
# does not source this file; it keeps its own inline copies of this logic so
# it keeps working unchanged regardless of what pr-and-push.sh does.
#
# Callers must have already set, before invoking any function below:
#   GITHUB_USER, REPO_NAME, REGISTRY   - see pr-and-push.sh / build-and-push.sh
#   ENVIRONMENTS                        - space-separated list, e.g. "dev staging prod"
# and must be running from inside the checkout the function operates on
# (build_and_push_manifests / build_app_image read git state via `git` in $PWD).

docker_login() {
    echo "$(gh auth token)" | docker login ghcr.io -u "$GITHUB_USER" --password-stdin
}

ensure_repo() {
    local repo_name=$1
    if ! gh repo view "$repo_name" &>/dev/null; then
        echo "Repository $repo_name does not exist. Creating as private repository..."
        gh repo create "$repo_name" --private --confirm
    fi
}

# Push a manifest OCI artifact for one service/env, tagged from the CURRENT git
# HEAD of the checkout the caller has cd'd into (i.e. call this right after
# landing on the merge commit you want published).
# $1 = env, $2 = kustomize base path, $3 = artifact name, $4 = title prefix
build_and_push_manifests() {
    local env=$1
    local kustomize_path=$2
    local artifact_name=$3
    local title_prefix=$4
    local version version_short tag temp_dir
    version=$(git rev-parse HEAD)
    version_short=$(git rev-parse --short HEAD)
    tag="main-$(git log --format=%ct -1)-${version}"
    temp_dir=$(mktemp -d)

    echo "Pushing ${artifact_name}/${env}/manifests for revision ${version}"
    kustomize build "${kustomize_path}" -o "${temp_dir}"
    flux push artifact \
      "oci://${REGISTRY}/${artifact_name}/${env}/manifests:${tag}" \
      --path "${temp_dir}" \
      --source="$(git config --get remote.origin.url)" \
      --revision="${version}" \
      --annotations="org.opencontainers.image.version=${version_short}" \
      --annotations="org.opencontainers.image.title=${title_prefix} manifests / ${env}" \
      --annotations="org.opencontainers.image.description=${title_prefix} manifests / ${env}"
    echo "Successfully pushed ${artifact_name}/${env}/manifests:${tag}"

    rm -rf "${temp_dir}"
}

# Build+push the shared app container image (hello-world / hello-second each
# have their own; hello-multi has none of its own and reuses hello-world's).
# Tags with both the timestamped "main-*" tag and the bare git sha, exactly as
# build-and-push.sh does, so ImagePolicy scans see the same tag shape either
# script produces. Must be run from the repo root of the checkout (build
# context is ".", matching build-and-push.sh).
# $1 = artifact_name (e.g. hello-world, hello-second)
# $2 = title, $3 = description
build_app_image() {
    local artifact_name=$1 title=$2 description=$3
    local version version_short tag
    version=$(git rev-parse HEAD)
    version_short=$(git rev-parse --short HEAD)
    tag="main-$(git log --format=%ct -1)-${version}"

    for t in "$tag" "$version"; do
        docker buildx build --push \
          --platform linux/amd64 \
          --provenance true \
          --annotation "index:org.opencontainers.image.version=${version_short}" \
          --annotation "index:org.opencontainers.image.source=https://github.com/${REPO_NAME}" \
          --annotation "index:org.opencontainers.image.revision=${version}" \
          --annotation "index:org.opencontainers.image.created=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
          --annotation "index:org.opencontainers.image.title=${title}" \
          --annotation "index:org.opencontainers.image.description=${description}" \
          --annotation "index:org.opencontainers.image.licenses=MIT" \
          --annotation "index:org.opencontainers.image.authors=Kuberik" \
          --annotation "index:org.opencontainers.image.vendor=Kuberik" \
          --annotation "index:org.opencontainers.image.url=https://kuberik.com" \
          -t "${REGISTRY}/${artifact_name}/app:${t}" \
          .

        kind load docker-image "${REGISTRY}/${artifact_name}/app:${t}" --name "${KIND_CLUSTER_NAME:-rollout-dev}" || true
    done
}

# Publish one hello-dep service release. Mirrors build-and-push.sh's function
# of the same name, including the rules documented in example/hello-dep/README.md:
#  - org.opencontainers.image.revision MUST stay a bare git sha: the
#    environment controller passes it to the GitHub Deployments API as the
#    deployment ref, which 422s on anything that is not a real git ref.
#  - the release ordinal is a SemVer *pre-release* identifier on the version
#    (triple-seq), never build metadata (triple+seq) - build metadata is
#    ignored for precedence, so every build of one triple would tie.
# $1 = role (api|frontend), $2 = seq ordinal, $3 = contract version triple,
# $4 = git revision, remaining args = extra buildx annotations (e.g. the
# consumer's com.kuberik.rollout.requires.api constraint).
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
