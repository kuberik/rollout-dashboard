# OIDC Setup with Dex and Local Connector

This guide explains how to set up OpenID Connect (OIDC) authentication for the Kind cluster using Dex with the built-in local connector. The local connector stores user credentials directly in Dex's storage, making it simple for development and testing.

## Prerequisites

- `kind` - Kubernetes in Docker
- `kubectl` - Kubernetes command-line tool
- `docker` - Container runtime
- `kubectl-oidc-login` - OIDC login plugin for kubectl
  - Install with: `go install github.com/int128/kubelogin/cmd/kubelogin@latest`
  - Or download from: https://github.com/int128/kubelogin/releases
- `openssl` - For certificate generation

## Quick Start

The setup is automated in `setup-kind-cluster.sh`. It will:

1. Generate TLS certificates for Dex
2. Deploy Dex with local connector
3. Configure the Kind cluster with OIDC settings
4. Set up networking between the cluster and Dex

Simply run:

```bash
./scripts/setup-kind-cluster.sh
```

Then configure kubectl:

```bash
./scripts/setup-kubectl-oidc.sh
kubectl config set-context --current --user=oidc
```

## Default Credentials

The default user configured in Dex is:
- **Email**: `admin@example.com`
- **Password**: `password`

You can modify these in `scripts/dex.yaml` under `staticPasswords`.

## Manual Setup

If you prefer to set up manually or the automated script fails:

### 1. Generate Dex TLS Certificates

```bash
./scripts/generate-dex-tls.sh
```

This creates certificates in `scripts/dex-certs/`.

### 2. Configure Dex

Edit `scripts/dex.yaml` to customize:
- User credentials in `staticPasswords` (see [Dex local connector docs](https://dexidp.io/docs/connectors/local/))
- Client configuration
- Other Dex settings

To add more users, you can:
- Add them statically in `staticPasswords` (requires bcrypt password hash)
- Use the gRPC API for dynamic user management

### 4. Deploy Dex

```bash
./scripts/setup-dex.sh
```

This will:
- Create a Docker container running Dex
- Copy certificates and configuration
- Start the Dex server on port 10443

### 5. Create Kind Cluster

The `kind-config.yaml` is already configured with OIDC settings. Just run:

```bash
kind create cluster --name rollout-dev --config kind-config.yaml
```

### 6. Configure Networking

Add Dex to the cluster's `/etc/hosts`:

```bash
DEX_IP=$(docker inspect -f '{{.NetworkSettings.IPAddress}}' dex-server)
echo "${DEX_IP} dex-server" | \
  kubectl -n kube-system exec -i kube-apiserver-rollout-dev-control-plane -- tee -a /etc/hosts
```

Add Dex to your local `/etc/hosts`:

```bash
echo "127.0.0.1 dex-server" | sudo tee -a /etc/hosts
```

### 7. Configure kubectl

```bash
./scripts/setup-kubectl-oidc.sh
```

Then set OIDC as your default user:

```bash
kubectl config set-context --current --user=oidc
```

## Usage

After setup, when you run `kubectl` commands, you'll be prompted to authenticate. The authentication flow will:

1. Open your browser to Dex login page
2. Enter your credentials (default: `admin@example.com` / `password`)
3. Dex provides a token to kubectl
4. kubectl uses the token to authenticate with Kubernetes

### Adding Users

To add additional users, you can:

1. **Statically in config**: Add entries to `staticPasswords` in `dex.yaml`. You'll need to generate bcrypt hashes:
   ```bash
   echo -n "password" | htpasswd -BinC 10 username | cut -d: -f2
   ```

2. **Via gRPC API**: Use Dex's gRPC API to dynamically manage users. See the [Dex documentation](https://dexidp.io/docs/connectors/local/) for details.

## Troubleshooting

### Dex container not starting

Check logs:
```bash
docker logs dex-server
```

### Cannot reach Dex from cluster

Verify Dex IP and hosts entry:
```bash
docker inspect -f '{{.NetworkSettings.IPAddress}}' dex-server
kubectl -n kube-system exec kube-apiserver-rollout-dev-control-plane -- cat /etc/hosts | grep dex-server
```

### Certificate errors

Regenerate certificates:
```bash
rm -rf scripts/dex-certs/*
./scripts/generate-dex-tls.sh
```

Then restart Dex:
```bash
docker stop dex-server
docker rm dex-server
./scripts/setup-dex.sh
```

### Authentication fails

- Verify you're using the correct email and password
- Check Dex logs: `docker logs dex-server`
- Ensure the user exists in `staticPasswords` or was created via gRPC API
- Verify the password hash is correct (if manually adding users)

## Cleanup

To remove everything:

```bash
# Stop and remove Dex
docker stop dex-server
docker rm dex-server

# Delete cluster
kind delete cluster --name rollout-dev

# Remove from /etc/hosts (manually edit the file)
sudo sed -i '/dex-server/d' /etc/hosts

# Remove certificates (optional)
rm -rf scripts/dex-certs/
```

## Files

- `scripts/generate-dex-tls.sh` - Generates TLS certificates for Dex
- `scripts/dex.yaml` - Dex configuration with local connector
- `scripts/setup-dex.sh` - Deploys Dex container
- `scripts/setup-kubectl-oidc.sh` - Configures kubectl for OIDC
- `scripts/setup-kind-cluster.sh` - Main setup script (integrates everything)
- `kind-config.yaml` - Kind cluster configuration with OIDC settings

## References

- [Dex Local Connector Documentation](https://dexidp.io/docs/connectors/local/)
- [Dex Configuration](https://dexidp.io/docs/configuration/)
- [kubelogin](https://github.com/int128/kubelogin)
