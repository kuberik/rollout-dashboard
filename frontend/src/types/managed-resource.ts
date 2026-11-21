export interface ManagedResourceStatus {
    groupVersionKind: string;
    name: string;
    namespace: string;
    status: string;
    message: string;
    lastModified: string;
    object?: any;
    /** "<namespace>/<name>" of the HelmRelease a Kustomization's managed resources gained this entry from (the backend expands a HelmRelease in an inventory one level); absent otherwise */
    helmRelease?: string;
}
