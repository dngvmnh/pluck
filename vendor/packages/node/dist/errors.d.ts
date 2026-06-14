export declare class MythosError extends Error {
    readonly code: string;
    constructor(message: string, code: string);
}
export declare class InsufficientFundsError extends MythosError {
    constructor();
}
export declare class SessionNotFoundError extends MythosError {
    constructor(jti: string);
}
