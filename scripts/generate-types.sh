#!/bin/bash

set -eEuo pipefail

TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

# Create output directory
mkdir -p frontend/src/types

# Install openapi-typescript if not already installed
if ! command -v openapi-typescript &> /dev/null; then
  npm install -g openapi-typescript
fi

# Download the CRDs
curl -s -o $TEMP_DIR/rollout.yaml https://raw.githubusercontent.com/kuberik/rollout-controller/main/config/crd/bases/kuberik.com_rollouts.yaml
curl -s -o $TEMP_DIR/rolloutgate.yaml https://raw.githubusercontent.com/kuberik/rollout-controller/main/config/crd/bases/kuberik.com_rolloutgates.yaml
curl -s -o $TEMP_DIR/healthcheck.yaml https://raw.githubusercontent.com/kuberik/rollout-controller/main/config/crd/bases/kuberik.com_healthchecks.yaml
curl -s -o $TEMP_DIR/kubestatus.yaml https://raw.githubusercontent.com/kuberik/rollout-controller/main/config/crd/bases/kuberik.com_kubestatuses.yaml
curl -s -o $TEMP_DIR/kustomization.yaml https://raw.githubusercontent.com/fluxcd/kustomize-controller/v1.6.1/config/crd/bases/kustomize.toolkit.fluxcd.io_kustomizations.yaml
curl -s -o $TEMP_DIR/ocirepository.yaml https://raw.githubusercontent.com/fluxcd/source-controller/v1.6.2/config/crd/bases/source.toolkit.fluxcd.io_ocirepositories.yaml

# Extract the schemas and manually fix metadata
ROLLOUT_SCHEMA=$(yq -j eval '.spec.versions[0].schema.openAPIV3Schema' $TEMP_DIR/rollout.yaml)
ROLLOUTGATE_SCHEMA=$(yq -j eval '.spec.versions[0].schema.openAPIV3Schema' $TEMP_DIR/rolloutgate.yaml)
HEALTHCHECK_SCHEMA=$(yq -j eval '.spec.versions[0].schema.openAPIV3Schema' $TEMP_DIR/healthcheck.yaml)
KUBESTATUS_SCHEMA=$(yq -j eval '.spec.versions[0].schema.openAPIV3Schema' $TEMP_DIR/kubestatus.yaml)
KUSTOMIZATION_SCHEMA=$(yq -j eval '.spec.versions[0].schema.openAPIV3Schema' $TEMP_DIR/kustomization.yaml)
OCIREPO_SCHEMA=$(yq -j eval '.spec.versions[0].schema.openAPIV3Schema' $TEMP_DIR/ocirepository.yaml)

# Convert CRDs to OpenAPI schema with proper Kubernetes metadata
cat > $TEMP_DIR/schema.json << EOL
{
  "openapi": "3.0.0",
  "info": {
    "title": "Rollout Dashboard API",
    "version": "1.0.0"
  },
  "components": {
    "schemas": {
      "KubernetesMetadata": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "description": "Name must be unique within a namespace"
          },
          "namespace": {
            "type": "string",
            "description": "Namespace defines the space within which each name must be unique"
          },
          "annotations": {
            "type": "object",
            "additionalProperties": {
              "type": "string"
            },
            "description": "Annotations is an unstructured key value map stored with a resource"
          },
          "labels": {
            "type": "object",
            "additionalProperties": {
              "type": "string"
            },
            "description": "Map of string keys and values that can be used to organize and categorize resources"
          },
          "ownerReferences": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "apiVersion": {
                  "type": "string",
                  "description": "API version of the owner"
                },
                "kind": {
                  "type": "string",
                  "description": "Kind of the owner"
                },
                "name": {
                  "type": "string",
                  "description": "Name of the owner"
                },
                "uid": {
                  "type": "string",
                  "description": "UID of the owner"
                },
                "controller": {
                  "type": "boolean",
                  "description": "If true, this reference points to the managing controller"
                },
                "blockOwnerDeletion": {
                  "type": "boolean",
                  "description": "If true, AND if the owner has the \"foregroundDeletion\" finalizer, then the owner cannot be deleted from the key-value store until this reference is removed"
                }
              }
            },
            "description": "List of objects depended by this object"
          },
          "managedFields": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "manager": {
                  "type": "string",
                  "description": "Manager is an identifier of the workflow managing these fields"
                },
                "operation": {
                  "type": "string",
                  "description": "Operation is the type of operation which lead to this version of the managedFields"
                },
                "apiVersion": {
                  "type": "string",
                  "description": "APIVersion defines the version of this resource that this field set applies to"
                },
                "time": {
                  "type": "string",
                  "format": "date-time",
                  "description": "Time is timestamp of when these fields were set"
                },
                "fieldsType": {
                  "type": "string",
                  "description": "FieldsType is the discriminator for the different fields format and version"
                },
                "fieldsV1": {
                  "type": "object",
                  "description": "FieldsV1 holds the field ownership information in a structured format"
                }
              }
            },
            "description": "ManagedFields maps workflow-id and version to the set of fields that are managed by that workflow"
          }
        }
      },
      "Rollout": $(echo "$ROLLOUT_SCHEMA" | jq '.properties.metadata = {"$ref": "#/components/schemas/KubernetesMetadata"}'),
      "RolloutGate": $(echo "$ROLLOUTGATE_SCHEMA" | jq '.properties.metadata = {"$ref": "#/components/schemas/KubernetesMetadata"}'),
      "HealthCheck": $(echo "$HEALTHCHECK_SCHEMA" | jq '.properties.metadata = {"$ref": "#/components/schemas/KubernetesMetadata"}'),
      "KubeStatus": $(echo "$KUBESTATUS_SCHEMA" | jq '.properties.metadata = {"$ref": "#/components/schemas/KubernetesMetadata"}'),
      "Kustomization": $(echo "$KUSTOMIZATION_SCHEMA" | jq '.properties.metadata = {"$ref": "#/components/schemas/KubernetesMetadata"}'),
      "OCIRepository": $(echo "$OCIREPO_SCHEMA" | jq '.properties.metadata = {"$ref": "#/components/schemas/KubernetesMetadata"}')
    }
  }
}
EOL

# Generate TypeScript types
openapi-typescript $TEMP_DIR/schema.json --output frontend/src/types/rollout-types.ts

# Create index file
cat > frontend/src/types/index.ts << EOL
import type { components } from './rollout-types';
import type { ManagedResourceStatus as ManagedResourceStatusType } from './managed-resource';

export type Rollout = components['schemas']['Rollout'];
export type RolloutGate = components['schemas']['RolloutGate'];
export type HealthCheck = components['schemas']['HealthCheck'];
export type KubeStatus = components['schemas']['KubeStatus'];
export type Kustomization = components['schemas']['Kustomization'];
export type OCIRepository = components['schemas']['OCIRepository'];
export type ManagedResourceStatus = ManagedResourceStatusType;
EOL
