#!/bin/bash

set -eEuo pipefail

# Default values
NAMESPACE="${NAMESPACE:-default}"
NAME="${NAME:-failing-healthcheck}"
CLASS="${CLASS:-}"
MESSAGE="${MESSAGE:-Simulated unhealthy state for testing purposes}"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    -n|--namespace)
      NAMESPACE="$2"
      shift 2
      ;;
    --name)
      NAME="$2"
      shift 2
      ;;
    --class)
      CLASS="$2"
      shift 2
      ;;
    --message)
      MESSAGE="$2"
      shift 2
      ;;
    -h|--help)
      cat << EOF
Usage: $0 [OPTIONS]

Create a Kubernetes HealthCheck CRD resource with Unhealthy status.

Options:
  -n, --namespace NAMESPACE   Kubernetes namespace (default: default)
  --name NAME                 Name of the HealthCheck (default: failing-healthcheck)
  --class CLASS               HealthCheck class (e.g., "kustomization") (optional)
  --message MESSAGE           Status message for the unhealthy state (optional)
  -h, --help                  Show this help message

Examples:
  $0
  $0 --namespace test --name my-failing-healthcheck
  $0 --class kustomization --message "Deployment failed to become ready"
  $0 --namespace production --name app-health --message "Pods in CrashLoopBackOff"

The script creates a HealthCheck resource (kuberik.com/v1alpha1) with:
  - Status set to "Unhealthy"
  - lastErrorTime set to current timestamp
  - lastChangeTime set to current timestamp
  - A custom error message

EOF
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Use -h or --help for usage information"
      exit 1
      ;;
  esac
done

echo "Creating failing HealthCheck resource..."
echo "  Namespace: $NAMESPACE"
echo "  Name: $NAME"
if [[ -n "$CLASS" ]]; then
  echo "  Class: $CLASS"
fi
echo "  Message: $MESSAGE"

# Create namespace if it doesn't exist
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

# Create the HealthCheck resource
HEALTHCHECK_YAML=$(cat <<EOF
apiVersion: kuberik.com/v1alpha1
kind: HealthCheck
metadata:
  name: $NAME
  namespace: $NAMESPACE
  labels:
    app: hello-world
    purpose: testing
EOF
)

if [[ -n "$CLASS" ]]; then
  HEALTHCHECK_YAML+=$(cat <<EOF

spec:
  class: "$CLASS"
EOF
)
fi

echo "$HEALTHCHECK_YAML" | kubectl apply -f -

# Wait a moment for the resource to be created
sleep 1

# Get current timestamp in RFC3339 format
CURRENT_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Escape message for JSON (escape backslashes and double quotes)
ESCAPED_MESSAGE=$(echo "$MESSAGE" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g')

# Patch the status to be Unhealthy
# Use jq if available for proper JSON escaping, otherwise use sed-escaped version
if command -v jq &> /dev/null; then
  PATCH_JSON=$(jq -n \
    --arg status "Unhealthy" \
    --arg message "$MESSAGE" \
    --arg lastErrorTime "$CURRENT_TIME" \
    --arg lastChangeTime "$CURRENT_TIME" \
    '{
      "status": {
        "status": $status,
        "message": $message,
        "lastErrorTime": $lastErrorTime,
        "lastChangeTime": $lastChangeTime
      }
    }')
  kubectl patch healthcheck "$NAME" -n "$NAMESPACE" --type=merge --subresource=status -p "$PATCH_JSON"
else
  # Fallback: use sed-escaped message
  kubectl patch healthcheck "$NAME" -n "$NAMESPACE" --type=merge --subresource=status -p "$(cat <<EOF
{
  "status": {
    "status": "Unhealthy",
    "message": "$ESCAPED_MESSAGE",
    "lastErrorTime": "$CURRENT_TIME",
    "lastChangeTime": "$CURRENT_TIME"
  }
}
EOF
)"
fi

echo ""
echo "HealthCheck created successfully with Unhealthy status!"
echo ""
echo "To check the HealthCheck:"
echo "  kubectl get healthcheck $NAME -n $NAMESPACE"
echo ""
echo "To view HealthCheck details:"
echo "  kubectl describe healthcheck $NAME -n $NAMESPACE"
echo ""
echo "To view HealthCheck YAML:"
echo "  kubectl get healthcheck $NAME -n $NAMESPACE -o yaml"
echo ""
echo "To delete the HealthCheck:"
echo "  kubectl delete healthcheck $NAME -n $NAMESPACE"
echo ""
