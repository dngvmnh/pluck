import { createLocalJWKSet } from 'jose';
export declare function getKeySet(apiUrl: string, forceRefresh?: boolean): Promise<ReturnType<typeof createLocalJWKSet>>;
export declare function getKeySetWithKidFallback(apiUrl: string): Promise<ReturnType<typeof createLocalJWKSet>>;
export declare function clearCache(): void;
