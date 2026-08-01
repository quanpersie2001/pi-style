# Theming and visual system

> Status: **Planned**

## Goals

All pi-style surfaces consume one semantic visual system. Layout presets decide structure; themes decide colors and glyph values. This prevents the status line, editor, startup, messages, and tools from becoming separate skins.

## Resolution hierarchy

```text
explicit piStyle theme overrides
  → optional pi-style extras from active theme metadata
  → active Pi semantic theme tokens
  → built-in pi-style safe defaults
```

A missing optional source must never block startup.

## Semantic tokens

Planned pi-style tokens are grouped by meaning rather than component implementation.

### Core

- `surface`, `surfaceRaised`, `surfaceMuted`
- `text`, `muted`, `dim`
- `accent`, `accentStrong`
- `border`, `borderMuted`, `borderActive`
- `success`, `warning`, `error`

### Status data

- `model`, `thinking`, `path`
- `gitClean`, `gitDirty`
- `contextLow`, `contextMedium`, `contextHigh`, `contextCritical`
- `tokens`, `cache`, `cost`, `time`
- `separator`

### Editor

- `editorPrompt`, `editorText`, `editorBackground`
- `editorBorder`, `editorBorderActive`
- `editorMetadataLabel`, `editorMetadataValue`
- thinking-level colors map to Pi's `thinkingOff` through `thinkingMax` tokens when available.

### Messages and tools

- `userPrefix`, `assistantPrefix`, `thinkingText`
- `messageBorder`, `messageBackground`
- `toolTitle`, `toolOutput`, `toolPending`, `toolSuccess`, `toolError`
- diff colors defer to Pi's existing diff tokens.

Implementations may reduce the token list where Pi already exposes an exact semantic token. New tokens require docs, defaults, no-color behavior, and tests.

## Style presets versus themes

A **style preset** defines:

- surface enablement;
- spacing/padding;
- status segment groups;
- editor layout/frame;
- message/tool density;
- startup mode.

A **theme** defines:

- color values;
- glyphs;
- separators;
- background behavior.

Users can combine a style preset with any compatible Pi theme. pi-style may ship optional theme JSON resources, but it must not require switching away from a user's active theme.

## Active Pi theme integration

Components use the theme object provided by Pi callbacks. Do not import a global theme singleton. The resolver maps pi-style semantics onto Pi tokens such as:

- `accent`, `text`, `muted`, `dim`;
- `border`, `borderMuted`, `borderAccent`;
- `success`, `warning`, `error`;
- tool/message/markdown tokens;
- thinking-level tokens.

Theme invalidation must clear strings that contain pre-baked ANSI codes.

## Glyph sets

### Nerd set

May use powerline separators and private-use icons for Pi, model, folder, branch, context, cache, time, and agents.

### Unicode-safe set

Uses common Unicode such as `π`, `⎇`, `·`, `│`, `◫`, and text labels where symbol support is uncertain.

### ASCII set

Uses plain labels and separators such as `pi`, `git`, `ctx`, `|`, `>`, and `<`.

No essential meaning may exist only in a private-use glyph.

## Nerd Font detection

Detection is conservative:

1. `PI_STYLE_NERD_FONTS=1|0`;
2. explicit config `on|off`;
3. `GHOSTTY_RESOURCES_DIR` or equivalent strong signal;
4. case-insensitive known terminal heuristic;
5. Unicode/ASCII fallback.

The doctor command explains why a mode was selected. Auto-detection never claims certainty about the configured font.

## ANSI and width

- All width calculations use Pi TUI's `visibleWidth()` or an equivalent tested wrapper.
- Truncation uses ANSI-aware helpers.
- Multi-line styled output reapplies style per line.
- Each line is self-contained and ends safely.
- Background and foreground state cannot leak into adjacent Pi content.

## Background rendering

The default technique is to paint backgrounds only across cells owned by the component. Components must not assume the terminal default background matches a chosen theme.

When a box/background extends to the component width, padding must be included in width calculations and ANSI reset behavior.

## Terminal-global background synchronization

OSC 11 is optional. Policy:

- disabled by default on unverified platforms;
- enabled in `auto` only for validated terminals/paths;
- forced via config/env only by explicit user choice;
- never use OSC 10 to change foreground;
- record whether pi-style changed the terminal;
- restore on shutdown/reload;
- no OSC query or write from render methods.

## `NO_COLOR`

With `NO_COLOR`:

- foreground/background colors are removed;
- labels, prefixes, borders, and state text remain;
- selected/active state uses glyph/text differences;
- errors retain words or symbols such as `error`, `!`, or `x`;
- no contrast assumption is required.

## Contrast and accessibility

- Critical state cannot be indicated only by red/green.
- Context thresholds include a number/label, not color alone.
- Pending/success/error tools have distinct symbols/text.
- Dim text is not used for essential prompt/input content.
- Configurable glyph overrides support terminals with width/rendering issues.

## Theme resources

The package may ship:

```text
themes/pi-style-dark.json
themes/pi-style-light.json
```

These are optional complete Pi themes for users wanting the intended visual palette. The extension itself still works with any active theme through semantic mapping.

## Theme requirements

- **THEME-001:** all surfaces use the shared resolver.
- **THEME-002:** theme change invalidates pre-baked styled caches.
- **THEME-003:** essential meaning survives no-color and ASCII modes.
- **THEME-004:** auto font detection has an explicit override.
- **THEME-005:** every rendered line is ANSI-contained.
- **THEME-006:** OSC changes are optional, platform-gated, and restored.
- **THEME-007:** invalid user overrides fall back safely.
- **THEME-008:** style presets and color themes remain separate concepts.

## Roadmap coverage

- Resolver/glyph/ANSI foundation: Phase 1.
- Consumed by UI features: Phases 2–5.
- Full overrides/themes/accessibility/platform proof: Phases 6–7.
