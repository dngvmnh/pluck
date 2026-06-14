"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.consumeSession = consumeSession;
exports.meterSession = meterSession;
const config_1 = require("./config");
const errors_1 = require("./errors");
async function post(path, body) {
    const { apiUrl } = (0, config_1.loadConfig)();
    return fetch(`${apiUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}
async function consumeSession(jti) {
    return post(`/api/apps/sessions/${jti}/consume`, {});
}
async function meterSession(jti, credits, reason) {
    const res = await post(`/api/apps/sessions/${jti}/meter`, { credits, reason });
    if (res.status === 402)
        throw new errors_1.InsufficientFundsError();
    if (res.status === 404)
        throw new errors_1.SessionNotFoundError(jti);
    if (!res.ok)
        throw new Error(`Meter request failed: ${res.status}`);
}
