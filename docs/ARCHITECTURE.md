# Architecture

> Status: **Phase 6 accepted after independent Peer acceptance and Root validation; Phase 7 remains blocked/not started pending Supervisor/program acceptance**

## Architecture goals

The architecture must support a richer product than the initial status-line slice without reproducing the monolithic structure of the references. It should keep Pi-specific integration thin, make render logic testable, isolate compatibility patches, and allow each UI surface to fail or be disabled independently.

## Planned repository structure

```text
pi-style/
├── extension-src/
│   └── pi-style/
│       ├── shared/
│       │   ├── ansi.ts
│       │   ├── width.ts
│       │   ├── collections.ts
│       │   ├── object.ts
│       │   └── path.ts
│       ├── domain/
│       │   ├── types.ts
│       │   ├── config-types.ts
│       │   ├── config-normalization.ts
│       │   ├── layout/
│       │   ├── status/
│       │   ├── styles/
│       │   └── theme/
│       ├── features/
│       │   ├── status-line/
│       │   ├── editor/
│       │   ├── startup/
│       │   ├── messages/
│       │   ├── tools/
│       │   └── terminal-background/
│       ├── app/
│       │   ├── config.ts
│       │   ├── runtime.ts
│       │   ├── state.ts
│       │   ├── snapshot.ts
│       │   ├── render-scheduler.ts
│       │   ├── disposable-store.ts
│       │   └── index.ts
│       └── pi/
│           ├── index.ts
│           ├── adapters.ts
│           ├── commands.ts
│           ├── lifecycle.ts
│           └── compatibility.ts
├── themes/
├── test/
│   ├── unit/
│   ├── integration/
│   ├── render/
│   ├── compatibility/
│   ├── e2e/
│   └── helpers/
├── docs/
└── dist/
```

The exact filenames may evolve, but dependency direction and ownership boundaries are contractual.

## Layer model

```text
shared → domain → features → app → pi
```

### `shared/`

Small reusable primitives with no product policy:

- ANSI-safe width and truncation wrappers;
- object merge and normalization helpers;
- collection utilities;
- path/name formatting;
- simple timer and disposal types when host-independent.

`shared/` may import Node built-ins and external utility packages, but not Pi extension types or higher layers.

### `domain/`

Pure product contracts and calculations:

- normalized configuration types;
- style and theme contracts;
- segment definitions and render results;
- responsive layout algorithms;
- status snapshots;
- preset resolution;
- capability descriptions that do not perform host detection.

Domain functions should be deterministic and testable without a TUI or filesystem.

### `features/`

One folder per user-visible surface. A feature may:

- convert a domain snapshot into Pi TUI components;
- expose an installer returning a disposable handle;
- own feature-local caches that do not belong to the shared runtime;
- depend on domain contracts and injected host providers.

Feature folders must not import one another directly. Shared state flows through app-level snapshots and provider callbacks.

### `app/`

The composition and runtime layer:

- loads and normalizes configuration;
- owns current session generation and runtime state;
- creates status/theme snapshots;
- starts background providers;
- coordinates render scheduling;
- composes feature installers;
- owns a disposable store;
- exposes package-level pure APIs if needed.

### `pi/`

The only layer that knows the concrete Pi extension lifecycle:

- exports the default extension factory;
- registers events, commands, and flags;
- adapts `ExtensionContext` into app providers;
- detects Pi capabilities and compatibility tier;
- installs/restores singleton UI surfaces;
- delegates all product logic to lower layers.

`pi/index.ts` must remain small. It is an adapter, not the implementation container.

## Dependency rules

- **ARCH-001:** Dependencies flow only from left to right in the layer diagram.
- **ARCH-002:** `shared/` never imports `domain/`, `features/`, `app/`, or `pi/`.
- **ARCH-003:** `domain/` never imports Pi packages or feature modules.
- **ARCH-004:** Feature modules never import sibling feature modules.
- **ARCH-005:** `app/` is the only layer that coordinates multiple features.
- **ARCH-006:** Direct Pi API access is restricted to `pi/`, except Pi TUI component types needed by a renderer implementation.
- **ARCH-007:** Compatibility patches live behind `pi/compatibility.ts` and feature-specific adapters, not in domain code.
- **ARCH-008:** Dependency-cruiser enforces the above rules in CI.

## Runtime composition

A session runtime contains explicit state rather than closure-spread mutable variables:

```ts
interface PiStyleRuntime {
  generation: number;
  config: NormalizedPiStyleConfig;
  capabilities: PiStyleCapabilities;
  snapshot: UiSnapshot;
  scheduler: RenderScheduler;
  disposables: DisposableStore;
  providers: RuntimeProviders;
  installations: FeatureInstallations;
}
```

The concrete type will evolve, but the concepts are required.

### Runtime providers

Providers isolate expensive or host-specific work:

- active model and thinking level;
- context usage;
- footer branch and extension statuses;
- Git status refresh;
- session usage aggregation;
- project/settings information;
- terminal/font capabilities.

Features receive provider results or immutable snapshots. They do not execute Git, parse settings, or scan sessions during render.

## Render data flow

```text
Pi events / provider refreshes
        ↓
mutable runtime state
        ↓
immutable UiSnapshot
        ↓
pure feature layout and formatting
        ↓
Pi TUI component render(width)
```

A `UiSnapshot` should contain only render-ready values or cheap derived primitives. It should be safe to read repeatedly from synchronous render methods.

## Render-path invariants

- **ARCH-009:** `render(width)` performs no filesystem access.
- **ARCH-010:** `render(width)` starts no process and performs no network access.
- **ARCH-011:** `render(width)` does not rescan the full session branch.
- **ARCH-012:** every emitted line has visible width less than or equal to `width`.
- **ARCH-013:** cache keys include all state that affects output, including width, theme generation, glyph mode, and relevant snapshot revision.
- **ARCH-014:** `invalidate()` clears themed/render caches and never performs expensive discovery.
- **ARCH-015:** streaming refreshes are bounded and coalesced.

## Background provider model

### Git

Git status uses a cwd/project keyed cache with:

- a bounded refresh interval;
- one in-flight refresh per key;
- stale-while-refresh behavior;
- explicit invalidation after `write`, `edit`, and branch-changing shell commands;
- process timeouts and error backoff;
- disposal on session shutdown.

### Session usage

Usage aggregation caches the last processed branch identity/length or a stable revision. It incrementally updates when possible and must not sum the entire branch on every frame.

### Theme discovery

The active Pi theme is the primary source. Optional discovery of additional pi-style theme metadata happens outside render and fails softly.

## Feature installation contract

Every feature installer returns a disposable object:

```ts
interface Disposable {
  dispose(): void | Promise<void>;
}
```

An installer must be:

- idempotent for the same runtime;
- safe to call after a failed previous attempt;
- reversible when it owns a singleton UI surface;
- explicit about whether it replaced or wrapped a previous owner;
- able to report a disabled fallback reason to diagnostics.

## Snapshot ownership and metadata deduplication

The app layer builds one `UiSnapshot` shared by status, editor, and startup features. Each preset also resolves a metadata ownership map, for example:

```text
model → status line
thinking → status line + editor border
path → status line
context → editor metadata row
branch → status line
extension status → secondary status row
```

This avoids each feature independently deriving the same values and prevents accidental duplicate UI.

## Scheduling

A shared render scheduler supports:

- immediate updates for thinking/model selection;
- coalesced updates for streaming usage;
- delayed refresh after Git-changing commands;
- typing deferral for noncritical status updates;
- cancellation and generation checks on shutdown.

The scheduler must not retain stale `ExtensionContext` objects across session replacement.

## Compatibility isolation

Public Pi APIs are used directly. Reflective/internal access is isolated behind capability adapters. Prototype or built-in renderer patches must:

1. be feature-scoped;
2. record the original identity;
3. avoid duplicate wrapping;
4. restore only if the installed wrapper is still active;
5. catch shape mismatches and disable the feature;
6. report their compatibility tier to `/pi-style doctor`.

See `COMPATIBILITY.md` and ADR 0004.

## Build and package architecture

The package follows the sibling `pi-rules` build model:

- strict TypeScript;
- ESM source;
- tsup build;
- an ESM Pi extension bundle under `dist/extensions/pi-style.js`;
- optional ESM/CJS public library entries only when reusable pure contracts are actually exported;
- Pi core packages marked as peer dependencies and externals;
- themes shipped as package resources.

The initial package need not expose a public library entry. Adding one is a Phase 6 decision based on real reuse.

## Error boundaries and degradation

A feature failure must not tear down unrelated surfaces:

| Failure | Required behavior |
| --- | --- |
| Invalid config | Normalize field to default and record a bounded warning. |
| Git command failure | Hide/stale Git segment; keep status line alive. |
| Editor conflict | Keep native/prior editor and continue other features. |
| Message patch mismatch | Disable message styling only. |
| Tool renderer conflict | Preserve existing/native renderer. |
| Theme-extra discovery failure | Use active Pi theme and built-in fallback. |
| Nerd glyph uncertainty | Use Unicode/ASCII set. |
| Stale session callback | Ignore through generation check. |

## Phase 4 startup implementation notes

Startup is an isolated feature under `features/startup`. It consumes a runtime-provided snapshot, uses public Pi header/overlay APIs, falls back to the namespaced `pi-style.startup` widget, and never performs discovery during render. The runtime owns generation, snapshot updates, dismissal events, and disposal; startup failure does not affect status or editor installations.

## Phase 2 implementation notes

The status-line subsystem uses app-owned immutable status snapshots, pure domain rendering, injected provider contracts, async cached Git refresh/invalidation, and namespaced public-widget component factories. The editor feature consumes the same immutable snapshots and is isolated from status-line implementation details. The accepted Phase 5 boundary adds isolated `features/messages` and `features/tools` compatibility adapters behind `pi/` version, shape, ownership, and session-flag gates; these adapters are renderer-only and do not mutate execution or registration semantics.

## Architecture acceptance criteria

Phase 0 proves the package boundary, thin adapter, strict dependency gate, and inert lifecycle harness. Runtime providers, snapshots, schedulers, feature installers, and render-path guarantees remain planned for later phases.

- Layer rules are encoded in dependency-cruiser.
- Unit tests can exercise domain layout/config/theme code without Pi.
- Integration tests can construct a fake Pi host and dispose every installation.
- Render tests prove width invariants.
- Repeated start/shutdown/reload does not increase listeners, timers, wrappers, or child processes.
- Compatibility features can be disabled independently.

## Roadmap coverage

- Introduced: Phase 0.
- Runtime/configuration/theme foundation: Phase 1A.
- Foundation implemented: Phase 1.
- Completed by: Phase 7.
- Requirement IDs: `ARCH-001` through `ARCH-015`.
- Blocking decisions: ADR 0001, 0002, and 0004.
