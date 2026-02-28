/**
 * Purpose: High-level client session — wraps Connection with join
 * flow and optional headless console logging.
 *
 * High-level behavior: On connect, immediately sends a `join` message.
 * In headless mode (silent: false, default), logs all server messages
 * to the console using chalk and auto-stops on fatal errors. In silent
 * mode (silent: true), only the join flow runs; the Ink UI layer
 * subscribes to events directly via the exposed `connection` property.
 *
 * Assumptions:
 *  - start() is called exactly once per Session instance.
 *  - In silent mode, all display is handled by the Ink UI layer.
 *
 * Invariants:
 *  - Join message is always sent on connect and reconnect.
 *  - In headless mode, PARTY_ENDED / PARTY_NOT_FOUND stop the session.
 */
import chalk from "chalk";
import { Connection } from "./connection.js";
export class Session {
    conn;
    username;
    partyCode;
    constructor(opts) {
        this.username = opts.username;
        this.partyCode = opts.partyCode;
        this.conn = new Connection(opts.serverUrl);
        // Always send join immediately on (re)connect.
        this.conn.on("connected", () => {
            const joinMsg = {
                type: "join",
                payload: {
                    partyCode: opts.partyCode,
                    username: opts.username,
                },
            };
            this.conn.send(joinMsg);
        });
        if (!opts.silent) {
            this._attachHeadlessLogging(opts.partyCode);
        }
    }
    /** Exposes the underlying Connection for UI layer subscriptions. */
    get connection() {
        return this.conn;
    }
    start() {
        this.conn.connect();
    }
    stop() {
        this.conn.disconnect();
    }
    sendRaw(msg) {
        this.conn.send(msg);
    }
    _attachHeadlessLogging(partyCode) {
        const tag = chalk.cyan("[session]");
        this.conn
            .on("disconnected", () => {
            console.log(tag, chalk.dim(`Disconnected from party ${partyCode}`));
        })
            .on("reconnecting", (attempt) => {
            console.log(tag, chalk.yellow(`Reconnecting (attempt ${attempt})...`));
        })
            .on("message", (msg) => {
            this._handleMessage(msg);
        });
    }
    _handleMessage(msg) {
        const tag = chalk.cyan("[session]");
        switch (msg.type) {
            case "join-ack":
                console.log(tag, chalk.green("Joined party"), chalk.bold(msg.payload.partyCode), "|", msg.payload.members.join(", "), "|", msg.payload.isHost ? chalk.magenta("host") : "member");
                break;
            case "member-joined":
                console.log(tag, chalk.green(msg.payload.username), "joined");
                break;
            case "member-left":
                console.log(tag, chalk.yellow(msg.payload.username), "left");
                break;
            case "member-status":
                break; // headless mode: status updates are not logged
            case "activity":
                console.log(tag, chalk.dim(`${msg.payload.username}: ${msg.payload.event}`));
                break;
            case "prompt-queued":
                console.log(tag, `Prompt ${msg.payload.promptId}`, `queued at position ${msg.payload.position}`);
                break;
            case "prompt-greenlit":
                console.log(tag, chalk.green(`Prompt ${msg.payload.promptId} greenlit:`), msg.payload.reasoning);
                break;
            case "prompt-redlit":
                console.log(tag, chalk.red(`Prompt ${msg.payload.promptId} redlit:`), msg.payload.reasoning);
                break;
            case "host-review-request":
                console.log(tag, chalk.magenta("[HOST]"), `Review request from ${msg.payload.username}`, `(prompt: ${msg.payload.promptId})`);
                break;
            case "prompt-approved":
                console.log(tag, chalk.green(`Prompt ${msg.payload.promptId} approved`));
                break;
            case "prompt-denied":
                console.log(tag, chalk.red(`Prompt ${msg.payload.promptId} denied:`), msg.payload.reason);
                break;
            case "error":
                console.error(tag, chalk.red(`Error [${msg.payload.code}]:`), msg.payload.message);
                if (msg.payload.code === "PARTY_ENDED" ||
                    msg.payload.code === "PARTY_NOT_FOUND" ||
                    msg.payload.code === "JOIN_TIMEOUT") {
                    this.stop();
                }
                break;
            default:
                break;
        }
    }
}
//# sourceMappingURL=session.js.map