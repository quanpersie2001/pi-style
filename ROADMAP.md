# pi-style roadmap

> Status: **In progress — Phase 0 and Phase 1A completed; product phases remain planned**

This roadmap defines the sequence for implementing the complete pi-style product. The phases are **sequencing boundaries, not an MVP scope reduction**. The intended v1 consists of every phase through Phase 7. Completing only the status line or editor is not completion of pi-style.

## Product direction

pi-style combines:

- native Pi layout and a responsive segment architecture inspired by `references/pi-powerline-footer/`;
- compact Droid-inspired styling across editor, startup, messages, and tools from `references/pi-droid-styling/`;
- a layered package/build/test structure modeled after `../pi-rules`.

The product contract lives in [`docs/PRODUCT.md`](docs/PRODUCT.md). Detailed behavior lives under [`docs/ui/`](docs/ui/README.md). Architecture decisions live under [`docs/decisions/`](docs/decisions/README.md).

## Guiding principles

- **Native Pi behavior first.** Pi owns feed scrolling, selection, resize, and terminal layout.
- **One visual system.** Status, editor, startup, messages, and tools share semantic themes and spacing.
- **No I/O in render.** Filesystem, Git, settings, and session aggregation use cached providers.
- **Compatibility is explicit.** Public APIs precede reflective composition; core patches are isolated and optional.
- **Incremental, not incomplete.** Each phase produces a usable slice, but the roadmap continues to the documented full product.
- **Proof accompanies features.** A phase is complete only when its automated/manual gates pass.

## Phase status summary

| Phase | Name | Status |
| --- | --- | --- |
| 0 | Contract and repository foundation | **Completed** |
| 1 | Runtime, configuration, and theme foundation | **Completed (Phase 1A)** |
| 2 | Complete status-line subsystem | Planned |
| 3 | Complete styled editor subsystem | Planned |
| 4 | Startup presentation | Planned |
| 5 | Messages and tool presentation | Planned |
| 6 | Full configurability and extension composition | Planned |
| 7 | Hardening, platform validation, and v1 release | Planned |

---

## Phase 0 — Contract and repository foundation

### Objective

Turn the reference-only workspace into a well-specified, buildable Pi package with enforceable architecture boundaries and a validation harness.

### Deliverables

#### Documentation

- Complete the product, architecture, reference adoption, configuration, lifecycle, compatibility, testing, and UI contracts under `docs/`.
- Record ADR 0001–0004.
- Define stable requirement identifiers and roadmap traceability.
- Add a root README summarizing installation intent and linking to docs once package identity is finalized.

#### Package scaffold

Create a structure modeled after `../pi-rules`:

```text
extension-src/pi-style/{shared,domain,features,app,pi}
themes/
test/{unit,render,integration,compatibility,performance,e2e,helpers}
dist/
```

Add:

- `package.json` with `pi-package` metadata;
- strict `tsconfig.json`;
- `tsup.config.ts`;
- `vitest.config.ts`;
- `biome.json`;
- dependency-cruiser configuration;
- `.gitignore`, `LICENSE`, `CHANGELOG.md`, and contribution/release basics;
- npm scripts for `typecheck`, `lint`, `depcruise`, `test`, `build`, and `check`.

#### Entrypoints

- Create a thin Pi extension entry at `extension-src/pi-style/pi/index.ts`.
- Build an ESM bundle at `dist/extensions/pi-style.js`.
- Declare optional theme resources through the Pi package manifest.
- Do not add a public library entry until Phase 6 identifies reusable contracts.

#### Test foundation

- Build a fake Pi host that records handlers, widgets, editor/footer/header ownership, themes, render requests, and cleanup.
- Add architecture tests or dependency-cruiser rules.
- Add one package load/start/shutdown smoke test.

### Dependencies

None.

### Exit criteria

- `npm run check` passes from a clean install.
- The extension loads in a fake host and performs no background work before `session_start`.
- Layer violations fail the architecture gate.
- Every planned v1 surface has acceptance criteria in docs.
- The package can be run with `pi -e ./dist/extensions/pi-style.js` without corrupting startup, even though features are not yet implemented.

### Primary docs

- [`docs/PRODUCT.md`](docs/PRODUCT.md)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/REFERENCE-ADOPTION.md`](docs/REFERENCE-ADOPTION.md)
- [`docs/TESTING.md`](docs/TESTING.md)
- ADR 0001–0004

---

## Phase 1 — Runtime, configuration, and theme foundation

> Phase 1A exit criteria passed: configuration, generation-safe runtime/disposal, scheduler, snapshots, semantic themes/glyphs, ANSI-safe helpers, capability diagnostics, headless preservation, lifecycle tests, package/build smoke, and required static diagnostics.

### Objective

Build the shared services required by every UI surface before implementing visible feature complexity.

### Deliverables

#### Configuration

- Define `PiStyleConfig`, normalized config, defaults, and schema version.
- Read global and trusted project `piStyle` settings.
- Implement precedence: defaults < global < project < env < session override.
- Normalize invalid types/enums/arrays without startup failure.
- Implement minimal `/pi-style`, `/pi-style on|off`, `/pi-style reload`, and `/pi-style doctor` foundation.

#### Runtime and lifecycle

- Create explicit runtime state and generation tokens.
- Implement `DisposableStore`.
- Implement shared render scheduler with immediate/coalesced/deferred update classes.
- Implement immutable `UiSnapshot` and revision tracking.
- Add headless mode guards.
- Implement idempotent session start/shutdown and config reload orchestration.

#### Theme and rendering foundation

- Implement semantic theme resolver over the active Pi theme.
- Implement glyph sets: Nerd, Unicode-safe, ASCII.
- Implement conservative auto-detection plus config/env override.
- Add ANSI-safe width/truncation/wrapping helpers.
- Implement `NO_COLOR` behavior.
- Define optional OSC 11 service interface, but do not enable unvalidated terminal-global mutation yet.

#### Provider foundation

- Define injected provider interfaces for model, thinking, context, footer data, Git, usage, extension statuses, and capabilities.
- Implement capability detection and doctor diagnostic records.

### Dependencies

Phase 0.

### Exit criteria

- Config precedence and invalid-input tests pass.
- Ten fake start/shutdown/reload cycles leave no timers/listeners/installations.
- Theme resolution works with dark, light, custom, missing-token, no-color, Nerd, Unicode, and ASCII cases.
- Render helpers prove width and ANSI containment.
- Headless modes start no TUI/terminal resources.
- Doctor output explains effective config and detected capabilities without secrets.

### Primary docs

- [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md)
- [`docs/LIFECYCLE-AND-COMPOSITION.md`](docs/LIFECYCLE-AND-COMPOSITION.md)
- [`docs/ui/THEMING.md`](docs/ui/THEMING.md)
- [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md)

---

## Phase 2 — Complete status-line subsystem

### Objective

Implement the full powerline-derived information surface using native Pi widgets, including live thinking level, responsive layout, smart defaults, providers, and extension-status integration.

### Deliverables

#### Segment domain

- Segment contracts, registry, priorities, normal/compact variants, and options.
- Built-in segments: Pi/model/thinking/path/Git/context/compaction/usage/cache/cost/time/host/session/extension statuses.
- Stable formatting for model, path, tokens, percentages, costs, time, and Git indicators.

#### Presets and layout

- `default`, `minimal`, `compact`, `full`, `ascii`, and `native` presets.
- Custom `left`, logical `right`, and `secondary` groups.
- Explicit-empty and deduplication semantics.
- Disabled segments and configured custom extension-status items.
- Separator styles with Nerd/Unicode/ASCII fallback.

#### Responsive renderer

- Primary and secondary row fitting by priority.
- Compact variants and controlled truncation.
- No orphan separators or blank rows.
- Width-safe behavior down to very narrow terminals.
- Render cache keyed by width/theme/config/snapshot revision.

#### Live state

- Immediate `thinking_level_select` updates.
- `model_select`, context, session name/tree/compaction, usage, and extension-status updates.
- Shared snapshot integration for later editor/startup use.

#### Providers

- Async cached Git provider with timeout, stale-while-refresh, deduplication, invalidation, and disposal.
- Incremental/cached usage aggregation.
- Context/compaction and subscription-aware cost behavior.
- Footer data bridge only when compatible and necessary.

#### Native UI installation

- Notifications widget.
- Primary widget configurable above/below editor.
- Secondary widget below editor.
- Stable namespaced widget IDs and complete removal.

### Dependencies

Phase 1 runtime, snapshots, theme, scheduler, providers, and capabilities.

### Exit criteria

- All `STAT-*` requirements are proven.
- Every preset passes render tests at 40/60/80/120/160 columns.
- Thinking changes are visible immediately.
- Git and session work never runs inside render.
- Missing footer/Git/usage data hides only affected segments.
- Another footer owner can be preserved with documented degradation.
- Streaming bursts produce bounded render requests.
- ASCII/no-color output remains understandable.

### Primary doc

- [`docs/ui/STATUS-LINE.md`](docs/ui/STATUS-LINE.md)

---

## Phase 3 — Complete styled editor subsystem

### Objective

Implement the primary Droid-inspired input experience while preserving Pi editing, keybindings, cursor/IME behavior, and existing extension ownership.

### Deliverables

#### Editor styles

- `compact` default style.
- `boxed` structured style.
- `dock` outlined style.
- `native` fallback style.
- Frame modes: auto, halfblock, line, solid, outline, native.

#### Input rendering

- Prompt glyph and fallback.
- Correct padding, wrapping, multiline continuation, and cursor marker alignment.
- Thinking-level border semantics.
- Subtle working/streaming state without excessive animation.
- Narrow-width degradation before input usability is affected.

#### Metadata

- Optional model/thinking/context/path/Git/extension-status rows using the shared snapshot.
- Preset-driven metadata ownership so the default does not duplicate the status line.
- Theme and no-color support.

#### Composition

- Capture previous editor factory.
- Preserve supported autocomplete/provider behavior where possible.
- Prefer existing editor by default when composition is impossible.
- Explicit force/preference diagnostics.
- Identity-safe restoration on disable/reload/shutdown.

#### Scope protection

Do not add Bash mode, prompt stash, shell history, directory-jump shortcuts, or private autocomplete-state styling.

### Dependencies

Phase 1 foundation and Phase 2 shared status snapshot/metadata contracts.

### Exit criteria

- All `EDIT-*` requirements are proven.
- Multiline prompt/cursor alignment passes render and manual IME checks.
- All styles remain usable at narrow widths and in ASCII/no-color mode.
- Existing editor conflict scenarios behave according to config.
- Disable/reload/session replacement restores a usable editor.
- No private autocomplete state is required.

### Primary doc

- [`docs/ui/EDITOR.md`](docs/ui/EDITOR.md)

---

## Phase 4 — Startup presentation

### Objective

Add a compact, branded, informative startup experience without blocking the editor or duplicating resource discovery work.

### Deliverables

#### Compact mode

- Header/resource summary using public Pi header API or safe widget fallback.
- Model/thinking/project/context and resource counts.
- Active preset and compatibility fallback summary where useful.

#### Overlay mode

- Optional responsive overlay with branded hierarchy and concise hints.
- Minimum width/height checks.
- Escape/input/agent/tool/timeout dismissal.

#### Lifecycle

- Show rules by session reason.
- Quiet and off modes.
- Snapshot resource data before mount; no render-time discovery.
- Generation-safe dismissal and shutdown cleanup.
- Headless fallback.

### Dependencies

Phase 1 runtime/theme/lifecycle; may consume Phase 2 snapshot values.

### Exit criteria

- All `START-*` requirements are proven.
- Startup appears only for configured reasons.
- Stale overlay callbacks cannot affect a new session.
- Resource errors degrade to known model/project information.
- Narrow/short/no-color/ASCII cases remain usable.
- Startup never delays prompt use for normal compact mode.

### Primary doc

- [`docs/ui/STARTUP.md`](docs/ui/STARTUP.md)

---

## Phase 5 — Messages and tool presentation

### Objective

Extend the Droid-inspired visual system into the conversation feed while respecting Pi version risk, native rich content, built-in tool semantics, and other extensions.

### Deliverables

#### Shared render primitives

- Role prefix, badge, compact box, state marker, metrics line.
- Shared width/theme/background safety.

#### Messages

- Optional user and assistant prefixes.
- Streaming, thinking-only, tool-only, and mixed assistant states.
- Compaction, skill, branch-summary, and custom message blocks.
- Expanded/collapsed behavior where host support exists.

#### Tools

- Compact state-aware headers for read/write/edit/find/list/grep/bash.
- Native syntax highlight/diff/truncation/expansion preservation.
- Partial, success, error, cancellation, empty, and truncated result states.
- Elapsed/result metrics when reliable.

#### Integration and patches

- Prefer public renderer hooks.
- Use renderer-only override before execution override.
- Add isolated Tier C patches only for documented missing hooks.
- Patch registry, capability/version gates, idempotence, identity-safe restore, and doctor reporting.
- Native/existing renderer fallback.

### Dependencies

Phase 1 theme/lifecycle/capabilities; Phase 0 ADR 0004; compatibility fake-host support.

### Exit criteria

- All `MSG-*` and `TOOL-*` requirements are proven.
- Streaming/partial/final transitions are correct.
- Built-in tool execution and result shapes remain unchanged.
- Unsupported host shapes disable only the affected surface.
- Repeated reload does not stack patches.
- Cleanup does not overwrite a later extension owner.
- Native fallback snapshots remain valid.

### Primary docs

- [`docs/ui/MESSAGES-AND-TOOLS.md`](docs/ui/MESSAGES-AND-TOOLS.md)
- [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md)
- [ADR 0004](docs/decisions/0004-compatibility-tiers-and-patch-policy.md)

---

## Phase 6 — Full configurability and extension composition

### Objective

Complete the user-facing control plane, persistence, migrations, cross-extension behavior, diagnostics, and reusable package contracts.

### Deliverables

#### Configuration completeness

- Persisted global/project settings with non-destructive writes.
- Full command surface and TUI settings selectors.
- Per-surface enable/disable.
- Preset, placement, editor style/frame, startup mode, message/tool style controls.
- Custom status layout/items and theme/glyph overrides.
- Config schema version and migrations.
- Environment emergency recovery overrides.

#### Runtime reconfiguration

- Diff-based reinstall of changed surfaces.
- Preserve unchanged providers where safe.
- Immediate theme/layout invalidation.
- Session-only versus persisted command behavior.

#### Composition

- Existing editor/footer/message/tool owner preference matrix.
- Explicit force options only where safe and documented.
- Extension-status custom item integration.
- Diagnostics for active/disabled/conflicted/failed surfaces.

#### Doctor and public contracts

- Complete `/pi-style doctor` output.
- Export pure types/preset/status/theme contracts as a library entry only if external reuse is demonstrated.
- Document compatibility and migration support policy.

### Dependencies

Phases 1–5.

### Exit criteria

- All `CFG-*`, remaining `LIFE-*`, and composition `COMPAT-*` requirements are proven.
- Global/project/env/session precedence works and reports value sources.
- Invalid configuration cannot break startup.
- Commands persist only to explicit scope.
- Runtime changes do not require full Pi restart where reload is sufficient.
- Conflicts produce actionable diagnostics and safe fallback.
- Config migration fixtures cover all released schema versions.

### Primary docs

- [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md)
- [`docs/LIFECYCLE-AND-COMPOSITION.md`](docs/LIFECYCLE-AND-COMPOSITION.md)
- [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md)

---

## Phase 7 — Hardening, platform validation, and v1 release

### Objective

Prove the complete product under performance, terminal, lifecycle, packaging, and release constraints.

### Deliverables

#### Performance and resource audit

- Render benchmarks for status/editor/messages/tools.
- Streaming render request/coalescing measurements.
- Git/session provider cache audits.
- Memory/listener/timer/process leak tests.
- Large session and long path/model/branch stress cases.

#### Terminal and accessibility matrix

- Ghostty, iTerm2, Kitty, WezTerm.
- Common Linux terminal.
- Windows Terminal native and WSL.
- tmux/SSH where practical.
- Nerd, normal Unicode, and ASCII fonts.
- truecolor, 256-color approximation, and `NO_COLOR`.
- widths 40/60/80/120/160 and short heights.
- optional OSC 11 validation and restoration policy.

#### Pi compatibility matrix

- Define tested Pi version range.
- Run public API and capability tests on supported versions/builds.
- Record Tier C surface support/fallback.
- Verify another-editor/footer/renderer coexistence cases.

#### Packaging and release

- Final package name/version/metadata and `pi-package` gallery assets.
- Correct peer dependencies and externals.
- `npm pack` contents audit.
- install/update/remove and `pi -e` smoke tests.
- README, CONTRIBUTING, LICENSE attribution, CHANGELOG, CI, and publish workflow.
- Screenshot/manual smoke protocol.

#### Documentation reconciliation

- Update all shipped features from `Planned` to `Implemented`.
- Remove or clearly label unsupported claims.
- Ensure every v1 requirement is implemented, superseded, or rejected through an accepted ADR.

### Dependencies

Phases 0–6.

### Exit criteria

- Full `npm run check` passes from a clean checkout.
- Required terminal and Pi compatibility evidence is recorded.
- No required surface relies on an undocumented fallback.
- Optional Tier C/Tier-global-terminal behaviors are clearly disclosed.
- Package install, reload, session switch, disable, shutdown, update, and removal are clean.
- All v1 requirement IDs have proof or an accepted disposition.
- No earlier phase remains a hidden “MVP shortcut.”

### Primary docs

- [`docs/TESTING.md`](docs/TESTING.md)
- [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md)
- [`docs/ui/THEMING.md`](docs/ui/THEMING.md)
- [`docs/PRODUCT.md`](docs/PRODUCT.md)

---

## Post-v1 research lane

These items are not silently included in v1. Each requires a new product contract, ADR, compatibility tier, and validation plan.

| Research item | Entry condition |
| --- | --- |
| Fixed user zone | A concrete UX problem cannot be solved with native Pi layout. |
| Terminal scroll-region compositor | Fixed-zone ADR accepted with terminal/resize/selection matrix. |
| Fixed-zone selection and clipboard | Only after compositor ownership exists. |
| Chat virtualization | Profiling demonstrates feed size/render bottleneck. |
| Physical buffer synchronization/self-heal | Reproducible terminal drift remains after native fixes. |
| Shell/Bash mode | Separate product approval; not a styling feature. |
| Prompt stash/history/navigation | Separate productivity package or explicit scope expansion. |
| AI working vibes | Separate optional extension, not core pi-style. |

## Phase-to-document traceability

| Phase | Product/architecture | Primary UI contract | Compatibility | Required proof |
| --- | --- | --- | --- | --- |
| 0 | Product, architecture, references, ADRs | All contracts drafted | Tier policy defined | Scaffold and architecture gates |
| 1 | Config, runtime, lifecycle | Theming | Capabilities/headless | Unit and lifecycle integration |
| 2 | Snapshot/providers | Status line | Widget/footer composition | Status/render/provider tests |
| 3 | Metadata ownership | Editor | Existing editor composition | Alignment/render/lifecycle tests |
| 4 | Startup scope | Startup | Header/overlay fallback | Reason/dismissal/stale-session tests |
| 5 | Feed presentation | Messages/tools | Tier C patches | Streaming/patch/fallback tests |
| 6 | User control/migrations | All configurable surfaces | Conflict/doctor matrix | Persistence/composition tests |
| 7 | Full product completion | All | Platform/version matrix | Full check, benchmarks, manual smoke |

## Rules for roadmap updates

- Moving a deliverable between phases is allowed when dependencies change, but does not remove it from v1.
- Removing a v1 deliverable requires updating `PRODUCT.md`, its UI contract, and an accepted ADR when architectural.
- A phase is not complete with failing required tests or unresolved cleanup/compatibility errors.
- New reference-derived ideas first update `REFERENCE-ADOPTION.md` and are assigned a phase or post-v1 lane.
- Release notes should identify which requirement IDs and roadmap deliverables changed.
