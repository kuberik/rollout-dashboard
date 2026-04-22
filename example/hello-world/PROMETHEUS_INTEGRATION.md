# Prometheus Integration for Hello World Example

This example demonstrates how to integrate Prometheus monitoring with Kuberik health checks for progressive delivery.

## Architecture

The hello-world application now includes:

1. **Prometheus Metrics Endpoint** (`/metrics`)
   - Exports custom application metrics (request count, error count, request duration, uptime)
   - Follows Prometheus text exposition format

2. **Prometheus Operator** (kube-prometheus-stack)
   - Deployed via Helm chart in the `monitoring` namespace
   - Includes Prometheus, Grafana, and Alertmanager
   - Automatically discovers ServiceMonitors and PrometheusRules

3. **ServiceMonitor**
   - Configures Prometheus to scrape the hello-python service
   - Scrapes `/metrics` endpoint every 15 seconds

4. **PrometheusRule (Alert Rules)**
   - `HighErrorRate`: Triggers when error rate > 0.1 req/s for 1 minute
   - `LowRequestRate`: Triggers when request rate < 0.01 req/s for 2 minutes
   - `AppDown`: Triggers when pod is not responding to scrapes for 1 minute

5. **Kuberik Health Checks**
   - Uses the `prometheus-alert` class from prometheus-controller
   - Monitors alert states and updates Rollout health status
   - Polls Prometheus every 30 seconds
   - Tracks all time series points since last scrape

## Metrics Exposed

The hello-world app exposes the following Prometheus metrics at `/metrics`:

- `http_requests_total` - Total number of HTTP requests (counter)
- `http_request_duration_seconds_sum` - Sum of HTTP request durations (counter)
- `http_errors_total` - Total number of HTTP errors (counter)
- `process_uptime_seconds` - Process uptime in seconds (gauge)

All metrics include a `version` label with the current app version.

## Deployment

### Prerequisites

1. **Install kube-prometheus-stack via Helm:**

   ```bash
   # Add the Prometheus community Helm repository
   helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
   helm repo update

   # Install kube-prometheus-stack
   helm install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
     --namespace monitoring \
     --create-namespace \
     --set prometheus.prometheusSpec.serviceMonitorSelectorNilUsesHelmValues=false \
     --set prometheus.prometheusSpec.podMonitorSelectorNilUsesHelmValues=false \
     --set prometheus.prometheusSpec.ruleSelectorNilUsesHelmValues=false
   ```

   **Important:** The `*NilUsesHelmValues=false` flags allow Prometheus to discover all ServiceMonitors, PodMonitors, and PrometheusRules across all namespaces, not just those with the Helm release label.

2. **Deploy the prometheus-controller:**

   ```bash
   cd /path/to/prometheus-controller
   make docker-build IMG=prometheus-controller:latest
   kind load docker-image prometheus-controller:latest --name <cluster-name>
   make deploy IMG=prometheus-controller:latest
   ```

3. **Install Flux CD and Kuberik rollout-controller** (if not already installed)

### Deploy Hello World with Prometheus

```bash
# Apply the hello-world manifests
kubectl apply -k example/hello-world/cd/base/

# Verify hello-python pods are running
kubectl get pods -n hello-world -l app=hello-python

# Verify ServiceMonitor is created
kubectl get servicemonitor -n hello-world

# Verify PrometheusRule is created
kubectl get prometheusrule -n hello-world

# Check HealthChecks
kubectl get healthchecks -n hello-world

# View health check status
kubectl describe healthcheck hello-world-prometheus-high-error-rate -n hello-world
kubectl describe healthcheck hello-world-prometheus-app-down -n hello-world
```

## Testing the Integration

### 1. Access the Application

```bash
# Port-forward to the hello-python service
kubectl port-forward -n hello-world svc/hello-python 8080:80

# Test the app endpoint
curl http://localhost:8080/

# View metrics
curl http://localhost:8080/metrics
```

### 2. Access Prometheus UI

```bash
# Port-forward to Prometheus (from kube-prometheus-stack)
kubectl port-forward -n monitoring svc/kube-prometheus-stack-prometheus 9090:9090

# Open in browser: http://localhost:9090
```

In Prometheus UI:
- Go to **Alerts** to see alert rules and their current state
- Go to **Graph** to query metrics:
  - `http_requests_total`
  - `rate(http_requests_total[1m])`
  - `http_errors_total`
  - `ALERTS{alertname="HighErrorRate"}`

### 3. Access Grafana UI

```bash
# Port-forward to Grafana
kubectl port-forward -n monitoring svc/kube-prometheus-stack-grafana 3000:80

# Open in browser: http://localhost:3000
# Default credentials: admin / prom-operator
```

### 4. Trigger Alerts

#### Simulate High Error Rate

Modify the hello-world app to introduce errors:

```bash
kubectl edit configmap hello-python-script -n hello-world
```

Add error injection in the `do_GET` method:

```python
def do_GET(self):
    start = time.time()

    if self.path == "/metrics":
        # ... existing metrics code
    else:
        try:
            metrics.inc_requests()

            # Inject errors randomly
            if random.random() < 0.2:  # 20% error rate
                metrics.inc_errors()
                self.send_response(500)
                self.send_header("Content-type", "text/plain")
                self.end_headers()
                self.wfile.write(b"Simulated error\n")
                return

            # ... rest of existing code
```

Restart pods to pick up the change:
```bash
kubectl rollout restart deployment hello-python -n hello-world
```

Generate traffic to trigger the alert:
```bash
# Generate requests
for i in {1..100}; do curl http://localhost:8080/ & done
```

Watch the alert fire:
```bash
# Check Prometheus alerts
kubectl port-forward -n monitoring svc/kube-prometheus-stack-prometheus 9090:9090
# Open: http://localhost:9090/alerts

# Watch HealthCheck status
kubectl get healthcheck hello-world-prometheus-high-error-rate -n hello-world -w
```

The HealthCheck should transition:
- `Healthy` → `Pending` (alert pending)
- `Pending` → `Unhealthy` (alert firing after 1 minute)

#### Simulate App Down

```bash
# Scale down the deployment
kubectl scale deployment hello-python -n hello-world --replicas=0

# Wait ~1 minute for AppDown alert to fire
kubectl get healthcheck hello-world-prometheus-app-down -n hello-world -w
```

The HealthCheck status will show:
- `lastErrorTime` updated when alert fires
- `message` indicating the alert is firing

## Integration with Rollouts

The Rollout configuration at `cd/base/resources.yaml` includes:

```yaml
spec:
  healthCheckSelector:
    selector:
      matchLabels:
        app: hello-world
```

This selector will match all HealthChecks with the `app: hello-world` label, including:
1. `hello-world-kustomization-health-check` (Flux deployment health)
2. `hello-world-prometheus-high-error-rate` (High error rate alert)
3. `hello-world-prometheus-app-down` (App down alert)

When any of these HealthChecks becomes `Unhealthy`, the Rollout will be blocked from progressing to the next step.

## Monitoring Query Examples

### PromQL Queries

```promql
# Request rate per second
rate(http_requests_total[1m])

# Error rate per second
rate(http_errors_total[1m])

# Error percentage
(rate(http_errors_total[1m]) / rate(http_requests_total[1m])) * 100

# Average request duration
rate(http_request_duration_seconds_sum[1m]) / rate(http_requests_total[1m])

# Check if alerts are firing
ALERTS{alertname="HighErrorRate", alertstate="firing"}
ALERTS{alertname="AppDown", alertstate="firing"}

# Pod uptime
process_uptime_seconds
```

## Architecture Diagram

```
┌─────────────────┐
│  hello-python   │──┐
│   Deployment    │  │
│                 │  │
│  /metrics       │◄─┤
│  exposed        │  │
└─────────────────┘  │
                     │
┌─────────────────┐  │
│ ServiceMonitor  │  │ defines scrape config
│                 │  │
│ selector:       │  │
│   app:          │  │
│   hello-python  │  │
└────────┬────────┘  │
         │           │
         │ discovered by
         │           │
┌────────▼───────────▼──┐
│   Prometheus Server   │
│  (kube-prometheus)    │
│                       │
│  - Scrapes pods       │
│  - Evaluates rules    │
│  - Stores TSDB        │
└────────┬──────────────┘
         │
         │ queries /api/v1/query_range
         │
┌────────▼────────────────────────┐
│  prometheus-controller          │
│                                  │
│  PrometheusAlertHealthCheck     │
│  Reconciler                     │
│                                  │
│  - Polls Prometheus API         │
│  - Checks ALERTS{labels...}     │
│  - Updates HealthCheck status   │
└────────┬────────────────────────┘
         │
         │ updates status
         │
┌────────▼────────┐
│   HealthCheck   │
│   Resources     │
│                 │
│  - high-error   │
│  - app-down     │
└────────┬────────┘
         │
         │ monitors health
         │
┌────────▼────────┐
│ rollout-        │
│ controller      │
│                 │
│ Blocks rollout  │
│ if unhealthy    │
└─────────────────┘
```

## ServiceMonitor vs Pod Annotations

This example uses a **ServiceMonitor** resource instead of pod annotations (`prometheus.io/scrape: "true"`) because:

1. **Best Practice with Prometheus Operator:** ServiceMonitors are the idiomatic way to configure scraping in Prometheus Operator
2. **Declarative Configuration:** The scrape configuration is in a CRD, making it version-controlled and auditable
3. **Namespace Isolation:** ServiceMonitors can be deployed alongside the application manifests
4. **Better Control:** More powerful relabeling and configuration options than annotations

The pod annotations in `resources.yaml` are informational but not used by Prometheus Operator.

## Cleanup

```bash
kubectl delete -k example/hello-world/cd/base/
kubectl delete namespace hello-world

# Optionally uninstall kube-prometheus-stack
helm uninstall kube-prometheus-stack -n monitoring
kubectl delete namespace monitoring
```

## Next Steps

1. **Configure Alertmanager:** Set up alerting to Slack/PagerDuty
2. **Add more metrics:** Track business metrics (user actions, feature usage)
3. **Create custom dashboards:** Use Grafana to visualize application metrics
4. **Tune alert thresholds:** Adjust based on baseline traffic patterns
5. **Add authentication:** Configure Prometheus with TLS and RBAC
6. **Multi-cluster monitoring:** Use Thanos or Cortex for long-term storage and federation
