export type InvitePayload = {
    partyCode: string;
    serverUrl: string;
};
export declare function encodeInviteCode(payload: InvitePayload): string;
export declare function decodeInviteCode(code: string): InvitePayload | null;
export declare function isInviteCode(code: string): boolean;
