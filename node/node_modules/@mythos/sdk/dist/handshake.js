"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handshakeRoute = handshakeRoute;
const SDK_VERSION = '0.1.0';
function handshakeRoute() {
    return (_req, res) => {
        res.json({ ok: true, sdk_version: SDK_VERSION });
    };
}
