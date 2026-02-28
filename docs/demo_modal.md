<!--
Purpose: Provide an end-to-end Modal demo runbook.
High-level behavior: Documents deploy, host, join, and execution steps.
Assumptions: Modal CLI is installed and authenticated.
Invariants: Instructions never include prompt contents in shared logs.
-->

# Modal Demo Runbook

## Deploy Modal Services

```bash
./tools/modal-deploy.sh
source .overmind/modal.env
```

## Run Overmind Host

```bash
npm run build
node dist/cli.js host --username alice
```

If port 4444 is in use, run one of these:

```bash
fuser -k 4444/tcp
```

Or set a different port:

```bash
OVERMIND_PORT=4455 node dist/cli.js host --username alice
```

## Join as a Second User

```bash
node dist/cli.js join <CODE> --username bob
```

## Submit a Prompt

In Bob's TUI, submit:

```
Add a /health endpoint that returns {status: "ok"} and add a corresponding
protocol message if needed.
```

## Expected Result

- Bob sees stage updates from the remote orchestrator.
- Diffs appear in the TUI after completion.
- The host workspace files are updated locally.
- Activity feed shows "changes applied" without prompt content.

## Notes

- `OVERMIND_ORCHESTRATOR_URL` is the base URL without `/runs`.
- Overmind calls only the orchestrator, never the model server directly.
