"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionNotFoundError = exports.InsufficientFundsError = exports.MythosError = void 0;
class MythosError extends Error {
    constructor(message, code) {
        super(message);
        this.code = code;
        this.name = 'MythosError';
    }
}
exports.MythosError = MythosError;
class InsufficientFundsError extends MythosError {
    constructor() {
        super('Insufficient funds in wallet', 'INSUFFICIENT_FUNDS');
        this.name = 'InsufficientFundsError';
    }
}
exports.InsufficientFundsError = InsufficientFundsError;
class SessionNotFoundError extends MythosError {
    constructor(jti) {
        super(`Session not found: ${jti}`, 'SESSION_NOT_FOUND');
        this.name = 'SessionNotFoundError';
    }
}
exports.SessionNotFoundError = SessionNotFoundError;
