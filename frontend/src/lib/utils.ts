import type { Rollout, Kustomization, OCIRepository } from "../types";


export function formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

export function formatTimeAgo(start: string, end: Date = new Date()): string {
    return `${formatDuration(start, end)} ago`;
}

// For in-flight rollouts (Baking/Deploying), prepend the verb so the
// timestamp clearly reads as time-in-state — a baking rollout sitting
// at 'baking 2h' jumps out as stuck, while 'baking 30s' looks normal.
// Returns just the timestamp for terminal states (timestamp alone is
// clear when there's no ongoing process).
export function formatStatusTime(
    bakeStatus: string,
    timestamp: string | null | undefined,
    now: Date = new Date()
): string {
    if (!timestamp) return '';
    const t = formatTimeAgoCompact(timestamp, now);
    if (bakeStatus === 'InProgress') return `baking ${t}`;
    if (bakeStatus === 'Deploying') return `deploying ${t}`;
    return t;
}

// Compare two rollouts' current versions using their actual deploy history,
// not env-name tier ordering. Direction is derived from data: if my current
// version appears as a past entry in the other rollout's history, the other
// has already deployed and moved past my version → I'm behind. Conversely,
// if the other's current version appears as a past entry in my history,
// I've already deployed past it → I'm ahead. When the versions diverge
// without history overlap, returns 'divergent'.
export type RolloutRelation =
    | { kind: 'same' }
    | { kind: 'behind'; otherVersion: string; by: number | null }
    | { kind: 'ahead'; otherVersion: string; by: number | null }
    | { kind: 'divergent'; otherVersion: string };

export function compareRollouts(
    myRollout: Rollout | null | undefined,
    otherRollout: Rollout | null | undefined
): RolloutRelation | null {
    if (!myRollout || !otherRollout) return null;
    const myH = myRollout.status?.history ?? [];
    const otherH = otherRollout.status?.history ?? [];
    const myV = myH[0] ? getDisplayVersion(myH[0].version) : null;
    const otherV = otherH[0] ? getDisplayVersion(otherH[0].version) : null;
    if (!myV || !otherV) return null;
    if (myV === otherV) return { kind: 'same' };

    const myVInOtherPast = otherH.slice(1).some((h) => getDisplayVersion(h.version) === myV);
    const otherVInMyPast = myH.slice(1).some((h) => getDisplayVersion(h.version) === otherV);

    if (myVInOtherPast && !otherVInMyPast) {
        const distinct: string[] = [];
        for (const h of otherH) {
            const v = getDisplayVersion(h.version);
            if (distinct[distinct.length - 1] !== v) distinct.push(v);
            if (v === myV) break;
        }
        const idx = distinct.indexOf(myV);
        return { kind: 'behind', otherVersion: otherV, by: idx >= 0 ? idx : null };
    }
    if (otherVInMyPast && !myVInOtherPast) {
        const distinct: string[] = [];
        for (const h of myH) {
            const v = getDisplayVersion(h.version);
            if (distinct[distinct.length - 1] !== v) distinct.push(v);
            if (v === otherV) break;
        }
        const idx = distinct.indexOf(otherV);
        return { kind: 'ahead', otherVersion: otherV, by: idx >= 0 ? idx : null };
    }
    return { kind: 'divergent', otherVersion: otherV };
}

// Classify a bakeStatusMessage / failure message into a short diagnostic
// category. The full message is too noisy for list cards; a category tag
// ("healthcheck", "image", "gate", "test", "timeout") gives the on-call
// user enough signal to triage without leaving the list view.
export function categorizeFailure(msg: string | null | undefined): string | null {
    if (!msg) return null;
    const m = msg.toLowerCase();
    if (/health.?check|liveness|readiness/.test(m)) return 'healthcheck';
    if (/image.?pull|cannot pull|registry|pullbackoff|errimagepull|imagepullbackoff/.test(m)) return 'image';
    if (/gate/.test(m)) return 'gate';
    if (/test/.test(m)) return 'test';
    if (/timeout|timed out|deadline/.test(m)) return 'timeout';
    if (/canary|kruise/.test(m)) return 'canary';
    if (/manifest|render|kustom|invalid yaml|invalid spec/.test(m)) return 'manifest';
    if (/permission|forbidden|unauthorized|rbac/.test(m)) return 'permission';
    if (/crashloop|oom|killed/.test(m)) return 'crash';
    if (/network|dial|connection refused|unreachable/.test(m)) return 'network';
    return 'failed';
}

export function formatTimeAgoCompact(start: string, end: Date = new Date()): string {
    const date = new Date(start);
    const s = Math.floor((end.getTime() - date.getTime()) / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d`;
    const mo = Math.floor(d / 30);
    if (mo < 12) return `${mo}mo`;
    return `${Math.floor(mo / 12)}y`;
}

export function formatDuration(timestamp: string, now: Date = new Date()): string {
    const date = new Date(timestamp);
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) {
        return `${diffInSeconds} second${diffInSeconds === 1 ? '' : 's'}`;
    }

    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) {
        return `${diffInMinutes} minute${diffInMinutes === 1 ? '' : 's'}`;
    }

    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) {
        return `${diffInHours} hour${diffInHours === 1 ? '' : 's'}`;
    }

    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 30) {
        return `${diffInDays} day${diffInDays === 1 ? '' : 's'}`;
    }

    const diffInMonths = Math.floor(diffInDays / 30);
    if (diffInMonths < 12) {
        return `${diffInMonths} month${diffInMonths === 1 ? '' : 's'}`;
    }

    const diffInYears = Math.floor(diffInMonths / 12);
    return `${diffInYears} year${diffInYears === 1 ? '' : 's'}`;
}

type StatusColor = 'yellow' | 'green' | 'red';

export function getRolloutStatus(deployment: Rollout): { color: StatusColor; text: string } {
    const readyCondition = deployment.status?.conditions?.find((c) => c.type === 'Ready');
    if (!readyCondition) {
        return { color: 'yellow', text: 'Unknown' };
    }
    return readyCondition.status === 'True'
        ? { color: 'green', text: 'Ready' }
        : { color: 'red', text: 'Error' };
}

/**
 * Parses the fieldsV1 YAML-like structure and checks if a specific field path is managed
 * @param fieldsV1 The fieldsV1 object from managedFields (already parsed from YAML)
 * @param fieldPath The field path to check (e.g., "spec.wantedVersion")
 * @returns true if the field path is managed, false otherwise
 */
export function isFieldManaged(fieldsV1: any, fieldPath: string): boolean {
    if (!fieldsV1 || typeof fieldsV1 !== 'object') {
        return false;
    }

    // Split the field path into parts
    const pathParts = fieldPath.split('.');

    // Navigate through the fieldsV1 object to check if the path exists
    let current = fieldsV1;
    for (const part of pathParts) {
        if (current && typeof current === 'object') {
            // Check for the field with 'f:' prefix
            const fieldKey = `f:${part}`;
            if (fieldKey in current) {
                current = current[fieldKey];
            } else {
                return false;
            }
        } else {
            return false;
        }
    }

    // If we reach here, the field path exists in the managed fields
    return true;
}

/**
 * Checks if a specific field is managed by a specific manager
 * @param managedFields Array of managed fields from metadata
 * @param managerName The name of the manager to check
 * @param fieldPath The field path to check (e.g., "spec.wantedVersion")
 * @returns true if the field is managed by the specified manager, false otherwise
 */
export function isFieldManagedByManager(
    managedFields: Array<{ manager?: string; fieldsV1?: any }>,
    managerName: string,
    fieldPath: string
): boolean {
    if (!managedFields || !Array.isArray(managedFields)) {
        return false;
    }

    for (const field of managedFields) {
        if (field.manager === managerName && field.fieldsV1) {
            if (isFieldManaged(field.fieldsV1, fieldPath)) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Checks if any field is managed by managers other than the specified one
 * @param managedFields Array of managed fields from metadata
 * @param managerName The name of the manager to exclude from the check
 * @param fieldPath The field path to check (e.g., "spec.wantedVersion")
 * @returns true if the field is managed by another manager, false otherwise
 */
export function isFieldManagedByOtherManager(
    managedFields: Array<{ manager?: string; fieldsV1?: any }>,
    managerName: string,
    fieldPath: string
): boolean {
    if (!managedFields || !Array.isArray(managedFields)) {
        return false;
    }

    for (const field of managedFields) {
        if (field.manager && field.manager !== managerName && field.manager !== '' && field.fieldsV1) {
            if (isFieldManaged(field.fieldsV1, fieldPath)) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Checks if a rollout has the force-deploy annotation and returns the version
 * @param rollout The rollout to check
 * @returns The version that is being force deployed, or null if no force deploy is set
 */
export function getForceDeployVersion(rollout: Rollout): string | null {
    return rollout.metadata?.annotations?.['rollout.kuberik.com/force-deploy'] || null;
}

/**
 * Checks if a rollout has the force-deploy annotation
 * @param rollout The rollout to check
 * @returns true if the force-deploy annotation exists
 */
export function hasForceDeployAnnotation(rollout?: Rollout): boolean {
    return rollout?.metadata?.annotations?.['rollout.kuberik.com/force-deploy'] !== undefined;
}

/**
 * Checks if a rollout has the bypass-gates annotation and returns the version
 * @param rollout The rollout to check
 * @returns The version that is bypassing gates, or null if no bypass is set
 */
export function getBypassGatesVersion(rollout: Rollout): string | null {
    return rollout.metadata?.annotations?.['rollout.kuberik.com/bypass-gates'] || null;
}

/**
 * Checks if a rollout has the bypass-gates annotation
 * @param rollout The rollout to check
 * @returns true if the bypass-gates annotation exists
 */
export function hasBypassGatesAnnotation(rollout: Rollout): boolean {
    return getBypassGatesVersion(rollout) !== null;
}

/**
 * Checks if a specific version is being force deployed
 * @param rollout The rollout to check
 * @param version The version to check
 * @returns true if the specified version is being force deployed
 */
export function isVersionForceDeploying(rollout: Rollout, version: string): boolean {
    const forceDeployVersion = getForceDeployVersion(rollout);
    return forceDeployVersion === version;
}

/**
 * Checks if a specific version is bypassing gates
 * @param rollout The rollout to check
 * @param version The version to check
 * @returns true if the specified version is bypassing gates
 */
export function isVersionBypassingGates(rollout: Rollout, version: string): boolean {
    const bypassVersion = getBypassGatesVersion(rollout);
    return bypassVersion === version;
}

/**
 * Checks if a rollout has a failed bake status and needs to be resumed
 * @param rollout The rollout to check
 * @returns true if the rollout has a failed bake status
 */
export function hasFailedBakeStatus(rollout: Rollout): boolean {
    if (!rollout?.status?.history || rollout.status.history.length === 0) {
        return false;
    }

    const lastDeployment = rollout.status.history[0];
    return lastDeployment.bakeStatus === 'Failed';
}

/**
 * Checks if a rollout has the unblock-failed annotation
 * @param rollout The rollout to check
 * @returns true if the unblock-failed annotation exists
 */
export function hasUnblockFailedAnnotation(rollout: Rollout): boolean {
    return rollout.metadata?.annotations?.['rollout.kuberik.com/unblock-failed'] === 'true';
}

// Helper function to get display version from version object or annotations
export function getDisplayVersion(versionInfo: {
    version?: string;
    revision?: string;
    tag: string;
}): string {
    return versionInfo.version || versionInfo.revision || versionInfo.tag;
}

/**
 * Extracts URL from gateway or ingress API resources
 * @param resource The managed resource with object field
 * @param groupVersionKind The groupVersionKind string (e.g., "networking.k8s.io/v1/Ingress")
 * @returns The URL string or null if not found
 */
export function extractURLFromGatewayOrIngress(resource: any, groupVersionKind: string): string | null {
    if (!resource?.object) {
        return null;
    }

    const obj = resource.object;
    const kind = groupVersionKind?.split('/').pop() || '';

    // Handle Gateway API resources
    if (groupVersionKind?.includes('gateway.networking.k8s.io')) {
        // Gateway resource
        if (kind === 'Gateway') {
            // Check status.addresses for hostname
            if (obj.status?.addresses && Array.isArray(obj.status.addresses)) {
                for (const addr of obj.status.addresses) {
                    if (addr.type === 'Hostname' && addr.value) {
                        // Determine scheme from listeners
                        let scheme = 'https';
                        if (obj.spec?.listeners && Array.isArray(obj.spec.listeners)) {
                            const httpListener = obj.spec.listeners.find((l: any) => l.protocol === 'HTTP');
                            if (httpListener) {
                                scheme = 'http';
                            }
                        }
                        return `${scheme}://${addr.value}`;
                    }
                }
            }
            // Fallback: check spec.listeners for hostname
            if (obj.spec?.listeners && Array.isArray(obj.spec.listeners)) {
                for (const listener of obj.spec.listeners) {
                    if (listener.hostname) {
                        const scheme = listener.protocol === 'HTTP' ? 'http' : 'https';
                        return `${scheme}://${listener.hostname}`;
                    }
                }
            }
        }
        // HTTPRoute resource
        if (kind === 'HTTPRoute') {
            // Check spec.hostnames
            if (obj.spec?.hostnames && Array.isArray(obj.spec.hostnames) && obj.spec.hostnames.length > 0) {
                const hostname = obj.spec.hostnames[0];
                // Try to determine scheme from parent gateway or default to https
                return `https://${hostname}`;
            }
        }
    }

    // Handle Ingress resources (networking.k8s.io)
    if (groupVersionKind?.includes('networking.k8s.io') && kind === 'Ingress') {
        // Check status.loadBalancer.ingress for hostname or IP
        if (obj.status?.loadBalancer?.ingress && Array.isArray(obj.status.loadBalancer.ingress)) {
            for (const ingress of obj.status.loadBalancer.ingress) {
                const hostname = ingress.hostname || ingress.ip;
                if (hostname) {
                    // Determine scheme from TLS
                    const scheme = obj.spec?.tls && obj.spec.tls.length > 0 ? 'https' : 'http';
                    return `${scheme}://${hostname}`;
                }
            }
        }
        // Fallback: check spec.rules for hostname
        if (obj.spec?.rules && Array.isArray(obj.spec.rules)) {
            for (const rule of obj.spec.rules) {
                if (rule.host) {
                    const scheme = obj.spec?.tls && obj.spec.tls.length > 0 ? 'https' : 'http';
                    return `${scheme}://${rule.host}`;
                }
            }
        }
    }

    return null;
}

export interface DatadogInfo {
	service: string;
	env: string;
	version?: string;
}

export function extractDatadogInfoFromContainers(
	containers: { env?: { name: string; value?: string }[] }[]
): DatadogInfo | null {
	for (const container of containers) {
		let ddService: string | null = null;
		let ddEnv: string | null = null;
		let ddVersion: string | null = null;
		for (const envVar of container.env || []) {
			if (envVar.name === 'DD_SERVICE' && envVar.value) ddService = envVar.value;
			if (envVar.name === 'DD_ENV' && envVar.value) ddEnv = envVar.value;
			if (envVar.name === 'DD_VERSION' && envVar.value) ddVersion = envVar.value;
		}
		if (ddService && ddEnv) return { service: ddService, env: ddEnv, ...(ddVersion ? { version: ddVersion } : {}) };
	}
	return null;
}

export function buildDatadogTestRunsUrl(service: string, version: string): string {
	return `https://app.datadoghq.com/ci/test/runs?query=${encodeURIComponent(`test_level:test -@ci.provider.name:github @test.service:${service} @version:${version}`)}`;
}

export function buildDatadogLogsUrl(service: string, env: string): string {
	return `https://app.datadoghq.com/logs?query=${encodeURIComponent(`service:${service} env:${env}`)}&live=true`;
}

/**
 * Datadog APM trace search filtered to spans emitted by the rollout test.
 *
 * The rollout-test image (see `tests/rollout/src/instrumentation.ts` in the
 * caffeine app repo) wraps each Playwright test + step in custom APM spans
 * tagged `@rollout.test:true`. Pairing that marker with the standard
 * unified-service tags (`service`, `env`, `version`) narrows the result
 * to exactly the traces produced by the canary's rollout-test Job — the
 * service Deployment's regular APM traffic, which carries the same
 * `service`/`env`/`version` tags but lacks `@rollout.test:true`, is
 * excluded.
 *
 * Each Playwright test produces one trace (root: `rollout_test.test`,
 * children: `rollout_test.step` per `test.step()` call), so the search
 * returns one row per test (more on Job retries) and each row drills
 * into a step-level flame graph.
 */
export function buildDatadogTraceSearchUrl(service: string, env: string, version?: string): string {
	const filters = [`service:${service}`, `env:${env}`, '@rollout.test:true'];
	if (version) filters.splice(2, 0, `version:${version}`);
	return `https://app.datadoghq.com/apm/traces?query=${encodeURIComponent(filters.join(' '))}`;
}

export function getResourceStatus(resource: Kustomization | OCIRepository) {
	const readyCondition = resource.status?.conditions?.find((c) => c.type === 'Ready');
	if (!readyCondition) return { status: 'Unknown', color: 'gray' as const };

	if (readyCondition.status === 'True') return { status: 'Ready', color: 'green' as const };

	const reconcilingCondition = resource.status?.conditions?.find((c) => c.type === 'Reconciling');
	const isReconciling =
		reconcilingCondition?.status === 'True' ||
		readyCondition.status === 'Unknown' ||
		readyCondition.reason?.toLowerCase().includes('progress');
	if (isReconciling) return { status: 'Reconciling', color: 'yellow' as const };

	return { status: 'Failed', color: 'red' as const };
}

export function getLastTransitionTime(resource: Kustomization | OCIRepository) {
	const readyCondition = resource.status?.conditions?.find((c) => c.type === 'Ready');
	return readyCondition?.lastTransitionTime;
}

const LINK_ANNOTATION_PREFIX = 'rollout.kuberik.com/link.';

export function parseLinkAnnotations(
	annotations: Record<string, string> | undefined
): { label: string; url: string }[] {
	if (!annotations) return [];
	return Object.entries(annotations)
		.filter(([key]) => key.startsWith(LINK_ANNOTATION_PREFIX))
		.map(([key, url]) => ({
			label: key.slice(LINK_ANNOTATION_PREFIX.length),
			url
		}));
}
