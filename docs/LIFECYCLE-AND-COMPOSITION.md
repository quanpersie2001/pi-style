# Lifecycle and composition

> Status: **Phase 7 verified**

## Goals

Pi UI surfaces are long-lived, some are singleton replacements, and sessions can reload or switch inside one process. pi-style must install predictably, preserve existing owners where possible, and clean up every listener, timer, widget, patch, and terminal mutation.

## Session runtime ownership

One extension instance may observe multiple session lifecycles. Each active session installation receives a monotonically increasing generation number; async callbacks capture their generation and ignore results that no longer match the active runtime.

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

The factory must not create timers, watchers, child processes, sockets, or terminal mutations: some Pi invocations load extensions without starting a session.

## Event map

| Event | State/UI effect |
| --- | --- |
| `session_start` | Build and install a fresh runtime. |
| `session_shutdown` | Dispose runtime, restore owned surfaces, cancel work. |
| `model_select` / `thinking_level_select` | Update snapshot; request immediate render (thinking bypasses typing deferral). |
| `session_info_changed` | Refresh session/name segment if enabled. |
| `before_agent_start` / `agent_start` | Capture dismissal state; mark streaming; dismiss startup; increase refresh cadence. |
| `message_update` / `message_end` | Update bounded live usage and message renderer caches. |
| `turn_end` / `agent_settled` | Refresh usage/context; settle transient UI; final coalesced refresh. |
| `tool_execution_start/update/end`, `tool_result` | Update owned tool presentation; invalidate Git/status providers after writes or branch-changing commands. |
| `session_tree` / `session_compact` | Rebuild branch-derived snapshot caches. |
| resources/theme reload | Invalidate themed caches and reinstall only affected surfaces. |

## Disposable store

The runtime owns a `DisposableStore` covering event unsubscribes, timers and schedulers, provider cancellation, widget removals, header/working-indicator/editor/footer restoration, compatibility patch restorers, background restoration, and overlay dismissals. Disposal runs in reverse installation order so dependent surfaces are removed before providers are destroyed.

## Widget composition

Stable namespaced IDs:

```text
pi-style.notifications       aboveEditor
pi-style.status.primary      aboveEditor | belowEditor (default: below)
pi-style.status.secondary    belowEditor, only when it has visible content
pi-style.startup             aboveEditor fallback for header
```

Widget factories receive the current Pi theme. Components cache only output derived from the current theme generation and snapshot revision; `invalidate()` clears those caches.

## Editor composition

1. Read `ctx.ui.getEditorComponent()` when available and record any previous factory.
2. If `preferExistingEditor` is true and safe composition is impossible, keep the existing editor and disable pi-style editor styling.
3. If composition is supported, install pi-style's editor while preserving the previous autocomplete provider or documented base behavior.
4. Store the installed factory identity; on disposal restore the previous factory only if the current owner is still pi-style's.

Passing through autocomplete is not full editor composition — pi-style never claims to wrap arbitrary custom rendering/input state without a supported Pi API. Diagnostics distinguish: no previous editor / provider preserved / prior editor preferred / pi-style forced / unsupported conflict. The custom editor extends `CustomEditor`, delegates unhandled keys to `super.handleInput()`, and never takes ownership of shell/history/navigation workflows.

## Footer composition

While the status line is enabled, pi-style replaces the native footer with an empty owned component so footer/status output is not duplicated. The footer factory captures Pi's `ReadonlyFooterDataProvider` for branch/extension-status data and subscribes to branch changes. Restoration renders no decorative replacement and calls `setFooter(undefined)` only while pi-style still owns the footer. Because footer ownership is singleton, this bridge is a capability-dependent adapter, not a guaranteed installation.

## Header and startup composition

Compact startup uses the namespaced widget by default and may use `setHeader` only when a safe owner-observation adapter (`getHeaderFactory`) is injected; an unobservable header is never claimed. Overlay startup uses `ctx.ui.custom(..., { overlay: true })` with a dismiss handle, closed on input, agent start, session replacement, or configured timeout. Startup data is collected before mounting; render methods never scan files or resources.

## Compatibility patch lifecycle

Every patch uses a marker stored in a `WeakMap`, `Symbol`, or registry keyed by target identity:

```ts
interface PatchRecord {
  feature: string;
  target: object;
  original: unknown;
  installed: unknown;
  restore(): void;
}
```

Rules: never wrap the same target twice; restore only if `target.method === installed`; do not overwrite a later extension's replacement during cleanup; catch capability/shape errors and disable the feature; include patch state in doctor output. Phase 5 message/tool patches are session-only, exact-Pi-gated, renderer-only, and default-deny. A failed exact restoration retains the probe for retry before a new generation; a later owner is preserved.

## Render scheduling

| Class | Examples | Behavior |
| --- | --- | --- |
| Immediate | thinking/model selection, explicit command | Render now; bypass typing deferral. |
| Coalesced | streaming usage, extension statuses | One render per short window. |
| Deferred while typing | Git/context refresh | Keep current snapshot during recent input. |
| Delayed retry | branch-changing shell command | Invalidate immediately; refresh after bounded delays. |

No scheduler may keep the process alive after shutdown.

## Configuration reload

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

A full Pi `/reload` tears down the old extension runtime; code following `await ctx.reload()` must not use old session-bound state.

## Disable flow

1. prevent new feature work;
2. dismiss startup overlays;
3. remove widgets;
4. restore editor/footer/header/working indicator if still owned;
5. restore patches and optional background state;
6. stop providers/timers;
7. leave Pi usable with native or prior extension surfaces.

## Headless modes

`print` and `json` modes load config and register commands/events but start no terminal-specific resources. RPC mode follows Pi's documented UI protocol and skips unsupported custom TUI components.

## Failure handling

- A failed optional feature installation records a diagnostic and continues.
- A failed core runtime/config installation falls back to an inert extension rather than partially mutating the terminal.
- Stale-context errors are lifecycle cancellation, not user-facing errors.
- Debug logs go through a bounded logger, never raw interleaved stdout during TUI rendering.

## Lifecycle acceptance criteria

- **LIFE-005:** ten start/shutdown cycles leave no additional timers, listeners, widgets, or wrappers.
- **LIFE-006:** session switch callbacks from the old generation are ignored.
- **LIFE-007:** disabling restores a usable previous/native editor and footer.
- **LIFE-008:** model/thinking events visibly update without reload.
- **LIFE-009:** theme invalidation clears all pre-baked styled caches.
- **LIFE-010:** one surface failure does not disable unrelated public-API surfaces.

## Roadmap coverage

- Runtime, generation, disposal, snapshot, scheduler foundation: Phase 1A.
- Status/editor/startup integrations: Phases 2–4.
- Patch lifecycle: Phase 5.
- Reload, persistence, conflict reconciliation, bounded doctor: Phase 6.
- Leak and platform proof: Phase 7; manual evidence pending.
- Requirement IDs: `LIFE-001` through `LIFE-010`.
