#!/bin/bash
set -e

SCRIPT_DIR=$(dirname "$0")
PROJECT_ROOT=$(dirname "$SCRIPT_DIR")

echo "Setting up Kind cluster with registry..."

# Create Kind cluster
kind create cluster --name rollout-dev --config "${PROJECT_ROOT}/kind-config.yaml"

# Wait for cluster to be ready
kubectl wait --for=condition=Ready nodes --all --timeout=300s

# Create registry namespace
kubectl create namespace registry

# Create registry configuration ConfigMap
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: registry-config
  namespace: registry
data:
  config.yml: |
    version: 0.1
    log:
      level: debug
    storage:
      delete:
        enabled: true
      filesystem:
        rootdirectory: /var/lib/registry
    http:
      addr: 0.0.0.0:5000
EOF

# Create registry deployment with both TLS and HTTP
cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: registry
  namespace: registry
spec:
  replicas: 1
  selector:
    matchLabels:
      app: registry
  template:
    metadata:
      labels:
        app: registry
    spec:
      hostNetwork: true
      containers:
      - name: registry
        image: registry:3
        ports:
        - containerPort: 5000
        command:
        - /bin/registry
        - serve
        - /etc/docker/registry/config.yml
        volumeMounts:
        - name: registry-storage
          mountPath: /var/lib/registry
        - name: registry-config
          mountPath: /etc/docker/registry

      volumes:
      - name: registry-storage
        emptyDir: {}
      - name: registry-config
        configMap:
          name: registry-config
---
apiVersion: v1
kind: Service
metadata:
  name: registry
  namespace: registry
spec:
  type: NodePort
  selector:
    app: registry
  ports:
  - port: 80
    protocol: TCP
    targetPort: 5000
---
apiVersion: v1
kind: Service
metadata:
  name: registry-nodeport
  namespace: registry
spec:
  type: NodePort
  selector:
    app: registry
  ports:
  - port: 5000
    protocol: TCP
    nodePort: 30950
EOF

# Wait for registry to be ready
echo "Waiting for registry to be ready..."
kubectl wait --for=condition=available --timeout=300s deployment/registry -n registry


echo "Kind cluster setup complete!"
echo "Registry is available at: registry:5000 (insecure, no auth)"
