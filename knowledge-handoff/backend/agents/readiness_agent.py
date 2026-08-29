"""
readiness_agent.py — Knowledge Continuity Suite
Module 2: Onboarding-Readiness Gap Analyzer

Answers: "If the sole owner of a high-risk file left tomorrow, who on the
team is closest to being able to take over?"

Algorithm (Option A — fully automatic, git-history only):
  For each HIGH-risk file whose author_count <= 2:
  1. Collect all other contributors in the repo.
  2. Score each by how close their git history is to the risky file:
       +3  per file they touched in the same immediate directory
       +2  per file they touched in the same top-level module (different dir)
       +1  per any other file they have touched (general repo familiarity)
  3. Rank and emit: "Best backup: Jane (touched 3 related files) > Ali ..."

Inputs  (written by Module 1 — no new git collection needed):
    outputs/contributor_report.json  -- per-file author lists
    outputs/risk_report.json         -- per-file risk levels + author_count

Output:
    outputs/readiness_report.json

Usage (run from backend/):
    python agents/readiness_agent.py outputs/contributor_report.json outputs/risk_report.json
"""

from __future__ import annotations

import json
import os
import re
import sys
from collections import defaultdict
from pathlib import PurePosixPath
from typing import Any


_EMAIL_STRIP = re.compile(r"\s*<[^>]*>")


def _strip_email(raw: str) -> str:
    return _EMAIL_STRIP.sub("", raw).strip()


def _parse_authors(author_list: list[str]) -> list[str]:
    seen: set[str] = set()
    names: list[str] = []
    for raw in author_list:
        name = _strip_email(raw)
        if name and name not in seen:
            seen.add(name)
            names.append(name)
    return names


def _parent_dir(filepath: str) -> str:
    return str(PurePosixPath(filepath).parent)


def _top_module(filepath: str) -> str:
    parts = PurePosixPath(filepath).parts
    return parts[0] if len(parts) > 1 else ""


def _score(candidate: str, risk_file: str, author_to_files: dict[str, set[str]]) -> tuple[int, list[str]]:
    """
    Proximity score for candidate vs risk_file.
    +3 per file in the same immediate directory
    +2 per file in the same top-level module (but different dir)
    +1 per any other file touched
    Returns (score, related_files) where related = same-dir or same-module files.
    """
    risk_dir = _parent_dir(risk_file)
    risk_mod = _top_module(risk_file)
    touched = author_to_files.get(candidate, set()) - {risk_file}
    score = 0
    related: list[str] = []
    for f in touched:
        if _parent_dir(f) == risk_dir:
            score += 3
            related.append(f)
        elif _top_module(f) == risk_mod and risk_mod:
            score += 2
            related.append(f)
        else:
            score += 1
    return score, related


def analyze(contributor_report: dict[str, Any], risk_report: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Core logic. Returns one entry per HIGH-risk, narrow-owner file with a ranked
    list of backup candidates drawn purely from git history.
    """
    author_to_files: dict[str, set[str]] = defaultdict(set)
    file_to_authors: dict[str, list[str]] = {}

    for rec in contributor_report.get("files", []):
        fp = rec["file"]
        names = _parse_authors(rec.get("authors", []))
        file_to_authors[fp] = names
        for name in names:
            author_to_files[name].add(fp)

    all_contributors = set(author_to_files.keys())
    results: list[dict[str, Any]] = []

    for entry in risk_report:
        if entry.get("risk_level") != "HIGH":
            continue
        if entry.get("author_count", 0) > 2:
            continue

        fp = entry["file"]
        owners = file_to_authors.get(fp, [])
        candidates = all_contributors - set(owners)
        if not candidates:
            continue

        ranking: list[dict[str, Any]] = []
        for c in candidates:
            s, related = _score(c, fp, author_to_files)
            ranking.append({
                "name": c,
                "score": s,
                "related_files_touched": len(related),
                "related_files": sorted(related),
            })
        ranking.sort(key=lambda x: (-x["score"], x["name"]))

        top = ranking[0]
        n = top["related_files_touched"]
        best_backup = f"{top['name']} (touched {n} related file{'s' if n != 1 else ''}, score {top['score']})"

        results.append({
            "file": fp,
            "risk_level": "HIGH",
            "why": entry.get("why", ""),
            "owners": owners,
            "best_backup": best_backup,
            "backup_ranking": ranking,
        })

    return results


def _load_json(path: str) -> Any:
    """Load JSON tolerating UTF-8, UTF-8-BOM, or UTF-16 (Windows pipeline output)."""
    for enc in ("utf-8-sig", "utf-16", "utf-8"):
        try:
            with open(path, "r", encoding=enc) as fh:
                return json.load(fh)
        except (UnicodeDecodeError, UnicodeError):
            continue
    raise ValueError(f"Cannot decode {path}")


def main() -> None:
    if len(sys.argv) != 3:
        print("Usage: python agents/readiness_agent.py <contributor_report.json> <risk_report.json>",
              file=sys.stderr)
        sys.exit(1)

    contributor_report = _load_json(sys.argv[1])
    risk_report = _load_json(sys.argv[2])
    results = analyze(contributor_report, risk_report)

    os.makedirs("outputs", exist_ok=True)
    out_path = os.path.join("outputs", "readiness_report.json")
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump({
            "agent": "readiness_agent",
            "repo": contributor_report.get("repo", ""),
            "high_risk_files_analyzed": len(results),
            "files": results,
        }, fh, indent=2, ensure_ascii=False)

    print(f"Analyzed {len(results)} high-risk file(s) -> {out_path}")
    print()
    for entry in results:
        owners_str = ", ".join(entry["owners"]) or "unknown"
        print(f"  FILE : {entry['file']}")
        print(f"  OWNER: {owners_str}")
        print(f"  BEST BACKUP: {entry['best_backup']}")
        for r in entry["backup_ranking"][1:4]:
            print(f"    > {r['name']} (touched {r['related_files_touched']} related files, score {r['score']})")
        print()


if __name__ == "__main__":
    main()
