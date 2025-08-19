# Scripts

This directory contains various scripts for setting up and managing the rollout dashboard.

## Available Scripts

### `setup-dev-environment.sh`
Sets up the complete development environment including:
- Kind cluster creation
- Flux installation
- CRD application
- Frontend build and deployment

### `setup-kind-cluster.sh`
Creates a local Kind cluster for development.

### `build-and-push.sh`
Builds and pushes the rollout dashboard image.

### `create-kyverno-healthcheck-rule.sh`
Creates a Kyverno ClusterPolicy that automatically generates and manages HealthCheck resources.

### `create-datadogmonitor.sh`
Creates an empty DataDogMonitor resource with basic configuration and proper labeling.

## Kyverno HealthCheck Rule

The `create-kyverno-healthcheck-rule.sh` script creates a Kyverno policy that:

### Features
- **Automatic Generation**: Creates HealthCheck resources for any resource labeled with `kuberik.com/health-check-classes`
- **Dynamic Updates**: Automatically updates HealthCheck resources when upstream resources change
- **SSA Generation**: Enables Server-Side Apply generation for efficient updates
- **Smart Labeling**: Applies comprehensive labels for resource tracking and management

### How It Works
1. **Trigger**: Any resource with the `kuberik.com/health-check-classes` label
2. **Action**: Generates a corresponding HealthCheck resource
3. **Configuration**: Automatically configures health check parameters
4. **Management**: Updates HealthCheck resources when source resources change

### Usage

```bash
# Make the script executable
chmod +x scripts/create-kyverno-healthcheck-rule.sh

# Run the script
./scripts/create-kyverno-healthcheck-rule.sh
```

### Testing

After running the script, test it by creating a resource with the required label:

```bash
# Create a test deployment with health check label
kubectl run test-app --image=nginx --labels=kuberik.com/health-check-classes=http

# Verify the HealthCheck was created
kubectl get healthchecks
kubectl describe healthcheck healthcheck-test-app
```

### Prerequisites

- Kubernetes cluster running
- Kyverno installed in the cluster
- kubectl configured and accessible
- HealthCheck CRD available (`kuberik.com/v1alpha1`)

### Generated HealthCheck Configuration

The rule generates HealthCheck resources with:
- **Default Settings**: 30s interval, 10s timeout, 3 retries
- **Backoff Strategy**: Exponential backoff with 5s initial, 60s max
- **Failure Handling**: 3 failure threshold, 1 success threshold
- **Smart Naming**: `healthcheck-{resource-name}` pattern
- **Comprehensive Labels**: Source tracking and management labels

### Customization

To modify the default health check parameters, edit the script and adjust the values in the `data.spec` section:

```yaml
interval: 30s          # Health check frequency
timeout: 10s           # Individual check timeout
retries: 3             # Number of retries
failureThreshold: 3    # Consecutive failures before marking unhealthy
successThreshold: 1    # Consecutive successes before marking healthy
```

### Troubleshooting

1. **Rule not working**: Ensure Kyverno is installed and running
2. **HealthCheck not created**: Check if the source resource has the correct label
3. **Permission issues**: Verify Kyverno has permissions to create HealthCheck resources
4. **CRD missing**: Ensure the HealthCheck CRD is installed before running the script

## DataDogMonitor Creation

The `create-datadogmonitor.sh` script creates empty DataDogMonitor resources for monitoring setup.

### Features
- **Quick Creation**: Rapidly creates DataDogMonitor resources with proper structure
- **Flexible Naming**: Customizable monitor names and namespaces
- **Proper Labeling**: Applies consistent labels for resource management
- **Template Ready**: Creates monitors ready for query and threshold configuration

### Usage

```bash
# Make the script executable
chmod +x scripts/create-datadogmonitor.sh

# Create a monitor with default settings
./scripts/create-datadogmonitor.sh

# Create a monitor in a specific namespace
./scripts/create-datadogmonitor.sh my-namespace

# Create a monitor with custom name and namespace
./scripts/create-datadogmonitor.sh my-namespace my-custom-monitor
```

### Prerequisites

- Kubernetes cluster running
- DataDog operator installed with CRDs
- kubectl configured and accessible
- DataDogMonitor CRD available (`datadoghq.com/v1`)

### Generated Monitor Structure

The script creates monitors with:
- **Basic Configuration**: Metric alert type with empty query
- **Proper Metadata**: Namespace, labels, and annotations
- **Default Thresholds**: Critical and warning set to 0 (configurable)
- **Organizational Tags**: Environment and source tracking tags
- **Ready for Customization**: Empty query field ready for your monitoring logic

### YAML Templates

For direct usage without scripts, use the YAML templates:

```bash
# Apply empty monitor template
kubectl apply -f scripts/templates/empty-datadogmonitor.yaml

# Apply example monitors
kubectl apply -f scripts/templates/datadogmonitor-examples.yaml
```

### Monitor Types Supported

The templates include examples for:
- **Metric Alert**: Standard metric-based monitoring
- **Service Check**: Service health monitoring
- **Log Alert**: Log-based alerting
- **APM Alert**: Application performance monitoring
- **Composite**: Multi-condition monitoring
- **Empty Template**: Ready for custom configuration

### Customization

After creation, customize your monitor:

```bash
# Edit the monitor directly
kubectl edit datadogmonitor monitor-name -n namespace

# Or apply updated YAML
kubectl apply -f updated-monitor.yaml
```

### Common Configuration Fields

```yaml
spec:
  query: "your:monitoring:query"           # Required: Your monitoring query
  thresholds:
    critical: 100                           # Critical threshold value
    warning: 80                             # Warning threshold value
  evaluationDelay: 60                       # Delay evaluation by N seconds
  includeTags: true                         # Include tags in notifications
  requireFullWindow: true                   # Require full evaluation window
  notifyAudit: false                        # Notify on monitor changes
  locked: false                             # Prevent editing
  timeoutH: 0                               # Timeout in hours
  newHostDelay: 300                         # Delay for new hosts
  noDataTimeframe: 10                       # No data timeout
  notifyNoData: false                       # Notify on no data
  renotifyInterval: 0                       # Renotify interval
  escalationMessage: ""                     # Escalation message
  validate: true                            # Validate query syntax
  restrictedRoles: []                       # Restricted access roles
  priority: 1                               # Priority level
```

## Cleanup

To remove the Kyverno rule:

```bash
kubectl delete clusterpolicy auto-healthcheck-generation
```

To remove generated HealthCheck resources:

```bash
kubectl delete healthchecks --selector=kuberik.com/auto-generated=true
```

To remove DataDogMonitor resources:

```bash
# Remove specific monitor
kubectl delete datadogmonitor monitor-name -n namespace

# Remove all monitors in namespace
kubectl delete datadogmonitors --all -n namespace

# Remove monitors by label
kubectl delete datadogmonitors --selector=app.kubernetes.io/part-of=rollout-dashboard
```
