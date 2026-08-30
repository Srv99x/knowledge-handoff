# Knowledge Continuity Suite

**Find where your codebase's critical knowledge is dangerously stuck in one person's head — before that person leaves.**

Built with IBM Bob 2.0 for the IBM TechXchange 2026 Pre-conference Dev Day Hackathon.

---

## The Problem

When a key contributor leaves a team, critical knowledge often leaves with them. Every codebase accumulates files that only one or two people truly understand — complex, undocumented, and quietly load-bearing. Teams usually discover this risk only *after* the person is gone, when onboarding a replacement becomes a slow, expensive guessing game.

## The Solution

The Knowledge Continuity Suite proactively finds these risks before they become emergencies. It analyzes a repository's real git history and code to answer three questions:

1. **Which files are at risk?** (Detect)
2. **Who could actually take over if the owner left tomorrow?** (Assess)
3. **How do we capture the missing knowledge, cheaply?** (Remediate)

---

## Architecture

Three independent modules, each built around parallel IBM Bob subagents, feeding a shared risk report:

```
                    ┌─────────────────────┐
                    │   Target Repository   │
                    │   (git history + code)│
                    └───────────┬──────────┘
                                │
         ┌──────────────────────┼──────────────────────┐
         ▼                      ▼                      ▼
┌─────────────────┐  ┌──────────────────┐  ┌──────────────────────┐
│ Contributor      │  │ Complexity /     │  │ Documentation Gap    │
│ Analysis Agent   │  │ Criticality Agent│  │ Agent                │
│ (git log walk)   │  │ (lizard-based)   │  │ (comment/doc scoring)│
└────────┬─────────┘  └────────┬─────────┘  └──────────┬───────────┘
         └──────────────────────┼──────────────────────┘
                                 ▼
                      ┌────────────────────┐
                      │    Orchestrator     │
                      │  (risk classifier)  │
                      └──────────┬──────────┘
                                 ▼
                      ┌────────────────────┐
                      │   risk_report.json  │  ← Module 1 output
                      └──────────┬──────────┘
                 ┌───────────────┴───────────────┐
                 ▼                                 ▼
      ┌─────────────────────┐          ┌──────────────────────┐
      │  Onboarding-Readiness │          │  Extraction Assistant  │
      │  Analyzer (Module 2)  │          │  (Module 3)            │
      │  "who's the backup?"  │          │  auto-drafts knowledge │
      └──────────┬───────────┘          └──────────┬─────────────┘
                 └───────────────┬───────────────────┘
                                 ▼
                      ┌────────────────────┐
                      │   Live Dashboard     │
                      │  (6 views, zero-dep) │
                      └────────────────────┘
```

---

## What Each Module Does

### Module 1 — Knowledge-Loss Risk Mapper
Three subagents run in parallel against the target repo:
- **Contributor Analysis Agent** — walks `git log` per file to compute distinct-author count and staleness, using connected-component identity resolution (a person committing under two emails/display names is correctly merged into one real contributor)
- **Complexity/Criticality Agent** — scores every file's real cyclomatic complexity and size via `lizard`
- **Documentation Gap Agent** — scores comment/docstring coverage, weighted across six signals (comments, docstrings, file headers, external doc references, comment quality, completeness)

An **Orchestrator** merges all three signals into a single `risk_report.json`: every file classified HIGH / MEDIUM / LOW, with a plain-English reason.

### Module 2 — Onboarding-Readiness Analyzer
For every HIGH-risk file, answers: *"If the sole owner left tomorrow, who on the team is closest to being able to take over?"* Ranks candidates by breadth, recency, and depth of related work — fully automatic from git history, no manual self-rating required.

### Module 3 — Extraction Assistant
For every HIGH-risk file, auto-drafts a plain-English knowledge document from existing commit messages, PR descriptions, and inline comments — turning a blank-page documentation task into a five-minute review task. Template-driven (no live LLM dependency), safe and fast to demo.

### Dashboard
A zero-dependency (Python stdlib + vanilla JS, no npm/build step) live dashboard rendering all six reports across Overview, Risk, Bus Factor, Complexity, Documentation, Onboarding, and Extraction views.

---

## Verified Results

Run against [`canonical/steam-snap`](https://github.com/canonical/steam-snap) (445 real commits, 15+ contributors) as the demo target:

| Metric | Value |
|---|---|
| Files tracked | 73 |
| Files risk-ranked | 64 |
| **HIGH risk** | 8 |
| MEDIUM risk | 38 |
| LOW risk | 18 |
| HIGH-risk files with a real backup | **0 of 8** |
| Knowledge drafts generated | 8 |

**Every one of the 8 HIGH-risk files has exactly one true owner**, split entirely between two people — a genuine, verified bus-factor problem this repo didn't know it had.

### We didn't trust AI output blindly

Every number above was independently cross-checked against raw ground truth — real `git log` output, the `lizard` library directly — not assumed correct because it looked reasonable. This process caught and fixed multiple real bugs before they reached the final report:

- **Contributor identity bug**: the same person committing under two email addresses was being counted as two separate contributors, systematically understating risk
- **Path-matching bug**: a substring check (`".git"` in path) was silently treating every file under `.github/` as internal VCS data, dropping real GitHub template/workflow files from analysis
- **Schema mismatch bugs**: field-name drift between independently-built modules (`doc_score` vs `documentation_score`, `days_since_last_touch` vs `last_touch_days_ago`) — now documented explicitly in [`SCHEMA.md`](./SCHEMA.md) to prevent recurrence
- **Silent-drop bug**: an early integration dropped files missing from any single report instead of handling partial data gracefully — including the single best demo example

See [`fix-issues-plan.md`](./fix-issues-plan.md) and [`agents-plan.md`](./agents-plan.md) for the full engineering trail.

---

## How IBM Bob Was Used

- **`/init`** to generate project-aware context before any code generation
- **Plan mode**, explicitly using Bob's subagent-approval flow to plan independent parallel subagent tasks rather than building sequentially
- **Agent mode** to implement subagents per approved plans
- **Iterative debugging with Bob** — diagnosing real bugs from observed symptoms (e.g. a file-count mismatch between modules), not being handed the answer, then fixing and re-verifying
- A dedicated **Bob skill** (`.bob/skills/verify-dashboard/`) that automates rebuilding and health-checking the dashboard against live data on every change

Full details in the submission's written Bob-usage statement.

---

## Running It

**Requirements:** Python 3.11+, Node.js (for dashboard verification only)

```bash
pip install gitpython lizard

# Full backend pipeline — regenerates all 5 reports in order
bash backend/run_all.sh          # macOS/Linux/Git Bash
backend\run_all.bat              # Windows (native)

# Verify + rebuild + launch the dashboard
bash .bob/skills/verify-dashboard/scripts/verify.sh
# → open http://localhost:8765
```

See [`SCHEMA.md`](./SCHEMA.md) for the exact JSON contract each report follows.

---

## Project Structure

```
knowledge-handoff/
├── backend/
│   ├── agents/              # All 6 agent scripts + orchestrator + adapter
│   ├── outputs/              # Generated reports (regenerate via run_all)
│   ├── run_all.sh / .bat
├── dashboard/                 # Zero-dependency live dashboard
├── sample-repos/              # Demo target repo (steam-snap)
├── .bob/skills/verify-dashboard/   # Automated dashboard verification skill
├── bob_sessions/              # Bob task session summary screenshots
├── agents-plan.md             # Module 1 build plan
├── fix-issues-plan.md         # Cross-platform bug fixes + rationale
├── SCHEMA.md                  # JSON contract reference
└── README.md
```

---

## Team

Built by Team Blindspot for IBM TechXchange 2026 Pre-conference Dev Day Hackathon.

