# Report Schemas

Reference for the exact JSON shape each agent produces and consumes. Written after multiple real integration bugs came from field-name drift between independently-built modules — this is the single source of truth going forward.

---

## `contributor_report.json`
Produced by `contributor_agent.py`

```json
{
  "agent": "contributor_analysis",
  "repo": "<path to analyzed repo>",
  "file_count_analyzed": 73,
  "files": [
    {
      "file": "snap/keys/B05498B7.asc",
      "author_count": 1,
      "authors": ["James Henstridge"],
      "commit_count": 1,
      "last_touch_date": "2022-07-13",
      "days_since_last_touch": 1507
    }
  ]
}
```
Sorted: fewest authors first, then most stale. `author_count` uses connected-component identity resolution (same person under multiple emails/names is merged).

---

## `complexity_report.json`
Produced by `complexity_agent.py`

```json
{
  "agent": "complexity_analysis",
  "repo": "<path>",
  "file_count_analyzed": 64,
  "files": [
    {
      "file": "docs/.sphinx/update_sp.py",
      "complexity_score": 42.12,
      "metrics": {
        "nloc": 202,
        "function_count": 6,
        "avg_cyclomatic_complexity": 6.0,
        "max_cyclomatic_complexity": 16
      }
    }
  ]
}
```
Binary files are excluded entirely (not scored as 0 — omitted from `files`). `complexity_score` is normalized 0–100 against the corpus.

---

## `documentation_report.json`
Produced by `documentation_gap_agent.py`

```json
{
  "agent": "documentation_gap_agent",
  "repo": "<path>",
  "file_count_analyzed": 52,
  "files": [
    {
      "file": "README.md",
      "documentation_score": 92,
      "metrics": {
        "comment_count": 0,
        "docstring_count": 0,
        "has_file_description": true,
        "has_external_documentation": true
      },
      "reason": "..."
    }
  ]
}
```
> ⚠️ **Field is `documentation_score`, not `doc_score`.** `run_pipeline.py`'s adapter checks both names defensively — don't assume every consumer does.

---

## `risk_report.json`
Produced by `run_pipeline.py`, feeding `orchestrator.compute_risk()`

```json
[
  {
    "file": "snap/keys/B05498B7.asc",
    "author_count": 1,
    "last_touch_days_ago": 1507,
    "complexity_score": 8.6,
    "doc_score": 0,
    "risk_level": "HIGH",
    "why": "1 contributor, last touched 1507 days ago, zero comments (doc score 0.0/100)."
  }
]
```
> ⚠️ **This is a bare JSON array, not `{"files": [...]}`** — unlike every other report in this project. Code that assumes `risk_report['files']` will fail. This inconsistency is a known, disclosed limitation (see `fix-issues-plan.md`).

> ⚠️ **Field is `last_touch_days_ago`**, translated from the contributor report's `days_since_last_touch` by the adapter — the two field names are intentionally different across these two files.

Files missing from the documentation report default to `doc_score: 0` rather than being silently dropped — a missing score genuinely means "no documentation signal found," and dropping the file would have removed real risk data (including the highest-value demo example) from the final report.

---

## `onboarding_report.json`
Produced by `onboarding_agent.py`

```json
{
  "high_risk_file_count": 8,
  "files": [
    {
      "file": "src/nvidia32",
      "all_owners": ["ashuntu"],
      "backups": [
        {"name": "shanecrowley", "score": 100.0, "files_covered": 6}
      ]
    }
  ]
}
```
Backup candidates are computed automatically from git history (breadth × recency × depth of related work) — no manual self-rating required.

---

## `extraction_report.json`
Produced by `extraction_agent.py`

```json
{
  "agent": "extraction_agent",
  "repo": "<path>",
  "high_risk_files_drafted": 8,
  "files": [
    {
      "file": "src/nvidia32",
      "risk_level": "HIGH",
      "why": "...",
      "commit_count_used": 14,
      "comment_count_extracted": 7,
      "draft_markdown": "..."
    }
  ]
}
```
Individual `.md` drafts are written to `outputs/extraction_drafts/<sanitized-filename>.md` for direct human review.

---

## Known Inconsistencies (disclosed, not hidden)

| Inconsistency | Files affected | Status |
|---|---|---|
| `risk_report.json` is a bare list; every other report wraps `files` in an object | `run_pipeline.py` output | Documented, not changed — fixing would ripple through 3 downstream consumers this late in the build |
| `documentation_score` vs `doc_score` naming | `documentation_gap_agent.py` vs `orchestrator.py` | Handled defensively in the adapter, not unified at the source |
| `days_since_last_touch` vs `last_touch_days_ago` | `contributor_agent.py` vs `orchestrator.py` | Handled via explicit translation in `run_pipeline.py` |

These are left as-is deliberately rather than risk destabilizing verified, working modules under time pressure — each is handled correctly at the integration boundary, just not unified at the source.
