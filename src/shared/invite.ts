const INVITE_PREFIX = "ovm1_";

export type InvitePayload = {
    partyCode: string;
    serverUrl: string;
};

export function encodeInviteCode(payload: InvitePayload): string {
    const json = JSON.stringify(payload);
    const encoded = Buffer.from(json, "utf8").toString("base64url");
    return `${INVITE_PREFIX}${encoded}`;
}

export function decodeInviteCode(code: string): InvitePayload | null {
    if (!code.startsWith(INVITE_PREFIX)) {
        return null;
    }
    const body = code.slice(INVITE_PREFIX.length);
    try {
        const json = Buffer.from(body, "base64url").toString("utf8");
        const parsed = JSON.parse(json) as Partial<InvitePayload>;
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
    } catch {
        return null;
    }
}

export function isInviteCode(code: string): boolean {
    return code.startsWith(INVITE_PREFIX);
}
