# Editor and input zone

> Status: **Planned**

## Purpose

The editor provides the strongest Droid-inspired visual identity in pi-style while retaining Pi input semantics. It is a lightweight `CustomEditor` treatment, not a copy of the reference editor's shell mode, history, fixed-zone, or private autocomplete renderer.

## Ownership and installation

The editor is installed through `ctx.ui.setEditorComponent()`. It extends Pi's `CustomEditor` so app keybindings, abort, exit, model cycling, text editing, paste handling, and other native behavior remain intact.

Before installation, pi-style records any previous editor factory and follows the composition policy in `LIFECYCLE-AND-COMPOSITION.md` and `COMPATIBILITY.md`.

## Styles

Styles are code-defined layouts selected by configuration. Users may override colors/glyphs but cannot provide arbitrary renderer code.

### `compact` (default)

Droid/Gemini-inspired minimal framing:

```text
  ❯ prompt text
────────────────────────────────────────────────────────
 model/context metadata only when owned by editor preset
```

Characteristics:

- 1 cell horizontal padding;
- strong prompt glyph;
- one subtle divider/frame;
- optional compact metadata row;
- no trailing blank row.

### `boxed`

More structured Droid-inspired panel:

```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ❯ prompt text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  model  ·  ctx 42%  ·  branch main
```

Characteristics:

- 2 cell horizontal padding where width permits;
- strong top/bottom or host border;
- metadata and optional runtime row;
- collapses to compact at narrow widths.

### `dock`

CLI dock style:

```text
┌─ ❯ prompt text ──────────────────────────────────────┐
└─ think:high · ctx 42% ───────────────────────────────┘
```

Characteristics:

- outlined frame;
- compact prompt gap;
- one owned status row;
- no attempt to become a fixed terminal zone.

### `native`

Uses native-looking Pi editor output with minimal prompt/frame decoration. This is both a user preference and compatibility fallback.

## Frame modes

- `auto` — choose an appropriate frame by style, width, color capability, and thinking level;
- `halfblock` — compact half-block border when terminal support is verified;
- `line` — single-line divider;
- `solid` — strong line/full-cell treatment;
- `outline` — box-drawing frame;
- `native` — rely on native editor structure.

Unknown or unsupported frame modes fall back to the style default.

## Prompt and continuation alignment

Default prompt is `❯`; Unicode/ASCII fallback may use `>`.

Rules:

- prompt width is measured, never assumed to be one cell;
- multiline continuation indent aligns with text after the prompt and gap;
- cursor marker remains in the correct rendered position;
- wrapping accounts for panel padding, borders, prompt, and continuation prefix;
- truncation is not used for editable input content; wrapping is used instead;
- very narrow width removes optional frame/padding before harming input usability.

## Input behavior

- Unhandled keys call `super.handleInput(data)`.
- pi-style does not add Bash mode, prompt stash, shell history, directory jumps, or custom navigation shortcuts.
- Paste and IME behavior remain inherited from Pi's editor.
- Focus/cursor marker behavior follows the TUI `Focusable` contract.
- A render decoration must never modify the editor's underlying text state.

## Autocomplete

The editor should preserve the built-in slash/path autocomplete provider through normal `CustomEditor` construction. If another editor provided a custom autocomplete provider and a supported composition path exists, preserve it.

pi-style does not access private autocomplete list/state merely to restyle it in the initial implementation. A future autocomplete visual treatment would be a separate compatibility-gated requirement.

## Metadata rows

Available metadata:

- model/provider;
- thinking level;
- context percentage/window;
- current project/path;
- Git branch/summary;
- extension statuses;
- response speed or session usage only if reliably provided.

The preset resolves which values the editor owns. The default status-focused preset avoids duplicating model/path/Git text in the editor. Context can be owned by the editor in compact layouts where it helps relate frame state to available space.

## Thinking state

The editor may communicate thinking level through border/frame color:

- off/minimal: muted/subtle;
- low/medium: progressively accented;
- high/xhigh/max: strong semantic thinking colors.

Text remains in the status line by default. The editor does not use a rainbow animation that interferes with input readability.

## Working/streaming state

Pi's working indicator remains the primary streaming signal. The editor may use a subtle active border state, but it must not continuously animate the whole frame or trigger expensive redraws.

## Width behavior

Degradation order:

1. remove optional metadata items;
2. abbreviate metadata labels/values;
3. reduce horizontal padding;
4. replace outline/box with a single divider;
5. hide metadata row;
6. use native/minimal frame while preserving prompt and editable text.

No style is allowed to reserve more rows than it renders.

## Theming

The editor consumes semantic tokens from `THEMING.md`:

- prompt and input text;
- background/frame;
- metadata label/value;
- thinking-level border;
- active/working state.

Pre-baked strings are rebuilt after theme invalidation.

## Existing editor conflict

Default conflict behavior:

- if there is no previous custom editor, install pi-style;
- if a previous editor can be safely composed, preserve supported provider behavior;
- if not composable and `preferExistingEditor` is true, keep it and disable pi-style editor only;
- if the user explicitly forces pi-style, replace it and report the decision;
- on shutdown, restore the previous owner only if pi-style still owns the slot.

## Failure fallback

Any constructor/render capability mismatch falls back to the previous/native editor before removing other pi-style features. The editor feature must never leave the user without a usable input component.

## Requirements

- **EDIT-001:** extend `CustomEditor` and preserve native app keybindings.
- **EDIT-002:** support compact, boxed, dock, and native styles.
- **EDIT-003:** multiline prompt, wrapping, continuation, and cursor alignment are width-correct.
- **EDIT-004:** thinking level updates editor frame semantics live.
- **EDIT-005:** metadata follows preset ownership and avoids accidental duplication.
- **EDIT-006:** existing editor ownership follows documented composition settings.
- **EDIT-007:** disabling/shutdown restores a usable prior/native editor.
- **EDIT-008:** narrow widths remove decoration before harming input usability.
- **EDIT-009:** no unrelated shell/history/navigation workflow is introduced.
- **EDIT-010:** theme invalidation rebuilds themed content.
- **EDIT-011:** no private autocomplete state dependency is required for v1.

## Planned tests

- single/multiline text and cursor at start/middle/end;
- wide, normal, narrow, and extremely narrow width;
- Unicode/ASCII prompt widths;
- all styles and frame modes;
- all thinking levels and live change event;
- metadata ownership combinations;
- no previous editor, composable provider, preferred prior editor, forced replacement;
- theme invalidation and no-color mode;
- session shutdown/reload restoration;
- long input wrapping without over-width output.

## Roadmap coverage

- Implemented in: Phase 3.
- Full persistence/conflict commands: Phase 6.
- Terminal/IME/manual proof: Phase 7.
- Requirement IDs: `EDIT-001` through `EDIT-011`.
