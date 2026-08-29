# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Architectural Constraints (Non-Obvious Only)

- **Greenfield project** — no stack, framework, or architecture has been chosen. Planning should start from requirements, not from existing code patterns.
- **`sample-repos/` is test data, not architecture** — the presence of `steam-snap` (a Snapcraft/Bash/Python project) does not indicate the project's own technology choices.
- **`agents/` and `outputs/` directory names suggest an agentic workflow pattern** — likely intended for AI agent scripts and their generated artifacts, but this is not yet codified.
- **Security posture is pre-configured** — `.gitignore` and `.bobignore` are already hardened for IBM Cloud/Watsonx credential patterns. Any architecture plan must account for credential management via environment variables from day one; these files must not be modified to loosen security patterns.
- **IBM Watsonx/Cloud context** — the template's `.gitignore` references `ibmcloud-credentials.json` and `ibm-credentials.env`, suggesting the project will use IBM Cloud services. Plan accordingly for Watson/Watsonx API integration patterns.
