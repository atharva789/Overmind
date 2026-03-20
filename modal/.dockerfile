# =============================================================================
# Overmind Orchestrator — Production Dockerfile for ECS Fargate
# =============================================================================
# Multi-stage build to minimize final image size.
# Stage 1 (builder): installs all Python deps into a virtual env.
# Stage 2 (runtime): copies only the venv + app code — no pip, no build tools.
#
# WHY multi-stage?
#   - Build tools (gcc, pip cache) add ~400MB that are never used at runtime.
#   - Final image is smaller → faster ECS task pulls from ECR → faster cold starts.
#
# WHY non-root user?
#   - Defense in depth: if the app is exploited, the attacker has limited permissions.
#   - Required by many security scanning tools and compliance frameworks.
#   - ECS Fargate supports non-root containers natively.
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Builder — install dependencies into an isolated virtual env
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS builder

WORKDIR /build

# Install build dependencies that some Python packages need for compilation.
# These stay in the builder stage only — never shipped to production.
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc g++ && \
    rm -rf /var/lib/apt/lists/*

# Create a virtual env so we can copy it cleanly to the runtime stage.
# WHY a venv instead of installing globally?
#   - Clean boundary: we copy /build/venv → /app/venv, nothing else leaks through.
#   - No risk of polluting the system Python in the runtime image.
RUN python -m venv /build/venv
ENV PATH="/build/venv/bin:$PATH"

# Install Python dependencies BEFORE copying app code.
# WHY? Docker layer caching: if requirements.txt hasn't changed, this layer
# is reused even when you change application code — saves minutes on rebuilds.
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# ---------------------------------------------------------------------------
# Stage 2: Runtime — minimal image with only what's needed to run
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS runtime

# Install only the runtime system libraries needed by onnxruntime and asyncpg.
# - libgomp1: OpenMP runtime (onnxruntime uses it for parallel inference)
# - curl: lightweight healthcheck (avoids importing Python + httpx on every check)
RUN apt-get update && \
    apt-get install -y --no-install-recommends libgomp1 curl && \
    rm -rf /var/lib/apt/lists/*

# Create a non-root user for security.
# WHY uid 1000? Convention for the first non-system user. ECS Fargate respects
# the USER directive — the task runs as this user, not root.
RUN groupadd --gid 1000 appuser && \
    useradd --uid 1000 --gid appuser --create-home appuser

WORKDIR /app

# Copy the pre-built virtual env from the builder stage.
COPY --from=builder /build/venv /app/venv

# Fix shebang lines: pip writes #!/build/venv/bin/python in the builder stage,
# but the venv lives at /app/venv in the runtime stage. Without this, every
# console_script (uvicorn, pip, etc.) fails with "no such file or directory".
RUN find /app/venv/bin -type f -exec grep -l '#!/build/venv/bin/python' {} + | xargs -r sed -i 's|#!/build/venv/bin/python|#!/app/venv/bin/python|g'

# Activate the venv by prepending it to PATH.
ENV PATH="/app/venv/bin:$PATH"

# Copy application code.
COPY . .

# The fastembed model (BAAI/bge-large-en-v1.5, ~1.3GB) is downloaded on first use
# and cached in ~/.cache/fastembed/. Set the cache dir so it persists across
# container restarts if you mount an EFS volume. Otherwise it re-downloads on
# every cold start (adds ~30-60s depending on network).
ENV FASTEMBED_CACHE_DIR="/app/.cache/fastembed"
RUN mkdir -p /app/.cache/fastembed && chown -R appuser:appuser /app

# Switch to non-root user AFTER all file operations.
USER appuser

EXPOSE 8000

# Healthcheck using curl instead of Python.
# WHY curl instead of `python -c "import httpx; ..."`?
#   - curl starts in ~5ms vs ~500ms for Python interpreter + httpx import
#   - Doesn't compete with the app for Python GIL or memory
#   - More reliable: if the Python process is hung, curl still runs independently
#
# --start-period=120s: gives the container 2 minutes before healthchecks count.
# WHY 120s? On first boot, fastembed downloads the ONNX model (~1.3GB).
# During this time the /health endpoint may not respond. start-period prevents
# ECS from killing the task before it's ready.
# On subsequent boots (if model is cached), the app starts in ~5s.
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "orchestrator:web_app", "--host", "0.0.0.0", "--port", "8000"]
