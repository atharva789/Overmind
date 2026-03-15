#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.deploy-venv"
DEPLOY_SCRIPT="$SCRIPT_DIR/deploy_sagemeker.py"

echo "==> Creating temporary venv at $VENV_DIR"
python3 -m venv "$VENV_DIR"

cleanup() {
    echo "==> Removing temporary venv"
    rm -rf "$VENV_DIR"
}
trap cleanup EXIT

echo "==> Installing dependencies"
"$VENV_DIR/bin/pip" install --quiet --upgrade pip
"$VENV_DIR/bin/pip" install --quiet "sagemaker>=2.200,<3" boto3

echo "==> Running deploy script"
"$VENV_DIR/bin/python" "$DEPLOY_SCRIPT"
