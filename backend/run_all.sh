#!/usr/bin/env bash
# run_all.sh — Knowledge Continuity Suite
# Runs the full pipeline end-to-end on sample-repos/steam-snap.
# Safe to run from any working directory.
# Works on macOS (python3), Linux, and Git Bash on Windows.

set -e

# Detect python command — prefer python3.11+, fall back to python3, then python
if command -v python3.11 &>/dev/null; then
    PY=python3.11
elif command -v python3.12 &>/dev/null; then
    PY=python3.12
elif command -v python3.13 &>/dev/null; then
    PY=python3.13
elif command -v python3 &>/dev/null; then
    PY=python3
elif command -v python &>/dev/null; then
    PY=python
else
    echo "Error: no python3 or python found in PATH." >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENTS="$SCRIPT_DIR/agents"
OUTPUTS="$SCRIPT_DIR/outputs"
REPO="$SCRIPT_DIR/../sample-repos/steam-snap"

echo "Using: $PY"
echo ""

echo "=== Step 1: Contributor Agent ==="
"$PY" "$AGENTS/contributor_agent.py" "$REPO"

echo "=== Step 2: Complexity Agent ==="
"$PY" "$AGENTS/complexity_agent.py" "$REPO"

echo "=== Step 3: Documentation Gap Agent ==="
"$PY" "$AGENTS/documentation_gap_agent.py" \
  --repo "$REPO" \
  --output "$OUTPUTS/documentation_report.json"

echo "=== Step 4: Run Pipeline (risk report) ==="
"$PY" "$AGENTS/run_pipeline.py" \
  "$OUTPUTS/contributor_report.json" \
  "$OUTPUTS/complexity_report.json" \
  "$OUTPUTS/documentation_report.json" \
  > "$OUTPUTS/risk_report.json"

echo "=== Step 5: Onboarding Agent ==="
"$PY" "$AGENTS/onboarding_agent.py" "$REPO" \
  --risk-report "$OUTPUTS/risk_report.json" \
  --contributor-report "$OUTPUTS/contributor_report.json"

echo "=== Step 6: Extraction Agent ==="
"$PY" "$AGENTS/extraction_agent.py" \
  "$OUTPUTS/risk_report.json" \
  "$OUTPUTS/contributor_report.json" \
  "$REPO"

echo ""
echo "Done. All outputs written to: $OUTPUTS"
