export declare function consumeSession(jti: string): Promise<Response>;
export declare function meterSession(jti: string, credits: number, reason?: string): Promise<void>;
