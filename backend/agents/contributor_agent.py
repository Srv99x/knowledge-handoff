"""
contributor_agent.py — Knowledge Continuity Suite

Walk every tracked file in a target git repo, query git log per file to
extract author identities and timestamps, and emit a sorted JSON report to
outputs/contributor_report.json.

Usage:
    python agents/contributor_agent.py [repo_path]

repo_path defaults to the current working directory if omitted.
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import git


def collect_tracked_files(tree) -> list[str]:
    """Recursively collect all blob paths from a git tree."""
    paths: list[str] = []
    for blob in tree.blobs:
        paths.append(blob.path)
    for subtree in tree.trees:
        paths.extend(collect_tracked_files(subtree))
    return paths


def analyze_file(repo: git.Repo, file_path: str, today: datetime.date) -> dict:
    """Return contributor metadata for a single tracked file."""
    raw_log = repo.git.log(
        "--follow",
        "--format=%aN%x09%ae%x09%aI",
        "--",
        file_path,
    )

    lines = [line for line in raw_log.splitlines() if line.strip()]

    # Deduplicate by email first (canonical = most-frequent display name for
    # that email), then merge any canonical names that share >=1 email.
    # This handles two cases correctly:
    #   1. Same name, two emails  (e.g. ken@vandine.org + ken.vandine@canonical.com)
    #   2. Two names, same email  (e.g. "Ash" + "ashuntu" via ashton.nelson@canonical.com)
    # Previously grouping by name first missed case 2.
    email_name_counts: dict[str, dict[str, int]] = {}  # email -> {name: count}
    last_touch_iso: str | None = None

    for line in lines:
        parts = line.split("\t", 2)
        if len(parts) < 3:
            continue
        name, email, timestamp_str = parts
        email_norm = email.lower()
        if email_norm not in email_name_counts:
            email_name_counts[email_norm] = {}
        email_name_counts[email_norm][name] = \
            email_name_counts[email_norm].get(name, 0) + 1
        if last_touch_iso is None:
            # git log is newest-first; first line = most recent commit
            last_touch_iso = timestamp_str

    commit_count = len(lines)

    # Resolve identity clusters via connected-component search on the
    # (name, email) bipartite graph.
    #
    # Two commits belong to the same real person if they share either a
    # display name OR an email address. We BFS over that graph to find
    # connected components, then pick the most-frequent display name in each
    # component as the canonical identity.
    #
    # This cleanly handles all three cases:
    #   A) same name,  two emails  → joined by shared name node
    #   B) two names,  same email  → joined by shared email node
    #   C) two names,  two emails, one overlap → multi-hop join

    # Build name → set-of-emails and email → set-of-names adjacency
    name_to_emails: dict[str, set[str]] = {}
    for email_norm, name_counts in email_name_counts.items():
        for name in name_counts:
            name_to_emails.setdefault(name, set()).add(email_norm)

    # BFS/DFS: each unvisited name is the seed of a new component
    visited_names:  set[str] = set()
    visited_emails: set[str] = set()

    # canon_emails: canonical_name -> set of emails in that identity cluster
    canon_emails: dict[str, set[str]] = {}

    all_names = set(name_to_emails)
    for seed_name in all_names:
        if seed_name in visited_names:
            continue
        # BFS to find all names and emails reachable from seed_name
        component_names:  set[str] = set()
        component_emails: set[str] = set()
        queue = [seed_name]
        while queue:
            n = queue.pop()
            if n in component_names:
                continue
            component_names.add(n)
            visited_names.add(n)
            for e in name_to_emails.get(n, []):
                if e in component_emails:
                    continue
                component_emails.add(e)
                visited_emails.add(e)
                # Add all other names that used this email
                for other_n in email_name_counts.get(e, {}):
                    if other_n not in component_names:
                        queue.append(other_n)

        # Pick the most-frequent name in this component as the canonical
        name_freq = {
            n: sum(email_name_counts[e].get(n, 0) for e in component_emails)
            for n in component_names
        }
        canonical = max(name_freq, key=lambda n: (name_freq[n], n))
        canon_emails[canonical] = component_emails

    if last_touch_iso:
        last_touch_dt = datetime.fromisoformat(last_touch_iso)
        last_touch_date = last_touch_dt.date()
    else:
        last_touch_date = today

    days_since = (today - last_touch_date).days

    # Build author list as "Name <email1, email2>" — schema unchanged
    authors = [
        f"{name} <{', '.join(sorted(emails))}>"
        for name, emails in canon_emails.items()
    ]

    return {
        "file": file_path,
        "author_count": len(canon_emails),
        "authors": authors,
        "commit_count": commit_count,
        "last_touch_date": last_touch_date.isoformat(),
        "days_since_last_touch": days_since,
    }


def main() -> None:
    repo_path = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
    repo_path = os.path.abspath(repo_path)

    repo = git.Repo(repo_path)
    today = datetime.now(timezone.utc).date()

    tracked_files = collect_tracked_files(repo.head.commit.tree)

    file_records = [analyze_file(repo, fp, today) for fp in tracked_files]

    # Sort: fewest authors first; ties broken by most days since last touch (desc)
    file_records.sort(key=lambda r: (r["author_count"], -r["days_since_last_touch"]))

    report = {
        "agent": "contributor_agent",
        "repo": repo_path,
        "file_count_analyzed": len(file_records),
        "files": file_records,
    }

    _OUTPUTS = Path(__file__).resolve().parent.parent / "outputs"
    _OUTPUTS.mkdir(exist_ok=True)
    output_path = str(_OUTPUTS / "contributor_report.json")
    with open(output_path, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)

    print(f"Analyzed {len(file_records)} files in {repo_path}")


if __name__ == "__main__":
    main()
