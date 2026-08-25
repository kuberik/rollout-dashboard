import { describe, it, expect } from 'vitest';
import { isFieldManaged, isFieldManagedByManager, isFieldManagedByOtherManager, parseLinkAnnotations, extractDatadogInfoFromContainers, buildDatadogTestRunsUrl, buildDatadogLogsUrl, buildDatadogTraceSearchUrl, shortenVersion, getGitHubRef, buildGitHubTreeUrl } from './utils';
import {
    ENVIRONMENT_THEME_ANNOTATION,
    ENVIRONMENT_THEME_COLOR_ANNOTATION,
    ENVIRONMENT_THEME_LABEL_ANNOTATION,
    getEnvironmentThemeStyle,
    getRolloutEnvironmentTheme
} from './environment-theme';

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

describe('environment themes', () => {
    it('returns null when a rollout has no theme annotations', () => {
        expect(getRolloutEnvironmentTheme({ metadata: { annotations: {} } } as any)).toBeNull();
        expect(getRolloutEnvironmentTheme(null)).toBeNull();
    });

    it('maps production to a non-red preset theme', () => {
        const theme = getRolloutEnvironmentTheme({
            metadata: {
                annotations: {
                    [ENVIRONMENT_THEME_ANNOTATION]: 'prod'
                }
            }
        } as any);

        expect(theme?.label).toBe('Production');
        expect(theme?.color).toBe('#d97706');
        expect(theme?.color).not.toMatch(/^#(?:dc2626|ef4444|f87171)$/);
    });

    it('infers production from an Environment name containing prod', () => {
        const theme = getRolloutEnvironmentTheme({ metadata: { annotations: {} } } as any, 'eu-prod-1');

        expect(theme?.label).toBe('eu-prod-1');
        expect(theme?.color).toBe('#d97706');
    });

    it('infers development from Environment spec.environment', () => {
        const theme = getRolloutEnvironmentTheme(
            { metadata: { annotations: {} } } as any,
            { spec: { environment: 'development-west' } } as any
        );

        expect(theme?.label).toBe('development-west');
        expect(theme?.color).toBe('#16a34a');
    });

    it('lets a theme annotation override the inferred environment theme', () => {
        const theme = getRolloutEnvironmentTheme(
            {
                metadata: {
                    annotations: {
                        [ENVIRONMENT_THEME_ANNOTATION]: 'dev'
                    }
                }
            } as any,
            'eu-prod-1'
        );

        expect(theme?.label).toBe('Development');
        expect(theme?.color).toBe('#16a34a');
    });

    it('lets a custom color annotation override the inferred environment color', () => {
        const theme = getRolloutEnvironmentTheme(
            {
                metadata: {
                    annotations: {
                        [ENVIRONMENT_THEME_COLOR_ANNOTATION]: '#0EA5E9'
                    }
                }
            } as any,
            'eu-prod-1'
        );

        expect(theme?.label).toBe('eu-prod-1');
        expect(theme?.color).toBe('#0ea5e9');
    });

    it('maps development to the green preset theme', () => {
        const theme = getRolloutEnvironmentTheme({
            metadata: {
                annotations: {
                    [ENVIRONMENT_THEME_ANNOTATION]: 'development'
                }
            }
        } as any);

        expect(theme?.label).toBe('Development');
        expect(theme?.color).toBe('#16a34a');
    });

    it('uses a custom hex color annotation with an optional label', () => {
        const theme = getRolloutEnvironmentTheme({
            metadata: {
                annotations: {
                    [ENVIRONMENT_THEME_COLOR_ANNOTATION]: '#0EA5E9',
                    [ENVIRONMENT_THEME_LABEL_ANNOTATION]: 'Sandbox'
                }
            }
        } as any);

        expect(theme?.label).toBe('Sandbox');
        expect(theme?.color).toBe('#0ea5e9');
    });

    it('rejects invalid custom color values', () => {
        const theme = getRolloutEnvironmentTheme({
            metadata: {
                annotations: {
                    [ENVIRONMENT_THEME_COLOR_ANNOTATION]: 'url(https://example.com/image.png)'
                }
            }
        } as any);

        expect(theme).toBeNull();
    });

    it('returns CSS variables for a parsed theme', () => {
        const theme = getRolloutEnvironmentTheme({
            metadata: {
                annotations: {
                    [ENVIRONMENT_THEME_ANNOTATION]: 'staging'
                }
            }
        } as any);

        expect(theme).not.toBeNull();
        expect(getEnvironmentThemeStyle(theme!)).toContain('--rollout-theme-accent: #7c3aed');
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

describe('buildDatadogTraceSearchUrl', () => {
    it('should build a URL with service, env, and version', () => {
        const url = buildDatadogTraceSearchUrl('my-service', 'production', 'v1.0.0');
        expect(url).toContain('https://app.datadoghq.com/apm/traces?query=');
        expect(url).toContain(encodeURIComponent('service:my-service'));
        expect(url).toContain(encodeURIComponent('env:production'));
        expect(url).toContain(encodeURIComponent('version:v1.0.0'));
        // `@rollout.test:true` marker is what distinguishes rollout-test
        // traces from the service Deployment's regular APM traffic; without
        // it the search would also surface unrelated traffic.
        expect(url).toContain(encodeURIComponent('@rollout.test:true'));
    });

    it('should omit the version filter when no version is provided', () => {
        const url = buildDatadogTraceSearchUrl('my-service', 'staging');
        expect(url).toContain('https://app.datadoghq.com/apm/traces?query=');
        expect(url).toContain(encodeURIComponent('service:my-service'));
        expect(url).toContain(encodeURIComponent('env:staging'));
        expect(url).toContain(encodeURIComponent('@rollout.test:true'));
        expect(url).not.toContain(encodeURIComponent('version:'));
    });
});

describe('shortenVersion', () => {
    it('returns empty string for nullish input', () => {
        expect(shortenVersion(null)).toBe('');
        expect(shortenVersion(undefined)).toBe('');
        expect(shortenVersion('')).toBe('');
    });

    it('shortens a full 40-char git SHA to 7 chars', () => {
        expect(shortenVersion('cf9292d57497bfccae1be39609c2c0e50b4de1ce')).toBe('cf9292d');
        expect(shortenVersion('7BD43E1956F3B822B948BD0EEA9DBD08B4673DDB')).toBe('7BD43E1');
    });

    it('keeps tag prefix and shortens long hex suffix after a dash', () => {
        expect(shortenVersion('main-1776963445-50ef792e2bd4b2c21c1e2b13f064e05c9e84034d'))
            .toBe('main-1776963445-50ef792');
        expect(shortenVersion('release-abcdef0123456789')).toBe('release-abcdef0');
    });

    it('leaves already-short SHAs alone', () => {
        expect(shortenVersion('a7e115f')).toBe('a7e115f');
        expect(shortenVersion('ebe9fb6')).toBe('ebe9fb6');
    });

    it('leaves non-hex versions alone', () => {
        expect(shortenVersion('1.2.3')).toBe('1.2.3');
        expect(shortenVersion('v1.2.3-rc1')).toBe('v1.2.3-rc1');
        expect(shortenVersion('0.3.0-1779831037')).toBe('0.3.0-1779831037');
        expect(shortenVersion('main-1.2.3')).toBe('main-1.2.3');
    });

    it('does not shorten short hex tails (<12 chars)', () => {
        expect(shortenVersion('release-abc1234')).toBe('release-abc1234');
    });
});

describe('getGitHubRef', () => {
    it('prefers revision over package version and tag', () => {
        expect(getGitHubRef({
            version: '0.0.0-7028',
            revision: '0ceef826f41a8889b30e836790371485c027287f',
            tag: 'main-1787656929-0ceef826f41a8889b30e836790371485c027287f'
        })).toBe('0ceef826f41a8889b30e836790371485c027287f');
    });

    it('strips git@sha1: prefix from revision', () => {
        expect(getGitHubRef({
            revision: 'git@sha1:0ceef826f41a8889b30e836790371485c027287f',
            version: '0.0.0-7028',
            tag: 'v1'
        })).toBe('0ceef826f41a8889b30e836790371485c027287f');
    });

    it('falls back to version then tag when revision is missing', () => {
        expect(getGitHubRef({ version: '82b9b24', tag: 'main-82b9b24' })).toBe('82b9b24');
        expect(getGitHubRef({ tag: 'main-82b9b24' })).toBe('main-82b9b24');
        expect(getGitHubRef({})).toBe('');
    });
});

describe('buildGitHubTreeUrl', () => {
    it('appends /tree/{ref} to an HTTPS GitHub URL', () => {
        expect(buildGitHubTreeUrl(
            'https://github.com/caffeinelabs/app',
            '0ceef826f41a8889b30e836790371485c027287f'
        )).toBe('https://github.com/caffeinelabs/app/tree/0ceef826f41a8889b30e836790371485c027287f');
    });

    it('converts SSH remotes and strips .git', () => {
        expect(buildGitHubTreeUrl('git@github.com:caffeinelabs/app.git', 'abc123'))
            .toBe('https://github.com/caffeinelabs/app/tree/abc123');
        expect(buildGitHubTreeUrl('https://github.com/caffeinelabs/app.git', 'abc123'))
            .toBe('https://github.com/caffeinelabs/app/tree/abc123');
    });

    it('returns empty string when source or ref is missing', () => {
        expect(buildGitHubTreeUrl('', 'abc')).toBe('');
        expect(buildGitHubTreeUrl('https://github.com/org/repo', '')).toBe('');
    });
});
