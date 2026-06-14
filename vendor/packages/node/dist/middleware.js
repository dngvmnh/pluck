"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireLaunchToken = requireLaunchToken;
const verify_1 = require("./verify");
const api_client_1 = require("./api-client");
function requireLaunchToken() {
    return async (req, res, next) => {
        const token = req.query['lt'];
        if (!token) {
            res.status(401).json({ error: 'Missing launch token' });
            return;
        }
        let session;
        try {
            session = await (0, verify_1.verifyLaunchToken)(token);
        }
        catch {
            res.status(401).json({ error: 'Invalid launch token' });
            return;
        }
        let consumeRes;
        try {
            consumeRes = await (0, api_client_1.consumeSession)(session.sessionJti);
        }
        catch {
            res.status(503).json({ error: 'Could not verify session' });
            return;
        }
        if (consumeRes.status === 409) {
            res.status(401).json({ error: 'Token already consumed' });
            return;
        }
        if (consumeRes.status < 200 || consumeRes.status >= 300) {
            res.status(503).json({ error: 'Could not verify session' });
            return;
        }
        req.mythos = session;
        next();
    };
}
