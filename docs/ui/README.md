# UI surface contracts

> Status: **All v1 UI surfaces implemented (Phases 2–5); Phase 7 verified**

## Surface map

```text
startup/header
conversation feed
  ├─ user messages
  ├─ assistant/thinking messages
  ├─ tool calls and results
  └─ special messages
above-editor widgets
  ├─ notifications
  └─ primary status row
editor/user zone
below-editor widgets
  └─ secondary status row
optional footer data bridge
```

Pi retains ownership of the feed, scrolling, selection, resize, and native terminal layout. pi-style installs components into these supported surfaces.

## Detailed contracts

- [STATUS-LINE.md](STATUS-LINE.md) — information segments and responsive layout.
- [EDITOR.md](EDITOR.md) — prompt/input presentation and metadata.
- [STARTUP.md](STARTUP.md) — startup header and optional overlay.
- [MESSAGES-AND-TOOLS.md](MESSAGES-AND-TOOLS.md) — conversation/tool presentation.
- [THEMING.md](THEMING.md) — shared semantic visual system.

## Shared visual principles

1. **Structure survives without color.** Borders, spacing, prefixes, and labels communicate hierarchy in `NO_COLOR` mode.
2. **One metadata owner by default.** Presets resolve whether model/path/context/Git/status text belongs to the status line or editor.
3. **Thinking can have dual representation.** Text may appear in the status line while editor border color communicates state without repeating text.
4. **No over-width lines.** Every component truncates or collapses to its render width.
5. **No orphan separators.** Hidden segments or empty blocks remove adjacent decoration.
6. **No render-time I/O.** Components consume snapshots.
7. **Native fallback is valid.** A surface may remain native when compatibility or extension ownership prevents styling.
8. **Semantic tokens only.** Features do not hardcode unrelated color palettes.

## Default metadata ownership

| Datum | Default owner | Secondary use |
| --- | --- | --- |
| Model | status line | startup summary |
| Thinking level | status line | editor frame color |
| Path/project | status line | startup summary |
| Git branch/status | status line | optional editor compact row only in a matching preset |
| Context usage | editor metadata or status line by preset | startup summary |
| Usage/cost | status secondary/trailing group | none |
| Extension statuses | secondary status row | optional editor footer when status line disabled |
| Streaming state | Pi working indicator | optional subtle editor frame state |

## Shared width behavior

The exact threshold is computed from content rather than fixed breakpoints, but documentation examples use:

- **wide:** ≥120 columns — full configured layout;
- **normal:** 80–119 — optional abbreviations and secondary overflow;
- **narrow:** 50–79 — essential segments, compact frames;
- **very narrow:** <50 — model/thinking/input usability before decoration.

Components must also behave correctly at widths below examples used in normal terminals.

## Shared acceptance criteria

- Theme changes invalidate every surface.
- Switching session/model/thinking updates all owning surfaces consistently.
- `NO_COLOR` and ASCII modes remain readable.
- disabling one surface does not leave blank reserved rows.
- shutdown restores Pi/prior extension ownership.
