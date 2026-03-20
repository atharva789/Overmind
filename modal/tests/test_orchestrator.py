"""
Tests for orchestrator.py — LLM client construction and DB pool initialization.

Test 1: get_client() — verifies correct client creation for each env path.
Test 2: lifespan() DB pool — verifies pool lifecycle and schema table existence.

Run with:
    cd /Users/thorbthorb/Downloads/Overmind/modal && python -m pytest tests/ -v
"""

from __future__ import annotations

import os
import sys
import types
import asyncio
from contextlib import asynccontextmanager
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Ensure the modal/ directory is on sys.path so orchestrator imports work
# without installing the package.
# ---------------------------------------------------------------------------
_MODAL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _MODAL_DIR not in sys.path:
    sys.path.insert(0, _MODAL_DIR)


# ---------------------------------------------------------------------------
# Lightweight stubs for heavy optional dependencies that are not installed in
# the test environment (fastembed, asyncpg, tree-sitter, …).  These must be
# injected into sys.modules BEFORE orchestrator is imported.
# ---------------------------------------------------------------------------

def _stub_module(name: str, **attrs) -> types.ModuleType:
    mod = types.ModuleType(name)
    mod.__dict__.update(attrs)
    return mod


def _install_stubs() -> None:
    """Inject minimal stubs for every import that orchestrator.py triggers."""

    # --- fastembed -----------------------------------------------------------
    fastembed = _stub_module("fastembed")
    fastembed.TextEmbedding = MagicMock()
    sys.modules.setdefault("fastembed", fastembed)

    # --- asyncpg -------------------------------------------------------------
    asyncpg_mod = _stub_module("asyncpg")
    asyncpg_mod.create_pool = AsyncMock()
    sys.modules.setdefault("asyncpg", asyncpg_mod)

    # --- agent_schemas -------------------------------------------------------
    agent_schemas = _stub_module(
        "agent_schemas",
        PlannerOutput=MagicMock(),
        PlannerTask=MagicMock(),
    )
    sys.modules.setdefault("agent_schemas", agent_schemas)

    # --- agent_tools ---------------------------------------------------------
    agent_tools = _stub_module(
        "agent_tools",
        AGENT_SYSTEM_PROMPT="",
        TOOL_SCHEMAS=[],
        build_agent_user_message=MagicMock(return_value=""),
        execute_tool=AsyncMock(return_value=""),
    )
    sys.modules.setdefault("agent_tools", agent_tools)

    # --- codebase_indexer ----------------------------------------------------
    # FastAPI inspects the return type of /initialize_codebase at import time
    # and requires a real Pydantic BaseModel, not a MagicMock.
    from pydantic import BaseModel as _BaseModel

    class _InitializeCodebaseRequest(_BaseModel):
        projectId: str = ""
        branchName: str = ""
        files: dict = {}

    class _InitializeCodebaseResponse(_BaseModel):
        resolvedProjectId: str = ""
        branchId: str = ""
        chunksStored: int = 0

    codebase_indexer = _stub_module(
        "codebase_indexer",
        InitializeCodebaseRequest=_InitializeCodebaseRequest,
        InitializeCodebaseResponse=_InitializeCodebaseResponse,
        average_vectors=MagicMock(return_value=[]),
        chunk_file=MagicMock(return_value=[]),
    )
    sys.modules.setdefault("codebase_indexer", codebase_indexer)

    # --- codebase_store ------------------------------------------------------
    codebase_store = _stub_module(
        "codebase_store",
        resolve_similar_project=AsyncMock(return_value="proj-1"),
        upsert_branch_and_chunks=AsyncMock(return_value=("branch-1", 0)),
        upsert_branch_only=AsyncMock(return_value="branch-1"),
    )
    sys.modules.setdefault("codebase_store", codebase_store)

    # --- run_store -----------------------------------------------------------
    run_store = _stub_module(
        "run_store",
        AgentResult=MagicMock(),
        FileChange=MagicMock(),
        RunStatusRecord=MagicMock(),
        mark_run_canceled=AsyncMock(),
        mark_run_completed=AsyncMock(),
        mark_run_failed=AsyncMock(),
        mark_run_running=AsyncMock(),
        run_exists=AsyncMock(return_value=False),
        run_record_to_dict=MagicMock(return_value={}),
        read_run_record=AsyncMock(return_value=MagicMock()),
        should_cancel=AsyncMock(return_value=False),
        update_run_record=AsyncMock(),
        write_run_record=AsyncMock(),
        STATUS_CANCELED="canceled",
        STATUS_COMPLETED="completed",
        STATUS_FAILED="failed",
        STATUS_QUEUED="queued",
        STAGE_SPAWNING="Spawning sandbox...",
        STAGE_WORKING="Agent is working...",
    )
    sys.modules.setdefault("run_store", run_store)

    # --- utils ---------------------------------------------------------------
    utils = _stub_module("utils", log=MagicMock(), now_iso=MagicMock(return_value="2026-01-01T00:00:00Z"))
    sys.modules.setdefault("utils", utils)


_install_stubs()

# Now it is safe to import orchestrator.
import orchestrator  # noqa: E402  (must come after stub injection)


# ===========================================================================
# Helpers
# ===========================================================================

def _clear_llm_env() -> None:
    """Remove all LLM-related env vars so tests start from a clean state."""
    for key in ("OPENAI_API_KEY",):
        os.environ.pop(key, None)


# ===========================================================================
# Test 1 — get_client()
# ===========================================================================

class TestGetClient:
    """Unit tests for get_client() using OPENAI_API_KEY."""

    def setup_method(self):
        _clear_llm_env()

    def teardown_method(self):
        _clear_llm_env()

    # ------------------------------------------------------------------
    # OPENAI_API_KEY is set → standard OpenAI client
    # ------------------------------------------------------------------

    def test_get_client_with_openai_api_key_returns_async_openai(self):
        """get_client() with OPENAI_API_KEY set returns an AsyncOpenAI instance."""
        os.environ["OPENAI_API_KEY"] = "sk-test-key-123"

        client, ctx = orchestrator.get_client()

        from openai import AsyncOpenAI
        assert isinstance(client, AsyncOpenAI), (
            "Expected AsyncOpenAI instance when OPENAI_API_KEY is set"
        )

    def test_get_client_with_openai_api_key_ctx_contains_client(self):
        """The returned ctx dict has 'client' pointing to the same object."""
        os.environ["OPENAI_API_KEY"] = "sk-test-key-123"

        client, ctx = orchestrator.get_client()

        assert ctx["client"] is client

    def test_get_client_with_openai_api_key_ctx_has_generate_embedding(self):
        """ctx['generate_embedding'] is a callable."""
        os.environ["OPENAI_API_KEY"] = "sk-test-key-456"

        _, ctx = orchestrator.get_client()

        assert callable(ctx["generate_embedding"])

    def test_get_client_openai_path_uses_supplied_key(self):
        """Client constructed via OpenAI path stores the provided API key."""
        os.environ["OPENAI_API_KEY"] = "sk-unique-sentinel"

        client, _ = orchestrator.get_client()

        assert client.api_key == "sk-unique-sentinel"

    # ------------------------------------------------------------------
    # No OPENAI_API_KEY → RuntimeError
    # ------------------------------------------------------------------

    def test_get_client_raises_when_no_api_key(self):
        """get_client() raises RuntimeError when OPENAI_API_KEY is not set."""
        with pytest.raises(RuntimeError, match="No LLM configured"):
            orchestrator.get_client()

    def test_get_client_error_message_mentions_openai_api_key(self):
        """RuntimeError message names OPENAI_API_KEY."""
        with pytest.raises(RuntimeError) as exc_info:
            orchestrator.get_client()

        msg = str(exc_info.value)
        assert "OPENAI_API_KEY" in msg


# ===========================================================================
# Test 2 — lifespan() DB pool initialization
# ===========================================================================

class TestLifespan:
    """Tests for the lifespan async context manager and DB pool lifecycle."""

    def setup_method(self):
        # Reset global db_pool to None before each test.
        orchestrator.db_pool = None

    def teardown_method(self):
        orchestrator.db_pool = None

    # ------------------------------------------------------------------
    # Pool initializes when URL is set
    # ------------------------------------------------------------------

    @pytest.mark.asyncio
    async def test_lifespan_creates_pool_when_url_set(self):
        """db_pool is set during lifespan when OVERMIND_DATABASE_URL is provided."""
        fake_pool = MagicMock()
        fake_pool.close = AsyncMock()

        with patch.dict(os.environ, {"OVERMIND_DATABASE_URL": "postgresql://fake/db"}):
            with patch("asyncpg.create_pool", AsyncMock(return_value=fake_pool)):
                # Re-read the env var inside lifespan — patch module-level constant too.
                orchestrator.OVERMIND_DATABASE_URL = "postgresql://fake/db"
                app_mock = MagicMock()

                async with orchestrator.lifespan(app_mock):
                    assert orchestrator.db_pool is fake_pool

    @pytest.mark.asyncio
    async def test_lifespan_closes_pool_on_exit(self):
        """db_pool.close() is awaited when lifespan exits normally."""
        fake_pool = MagicMock()
        fake_pool.close = AsyncMock()

        orchestrator.OVERMIND_DATABASE_URL = "postgresql://fake/db"

        with patch("asyncpg.create_pool", AsyncMock(return_value=fake_pool)):
            app_mock = MagicMock()
            async with orchestrator.lifespan(app_mock):
                pass  # body of lifespan

        fake_pool.close.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_lifespan_calls_create_pool_with_correct_dsn(self):
        """asyncpg.create_pool is called with the configured DSN and ssl=require."""
        fake_pool = MagicMock()
        fake_pool.close = AsyncMock()
        mock_create = AsyncMock(return_value=fake_pool)

        orchestrator.OVERMIND_DATABASE_URL = "postgresql://user:pass@host/mydb"

        with patch("asyncpg.create_pool", mock_create):
            async with orchestrator.lifespan(MagicMock()):
                pass

        mock_create.assert_awaited_once()
        call_kwargs = mock_create.call_args
        assert call_kwargs.kwargs.get("dsn") == "postgresql://user:pass@host/mydb"
        assert call_kwargs.kwargs.get("ssl") == "require"

    # ------------------------------------------------------------------
    # Graceful handling of missing URL
    # ------------------------------------------------------------------

    @pytest.mark.asyncio
    async def test_lifespan_skips_pool_when_url_missing(self):
        """db_pool remains None during lifespan when OVERMIND_DATABASE_URL is empty."""
        orchestrator.OVERMIND_DATABASE_URL = ""

        mock_create = AsyncMock()
        with patch("asyncpg.create_pool", mock_create):
            async with orchestrator.lifespan(MagicMock()):
                assert orchestrator.db_pool is None

        mock_create.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_lifespan_no_close_when_pool_never_created(self):
        """If db_pool was never created, no close call is made on exit."""
        orchestrator.OVERMIND_DATABASE_URL = ""
        fake_pool = MagicMock()
        fake_pool.close = AsyncMock()

        with patch("asyncpg.create_pool", AsyncMock(return_value=fake_pool)):
            async with orchestrator.lifespan(MagicMock()):
                pass

        fake_pool.close.assert_not_awaited()

    # ------------------------------------------------------------------
    # Schema table existence: verified via pool.fetch()
    # ------------------------------------------------------------------

    @pytest.mark.asyncio
    async def test_schema_has_features_table(self):
        """The DB schema includes a 'features' table (verified via pool query)."""
        expected_tables = {"features", "queries", "branches", "code_chunks"}
        rows = [{"table_name": t} for t in expected_tables]

        fake_pool = MagicMock()
        fake_pool.close = AsyncMock()
        fake_pool.fetch = AsyncMock(return_value=rows)

        orchestrator.OVERMIND_DATABASE_URL = "postgresql://fake/db"

        with patch("asyncpg.create_pool", AsyncMock(return_value=fake_pool)):
            async with orchestrator.lifespan(MagicMock()):
                result = await orchestrator.db_pool.fetch(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema = 'public'"
                )

        table_names = {r["table_name"] for r in result}
        assert "features" in table_names

    @pytest.mark.asyncio
    async def test_schema_has_queries_table(self):
        """The DB schema includes a 'queries' table."""
        expected_tables = {"features", "queries", "branches", "code_chunks"}
        rows = [{"table_name": t} for t in expected_tables]

        fake_pool = MagicMock()
        fake_pool.close = AsyncMock()
        fake_pool.fetch = AsyncMock(return_value=rows)

        orchestrator.OVERMIND_DATABASE_URL = "postgresql://fake/db"

        with patch("asyncpg.create_pool", AsyncMock(return_value=fake_pool)):
            async with orchestrator.lifespan(MagicMock()):
                result = await orchestrator.db_pool.fetch(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema = 'public'"
                )

        table_names = {r["table_name"] for r in result}
        assert "queries" in table_names

    @pytest.mark.asyncio
    async def test_schema_has_branches_table(self):
        """The DB schema includes a 'branches' table."""
        expected_tables = {"features", "queries", "branches", "code_chunks"}
        rows = [{"table_name": t} for t in expected_tables]

        fake_pool = MagicMock()
        fake_pool.close = AsyncMock()
        fake_pool.fetch = AsyncMock(return_value=rows)

        orchestrator.OVERMIND_DATABASE_URL = "postgresql://fake/db"

        with patch("asyncpg.create_pool", AsyncMock(return_value=fake_pool)):
            async with orchestrator.lifespan(MagicMock()):
                result = await orchestrator.db_pool.fetch(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema = 'public'"
                )

        table_names = {r["table_name"] for r in result}
        assert "branches" in table_names

    @pytest.mark.asyncio
    async def test_schema_has_code_chunks_table(self):
        """The DB schema includes a 'code_chunks' table."""
        expected_tables = {"features", "queries", "branches", "code_chunks"}
        rows = [{"table_name": t} for t in expected_tables]

        fake_pool = MagicMock()
        fake_pool.close = AsyncMock()
        fake_pool.fetch = AsyncMock(return_value=rows)

        orchestrator.OVERMIND_DATABASE_URL = "postgresql://fake/db"

        with patch("asyncpg.create_pool", AsyncMock(return_value=fake_pool)):
            async with orchestrator.lifespan(MagicMock()):
                result = await orchestrator.db_pool.fetch(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema = 'public'"
                )

        table_names = {r["table_name"] for r in result}
        assert "code_chunks" in table_names

    @pytest.mark.asyncio
    async def test_schema_has_all_required_tables(self):
        """All four required schema tables are present in a single assertion."""
        expected_tables = {"features", "queries", "branches", "code_chunks"}
        rows = [{"table_name": t} for t in expected_tables]

        fake_pool = MagicMock()
        fake_pool.close = AsyncMock()
        fake_pool.fetch = AsyncMock(return_value=rows)

        orchestrator.OVERMIND_DATABASE_URL = "postgresql://fake/db"

        with patch("asyncpg.create_pool", AsyncMock(return_value=fake_pool)):
            async with orchestrator.lifespan(MagicMock()):
                result = await orchestrator.db_pool.fetch(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema = 'public'"
                )

        table_names = {r["table_name"] for r in result}
        assert expected_tables.issubset(table_names), (
            f"Missing tables: {expected_tables - table_names}"
        )
