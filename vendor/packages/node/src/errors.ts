export class MythosError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'MythosError';
  }
}

export class InsufficientFundsError extends MythosError {
  constructor() {
    super('Insufficient funds in wallet', 'INSUFFICIENT_FUNDS');
    this.name = 'InsufficientFundsError';
  }
}

export class SessionNotFoundError extends MythosError {
  constructor(jti: string) {
    super(`Session not found: ${jti}`, 'SESSION_NOT_FOUND');
    this.name = 'SessionNotFoundError';
  }
}
