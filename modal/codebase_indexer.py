"""
Purpose: Helpers and models for codebase chunking and similarity indexing.
High-level behavior: Splits files into AST-aware chunks (functions, classes,
  methods) using tree-sitter, with line-by-line chunks for the remaining code.
  Computes vector averages and cosine similarities. Defines the Pydantic
  request/response models used by the initialize_codebase endpoint.
Assumptions: Callers supply non-None file contents; embeddings are equal-length
  float lists produced by the same embedding model.
Invariants: chunk_file never returns whitespace-only chunks; average_vectors
  raises ValueError on empty input; cosine_similarity returns 0.0 for
  zero-magnitude vectors rather than dividing by zero.
"""

from __future__ import annotations

import math
import os

from pydantic import BaseModel


class InitializeCodebaseRequest(BaseModel):
    projectId: str
    branchName: str = "main"
    files: dict[str, str]  # path → content


class InitializeCodebaseResponse(BaseModel):
    resolvedProjectId: str
    branchId: str
    chunksStored: int


# Maps file extensions to tree-sitter language identifiers.
_LANGUAGE_MAP: dict[str, str] = {
    ".py": "python",
    ".ts": "typescript",
    ".tsx": "tsx",
    ".js": "javascript",
    ".jsx": "javascript",
    ".go": "go",
}

# AST node types that become named chunks per language.
_DEFINITION_TYPES: dict[str, frozenset[str]] = {
    "python": frozenset({"function_definition", "class_definition"}),
    "typescript": frozenset({"function_declaration", "method_definition", "class_declaration"}),
    "tsx": frozenset({"function_declaration", "method_definition", "class_declaration"}),
    "javascript": frozenset({"function_declaration", "method_definition", "class_declaration"}),
    "go": frozenset({"function_declaration", "method_declaration"}),
}

# Child node types that carry a definition's name.
_NAME_NODE_TYPES = frozenset(
    {"identifier", "property_identifier", "type_identifier", "field_identifier"}
)


_parser_cache: dict[str, object] = {}
_parser_unavailable: set[str] = set()


def _make_parser(lang: str):
    """Return a cached tree-sitter Parser, or None if the language is unavailable."""
    if lang in _parser_cache:
        return _parser_cache[lang]
    if lang in _parser_unavailable:
        return None
    try:
        from tree_sitter import Language, Parser

        if lang == "python":
            import tree_sitter_python as m
            parser = Parser(Language(m.language()))
        elif lang == "typescript":
            import tree_sitter_typescript as m
            parser = Parser(Language(m.language_typescript()))
        elif lang == "tsx":
            import tree_sitter_typescript as m
            parser = Parser(Language(m.language_tsx()))
        elif lang in ("javascript", "jsx"):
            import tree_sitter_javascript as m
            parser = Parser(Language(m.language()))
        elif lang == "go":
            import tree_sitter_go as m
            parser = Parser(Language(m.language()))
        else:
            _parser_unavailable.add(lang)
            return None

        _parser_cache[lang] = parser
        return parser
    except Exception as exc:
        print(f"[tree-sitter] parser unavailable for {lang}: {exc}")
        _parser_unavailable.add(lang)
        return None


def _node_name(node, src: bytes) -> str:
    """Return the name identifier from the first matching child, or empty string."""
    for child in node.children:
        if child.type in _NAME_NODE_TYPES:
            return src[child.start_byte : child.end_byte].decode("utf-8", errors="replace")
    return ""


def _collect(
    node,
    lang: str,
    src: bytes,
    lines: list[str],
    path: str,
    chunks: list[dict],
    covered: set[int],
    parent: str,
) -> None:
    """Recursively walk the AST, emitting a chunk for each definition node."""
    def_types = _DEFINITION_TYPES.get(lang, frozenset())
    if node.type in def_types:
        name = _node_name(node, src) or node.type
        qualified = f"{parent}.{name}" if parent else name
        start = node.start_point[0] + 1  # 1-indexed
        end = node.end_point[0] + 1
        text = "\n".join(lines[start - 1 : end])
        if text.strip():
            chunks.append(
                {
                    "path": path,
                    "chunk_name": f"{path}:{qualified}",
                    "chunk_text": text,
                    "start_line": start,
                    "end_line": end,
                }
            )
            covered.update(range(start, end + 1))
        # Recurse with this definition as the new parent so nested definitions
        # (e.g. methods inside a class) get qualified names like "ClassName.method".
        for child in node.children:
            _collect(child, lang, src, lines, path, chunks, covered, qualified)
    else:
        for child in node.children:
            _collect(child, lang, src, lines, path, chunks, covered, parent)


def chunk_file(path: str, content: str) -> list[dict]:
    """
    Split a file into AST-aware chunks using tree-sitter.

    Functions, classes, and methods are extracted as named chunks whose
    chunk_name is "<path>:<QualifiedName>" (e.g. "src/foo.py:Foo.bar").
    Their source lines are not repeated in the line-by-line output.

    Every remaining non-empty line becomes its own single-line chunk with
    chunk_name "<path>:<line_number>".

    Falls back to pure line-by-line if the language is unsupported or
    tree-sitter cannot parse the file.

    Returns chunks sorted ascending by start_line.
    Never returns whitespace-only chunks.
    Edge cases: empty files produce no chunks; partial trailing lines are included.
    """
    lines = content.split("\n")
    src = content.encode("utf-8")
    ext = os.path.splitext(path)[1].lower()
    lang = _LANGUAGE_MAP.get(ext)

    chunks: list[dict] = []
    covered: set[int] = set()

    if lang is not None:
        parser = _make_parser(lang)
        if parser is not None:
            tree = parser.parse(src)
            _collect(tree.root_node, lang, src, lines, path, chunks, covered, "")

    # Line-by-line chunks for every non-empty line not covered by an AST chunk.
    for i, line in enumerate(lines, start=1):
        if i not in covered and line.strip():
            chunks.append(
                {
                    "path": path,
                    "chunk_name": f"{path}:{i}",
                    "chunk_text": line,
                    "start_line": i,
                    "end_line": i,
                }
            )

    chunks.sort(key=lambda c: c["start_line"])
    return chunks


def average_vectors(vectors: list[list[float]]) -> list[float]:
    """
    Compute element-wise average of a list of float vectors.
    Does not mutate inputs.
    Edge cases: raises ValueError if vectors is empty.
    """
    if not vectors:
        raise ValueError("average_vectors: empty list")
    import numpy as np
    return np.mean(vectors, axis=0).tolist()


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """
    Compute cosine similarity between two vectors.
    Does not mutate inputs.
    Edge cases: returns 0.0 if either vector has zero magnitude.
    """
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    if mag_a == 0.0 or mag_b == 0.0:
        return 0.0
    return dot / (mag_a * mag_b)
