# Startup presentation

> Status: **Implemented — Phase 4 complete**

## Purpose

The startup surface introduces the pi-style visual identity and summarizes the active environment without delaying entry into the editor. It uses Pi's public header and overlay APIs, with a namespaced widget fallback when the header API is unavailable.

## Modes

### `compact` (default)

A small startup summary is rendered through a namespaced widget by default. The header path is used only when an injected safe `getHeaderFactory` ownership adapter is available and the observable header is unowned. Without a widget or safe observable header ownership, no startup surface is installed.

### `overlay`

An optional centered overlay rendered through `ctx.ui.custom(..., { overlay: true })`. It is visual presentation only and falls back to compact when the public overlay capability is unavailable or the overlay request fails. The overlay is responsive and hides below its minimum usable width/height.

### `off`

No startup header, overlay, widget, input listener, or startup-specific timer is installed.

## Information model

The implementation consumes model, thinking level, project/cwd, context percentage, active preset, and pre-captured resource summaries supplied by the runtime. Resource discovery remains outside render and is represented through the app resource snapshot boundary. Missing or malformed optional fields are omitted; zero values are not invented. Resource errors are shown as a bounded summary without exposing settings or secrets.

Startup render receives a snapshot and performs no filesystem, process, network, session, or resource discovery. Resource collection belongs outside the component render path.

## Session reason rules

Pi exposes `startup`, `reload`, `new`, `resume`, and `fork`. The feature records the reason in its snapshot and uses deterministic behavior: compact is eligible for all supported reasons, while the overlay is limited to the initial `startup` reason to avoid repeatedly interrupting replacement sessions.

## Dismissal and lifecycle

Overlay dismissal is idempotent and is triggered by terminal input, `input`, `agent_start`, tool execution start, explicit handle dismissal, or runtime disposal. The runtime generation guard prevents stale updates from mutating a replacement session. Header/widget cleanup uses namespaced ownership and restores only when the installed header factory is still the current owner. Timeout state is cancellable through the installation cleanup path.

## Width behavior

Every output line is measured with ANSI-aware width helpers and truncated safely. Width zero returns no output. The overlay uses public responsive `visible` checks for minimum width/height; compact output retains the identity line and drops optional content when narrow.

## Theme and glyphs

Startup resolves semantic colors from the active Pi theme supplied by the public factory callback. `invalidate()` requests a fresh render rather than retaining old ANSI strings. The shared resolver provides Unicode/ASCII/no-color behavior and uses no private-use glyph as the only source of meaning.

## Failure fallback

- Missing header API → compact startup widget (`pi-style.startup`) when widgets are available, otherwise no startup surface.
- Missing custom/overlay API or overlay failure → compact header/widget fallback.
- Headless `print`/`json`/RPC contexts → no terminal startup installation; status/editor behavior remains independent.
- Startup installation failure → only the startup surface is disabled.
- Without an observable header-owner adapter, startup never claims the header when a widget is available; the namespaced widget is used instead. With the adapter, a later header owner is preserved during cleanup.

## Requirements

- **START-001:** compact startup is the default mode — proven by default config and render/integration path.
- **START-002:** overlay is optional and nonblocking — proven by public overlay mounting and independent runtime installation.
- **START-003:** startup render performs no resource/filesystem discovery — proven by snapshot-only feature contract.
- **START-004:** dismissal is safe across session generations — proven by runtime generation/disposable guards.
- **START-005:** startup reason behavior is deterministic and nonintrusive — proven by reason-aware compact/overlay policy.
- **START-006:** narrow/no-color/ASCII modes remain readable — proven by width and semantic fallback render tests.
- **START-007:** headless modes mount no custom terminal UI — proven by existing headless lifecycle tests and TUI-only installer guard.
- **START-008:** startup never exposes secrets or full settings — proven by typed snapshot fields and bounded metadata rendering.

## Automated proof

`test/unit/startup.test.ts` covers mode behavior, missing data, no invented values, overlay structure, active theme rendering, ASCII/no-color-compatible output, and widths `0, 1, 20, 40, 60, 80, 120, 160`. Existing lifecycle tests cover headless installation, repeated startup/shutdown cleanup, and status/editor independence.

Real Pi smoke proof: `pi --mode json --no-session -e ./dist/extensions/pi-style.js` exits successfully without terminal UI installation. Full terminal matrix proof remains part of Phase 7.

## Roadmap coverage

- Implemented in: Phase 4 (complete for automated lifecycle proof; manual terminal proof remains pending).
- Full command/config control: Phase 6.
- Terminal/manual proof: Phase 7.
- Requirement IDs: `START-001` through `START-008`.
