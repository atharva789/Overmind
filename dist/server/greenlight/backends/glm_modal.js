import { autoGreenlit, validateResult } from "../evaluate.js";
import { EVAL_TIMEOUT_MS } from "../../../shared/constants.js";
/**
 * Evaluate a prompt via the GLM 5.0 Modal sandbox.
 * POSTs pre-computed context bundle. No tool calls.
 */
export async function evaluateWithGlmModal(req, partyCode, promptId, log, timeoutMs = EVAL_TIMEOUT_MS) {
    const url = process.env["MODAL_GREENLIGHT_URL"];
    if (!url) {
        return autoGreenlit("MODAL_GREENLIGHT_URL not configured.");
    }
    const token = process.env["MODAL_GREENLIGHT_TOKEN"];
    const headers = {
        "Content-Type": "application/json",
    };
    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }
    log(partyCode, promptId, "glm", `POST ${url} (prompt length: ${req.prompt.content.length}, concurrent: ${req.concurrent.length})`);
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const response = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(req),
            signal: controller.signal,
        });
        clearTimeout(timer);
        if (!response.ok) {
            const body = await response.text().catch(() => "");
            log(partyCode, promptId, "glm", `HTTP ${response.status}: ${body.slice(0, 200)}`);
            throw new Error(`Modal returned HTTP ${response.status}`);
        }
        const data = await response.json();
        const result = validateResult(data);
        if (result) {
            log(partyCode, promptId, "glm", `verdict: ${result.verdict}`);
            return result;
        }
        log(partyCode, promptId, "glm", "invalid response schema, auto-greenlit");
        return autoGreenlit("GLM response did not match expected schema — auto-approved.");
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(partyCode, promptId, "glm", `error: ${msg}`);
        throw err;
    }
}
//# sourceMappingURL=glm_modal.js.map