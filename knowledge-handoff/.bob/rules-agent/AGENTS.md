# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Coding Rules (Non-Obvious Only)

- **`sample-repos/` is test data** — treat cloned repos under it as read-only reference material, not as part of this project's codebase. Never generate project-level files (AGENTS.md, configs, etc.) inside `sample-repos/`.
- **No application code exists yet** — `agents/` and `outputs/` are empty directories. Any code you write will be the first code in this project.
- **`.bobignore` blocks files matching `*config.json` and `*config.yaml`** — if you create config files with these names, Bob will not be able to read them in future sessions. Use distinct names (e.g. `app-config.json`, `settings.yaml`).
- **Credential files must never be created with hardcoded values** — always template with placeholders and reference `.env.example` as the model.
