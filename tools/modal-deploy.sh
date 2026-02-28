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

# Extract the last Modal web endpoint URL from deploy output.
# Does not print raw deploy output.
# Edge cases: Returns empty string when no URL is found.
# Invariants: URLs are returned without surrounding whitespace.
extract_url() {
    local output="$1"
    local run_url

    run_url="$(printf "%s" "${output}" \
        | grep -Eo 'https://[^[:space:]]+\\.modal\\.run[^[:space:]]*' \
        | tail -1 \
        | tr -d '\r')"

    if [ -n "${run_url}" ]; then
        echo "${run_url}"
        return 0
    fi

    printf "%s" "${output}" \
        | grep -Eo 'https://[^[:space:]]+' \
        | tail -1 \
        | tr -d '\r'
}

# Extract a modal.run URL from modal app list output.
# Does not fail if the app list is unavailable.
# Edge cases: Falls back to any modal.run URL if name matches fail.
# Invariants: Returns a single URL or empty string.
extract_url_from_app_list() {
    local app_name="$1"
    local app_list
    local python_bin

    if command -v python3 >/dev/null 2>&1; then
        python_bin="python3"
    elif command -v python >/dev/null 2>&1; then
        python_bin="python"
    else
        return 1
    fi

    app_list="$(modal app list --json 2>/dev/null || true)"
    if [ -z "${app_list}" ]; then
        return 1
    fi

    printf "%s" "${app_list}" | "${python_bin}" - "${app_name}" <<'PY'
import json
import sys

app_name = sys.argv[1]

try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(1)

urls = []

def walk(obj):
    if isinstance(obj, dict):
        for value in obj.values():
            walk(value)
    elif isinstance(obj, list):
        for value in obj:
            walk(value)
    elif isinstance(obj, str):
        if ".modal.run" in obj:
            urls.append(obj)

walk(data)

if not urls:
    sys.exit(1)

for url in reversed(urls):
    if app_name in url:
        print(url)
        sys.exit(0)

print(urls[-1])
PY
}

# Deploy a Modal file and capture its web URL.
# Does not echo full deploy output.
# Edge cases: Exits if URL cannot be detected.
# Invariants: Returns a non-empty URL on success.
deploy_and_capture_url() {
    local label="$1"
    local file_path="$2"
    local app_name="$3"
    local deploy_output
    local url

    echo "Deploying ${label}..." >&2
    deploy_output="$(modal deploy "${file_path}" 2>&1)"
    url="$(extract_url "${deploy_output}")"

    if [ -z "${url}" ] || ! echo "${url}" | grep -q "\\.modal\\.run"; then
        url="$(extract_url_from_app_list "${app_name}")"
    fi

    if [ -z "${url}" ] || ! echo "${url}" | grep -q "\\.modal\\.run"; then
        echo "Detected URL does not look like a Modal endpoint." >&2
        echo "Run: modal app list --json and find the *.modal.run URL." >&2
        exit 1
    fi

    echo "${label} URL: ${url}" >&2
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

LLM_URL="$(deploy_and_capture_url "LLM server" "modal/llm_server.py" \
    "overmind-llm")"
ORCH_URL="$(deploy_and_capture_url "Orchestrator" "modal/orchestrator.py" \
    "overmind-orchestrator")"

write_env_file "${ORCH_URL}" "${LLM_URL}"

echo ""
echo "Saved: ${ENV_FILE}"
echo ""
echo "Paste into your shell:"
echo "export OVERMIND_ORCHESTRATOR_URL=\"${ORCH_URL}\""
echo "export OVERMIND_ORCHESTRATOR_POLL_MS=\"${POLL_MS_DEFAULT}\""
echo "export OVERMIND_ORCHESTRATOR_TIMEOUT_MS=\"${TIMEOUT_MS_DEFAULT}\""
