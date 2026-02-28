#!/usr/bin/env bash
# Purpose: Deploy Modal LLM and orchestrator services for the demo.
# High-level behavior: Deploys services, captures URLs, writes modal.env.
# Assumptions: modal CLI is installed and authenticated.
# Invariants: The script never prints secrets to stdout.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_DIR="${ROOT_DIR}/.overmind"
ENV_FILE="${ENV_DIR}/modal.env"
POLL_MS_DEFAULT="500"
TIMEOUT_MS_DEFAULT="900000"

# Ensure required commands exist.
# Does not attempt installation.
# Edge cases: Exits if modal is missing.
# Invariants: Returns only when dependencies are present.
require_command() {
    local command_name="$1"
    if ! command -v "${command_name}" >/dev/null 2>&1; then
        echo "Missing required command: ${command_name}" >&2
        exit 1
    fi
}

# Extract the last URL from Modal deploy output.
# Does not print raw deploy output.
# Edge cases: Returns empty string when no URL is found.
# Invariants: URLs are returned without surrounding whitespace.
extract_url() {
    local output="$1"
    echo "${output}" \
        | grep -Eo 'https://[^[:space:]]+' \
        | tail -1 \
        | tr -d '\r'
}

# Deploy a Modal file and capture its web URL.
# Does not echo full deploy output.
# Edge cases: Exits if URL cannot be detected.
# Invariants: Returns a non-empty URL on success.
deploy_and_capture_url() {
    local label="$1"
    local file_path="$2"
    local deploy_output
    local url

    echo "Deploying ${label}..."
    deploy_output="$(modal deploy "${file_path}" 2>&1)"
    url="$(extract_url "${deploy_output}")"

    if [ -z "${url}" ]; then
        echo "Unable to detect ${label} URL from deploy output." >&2
        echo "Re-run: modal deploy ${file_path}" >&2
        exit 1
    fi

    echo "${label} URL: ${url}"
    echo "${url}"
}

# Write the modal.env file with orchestrator settings.
# Does not write secrets.
# Edge cases: Overwrites existing modal.env content.
# Invariants: The file contains required demo env variables.
write_env_file() {
    local orchestrator_url="$1"
    local llm_url="$2"

    mkdir -p "${ENV_DIR}"
    cat <<EOF > "${ENV_FILE}"
OVERMIND_ORCHESTRATOR_URL=${orchestrator_url}
OVERMIND_ORCHESTRATOR_POLL_MS=${POLL_MS_DEFAULT}
OVERMIND_ORCHESTRATOR_TIMEOUT_MS=${TIMEOUT_MS_DEFAULT}
OVERMIND_LLM_URL=${llm_url}
EOF
}

require_command "modal"

LLM_URL="$(deploy_and_capture_url "LLM server" "modal/llm_server.py")"
ORCH_URL="$(deploy_and_capture_url "Orchestrator" "modal/orchestrator.py")"

write_env_file "${ORCH_URL}" "${LLM_URL}"

echo ""
echo "Saved: ${ENV_FILE}"
echo ""
echo "Paste into your shell:"
echo "export OVERMIND_ORCHESTRATOR_URL=\"${ORCH_URL}\""
echo "export OVERMIND_ORCHESTRATOR_POLL_MS=\"${POLL_MS_DEFAULT}\""
echo "export OVERMIND_ORCHESTRATOR_TIMEOUT_MS=\"${TIMEOUT_MS_DEFAULT}\""
