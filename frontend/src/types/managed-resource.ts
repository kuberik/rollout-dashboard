export interface ManagedResourceStatus {
    groupVersionKind: string;
    name: string;
    namespace: string;
    status: string;
    message: string;
}
