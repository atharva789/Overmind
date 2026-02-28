#!/usr/bin/env bash
# Purpose: Deploy Modal services and set up the current directory for Overmind.
# Usage:
#   overmind-deploy              Deploy Modal services + write env files to cwd
#   overmind-deploy --setup      Skip deploy, just write env files to cwd
#   overmind-deploy --check      Verify endpoints are reachable
#
# Can be run from any directory. Modal Python files are resolved relative to
# this script. Env files are written to the current working directory.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OVERMIND_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TARGET_DIR="$(pwd)"
ENV_DIR="${TARGET_DIR}/.overmind"
MODAL_ENV_FILE="${ENV_DIR}/modal.env"
DOT_ENV_FILE="${TARGET_DIR}/.env"
POLL_MS_DEFAULT="500"
TIMEOUT_MS_DEFAULT="900000"

# ─── Helpers ───

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "Error: '$1' is not installed." >&2
        exit 1
    fi
}

get_modal_workspace() {
    modal profile current 2>/dev/null | tr -d '[:space:]'
}

construct_modal_url() {
    local workspace="$1"
    local app_name="$2"
    local function_suffix="$3"
    echo "https://${workspace}--${app_name}-${function_suffix}.modal.run"
}

check_url() {
    local url="$1"
    local code
    code="$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${url}" 2>/dev/null || echo "000")"
    echo "${code}"
}

extract_url() {
    local output="$1"
    printf "%s" "${output}" \
        | grep -Eo 'https://[^[:space:]]+\.modal\.run[^[:space:]]*' \
        | tail -1 \
        | tr -d '\r'
}

# ─── Deploy a single Modal service ───

deploy_service() {
    local label="$1"
    local file_path="$2"
    local app_name="$3"
    local function_suffix="$4"
    local workspace="$5"
    local deploy_output url

    echo "  Deploying ${label}..."
    deploy_output="$(modal deploy "${file_path}" 2>&1)"
    url="$(extract_url "${deploy_output}")"

    # Fallback: construct from naming convention
    if [ -z "${url}" ]; then
        url="$(construct_modal_url "${workspace}" "${app_name}" "${function_suffix}")"
        echo "  Constructed URL from naming convention."
    fi

    echo "  ${label}: ${url}"
    echo "${url}"
}

# ─── Write env files ───

write_modal_env() {
    local orch_url="$1"
    local llm_url="$2"

    mkdir -p "${ENV_DIR}"
    cat > "${MODAL_ENV_FILE}" <<EOF
OVERMIND_ORCHESTRATOR_URL=${orch_url}
OVERMIND_ORCHESTRATOR_POLL_MS=${POLL_MS_DEFAULT}
OVERMIND_ORCHESTRATOR_TIMEOUT_MS=${TIMEOUT_MS_DEFAULT}
OVERMIND_LLM_URL=${llm_url}
EOF
    echo "  Wrote ${MODAL_ENV_FILE}"
}

write_dot_env() {
    local gemini_key="$1"
    cat > "${DOT_ENV_FILE}" <<EOF
GEMINI_API_KEY=${gemini_key}
EOF
    echo "  Wrote ${DOT_ENV_FILE}"
}

# ─── Commands ───

cmd_check() {
    echo "Checking Overmind endpoints..."
    echo ""

    if [ ! -f "${MODAL_ENV_FILE}" ]; then
        echo "  No .overmind/modal.env found in ${TARGET_DIR}"
        echo "  Run: overmind-deploy --setup"
        exit 1
    fi

    local orch_url llm_url
    orch_url="$(grep '^OVERMIND_ORCHESTRATOR_URL=' "${MODAL_ENV_FILE}" | cut -d= -f2-)"
    llm_url="$(grep '^OVERMIND_LLM_URL=' "${MODAL_ENV_FILE}" | cut -d= -f2-)"

    local orch_status llm_status
    echo "  Orchestrator: ${orch_url}"
    orch_status="$(check_url "${orch_url}/health")"
    if [ "${orch_status}" = "200" ]; then
        local health_body
        health_body="$(curl -s --max-time 10 "${orch_url}/health" 2>/dev/null)"
        echo "    Status: OK (${health_body})"
    else
        echo "    Status: UNREACHABLE (HTTP ${orch_status})"
    fi

    echo "  LLM Server:   ${llm_url}"
    llm_status="$(check_url "${llm_url}/v1/models")"
    if [ "${llm_status}" = "200" ] || [ "${llm_status}" = "401" ]; then
        echo "    Status: OK (HTTP ${llm_status})"
    else
        echo "    Status: UNREACHABLE (HTTP ${llm_status})"
    fi

    echo ""
    if [ -f "${DOT_ENV_FILE}" ]; then
        if grep -q "GEMINI_API_KEY=." "${DOT_ENV_FILE}" 2>/dev/null; then
            echo "  .env: GEMINI_API_KEY is set"
        else
            echo "  .env: GEMINI_API_KEY is empty"
        fi
    else
        echo "  .env: not found (optional, needed for prompt evaluation)"
    fi
}

cmd_setup() {
    require_command "modal"
    require_command "curl"

    echo ""
    echo "Setting up Overmind in: ${TARGET_DIR}"
    echo ""

    local workspace
    workspace="$(get_modal_workspace)"
    if [ -z "${workspace}" ]; then
        echo "Error: Could not determine Modal workspace. Run: modal token set" >&2
        exit 1
    fi

    local orch_url llm_url
    orch_url="$(construct_modal_url "${workspace}" "overmind-orchestrator" "fastapi-app")"
    llm_url="$(construct_modal_url "${workspace}" "overmind-llm" "llmserver-serve")"

    # Verify endpoints are reachable
    echo "  Verifying endpoints..."
    local orch_status
    orch_status="$(check_url "${orch_url}/health")"
    if [ "${orch_status}" = "200" ]; then
        echo "  Orchestrator: OK"
    else
        echo "  Orchestrator: HTTP ${orch_status} (may need deploy first)"
    fi

    local llm_status
    llm_status="$(check_url "${llm_url}/v1/models")"
    if [ "${llm_status}" = "200" ] || [ "${llm_status}" = "401" ]; then
        echo "  LLM Server: OK"
    else
        echo "  LLM Server: HTTP ${llm_status} (may need deploy first)"
    fi

    echo ""
    write_modal_env "${orch_url}" "${llm_url}"

    # Handle .env / GEMINI_API_KEY
    if [ -f "${DOT_ENV_FILE}" ] && grep -q "GEMINI_API_KEY=." "${DOT_ENV_FILE}" 2>/dev/null; then
        echo "  .env already has GEMINI_API_KEY, skipping."
    else
        # Try to copy from Overmind source dir
        local source_env="${OVERMIND_ROOT}/.env"
        if [ -f "${source_env}" ] && grep -q "GEMINI_API_KEY=." "${source_env}" 2>/dev/null; then
            local key
            key="$(grep '^GEMINI_API_KEY=' "${source_env}" | cut -d= -f2-)"
            write_dot_env "${key}"
        elif [ -n "${GEMINI_API_KEY:-}" ]; then
            write_dot_env "${GEMINI_API_KEY}"
        else
            echo "  Note: No GEMINI_API_KEY found. Set it in .env for prompt evaluation."
        fi
    fi

    echo ""
    echo "Done! You can now run:"
    echo "  overmind host --port 4444"
}

cmd_deploy() {
    require_command "modal"
    require_command "curl"

    echo ""
    echo "Deploying Overmind Modal services..."
    echo ""

    local workspace
    workspace="$(get_modal_workspace)"
    if [ -z "${workspace}" ]; then
        echo "Error: Could not determine Modal workspace. Run: modal token set" >&2
        exit 1
    fi
    echo "  Modal workspace: ${workspace}"
    echo ""

    # Deploy both services using absolute paths to Modal Python files
    local llm_url orch_url
    llm_url="$(deploy_service "LLM Server" \
        "${OVERMIND_ROOT}/modal/llm_server.py" \
        "overmind-llm" "llmserver-serve" "${workspace}")"

    orch_url="$(deploy_service "Orchestrator" \
        "${OVERMIND_ROOT}/modal/orchestrator.py" \
        "overmind-orchestrator" "fastapi-app" "${workspace}")"

    echo ""
    echo "Writing env files to: ${TARGET_DIR}"
    write_modal_env "${orch_url}" "${llm_url}"

    # Handle .env / GEMINI_API_KEY
    if [ -f "${DOT_ENV_FILE}" ] && grep -q "GEMINI_API_KEY=." "${DOT_ENV_FILE}" 2>/dev/null; then
        echo "  .env already has GEMINI_API_KEY, skipping."
    else
        local source_env="${OVERMIND_ROOT}/.env"
        if [ -f "${source_env}" ] && grep -q "GEMINI_API_KEY=." "${source_env}" 2>/dev/null; then
            local key
            key="$(grep '^GEMINI_API_KEY=' "${source_env}" | cut -d= -f2-)"
            write_dot_env "${key}"
        elif [ -n "${GEMINI_API_KEY:-}" ]; then
            write_dot_env "${GEMINI_API_KEY}"
        else
            echo "  Note: No GEMINI_API_KEY found. Set it in .env for prompt evaluation."
        fi
    fi

    echo ""
    echo "Verifying deployment..."
    local orch_status
    orch_status="$(check_url "${orch_url}/health")"
    if [ "${orch_status}" = "200" ]; then
        echo "  Orchestrator: OK"
    else
        echo "  Orchestrator: HTTP ${orch_status} (container may be cold-starting)"
    fi

    echo ""
    echo "Done! You can now run:"
    echo "  overmind host --port 4444"
}

# ─── Main ───

case "${1:-}" in
    --check)
        cmd_check
        ;;
    --setup)
        cmd_setup
        ;;
    --help|-h)
        echo "Usage: $(basename "$0") [--setup|--check|--help]"
        echo ""
        echo "  (no args)   Deploy Modal services and set up current directory"
        echo "  --setup     Set up current directory (skip deploy, services must exist)"
        echo "  --check     Verify endpoints are reachable"
        echo "  --help      Show this help"
        ;;
    "")
        cmd_deploy
        ;;
    *)
        echo "Unknown option: $1" >&2
        echo "Run with --help for usage." >&2
        exit 1
        ;;
esac
