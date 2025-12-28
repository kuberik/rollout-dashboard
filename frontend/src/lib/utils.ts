import type { Rollout } from "../types";


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
