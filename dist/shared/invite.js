const INVITE_PREFIX = "ovm1_";
export function encodeInviteCode(payload) {
    const json = JSON.stringify(payload);
    const encoded = Buffer.from(json, "utf8").toString("base64url");
    return `${INVITE_PREFIX}${encoded}`;
}
export function decodeInviteCode(code) {
    if (!code.startsWith(INVITE_PREFIX)) {
        return null;
    }
    const body = code.slice(INVITE_PREFIX.length);
    try {
        const json = Buffer.from(body, "base64url").toString("utf8");
        const parsed = JSON.parse(json);
        if (typeof parsed.partyCode !== "string") {
            return null;
        }
        if (typeof parsed.serverUrl !== "string") {
            return null;
        }
        return {
            partyCode: parsed.partyCode,
            serverUrl: parsed.serverUrl,
        };
    }
    catch {
        return null;
    }
}
export function isInviteCode(code) {
    return code.startsWith(INVITE_PREFIX);
}
//# sourceMappingURL=invite.js.map