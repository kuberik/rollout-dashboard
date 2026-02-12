import { describe, it, expect } from 'vitest';
import { isFieldManaged, isFieldManagedByManager, isFieldManagedByOtherManager, parseLinkAnnotations, extractDatadogInfoFromContainers, buildDatadogTestRunsUrl, buildDatadogLogsUrl } from './utils';

describe('Field Manager Validation', () => {
    describe('isFieldManaged', () => {
        it('should correctly parse fieldsV1 YAML structure and validate field paths', () => {
            // Example fieldsV1 from a real Kubernetes resource
            const fieldsV1 = {
                'f:spec': {
                    'f:wantedVersion': {}
                }
            };

            expect(isFieldManaged(fieldsV1, 'spec.wantedVersion')).toBe(true);
            expect(isFieldManaged(fieldsV1, 'spec')).toBe(true);
            expect(isFieldManaged(fieldsV1, 'metadata.name')).toBe(false);
            expect(isFieldManaged(fieldsV1, 'spec.otherField')).toBe(false);
        });

        it('should handle nested field paths correctly', () => {
            const fieldsV1 = {
                'f:spec': {
                    'f:healthCheckSelector': {
                        'f:matchLabels': {
                            'f:app': {}
                        }
                    }
                }
            };

            expect(isFieldManaged(fieldsV1, 'spec.healthCheckSelector.matchLabels.app')).toBe(true);
            expect(isFieldManaged(fieldsV1, 'spec.healthCheckSelector')).toBe(true);
            expect(isFieldManaged(fieldsV1, 'spec.healthCheckSelector.matchLabels')).toBe(true);
            expect(isFieldManaged(fieldsV1, 'spec.healthCheckSelector.matchLabels.other')).toBe(false);
        });

        it('should handle empty or undefined fieldsV1', () => {
            expect(isFieldManaged('', 'spec.wantedVersion')).toBe(false);
            expect(isFieldManaged({}, 'spec.wantedVersion')).toBe(false);
            expect(isFieldManaged(undefined, 'spec.wantedVersion')).toBe(false);
        });
    });

    describe('isFieldManagedByManager', () => {
        it('should correctly identify when a specific manager owns a field', () => {
            const managedFields = [
                {
                    manager: 'rollout-dashboard',
                    fieldsV1: {
                        'f:spec': {
                            'f:wantedVersion': {}
                        }
                    }
                },
                {
                    manager: 'kubectl',
                    fieldsV1: {
                        'f:metadata': {
                            'f:labels': {}
                        }
                    }
                }
            ];

            expect(isFieldManagedByManager(managedFields, 'rollout-dashboard', 'spec.wantedVersion')).toBe(true);
            expect(isFieldManagedByManager(managedFields, 'kubectl', 'metadata.labels')).toBe(true);
            expect(isFieldManagedByManager(managedFields, 'rollout-dashboard', 'metadata.labels')).toBe(false);
            expect(isFieldManagedByManager(managedFields, 'kubectl', 'spec.wantedVersion')).toBe(false);
        });

        it('should handle empty or undefined managedFields', () => {
            expect(isFieldManagedByManager([], 'rollout-dashboard', 'spec.wantedVersion')).toBe(false);
            expect(isFieldManagedByManager(undefined as any, 'rollout-dashboard', 'spec.wantedVersion')).toBe(false);
        });

        it('should handle fields without fieldsV1', () => {
            const managedFields = [
                {
                    manager: 'rollout-dashboard',
                    fieldsV1: undefined
                }
            ];

            expect(isFieldManagedByManager(managedFields, 'rollout-dashboard', 'spec.wantedVersion')).toBe(false);
        });
    });

    describe('isFieldManagedByOtherManager', () => {
        it('should correctly identify when other managers own a field', () => {
            const managedFields = [
                {
                    manager: 'rollout-dashboard',
                    fieldsV1: {
                        'f:metadata': {
                            'f:annotations': {}
                        }
                    }
                },
                {
                    manager: 'kubectl',
                    fieldsV1: {
                        'f:spec': {
                            'f:wantedVersion': {}
                        }
                    }
                }
            ];

            expect(isFieldManagedByOtherManager(managedFields, 'rollout-dashboard', 'spec.wantedVersion')).toBe(true);
            expect(isFieldManagedByOtherManager(managedFields, 'rollout-dashboard', 'metadata.annotations')).toBe(false);
            expect(isFieldManagedByOtherManager(managedFields, 'kubectl', 'spec.wantedVersion')).toBe(false);
        });

        it('should ignore empty manager names', () => {
            const managedFields = [
                {
                    manager: '',
                    fieldsV1: {
                        'f:spec': {
                            'f:wantedVersion': {}
                        }
                    }
                },
                {
                    manager: 'kubectl',
                    fieldsV1: {
                        'f:metadata': {
                            'f:labels': {}
                        }
                    }
                }
            ];

            expect(isFieldManagedByOtherManager(managedFields, 'rollout-dashboard', 'spec.wantedVersion')).toBe(false);
            expect(isFieldManagedByOtherManager(managedFields, 'rollout-dashboard', 'metadata.labels')).toBe(true);
        });

        it('should handle empty or undefined managedFields', () => {
            expect(isFieldManagedByOtherManager([], 'rollout-dashboard', 'spec.wantedVersion')).toBe(false);
            expect(isFieldManagedByOtherManager(undefined as any, 'rollout-dashboard', 'spec.wantedVersion')).toBe(false);
        });
    });

    describe('Real-world examples', () => {
        it('should handle the example from the attached file', () => {
            // This is a real fieldsV1 example from the attached file
            const fieldsV1 = {
                'f:metadata': {
                    'f:annotations': {
                        '.': {},
                        'f:dashboard.rollout.kuberik.com/description': {},
                        'f:kubectl.kubernetes.io/last-applied-configuration': {}
                    },
                    'f:labels': {
                        '.': {},
                        'f:environment': {}
                    }
                },
                'f:spec': {
                    '.': {},
                    'f:healthCheckSelector': {},
                    'f:minBakeTime': {},
                    'f:releasesImagePolicy': {},
                    'f:versionHistoryLimit': {}
                }
            };

            expect(isFieldManaged(fieldsV1, 'metadata.annotations')).toBe(true);
            expect(isFieldManaged(fieldsV1, 'metadata.labels.environment')).toBe(true);
            expect(isFieldManaged(fieldsV1, 'spec.healthCheckSelector')).toBe(true);
            expect(isFieldManaged(fieldsV1, 'spec.wantedVersion')).toBe(false); // This field is not managed
            expect(isFieldManaged(fieldsV1, 'spec.releasesImagePolicy')).toBe(true);
        });
    });
});

describe('parseLinkAnnotations', () => {
    it('should return empty array for undefined annotations', () => {
        expect(parseLinkAnnotations(undefined)).toEqual([]);
    });

    it('should return empty array for empty annotations', () => {
        expect(parseLinkAnnotations({})).toEqual([]);
    });

    it('should return empty array when no annotations match the link prefix', () => {
        const annotations = {
            'kubectl.kubernetes.io/last-applied-configuration': '{}',
            'rollout.kuberik.com/bypass-gates': 'v1.2.3'
        };
        expect(parseLinkAnnotations(annotations)).toEqual([]);
    });

    it('should extract a single link annotation', () => {
        const annotations = {
            'rollout.kuberik.com/link.Logs': 'https://example.com/logs'
        };
        expect(parseLinkAnnotations(annotations)).toEqual([
            { label: 'Logs', url: 'https://example.com/logs' }
        ]);
    });

    it('should extract multiple link annotations', () => {
        const annotations = {
            'rollout.kuberik.com/link.Logs': 'https://example.com/logs',
            'rollout.kuberik.com/link.CI': 'https://example.com/ci'
        };
        const result = parseLinkAnnotations(annotations);
        expect(result).toHaveLength(2);
        expect(result).toContainEqual({ label: 'Logs', url: 'https://example.com/logs' });
        expect(result).toContainEqual({ label: 'CI', url: 'https://example.com/ci' });
    });

    it('should ignore non-link annotations mixed in', () => {
        const annotations = {
            'kubectl.kubernetes.io/last-applied-configuration': '{}',
            'rollout.kuberik.com/link.Logs': 'https://example.com/logs',
            'rollout.kuberik.com/bypass-gates': 'v1.0.0',
            'rollout.kuberik.com/link.CI': 'https://example.com/ci'
        };
        const result = parseLinkAnnotations(annotations);
        expect(result).toHaveLength(2);
        expect(result).toContainEqual({ label: 'Logs', url: 'https://example.com/logs' });
        expect(result).toContainEqual({ label: 'CI', url: 'https://example.com/ci' });
    });

    it('should preserve the full URL value including encoded characters', () => {
        const annotations = {
            'rollout.kuberik.com/link.CI': 'https://app.datadoghq.com/ci/test/runs?query=test_level%3Atest%20-%40ci.provider.name%3Agithub%20%40test.service%3Amyservice%20%40version%3Av1.0.0'
        };
        const result = parseLinkAnnotations(annotations);
        expect(result).toEqual([
            {
                label: 'CI',
                url: 'https://app.datadoghq.com/ci/test/runs?query=test_level%3Atest%20-%40ci.provider.name%3Agithub%20%40test.service%3Amyservice%20%40version%3Av1.0.0'
            }
        ]);
    });
});

describe('extractDatadogInfoFromContainers', () => {
    it('should return null for empty containers array', () => {
        expect(extractDatadogInfoFromContainers([])).toBeNull();
    });

    it('should return null when no DD env vars are present', () => {
        const containers = [{ env: [{ name: 'FOO', value: 'bar' }] }];
        expect(extractDatadogInfoFromContainers(containers)).toBeNull();
    });

    it('should return null when only DD_SERVICE is present', () => {
        const containers = [{ env: [{ name: 'DD_SERVICE', value: 'my-service' }] }];
        expect(extractDatadogInfoFromContainers(containers)).toBeNull();
    });

    it('should return null when only DD_ENV is present', () => {
        const containers = [{ env: [{ name: 'DD_ENV', value: 'dev' }] }];
        expect(extractDatadogInfoFromContainers(containers)).toBeNull();
    });

    it('should extract service and env when both are present', () => {
        const containers = [{
            env: [
                { name: 'DD_SERVICE', value: 'my-service' },
                { name: 'DD_ENV', value: 'production' }
            ]
        }];
        expect(extractDatadogInfoFromContainers(containers)).toEqual({
            service: 'my-service',
            env: 'production'
        });
    });

    it('should extract service, env and version when all are present', () => {
        const containers = [{
            env: [
                { name: 'DD_SERVICE', value: 'my-service' },
                { name: 'DD_ENV', value: 'production' },
                { name: 'DD_VERSION', value: 'main-1770831919-d4cd2de3ed1185943c9105df735a099a2165c7ce' }
            ]
        }];
        expect(extractDatadogInfoFromContainers(containers)).toEqual({
            service: 'my-service',
            env: 'production',
            version: 'main-1770831919-d4cd2de3ed1185943c9105df735a099a2165c7ce'
        });
    });

    it('should return info without version when DD_VERSION is absent', () => {
        const containers = [{
            env: [
                { name: 'DD_SERVICE', value: 'my-service' },
                { name: 'DD_ENV', value: 'staging' }
            ]
        }];
        const result = extractDatadogInfoFromContainers(containers);
        expect(result).toEqual({ service: 'my-service', env: 'staging' });
        expect(result?.version).toBeUndefined();
    });

    it('should find DD tags in a second container if first has none', () => {
        const containers = [
            { env: [{ name: 'FOO', value: 'bar' }] },
            {
                env: [
                    { name: 'DD_SERVICE', value: 'backend' },
                    { name: 'DD_ENV', value: 'staging' }
                ]
            }
        ];
        expect(extractDatadogInfoFromContainers(containers)).toEqual({
            service: 'backend',
            env: 'staging'
        });
    });

    it('should handle containers with no env field', () => {
        const containers = [{}];
        expect(extractDatadogInfoFromContainers(containers)).toBeNull();
    });

    it('should ignore env vars with empty values', () => {
        const containers = [{
            env: [
                { name: 'DD_SERVICE', value: '' },
                { name: 'DD_ENV', value: 'dev' }
            ]
        }];
        expect(extractDatadogInfoFromContainers(containers)).toBeNull();
    });
});

describe('buildDatadogTestRunsUrl', () => {
    it('should build a URL with service and version', () => {
        const url = buildDatadogTestRunsUrl('my-service', 'v1.0.0');
        expect(url).toContain('https://app.datadoghq.com/ci/test/runs?query=');
        expect(url).toContain(encodeURIComponent('@test.service:my-service'));
        expect(url).toContain(encodeURIComponent('@version:v1.0.0'));
    });
});

describe('buildDatadogLogsUrl', () => {
    it('should build a URL with service and env', () => {
        const url = buildDatadogLogsUrl('my-service', 'production');
        expect(url).toContain('https://app.datadoghq.com/logs?query=');
        expect(url).toContain(encodeURIComponent('service:my-service'));
        expect(url).toContain(encodeURIComponent('env:production'));
        expect(url).toContain('&live=true');
    });
});
