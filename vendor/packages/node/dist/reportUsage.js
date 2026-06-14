"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportUsage = reportUsage;
const api_client_1 = require("./api-client");
async function reportUsage(jti, opts) {
    await (0, api_client_1.meterSession)(jti, opts.credits, opts.reason);
}
