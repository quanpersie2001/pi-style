# Product contract

> Status: **Planned**

## Product statement

pi-style is a cohesive UI package for the Pi coding agent. It preserves Pi's native ownership of the conversation feed, scrolling, selection, editor placement, and terminal lifecycle while adding a compact, responsive visual system across the startup view, status line, editor, messages, and tool presentation.

Its information architecture is inspired by `pi-powerline-footer`; its visual density, framing, prompts, badges, and message hierarchy are inspired by `pi-droid-styling`. pi-style reimplements the selected ideas as a smaller layered package rather than embedding either project as a dependency.

## Product goals

- **PROD-001 — Native layout first.** Pi remains responsible for feed scrolling, selection, resize behavior, and editor positioning.
- **PROD-002 — Cohesive visual identity.** All supported UI surfaces use one semantic theme and spacing system.
- **PROD-003 — Information without noise.** Model, thinking level, path, Git, context, usage, and extension status are shown according to priority and available width.
- **PROD-004 — Live state.** Model, thinking level, context, Git, streaming, and tool state update without requiring a session restart.
- **PROD-005 — Responsive behavior.** Narrow terminals degrade by collapsing, moving, abbreviating, or hiding optional information; they must not emit over-width lines.
- **PROD-006 — Safe defaults.** Font, glyph, color, placement, and compatibility choices work without mandatory user configuration.
- **PROD-007 — User control.** Users can select presets, placement, editor style, individual surfaces, glyph mode, and compatibility policy.
- **PROD-008 — Extension coexistence.** pi-style preserves prior editor/autocomplete behavior when possible and disables only conflicting surfaces when composition is impossible.
- **PROD-009 — Maintainability.** Rendering is bounded and testable; compatibility-sensitive patches are isolated, reversible, and version/capability gated.
- **PROD-010 — Full product by phases.** Incremental delivery is a sequencing strategy. The intended v1 includes all roadmap phases through hardening and release.

## Intended v1 feature set

### Status line

- Native Pi widgets above or below the editor.
- Segment registry and named presets.
- Model and live thinking-level indicators.
- Current path and Git status.
- Context usage and auto-compaction marker.
- Token/cache/cost/time statistics where reliable.
- Extension statuses and configured custom items.
- Responsive primary/secondary rows.
- Unicode/ASCII fallback and optional Nerd Font glyphs.

### Editor and input zone

- A Droid-inspired `CustomEditor` implementation that preserves Pi keybindings.
- Multiple code-defined styles: compact, boxed, dock, and native fallback.
- Prompt glyph, multiline continuation alignment, frame selection, and themed thinking borders.
- Optional metadata rows using the same status snapshot as the status line.
- Previous editor/autocomplete composition when supported.

### Startup presentation

- Compact branded header and resource summary by default.
- Optional startup overlay for users who want a richer presentation.
- Quiet/off modes.
- Width-safe rendering and prompt/agent-start dismissal.

### Conversation and tools

- Optional user and assistant prefixes.
- Styled thinking and tool-only assistant states.
- Consistent boxes for compaction, branch summaries, skills, and custom messages.
- Compact badges and state-aware presentation for built-in tools.
- Expanded/collapsed output and elapsed-time metadata.
- Native renderer fallback when a Pi version or another extension owns the surface.

### Theme and accessibility

- Semantic theme resolver shared by every feature.
- Integration with the active Pi theme.
- Controlled pi-style overrides for colors and glyphs.
- Truecolor/256-color-safe output through Pi's theme API.
- Nerd Font auto-detection with explicit override.
- `NO_COLOR` and ASCII-safe modes.
- Optional terminal-background synchronization under a strict platform policy.

### Operations

- Global and project-local configuration.
- Commands for inspection, toggling, presets, placement, editor style, reload, and diagnostics.
- Reload-safe lifecycle and complete cleanup.
- Compatibility doctor output.
- Automated unit, integration, render, performance, and release tests.

## User experience principles

### Native behavior before decoration

A styled screen that breaks selection, scrolling, autocomplete, or keybindings is a product failure. Visual enhancement must yield to a stable Pi experience.

### Compact, not cryptic

Short labels such as `think:high`, `ctx:42%`, or `+2 *1 ?3` are acceptable when their meaning is stable. Ambiguous glyph-only output is not.

### Hierarchy before color

Spacing, grouping, framing, and placement must communicate structure even in no-color mode. Color reinforces meaning but cannot be the only signal.

### No accidental duplication

The same metadata should not appear in both the editor and status line unless the selected preset explicitly opts into duplication. The default layout should choose one primary owner for each datum.

### Graceful degradation

Missing Git data, unsupported terminal features, absent Nerd Fonts, unknown Pi component shapes, or extension conflicts should disable or simplify one surface—not crash Pi or corrupt the terminal.

### Predictable configuration

Defaults, global settings, project settings, environment overrides, and session commands use one documented precedence ladder. Invalid values normalize safely.

## Supported UI surfaces

| Surface | Default v1 ownership | Compatibility level |
| --- | --- | --- |
| Header/startup | Pi public header/overlay APIs | Public API |
| Primary status row | Named Pi widget | Public API |
| Secondary status row | Named Pi widget | Public API |
| Footer data | Native footer or minimal data bridge only when necessary | Public API with composition constraints |
| Editor | `CustomEditor` installed through Pi UI API | Public API; singleton conflict possible |
| Working indicator | `setWorkingIndicator()` | Public API |
| User/assistant messages | Optional renderer patch/adapter | Compatibility-gated |
| Special messages | Optional component patch/adapter | Compatibility-gated |
| Built-in tools | Renderer registration or isolated patch | Compatibility-gated |
| Terminal background | Explicit cell painting; optional OSC 11 | Platform-gated |

## Scope boundaries

### Pi owns

- conversation storage and branching;
- feed scrolling and terminal resize;
- selection and clipboard behavior in the native layout;
- model/provider execution;
- core editor semantics and app keybindings;
- the canonical active theme and settings system;
- built-in tool execution.

### pi-style owns

- visual presets and semantic style resolution;
- UI-specific snapshots and caches;
- segment selection, ordering, and responsive layout;
- the optional custom editor render treatment;
- UI installation, render scheduling, cleanup, and diagnostics;
- compatibility fallback for surfaces it modifies.

### Other extensions own

- their tool semantics and session state;
- their status text exposed through Pi's extension-status APIs;
- their own editors/footers/renderers when explicitly preferred by the user;
- productivity workflows unrelated to styling.

## Explicit non-goals for v1

The following reference features are not part of the intended v1 product:

- a persistent shell/Bash mode;
- prompt stash and shell history management;
- `/cd` or directory-jump ownership;
- AI-generated working messages or “vibes”;
- a fixed terminal scroll-region compositor;
- custom selection/copy behavior inside a fixed zone;
- chat virtualization;
- physical terminal-buffer self-healing;
- reimplementation of Pi's session browser or multiplexer behavior.

Some terminal-compositor ideas may be researched after v1, but only through a new decision record and explicit product approval.

## User workflows

### Install and activate

The package is installable through Pi's package mechanism and declares its extension and theme resources in `package.json`. With defaults, it should activate without a separate setup wizard.

### Choose a visual preset

A user can select a named preset through settings or `/pi-style preset <name>`. The preset controls coordinated status, editor, startup, message, and tool defaults while still allowing narrow overrides.

### Customize one surface

A user can keep the default preset but disable the startup overlay, select the native editor fallback, move the status line, or disable compatibility-sensitive message/tool styling.

### Troubleshoot compatibility

`/pi-style doctor` reports Pi version/capabilities, active surfaces, disabled fallbacks, terminal/glyph assumptions, and conflicts detected during installation.

## v1 completion definition

The product is ready for v1 only when:

1. all roadmap phases through Phase 7 satisfy their exit criteria;
2. all accepted requirement IDs are implemented or explicitly superseded/rejected by an ADR;
3. public API surfaces work without compatibility patches;
4. compatibility-sensitive surfaces degrade independently and have disposal tests;
5. width, no-color, ASCII, and terminal matrix checks are recorded;
6. package installation, reload, disable, session switching, and shutdown are proven;
7. documentation describes actual behavior rather than planned behavior.

## Roadmap coverage

- Introduced: Phase 0.
- Completed by: Phase 7.
- Requirement IDs: `PROD-001` through `PROD-010`.
- Blocking decisions: ADR 0001–0004.
- Required proof: the full validation ladder in `TESTING.md`.
