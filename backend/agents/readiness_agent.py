"""
readiness_agent.py — Knowledge Continuity Suite
Module 2: Onboarding-Readiness Gap Analyzer

Answers: "If the sole owner of a high-risk file left tomorrow, who on the
team is closest to being able to take over?"

Algorithm (Option A — fully automatic, git-history only):
  For each HIGH-risk file that has a sole or narrow owner:
  1. Identify all other contributors in the repo.
  2. Score each by proximity to the risky file based on their git history:
       +3  for each file they touched in the same directory as the risk file
       +2  for each file they touched in the same top-level module
       +1  for any other file they've touched in the repo
  3. Emit a ranked backup list: best → worst.

Inputs  (both written by Module 1):
    outputs/contributor_report.json  — per-file author lists
    outputs/risk_report.json         — per-file risk levels

Output:
    outputs/readiness_report.json

Usage:
    python agents/readiness_agent.py \\
        outputs/contributor_report.json \\
        outputs/risk_report.json
"""

from __future__ import annotations

import json
import os
import re
import sys
from collections import defaultdict
from pathlib import PurePosixPath
from typing import Any


# ---------------------------------------------------------------------------
# Name normalisation
# ---------------------------------------------------------------------------

_EMAIL_STRIP = re.compile(r"\s*<[^>]*>")


def _extract_name(raw: str) -> str:
    """Strip the '<email>' suffix and normalise whitespace."""
    return _EMAIL_STRIP.sub("", raw).strip()


def _parse_authors(author_list: list[str]) -> list[str]:
    """Return a deduplicated list of normalised author names from a file record."""
    seen: set[str] = set()
    names: list[str] = []
    for raw in author_list:
        name = _extract_name(raw)
        if name and name not in seen:
            seen.add(name)
            names.append(name)
    return names


# ---------------------------------------------------------------------------
# Proximity scoring helpers
# ---------------------------------------------------------------------------

def _immediate_dir(filepath: str) -> str:
    """Return the immediate parent directory of a file path (POSIX-style)."""
    return str(PurePosixPath(filepath).parent)


def _top_level_module(filepath: str) -> str:
    """Return the first path component (top-level directory/module)."""
    parts = PurePosixPath(filepath).parts
    return parts[0] if len(parts) > 1 else ""


def _score_candidate(
    candidate: str,
    risk_file: str,
    author_to_files: dict[str, set[str]],
) -> tuple[int, list[str]]:
    """
    Compute a proximity score for *candidate* relative to *risk_file*.

    Scoring:
        +3 per file touched in the same immediate directory
        +2 per file touched in the same top-level module (but not same dir)
        +1 per any other file touched in the repo

    Returns (score, list_of_related_files — same-dir or same-module only).
    """
    risk_dir = _immediate_dir(risk_file)
    risk_module = _top_level_module(risk_file)

    candidate_files = author_to_files.get(candidate, set()) - {risk_file}

    score = 0
    related: list[str] = []

    for f in candidate_files:
        f_dir = _immediate_dir(f)
        f_module = _top_level_module(f)

        if f_dir == risk_dir:
            score += 3
            related.append(f)
        elif f_module == risk_module and risk_module:
            score += 2
            related.append(f)
        else:
            score += 1

    return score, related


# ---------------------------------------------------------------------------
# Main analysis
# ---------------------------------------------------------------------------

def analyze(
    contributor_report: dict[str, Any],
    risk_report: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Core logic — pure function for easy testing.

    Returns a list of per-file readiness entries, one per HIGH-risk file that
    has a sole or narrow owner (author_count <= 2).
    """
    # Build author → set-of-files and file → authors maps
    author_to_files: dict[str, set[str]] = defaultdict(set)
    file_to_authors: dict[str, list[str]] = {}

    for record in contributor_report.get("files", []):
        filepath = record["file"]
        names = _parse_authors(record.get("authors", []))
        file_to_authors[filepath] = names
        for name in names:
            author_to_files[name].add(filepath)

    all_contributors: set[str] = set(author_to_files.keys())

    results: list[dict[str, Any]] = []

    for risk_entry in risk_report:
        if risk_entry.get("risk_level") != "HIGH":
            continue

        filepath = risk_entry["file"]
        author_count = risk_entry.get("author_count", 0)

        # Only analyse files with narrow ownership
        if author_count > 2:
            continue

        owners = file_to_authors.get(filepath, [])

        # Candidates = everyone who has NOT touched this file
        candidates = all_contributors - set(owners)

        if not candidates:
            continue

        ranked: list[dict[str, Any]] = []
        for candidate in candidates:
            score, related = _score_candidate(candidate, filepath, author_to_files)
            ranked.append({
                "name": candidate,
                "score": score,
                "related_files_touched": len(related),
                "related_files": sorted(related),
            })

        # Sort: highest score first; tie-break alphabetically for determinism
        ranked.sort(key=lambda x: (-x["score"], x["name"]))

        top = ranked[0] if ranked else None
        top_summary = (
            f"{top['name']} "
            f"(touched {top['related_files_touched']} related file"
            f"{'s' if top['related_files_touched'] != 1 else ''}, "
            f"score {top['score']})"
            if top
            else "no backup found"
        )

        results.append({
            "file": filepath,
            "risk_level": risk_entry["risk_level"],
            "why": risk_entry.get("why", ""),
            "owners": owners,
            "best_backup": top_summary,
            "backup_ranking": ranked,
        })

    return results


# ---------------------------------------------------------------------------
# I/O helpers
# ---------------------------------------------------------------------------

def load_json(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def main() -> None:
    if len(sys.argv) != 3:
        print(
            "Usage: python readiness_agent.py "
            "<contributor_report.json> <risk_report.json>",
            file=sys.stderr,
        )
        sys.exit(1)

    contributor_path, risk_path = sys.argv[1], sys.argv[2]

    contributor_report = load_json(contributor_path)
    risk_report = load_json(risk_path)

    results = analyze(contributor_report, risk_report)

    os.makedirs("outputs", exist_ok=True)
    output_path = os.path.join("outputs", "readiness_report.json")
    with open(output_path, "w", encoding="utf-8") as fh:
        json.dump(
            {
                "agent": "readiness_agent",
                "repo": contributor_report.get("repo", ""),
                "high_risk_files_analyzed": len(results),
                "files": results,
            },
            fh,
            indent=2,
            ensure_ascii=False,
        )

    print(f"Analyzed {len(results)} high-risk file(s) → {output_path}")
    print()

    # Quick human-readable summary to stdout
    for entry in results:
        owners_str = ", ".join(entry["owners"]) if entry["owners"] else "unknown"
        print(f"  FILE : {entry['file']}")
        print(f"  OWNER: {owners_str}")
        print(f"  BEST BACKUP: {entry['best_backup']}")
        others = entry["backup_ranking"][1:4]
        for r in others:
            print(
                f"    > {r['name']} "
                f"(touched {r['related_files_touched']} related files, score {r['score']})"
            )
        print()


if __name__ == "__main__":
    main()
