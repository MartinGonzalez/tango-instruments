# Tango Instruments

Monorepo containing all instruments (plugins) for the Tango desktop app. Each subdirectory is an independent instrument project with its own `package.json`, dependencies, and build output.

## Instruments

| Directory | ID | Description |
|---|---|---|
| `diaries-instrument/` | diaries-instrument | Daily coding activity tracker and dev diary generator |
| `pr-instrument/` | pr-instrument | GitHub pull request viewer and manager |
| `music-instrument/` | music-instrument | Apple Music playback control |
| `jira-board/` | jira-board | Jira boards, sprints, and ticket browser |
| `tango-example/` | tango-integration | Reference instrument showcasing the Tango SDK |

## Workflow Rules

### One instrument at a time
This repo is shared across all instruments. To avoid cross-contamination:
1. Pull latest `main` before starting work
2. Create a branch scoped to the instrument: `feat/<instrument-id>/description` or `fix/<instrument-id>/description`
3. Only modify files inside that instrument's directory
4. Do NOT touch other instruments in the same branch/PR

### Commands (run from inside an instrument directory)

```bash
bun dev              # Dev mode: build + watch + hot-reload into running Tango app
bun run build        # One-shot build to dist/
bun run test         # Run unit tests
bun run sync         # Sync instrument config with Tango app
bun run validate     # Validate manifest and structure
bun run publish      # Publish current version
bun run publish:patch  # Bump patch version and publish
bun run publish:minor  # Bump minor version and publish
bun run publish:major  # Bump major version and publish
```

All scripts delegate to the `tango-api` CLI (`bun node_modules/tango-api/src/cli.ts <command>`).

### tango-api dependency
Every instrument depends on `tango-api` via a GitHub tag (e.g., `github:MartinGonzalez/tango-api#v0.0.2-rcNN`). When the SDK is updated, use `/release-tango-api` to tag a new rc and update all consumers automatically.

### Dev mode (`bun dev`)
- Clears Bun cache and runs `bun install` once at startup
- Builds frontend + backend to `dist/`
- POSTs to the running Tango app's dev-reload endpoint (port 4243)
- Watches `src/` for changes and auto-rebuilds
- Also watches `package.json` and lockfile — updating the tango-api tag while dev is running triggers auto-install + rebuild

## Project Structure (per instrument)

```
<instrument>/
├── package.json      # Manifest (tango.instrument config lives here)
├── src/
│   ├── index.tsx     # Frontend entrypoint (React)
│   └── backend.ts    # Backend entrypoint (runs in host Bun process)
├── test/             # Unit tests
├── dist/             # Build output (gitignored)
└── node_modules/     # Dependencies (gitignored)
```

## Registry

`tango.json` at the repo root lists all instruments and their paths. Update it when adding or removing instruments.
