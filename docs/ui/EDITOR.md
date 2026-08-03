# Editor and input zone

> Status: **Implemented — Phase 3 complete**

## Purpose

The editor provides the strongest compact visual identity in pi-style while retaining Pi input semantics. It is a lightweight `CustomEditor` treatment — not a shell mode, history manager, fixed zone, or private autocomplete renderer.

## Ownership and installation

Installed through `ctx.ui.setEditorComponent()` in interactive TUI mode only. It extends Pi's `CustomEditor` so app keybindings, abort, exit, model cycling, text editing, paste, and IME behavior remain native. Before installation pi-style records any previous editor factory and follows the composition policy in `LIFECYCLE-AND-COMPOSITION.md` and `COMPATIBILITY.md`.

## Styles

Code-defined layouts selected by configuration; users may override colors/glyphs but cannot provide arbitrary renderer code.

### `compact` (default)

```text
  ❯ prompt text
────────────────────────────────────────────────────────
 model/context metadata only when owned by editor preset
```

1-cell horizontal padding, strong prompt glyph, one subtle divider, optional compact metadata row, no trailing blank row.

### `boxed`

```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ❯ prompt text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  model  ·  ctx 42%  ·  branch main
```

2-cell padding where width permits, strong top/bottom or host border, metadata and optional runtime row, collapses to compact at narrow widths.

### `dock`

```text
┌─ ❯ prompt text ──────────────────────────────────────┐
└─ think:high · ctx 42% ───────────────────────────────┘
```

Outlined frame, compact prompt gap, one owned status row, no attempt to become a fixed terminal zone.

### `native`

Native-looking Pi editor output with minimal decoration; both a user preference and the compatibility fallback.

## Frame modes

`auto` (choose by style/width/color capability/thinking level), `halfblock`, `line`, `solid`, `outline`, `native`. Unknown or unsupported modes fall back to the style default.

## Prompt and continuation alignment

Default prompt `❯`; Unicode/ASCII fallback `>`.

- prompt width is measured, never assumed to be one cell;
- multiline continuation indent aligns with text after the prompt and gap;
- cursor marker stays in the correct rendered position;
- wrapping accounts for panel padding, borders, prompt, and continuation prefix;
- editable input is wrapped, never truncated;
- very narrow width removes optional frame/padding before harming input usability.

## Input behavior

- Unhandled keys call `super.handleInput(data)`.
- No Bash mode, prompt stash, shell history, directory jumps, or custom navigation shortcuts.
- Paste and IME behavior inherited from Pi.
- Focus/cursor follows the TUI `Focusable` contract.
- Render decoration never modifies the editor's underlying text state.

## Autocomplete

The editor preserves the built-in slash/path autocomplete provider through normal `CustomEditor` construction; a prior editor's custom provider is preserved when a supported composition path exists. pi-style does not access private autocomplete list/state merely to restyle it — a future autocomplete treatment is a separate compatibility-gated requirement.

## Metadata rows

Available: model/provider, thinking level, context percentage/window, project/path, Git summary, extension statuses, and response speed or session usage when reliably provided. The preset resolves which values the editor owns; the default status-focused preset avoids duplicating model/path/Git text between editor and status line.

## Thinking and working state

Thinking level may communicate through border/frame color: off/minimal muted, low/medium progressively accented, high/xhigh/max strong semantic colors. Text stays in the status line by default; no rainbow animation interferes with input readability. Pi's working indicator remains the primary streaming signal; the editor may use a subtle active border but never continuously animates the frame or triggers expensive redraws.

## Width behavior

Degradation order: remove optional metadata → abbreviate labels/values → reduce horizontal padding → replace outline/box with a single divider → hide metadata row → native/minimal frame while preserving prompt and editable text. No style reserves more rows than it renders.

## Theming

Consumes semantic tokens from `THEMING.md`: prompt/input text, background/frame, metadata label/value, thinking-level border, active/working state. Pre-baked strings are rebuilt after theme invalidation.

## Existing editor conflict

| Situation | Behavior |
| --- | --- |
| No previous custom editor | Install pi-style. |
| Previous editor safely composable | Preserve supported provider behavior. |
| Not composable, `preferExistingEditor: true` | Keep prior editor; disable pi-style editor only. |
| User explicitly forces pi-style | Replace and report the decision. |
| Shutdown | Restore previous owner only if pi-style still owns the slot. |

Any constructor/render capability mismatch falls back to the previous/native editor before removing other pi-style features; the user is never left without a usable input component.

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

## Roadmap coverage

- Implemented in: Phase 3.
- Full persistence/conflict commands: Phase 6.
- Terminal/IME/manual proof: Phase 7; manual evidence pending.
- Requirement IDs: `EDIT-001` through `EDIT-011`.
