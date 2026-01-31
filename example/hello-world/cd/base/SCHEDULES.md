# RolloutSchedule Examples

This directory contains example RolloutSchedule and ClusterRolloutSchedule resources for testing time-based deployment controls.

## What are RolloutSchedules?

RolloutSchedules control when deployments can occur based on:
- **Time ranges** (e.g., "09:00-17:00")
- **Days of week** (e.g., "Monday-Friday")
- **Date ranges** (e.g., "2026-12-23 to 2026-12-26")
- **Timezones** (e.g., "America/New_York")

## Actions

- **Allow**: Deployments are permitted during the schedule window, blocked outside it
- **Deny**: Deployments are blocked during the schedule window, permitted outside it

## Examples in this Directory

### In resources.yaml

1. **business-hours-allow** - Allow deployments only during weekday business hours (9 AM - 5 PM)
2. **weekend-only** - Restrict deployments to weekends only
3. **night-deployment** - Allow deployments overnight only (10 PM - 6 AM, cross-midnight window)

### In schedules.yaml

4. **maintenance-window** - Sunday early morning maintenance window (2 AM - 6 AM)
5. **flexible-window** - Multiple deployment windows (morning, afternoon, weekends)
6. **holiday-freeze** - Block deployments during holidays using date ranges
7. **production-peak-hours-deny** - ClusterRolloutSchedule that blocks peak hours across production namespaces

## Testing Locally

### Deploy the examples

```bash
# Deploy all resources including schedules
kubectl apply -k example/hello-world/cd/deployments/dev/

# Check deployed schedules
kubectl get rolloutschedules -n hello-world
kubectl get clusterrolloutschedules

# View schedule details
kubectl describe rolloutschedule business-hours-allow -n hello-world
```

### Check schedule status

The status shows:
- **active**: Whether the schedule is currently active
- **activeRules**: Which rules are currently matching
- **nextTransition**: When the active state will next change
- **managedGates**: RolloutGates created by this schedule
- **matchingRollouts**: Number of rollouts matched

```bash
kubectl get rolloutschedule business-hours-allow -n hello-world -o yaml
```

### Apply schedules to rollouts

Rollouts are matched by label selectors. For example:

```yaml
apiVersion: kuberik.com/v1alpha1
kind: Rollout
metadata:
  name: my-rollout
  labels:
    schedule: business-hours  # Matches business-hours-allow schedule
spec:
  # ...
```

The `hello-world-app` rollout in resources.yaml has the `schedule: business-hours` label applied.

### Test schedule behavior

1. **Check current time vs schedule rules** - Schedules evaluate against current time in the specified timezone

2. **View created RolloutGates** - Schedules automatically create RolloutGates:
   ```bash
   kubectl get rolloutgates -n hello-world
   kubectl describe rolloutgate business-hours-allow-hello-world-app -n hello-world
   ```

3. **Trigger a deployment** - Try deploying during and outside the allowed window to see gates in action

4. **Monitor in dashboard** - The rollout-dashboard will show:
   - Active schedules affecting the rollout
   - Gate status (passing/blocking)
   - Next transition time

## Modifying Examples for Testing

### Change timezone

```yaml
spec:
  timezone: "America/Los_Angeles"  # Pacific Time
```

### Adjust time windows

```yaml
spec:
  rules:
    - name: "custom-window"
      timeRange:
        start: "14:00"  # 2 PM
        end: "18:00"    # 6 PM
```

### Test cross-midnight windows

```yaml
spec:
  rules:
    - name: "night-shift"
      timeRange:
        start: "20:00"  # 8 PM
        end: "04:00"    # 4 AM next day
```

### Use current dates for holiday freeze

Update the dateRange to current dates to test immediately:

```yaml
spec:
  rules:
    - name: "test-freeze"
      dateRange:
        start: "2026-01-30"  # Today
        end: "2026-01-31"    # Tomorrow
```

## Common Use Cases

1. **Business hours only** - Prevent deployments outside work hours
2. **Maintenance windows** - Allow deployments only during scheduled maintenance
3. **Peak traffic protection** - Block deployments during high-traffic periods
4. **Weekend deployments** - Restrict risky changes to weekends
5. **Holiday freezes** - Prevent deployments during holidays
6. **Night deployments** - Low-risk deployments overnight

## Troubleshooting

### Schedule not activating

1. Check timezone is correct
2. Verify rollout has matching labels
3. Check rules evaluate to true for current time
4. View status: `kubectl describe rolloutschedule <name>`

### Gate not blocking deployment

1. Verify the schedule is active
2. Check the Action (Allow vs Deny)
3. Ensure rollout references the gate
4. Check gate's `passing` status

### Cross-namespace schedules not working

1. Use ClusterRolloutSchedule (not RolloutSchedule)
2. Verify namespaceSelector matches target namespaces
3. Check RBAC permissions for the controller
