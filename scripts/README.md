# Development Environment Setup

This directory contains scripts to set up a development environment with Kind cluster and registry.

## Prerequisites

- [Kind](https://kind.sigs.k8s.io/docs/user/quick-start/) installed
- [kubectl](https://kubernetes.io/docs/tasks/tools/) installed
- [Docker](https://docs.docker.com/get-docker/) installed
- [OpenSSL](https://www.openssl.org/) installed (usually pre-installed on macOS)

## Scripts

### `setup-kind-cluster.sh`

This script sets up a complete Kind cluster with:

1. **Kind Cluster**: Creates a 3-node cluster (1 control-plane, 2 workers)
2. **Registry**: Deploys a Docker registry without TLS or authentication (insecure)
3. **Certificates**: Generates self-signed certificates for the registry
4. **Secrets**: Creates `registry-tls` secret in both `registry` and `rollout-dashboard` namespaces
5. **Port Exposure**: Exposes registry port 5000 to host machine
6. **Docker Configuration**: Configures Docker to trust the registry

**Usage:**
```bash
./scripts/setup-kind-cluster.sh
```

### `setup-dev-environment.sh`

This script sets up the complete development environment:

1. Checks if Kind cluster exists, creates it if not
2. Installs Flux
3. Deploys the rollout-dashboard application
4. Configures TLS certificate mounting
5. Applies example configurations
6. Builds and pushes images

**Usage:**
```bash
./scripts/setup-dev-environment.sh
```

### `cleanup-kind-cluster.sh`

This script cleans up the development environment:

1. Deletes the Kind cluster
2. Removes generated certificates
3. Cleans up host file entries
4. Removes Docker CA certificate

**Usage:**
```bash
./scripts/cleanup-kind-cluster.sh
```

## Registry Access

The registry is accessible at:
- **From host**: `registry:5000` (added to /etc/hosts)
- **From cluster**: `registry.registry.svc.cluster.local:5000`

**Note**: The registry is configured without authentication or TLS for development purposes. It runs as an insecure registry for easy testing and development.

## Certificates

Certificates are stored in the `certs/` directory:
- `ca.crt`: Certificate Authority certificate
- `ca.key`: Certificate Authority private key
- `server.crt`: Registry server certificate
- `server.key`: Registry server private key

## Docker Configuration

A Docker config file is created at `.docker/config.json` which is automatically used by the build scripts for registry access.

## Troubleshooting

### Registry Connection Issues

If you can't connect to the registry:

1. Check if the registry is running:
   ```bash
   kubectl get pods -n registry
   ```

2. Verify the service is accessible:
   ```bash
   kubectl get svc -n registry
   ```

3. Check if the port is exposed:
   ```bash
   netstat -an | grep 5000
   ```

### Certificate Issues

If you get certificate errors:

1. Verify the secret exists:
   ```bash
   kubectl get secret registry-tls -n registry
   kubectl get secret registry-tls -n rollout-dashboard
   ```

2. Regenerate certificates:
   ```bash
   ./scripts/cleanup-kind-cluster.sh
   ./scripts/setup-kind-cluster.sh
   ```

### Docker Trust Issues

If Docker can't trust the registry:

1. Check if the CA certificate is in place:
   ```bash
   ls -la ~/.docker/ca.crt
   ```

2. Restart Docker daemon:
   ```bash
   sudo systemctl restart docker  # Linux
   # or restart Docker Desktop on macOS
   ```
