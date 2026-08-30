# Fix Issues Plan — Knowledge Continuity Suite (knowledge-handoff-4)

## Context

All three modules are fully coded in `knowledge-handoff-4`:
- **Module 1** — `contributor_agent.py`, `complexity_agent.py`, `documentation_gap_agent.py`, `orchestrator.py`, `run_pipeline.py`
- **Module 2** — `onboarding_agent.py`
- **Module 3** — `extraction_agent.py`

The agents were developed and run on a **Windows machine** and the output artifacts
were copied here. When running on macOS the pipeline breaks in 3 places.

**Key constraint:** Do NOT make changes that would make any Bob task session
summary prompt look wrong. Agent logic changes are acceptable; cosmetic or
naming changes that invalidate existing output screenshots are not required.

---

## Issues Found

### Issue 1 — `risk_report.json` has a UTF-8 BOM (not pure UTF-8)
`backend/outputs/risk_report.json` starts with `﻿` (U+FEFF BOM character). The
`run_pipeline.py` `load_report()` opens files with `encoding="utf-8"` which
rejects the BOM on strict parsing. The `onboarding_agent.py` and
`extraction_agent.py` already handle this via an encoding ladder
(`utf-8-sig` → `utf-16`), but `run_pipeline.py` does not — meaning a fresh
re-run of the pipeline would fail at step 4.

### Issue 2 — Hard-coded Windows repo paths in all pre-generated reports
Every output JSON has `"repo": "C:\\Users\\Lenovo\\Downloads\\knowledge-handoff\\..."`.
This path does not exist on macOS. `extraction_agent.py` reads the repo path from
`contributor_report["repo"]` as its default — so running it fresh without passing
an explicit `--repo` argument will point at a non-existent Windows path and fail.

### Issue 3 — CWD-relative output paths in `contributor_agent.py`, `complexity_agent.py`, and `extraction_agent.py`
All three scripts write to `os.makedirs("outputs", ...)` — relative to **wherever
the script is run from** (CWD), not relative to the script file itself. If run
from `backend/agents/` they land in `backend/agents/outputs/` (wrong). If run
from `backend/` they land in `backend/outputs/` (correct, but fragile).
`onboarding_agent.py` already does this correctly using `Path(__file__).resolve()`.

### Issue 4 — `extraction_agent.py` uses a relative Windows repo path as fallback
In the pre-generated `extraction_report.json` the repo field is `"..\\sample-repos\\steam-snap"`
(Windows relative path with backslash). When `extraction_agent.py` reads this as
the repo fallback on macOS, the `Path()` + `.git` check will fail. The script
must be run with an explicit repo path argument on macOS.

### Issue 5 — `validate_report.py` uses a hard-coded relative path
`validate_report.py` opens `'../outputs/documentation_report.json'` — this
only works when the script is run from `backend/agents/`. It should use
`__file__`-relative paths like the other agents.

### Issue 6 — `documentation_report.json` uses `documentation_score` but `run_pipeline.py` also accepts `doc_score`
The documentation agent outputs `documentation_score` (not `doc_score`).
`run_pipeline.py` line 60 handles both:
`d.get("doc_score", d.get("documentation_score"))` — this is already correct.
No fix needed here.

---

## Sub-Task 1 — Fix `run_pipeline.py` to handle UTF-8 BOM

**Status:** `[ ] pending`

**Intent:**
`run_pipeline.py`'s `load_report()` opens JSON with `encoding="utf-8"` which fails
on files with a UTF-8 BOM (U+FEFF). Change it to `encoding="utf-8-sig"` so it
strips the BOM transparently without breaking normal UTF-8 files.

**Expected Outcomes:**
- `run_pipeline.py` can load `risk_report.json` and all other reports that may have
  a BOM without raising a `json.JSONDecodeError` or `UnicodeDecodeError`.
- No change to any output format or logic.

**Todo List:**
1. In `backend/agents/run_pipeline.py`, change the `open()` call in `load_report()`:
   - From: `open(path, "r", encoding="utf-8")`
   - To: `open(path, "r", encoding="utf-8-sig")`

**Relevant Context:**
- `run_pipeline.py` line 20: `with open(path, "r", encoding="utf-8") as fh:`
- `onboarding_agent.py` already uses `utf-8-sig` as its first ladder step.
- `utf-8-sig` is a Python built-in codec that strips BOM if present and reads
  normally if not — it is a safe, backwards-compatible replacement.

---

## Sub-Task 2 — Fix CWD-relative output paths in `contributor_agent.py`, `complexity_agent.py`, and `extraction_agent.py`

**Status:** `[ ] pending`

**Intent:**
Three scripts write to `outputs/` relative to CWD. This is fragile — the correct
output directory (`backend/outputs/`) is only reached if the script happens to be
run from `backend/`. Fix all three to compute the output path relative to
`__file__`, matching the pattern already used by `onboarding_agent.py`.

**Expected Outcomes:**
- Running any of the three scripts from any working directory always writes output
  to `backend/outputs/` (the directory that sits beside `backend/agents/`).
- Scripts still create the `outputs/` directory if it does not exist.

**Todo List:**
1. In `backend/agents/contributor_agent.py` `main()`:
   - Add `from pathlib import Path` import (not currently imported).
   - Replace:
     ```python
     os.makedirs("outputs", exist_ok=True)
     output_path = os.path.join("outputs", "contributor_report.json")
     ```
     With:
     ```python
     _OUTPUTS = Path(__file__).resolve().parent.parent / "outputs"
     _OUTPUTS.mkdir(exist_ok=True)
     output_path = str(_OUTPUTS / "contributor_report.json")
     ```
2. In `backend/agents/complexity_agent.py` `main()`:
   - Add `from pathlib import Path` import.
   - Replace:
     ```python
     os.makedirs("outputs", exist_ok=True)
     with open("outputs/complexity_report.json", "w", encoding="utf-8") as fh:
     ```
     With:
     ```python
     _OUTPUTS = Path(__file__).resolve().parent.parent / "outputs"
     _OUTPUTS.mkdir(exist_ok=True)
     with open(str(_OUTPUTS / "complexity_report.json"), "w", encoding="utf-8") as fh:
     ```
3. In `backend/agents/extraction_agent.py` `main()`:
   - Add `from pathlib import Path` import (already imported at module level — confirm).
   - Replace:
     ```python
     os.makedirs("outputs", exist_ok=True)
     os.makedirs(os.path.join("outputs", "extraction_drafts"), exist_ok=True)
     ...
     md_path = os.path.join("outputs", "extraction_drafts", fname)
     ...
     out_path = os.path.join("outputs", "extraction_report.json")
     ```
     With paths computed as:
     ```python
     _OUTPUTS = Path(__file__).resolve().parent.parent / "outputs"
     _DRAFTS  = _OUTPUTS / "extraction_drafts"
     _OUTPUTS.mkdir(exist_ok=True)
     _DRAFTS.mkdir(exist_ok=True)
     ...
     md_path = str(_DRAFTS / fname)
     ...
     out_path = str(_OUTPUTS / "extraction_report.json")
     ```

**Relevant Context:**
- `onboarding_agent.py` lines 39–43 shows the correct pattern to follow.
- `extraction_agent.py` already imports `Path` from `pathlib` at line 37.
- `contributor_agent.py` and `complexity_agent.py` do not yet import `pathlib`.

---

## Sub-Task 3 — Fix `validate_report.py` hard-coded path

**Status:** `[ ] pending`

**Intent:**
`validate_report.py` opens `'../outputs/documentation_report.json'` which only
works from `backend/agents/`. Make it path-safe using `__file__`.

**Expected Outcomes:**
- `validate_report.py` can be run from any working directory and always finds
  `backend/outputs/documentation_report.json`.

**Todo List:**
1. Replace the hard-coded open path:
   - From: `with open('../outputs/documentation_report.json') as f:`
   - To:
     ```python
     from pathlib import Path
     _REPORT = Path(__file__).resolve().parent.parent / "outputs" / "documentation_report.json"
     with open(_REPORT) as f:
     ```

**Relevant Context:**
- `validate_report.py` is a standalone validation script; it has no other path
  dependencies.

---

## Sub-Task 4 — Add a `run_all.sh` script to make the full pipeline easy to run on macOS

**Status:** `[ ] pending`

**Intent:**
Currently there is no single command to run the full end-to-end pipeline. A simple
shell script at `backend/run_all.sh` gives anyone a one-command way to regenerate
all five output files from scratch on macOS (or any Unix system), passing the
correct `repo` path automatically. This also documents the correct run order for
the submission.

**Expected Outcomes:**
- `backend/run_all.sh` exists and is executable.
- Running `bash backend/run_all.sh` from the project root regenerates all outputs
  in the correct order:
  1. `contributor_report.json`
  2. `complexity_report.json`
  3. `documentation_report.json`
  4. `risk_report.json`
  5. `onboarding_report.json`
  6. `extraction_report.json` + `extraction_drafts/`
- Each command uses paths relative to the script location so it works regardless
  of where the project is cloned.

**Todo List:**
1. Create `backend/run_all.sh` with the following content:
   ```bash
   #!/usr/bin/env bash
   set -e
   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
   AGENTS="$SCRIPT_DIR/agents"
   OUTPUTS="$SCRIPT_DIR/outputs"
   REPO="$SCRIPT_DIR/../sample-repos/steam-snap"

   echo "=== Step 1: Contributor Agent ==="
   python "$AGENTS/contributor_agent.py" "$REPO"

   echo "=== Step 2: Complexity Agent ==="
   python "$AGENTS/complexity_agent.py" "$REPO"

   echo "=== Step 3: Documentation Gap Agent ==="
   python "$AGENTS/documentation_gap_agent.py" --repo "$REPO" \
     --output "$OUTPUTS/documentation_report.json"

   echo "=== Step 4: Run Pipeline (risk report) ==="
   python "$AGENTS/run_pipeline.py" \
     "$OUTPUTS/contributor_report.json" \
     "$OUTPUTS/complexity_report.json" \
     "$OUTPUTS/documentation_report.json" \
     > "$OUTPUTS/risk_report.json"

   echo "=== Step 5: Onboarding Agent ==="
   python "$AGENTS/onboarding_agent.py" \
     --repo "$REPO" \
     --risk-report "$OUTPUTS/risk_report.json" \
     --contributor-report "$OUTPUTS/contributor_report.json"

   echo "=== Step 6: Extraction Agent ==="
   python "$AGENTS/extraction_agent.py" \
     "$OUTPUTS/risk_report.json" \
     "$OUTPUTS/contributor_report.json" \
     "$REPO"

   echo ""
   echo "All outputs written to: $OUTPUTS"
   ```
2. The documentation_gap_agent CLI args must be verified — check that it accepts
   `--repo` and `--output` flags (confirmed in its `argparse` setup).

**Relevant Context:**
- `run_pipeline.py` writes to stdout — must be redirected to file with `>`.
- `onboarding_agent.py` already resolves its output path via `__file__`, so no
  extra path arg is needed.
- `extraction_agent.py` needs the explicit `$REPO` as 3rd positional arg (after
  the path fix in Sub-Task 2, it no longer reads `repo` from the JSON).

---

## Sub-Task 5 — End-to-end verification run

**Status:** `[ ] pending`

**Intent:**
After applying all code fixes, run `bash backend/run_all.sh` and confirm all six
output files are generated cleanly with macOS paths and no encoding errors.

**Expected Outcomes:**
- All five `"repo"` fields in output JSONs show the macOS absolute path.
- `risk_report.json` is plain UTF-8 with no BOM.
- `onboarding_report.json` is generated with current macOS date-relative scores.
- `extraction_report.json` shows 8 HIGH-risk files drafted.
- `extraction_drafts/` contains 8 `.md` files.
- No errors or tracebacks during the run.

**Todo List:**
1. From the `knowledge-handoff-4/` directory, run:
   ```bash
   bash backend/run_all.sh
   ```
2. Check for any Python errors and fix before proceeding.
3. Open `backend/outputs/risk_report.json` — confirm it starts with `[` (not `﻿[`).
4. Confirm `backend/outputs/onboarding_report.json` exists and has `high_risk_file_count`.
5. Confirm `backend/outputs/extraction_drafts/` has `.md` files.
6. Run `python backend/agents/validate_report.py` — should print "All N entries pass validation."
