# Lifecycle and composition

> Status: **Phase 5 compatibility lifecycle accepted; full persistence/composition remains Phase 6**

## Goals

Pi UI surfaces are long-lived, some are singleton replacements, and sessions can reload or switch inside one process. pi-style must install predictably, preserve existing owners where possible, and clean up every listener, timer, widget, patch, and terminal mutation.

## Session runtime ownership

One extension instance may observe multiple session lifecycles. Each active session installation receives a monotonically increasing generation number. Any asynchronous callback captures its generation and ignores results when it no longer matches the active runtime.

- **LIFE-001:** background resources start no earlier than `session_start`.
- **LIFE-002:** `session_shutdown` is idempotent.
- **LIFE-003:** late callbacks from an old session cannot mutate the new session.
- **LIFE-004:** no raw stale `ExtensionContext`, footer provider, editor, or TUI reference is reused after session replacement.

## Startup sequence

```text
extension factory
  └─ register events, commands, and flags only

session_start
  ├─ increment generation
  ├─ dispose any incomplete prior installation
  ├─ read + normalize effective settings
  ├─ detect Pi and terminal capabilities
  ├─ create runtime providers and caches
  ├─ create initial immutable UI snapshot
  ├─ install low-risk/public surfaces
  ├─ install compatible editor/footer bridges
  ├─ install opt-in compatibility surfaces
  ├─ mount startup presentation
  └─ request initial render
```

The factory must not create timers, watchers, child processes, sockets, or terminal mutations because some Pi invocations load extensions without starting a session.

## Event map

| Event | State/UI effect |
| --- | --- |
| `session_start` | Build and install a fresh runtime. |
| `session_shutdown` | Dispose runtime, restore owned surfaces, cancel work. |
| `model_select` | Update model snapshot and request immediate status/editor render. |
| `thinking_level_select` | Update live thinking state and render immediately without typing deferral. |
| `session_info_changed` | Refresh session/name segment if enabled. |
| `before_agent_start` | Capture prompt/startup dismissal state; update working UI. |
| `agent_start` | Mark streaming, dismiss startup presentation, increase refresh cadence. |
| `message_update` | Update bounded live usage/streaming snapshot. |
| `message_end` | Finalize message state and message renderer caches. |
| `turn_end` | Refresh usage/context and settle transient UI. |
| `agent_settled` | Mark idle and perform final coalesced refresh. |
| `tool_execution_start/update/end` | Update tool presentation state when owned. |
| `tool_result` | Invalidate Git/status providers after writes or branch-changing commands. |
| `session_tree` / `session_compact` | Rebuild branch-derived snapshot caches. |
| resources/theme reload | Invalidate themed caches and reinstall only affected surfaces. |

## Disposable store

The runtime owns a `DisposableStore` containing:

- event/listener unsubscribe callbacks;
- timers and render schedulers;
- background provider cancellation;
- widget removals;
- header/working-indicator restoration;
- editor restoration information;
- footer restoration information;
- compatibility patch restorers;
- OSC/background restoration;
- overlay dismiss callbacks.

Disposal runs in reverse installation order so dependent surfaces are removed before providers are destroyed.

## Widget composition

Use stable namespaced IDs:

```text
pi-style.notifications
pi-style.status.primary
pi-style.status.secondary
pi-style.startup
```

Primary placement follows configuration. Notifications remain above the editor unless the host cannot support it. The secondary row is below the editor by default.

Widget factories receive the current Pi theme. Components cache only output derived from the current theme generation and snapshot revision. `invalidate()` clears those caches.

## Editor composition

The editor is a singleton UI surface.

### Installation algorithm

1. Read `ctx.ui.getEditorComponent()` when available.
2. Record whether a previous custom editor factory exists.
3. If `preferExistingEditor` is true and safe composition is impossible, keep the existing editor and disable pi-style editor styling.
4. If composition is supported, create pi-style's editor while preserving the previous autocomplete provider or documented base behavior.
5. Store the installed factory identity.
6. On disposal, restore the previous factory only if the current owner is still the pi-style factory.

### Composition limits

Passing through autocomplete is not full editor composition. pi-style must not claim that it can wrap arbitrary custom rendering/input state unless Pi exposes a supported composition API. Diagnostics should distinguish:

- no previous custom editor;
- previous provider successfully preserved;
- previous editor intentionally preferred;
- pi-style forced by user configuration;
- unsupported conflict fallback.

### Input rules

The custom editor extends `CustomEditor`, calls `super.handleInput()` for unhandled keys, and does not take ownership of unrelated shell/history/navigation workflows.

## Footer composition

The status line uses widgets. A custom footer is installed only if data such as branch/status subscriptions is unavailable through another public path.

If a footer bridge is needed:

- render no decorative replacement content unless configured;
- preserve/reject an existing custom footer according to compatibility settings;
- subscribe to branch/status changes and request render;
- unsubscribe on disposal;
- restore only when the bridge still owns the footer.

Because Pi footer ownership is singleton, this bridge is a capability-dependent adapter, not a guaranteed installation.

## Header and startup composition

Compact startup should use `setHeader` where available. Overlay startup uses `ctx.ui.custom(..., { overlay: true })` and keeps a dismiss handle. It must be dismissed on input, agent start, session replacement, or configured timeout.

Startup data is collected before mounting. Render methods do not scan files or resources.

## Compatibility patch lifecycle

Every compatibility patch uses a marker stored in a `WeakMap`, `Symbol`, or registry keyed by target identity. Phase 5 message/tool patches are session-only, exact-Pi-gated, renderer-only, and explicitly default-deny. A failed exact restoration retains the probe for retry before a new generation; a later owner is preserved. A patch record contains:

```ts
interface PatchRecord {
  feature: string;
  target: object;
  original: unknown;
  installed: unknown;
  restore(): void;
}
```

Rules:

- never wrap the same target twice;
- restore only if `target.method === installed`;
- do not overwrite a later extension's replacement during cleanup;
- catch capability/shape errors and disable the feature;
- include patch state in doctor output.

## Render scheduling

The scheduler supports four update classes:

| Class | Examples | Behavior |
| --- | --- | --- |
| Immediate | thinking/model selection, explicit command | Render now; bypass typing defer. |
| Coalesced | streaming usage, extension statuses | One render per short window. |
| Deferred while typing | Git/context refresh | Keep existing snapshot while recent editor input is active. |
| Delayed retry | branch-changing shell command | Invalidate immediately and refresh after bounded delays. |

No scheduler may keep the process alive after shutdown.

## Configuration reload

A configuration reload follows:

```text
read + normalize next config
  → diff active config
  → update pure runtime state
  → dispose changed feature installations
  → install changed features
  → preserve unchanged providers where safe
  → invalidate theme/layout caches
  → request render
```

A full Pi `/reload` tears down the old extension runtime. Code following `await ctx.reload()` must not use old session-bound state.

## Disable flow

Disabling pi-style:

1. prevents new feature work;
2. dismisses startup overlays;
3. removes widgets;
4. restores editor/footer/header/working indicator if still owned;
5. restores patches;
6. restores optional terminal background state;
7. stops providers/timers;
8. leaves Pi usable with native or prior extension surfaces.

## Headless modes

In `print` and `json` modes, UI methods are not used. The extension may load config and register commands/events, but it starts no terminal-specific resources. RPC mode follows Pi's documented UI protocol and skips unsupported custom TUI components.

## Failure handling

- A failed optional feature installation records a diagnostic and continues.
- A failed core runtime/config installation falls back to an inert extension rather than partially mutating the terminal.
- Stale-context errors are treated as lifecycle cancellation, not logged as repeated user-facing errors.
- Debug logs are written through a bounded logger or file, never raw interleaved stdout during TUI rendering.

## Phase 4 implementation notes

Startup is mounted after the runtime snapshot is created. Compact mode uses the public header API and a namespaced widget fallback; overlay mode uses public `ctx.ui.custom` with responsive visibility and an explicit dismiss handle. Input, agent, tool, replacement, and shutdown paths are generation-safe and idempotent. Cleanup restores only pi-style-owned header/widget surfaces and leaves status/editor installations independent.

## Phase 2 implementation notes

The status-line feature installs `pi-style.status.primary` and `pi-style.status.secondary` through public component widgets, respects primary placement, leaves footer ownership untouched, performs identity-safe cleanup, and skips terminal widgets in print/json modes. The editor feature installs only in interactive TUI mode through the public editor factory, preserves a prior editor by default when composition is unsupported, and restores conditionally by factory identity. Model, thinking, context, and Git invalidation events are adapted in `pi/` and routed through the runtime snapshot flow.

## Lifecycle acceptance criteria

- **LIFE-005:** ten start/shutdown cycles leave no additional timers, listeners, widgets, or wrappers.
- **LIFE-006:** session switch callbacks from the old generation are ignored.
- **LIFE-007:** disabling restores a usable previous/native editor and footer.
- **LIFE-008:** model/thinking events visibly update without reload.
- **LIFE-009:** theme invalidation clears all pre-baked styled caches.
- **LIFE-010:** one surface failure does not disable unrelated public-API surfaces.

## Roadmap coverage

- Runtime, generation, disposal, snapshot, and scheduler foundation: Phase 1A (implemented).
- Status/editor/startup integrations: Phases 2–4.
- Status/editor/startup integrations: Phases 2–4.
- Patch lifecycle: Phase 5.
- Full reload/persistence/conflict behavior: Phase 6.
- Leak and platform proof: Phase 7.
