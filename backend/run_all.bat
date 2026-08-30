@echo off
:: run_all.bat — Knowledge Continuity Suite
:: Runs the full pipeline end-to-end on sample-repos/steam-snap.
:: Works on Windows natively (Command Prompt or PowerShell).

setlocal enabledelayedexpansion

:: Detect python command — prefer py launcher with 3.11, fall back to python
where py >nul 2>&1
if %errorlevel% == 0 (
    set PY=py -3.11
    py -3.11 --version >nul 2>&1
    if not !errorlevel! == 0 (
        set PY=py
    )
) else (
    where python >nul 2>&1
    if %errorlevel% == 0 (
        set PY=python
    ) else (
        echo Error: no python found in PATH.
        exit /b 1
    )
)

echo Using: %PY%
echo.

set SCRIPT_DIR=%~dp0
set AGENTS=%SCRIPT_DIR%agents
set OUTPUTS=%SCRIPT_DIR%outputs
set REPO=%SCRIPT_DIR%..\sample-repos\steam-snap

echo === Step 1: Contributor Agent ===
%PY% "%AGENTS%\contributor_agent.py" "%REPO%"
if %errorlevel% neq 0 exit /b %errorlevel%

echo === Step 2: Complexity Agent ===
%PY% "%AGENTS%\complexity_agent.py" "%REPO%"
if %errorlevel% neq 0 exit /b %errorlevel%

echo === Step 3: Documentation Gap Agent ===
%PY% "%AGENTS%\documentation_gap_agent.py" --repo "%REPO%" --output "%OUTPUTS%\documentation_report.json"
if %errorlevel% neq 0 exit /b %errorlevel%

echo === Step 4: Run Pipeline (risk report) ===
%PY% "%AGENTS%\run_pipeline.py" ^
  "%OUTPUTS%\contributor_report.json" ^
  "%OUTPUTS%\complexity_report.json" ^
  "%OUTPUTS%\documentation_report.json" ^
  > "%OUTPUTS%\risk_report.json"
if %errorlevel% neq 0 exit /b %errorlevel%

echo === Step 5: Onboarding Agent ===
%PY% "%AGENTS%\onboarding_agent.py" "%REPO%" ^
  --risk-report "%OUTPUTS%\risk_report.json" ^
  --contributor-report "%OUTPUTS%\contributor_report.json"
if %errorlevel% neq 0 exit /b %errorlevel%

echo === Step 6: Extraction Agent ===
%PY% "%AGENTS%\extraction_agent.py" ^
  "%OUTPUTS%\risk_report.json" ^
  "%OUTPUTS%\contributor_report.json" ^
  "%REPO%"
if %errorlevel% neq 0 exit /b %errorlevel%

echo.
echo Done. All outputs written to: %OUTPUTS%
endlocal
