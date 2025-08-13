import { describe, it, expect } from 'vitest';
import { isFieldManaged, isFieldManagedByManager, isFieldManagedByOtherManager } from './utils';

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
