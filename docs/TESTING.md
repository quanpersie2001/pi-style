# Testing and validation

> Status: **Phase 2 status-line validation implemented; later phase validation remains planned**

## Goals

Visual output must be proven by executable contracts, not only screenshots. Tests should distinguish pure layout correctness, Pi lifecycle integration, compatibility behavior, render performance, and real terminal validation.

## Validation ladder

The package should expose:

```text
npm run typecheck
npm run lint
npm run depcruise
npm run test
npm run build
npm run check
```

`npm run check` runs all required automated gates in a stable order. Release workflows run it from a clean checkout.

## Planned test structure

```text
test/
├── unit/
│   ├── config/
│   ├── layout/
│   ├── status/
│   ├── theme/
│   └── providers/
├── render/
│   ├── status-line/
│   ├── editor/
│   ├── startup/
│   ├── messages/
│   └── tools/
├── integration/
│   ├── lifecycle/
│   ├── commands/
│   └── composition/
├── compatibility/
│   ├── pi-capabilities/
│   ├── patching/
│   └── conflicts/
├── performance/
├── e2e/
│   └── fixtures/
└── helpers/
    ├── fake-pi-host.ts
    ├── fake-theme.ts
    ├── render-assertions.ts
    └── terminal-cases.ts
```

## Unit tests

Required pure-unit coverage:

- config normalization and precedence;
- preset merging and explicit-empty-array semantics;
- segment registry and disabled/custom layout resolution;
- thinking-level mapping including `max`;
- responsive priority/overflow decisions;
- ANSI-aware visible width and truncation;
- path/model/Git formatting;
- theme semantic fallback and glyph mode;
- session usage cache updates;
- Git parser and invalidation state;
- doctor diagnostic classification.

## Render contract tests

Render tests call components or pure renderers at fixed widths and themes.

### Shared invariants

- **TEST-001:** every line satisfies `visibleWidth(line) <= width`.
- **TEST-002:** independently rendered lines end in safe/reset styling.
- **TEST-003:** empty/missing data does not leave duplicate separators.
- **TEST-004:** `NO_COLOR` preserves meaningful labels and state.
- **TEST-005:** ASCII mode emits no private-use glyphs.
- **TEST-006:** theme invalidation changes output when semantic colors change.

### Snapshot policy

Prefer semantic snapshots:

- strip or normalize ANSI codes when testing layout text;
- separately assert semantic color token usage;
- avoid raw full-screen byte snapshots that change on harmless escape ordering;
- use small golden fixtures for complex editor/message/tool examples.

## Fake Pi host

Integration tests need a bounded fake host that records:

- registered event handlers and commands;
- widget/header/editor/footer installations;
- working indicator changes;
- render requests;
- current theme/model/thinking/context;
- footer branch and extension statuses;
- ownership restoration;
- notifications and diagnostics.

It should support capability toggles so tests can simulate older/missing APIs without depending on multiple installed Pi versions.

## Lifecycle integration tests

- factory starts no background resources;
- session start installs configured surfaces;
- model/thinking events update snapshot and request render;
- session shutdown disposes in reverse order;
- repeated start/shutdown leaves counts unchanged;
- late provider promises are ignored after generation changes;
- disable restores previous editor/footer/working indicator;
- reload changes only affected surfaces;
- print/json modes create no terminal components.

## Composition tests

- no previous editor/footer;
- previous editor with composable provider;
- previous editor preferred by config;
- forced pi-style editor with explicit warning;
- previous footer preserved and dependent segments hidden;
- namespaced widgets coexist;
- another extension replaces a target after pi-style; cleanup does not overwrite it.

## Compatibility and patch tests

For every Tier C patch:

1. supported target shape installs once;
2. repeated installation is idempotent;
3. unsupported shape disables only the feature;
4. restore succeeds when wrapper is still active;
5. restore does not overwrite a later replacement;
6. streaming/partial render path remains correct;
7. native fallback output remains available;
8. doctor reports active/fallback state.

## Provider tests

### Git

- one in-flight command per cache key;
- stale value served while refreshing;
- timeout/error backoff;
- write/edit invalidation;
- branch-changing command invalidation;
- not-a-repository behavior;
- process disposal.

### Usage/context

- no full branch scan on unchanged snapshot;
- compaction/tree change invalidates correctly;
- live usage does not double count finalized usage;
- missing model context window produces hidden/unknown state.

## Performance tests

The exact numeric budgets will be calibrated after implementation, but tests must verify:

- no filesystem/process/network call occurs inside render;
- cached status render is sub-millisecond or within an agreed local budget;
- a streaming burst produces bounded render requests;
- layout work is linear in configured segment count;
- session usage aggregation is incremental/cached;
- repeated reload does not grow memory/listeners/timers;
- Git refreshes are deduplicated and bounded.

Performance regressions should fail CI only after stable baselines exist; before that, record measurements and alert thresholds.

## Manual terminal matrix

Before v1, record smoke results for:

| Dimension | Cases |
| --- | --- |
| Terminal | Ghostty, iTerm2, Kitty, WezTerm, Linux terminal, Windows Terminal/WSL |
| Width | 40, 60, 80, 120, 160 columns |
| Height | short and normal viewports |
| Font | Nerd Font, normal Unicode font, ASCII mode |
| Color | truecolor, 256-color approximation, `NO_COLOR` |
| Environment | local, tmux, SSH where practical |
| Lifecycle | startup, reload, new/resume/fork, shutdown |
| Content | long model/path/branch, multiline prompt, streaming, expanded tools |

Manual evidence includes Pi version, terminal/version, OS, config preset, and observed limitations.

## Phase 2 implementation notes

The repository includes status unit and integration coverage for preset/duplicate handling, snapshot generation safety, responsive rendering across documented widths, Git parsing/cache deduplication, usage live/final deduplication, context storage, malformed/disabled segment isolation, component factories, widget placement, cleanup, and headless behavior.

## Feature-specific proof

Each file under `docs/ui/` defines acceptance criteria. A feature is not `Implemented` until:

- every requirement ID has at least one automated or explicitly manual proof;
- automated tests pass;
- any manual-only claim is labeled as such;
- fallback behavior is tested, not merely the happy path.

## Phase gates

| Phase | Required proof |
| --- | --- |
| 0 | Typecheck/lint/depcruise/test/build scaffold. |
| 1 | Config, theme, runtime, scheduler, disposal, fake-host tests. |
| 2 | Status segments/layout/providers/render-width tests. |
| 3 | Editor alignment/composition/lifecycle/render tests. |
| 4 | Startup reasons/dismissal/stale-generation/render tests. |
| 5 | Message/tool patch idempotence, streaming, fallback tests. |
| 6 | Persistence, migration, commands, conflict and doctor tests. |
| 7 | Full check, performance audit, package smoke, terminal matrix. |

## Phase 0 evidence

- `npm ci` completes from the lockfile.
- `npm run check` passes, including typecheck, lint, dependency-cruiser, lifecycle tests, build, and package-load smoke.
- `npm pack --dry-run` contains only the runtime bundle, source map, package metadata, themes placeholder, README, changelog, and license.
- The built ESM extension imports successfully, and `pi --mode json --no-session -e ./dist/extensions/pi-style.js` completes without terminal UI installation.

## Release checklist

- `npm ci` and `npm run check` pass from clean checkout.
- packed npm contents include only declared runtime files, docs, themes, and licenses.
- `pi -e` package smoke starts and shuts down cleanly.
- install/update/remove paths are tested.
- peer dependency range matches tested Pi versions.
- changelog lists compatibility-sensitive changes.
- docs no longer describe shipped behavior as merely planned.
- no unresolved blocking diagnostic exists for edited files.

## Testing requirements

- **TEST-007:** tests never depend on the vendored reference repos at runtime.
- **TEST-008:** renderer tests exercise width extremes and missing data.
- **TEST-009:** compatibility tests prove disposal identity safety.
- **TEST-010:** manual terminal claims record reproducible environment details.
- **TEST-011:** a phase cannot be marked complete with failing required gates.

## Roadmap coverage

- Harness/scaffold: Phase 0.
- Expanded continuously through Phases 1–6.
- Full release proof: Phase 7.
