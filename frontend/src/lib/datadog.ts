import type { ManagedResourceStatus } from '../types';

export interface DatadogServiceInfo {
	service: string;
	env: string;
	url: string;
}

/**
 * Extract Datadog service info from managed resources by scanning
 * Deployment containers for DD_SERVICE and DD_ENV environment variables.
 */
export function extractDatadogServiceInfo(
	managedResources: Record<string, ManagedResourceStatus[]>
): DatadogServiceInfo | null {
	const allResources = Object.values(managedResources).flat();

	for (const resource of allResources) {
		const gvk = resource.groupVersionKind || '';
		if (gvk.includes('apps/v1') && gvk.includes('Deployment') && resource.object) {
			const deployment = resource.object;
			const containers = deployment.spec?.template?.spec?.containers || [];

			for (const container of containers) {
				const env = container.env || [];
				let ddService: string | null = null;
				let ddEnv: string | null = null;

				for (const envVar of env) {
					if (envVar.name === 'DD_SERVICE' && envVar.value) {
						ddService = envVar.value;
					}
					if (envVar.name === 'DD_ENV' && envVar.value) {
						ddEnv = envVar.value;
					}
				}

				if (ddService && ddEnv) {
					const url = `https://app.datadoghq.com/apm/entity/service:${encodeURIComponent(ddService)}?env=${encodeURIComponent(ddEnv)}`;
					return { service: ddService, env: ddEnv, url };
				}
			}
		}
	}

	return null;
}
