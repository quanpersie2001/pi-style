# Configuration

> Status: **Phase 7 verified**

## Goals

Configuration must support a simple zero-config default and a complete product without creating an arbitrary rendering language. Users select known presets and override documented values; they never inject executable code.

## Storage and precedence

The namespace is `piStyle` inside Pi settings files:

```text
built-in defaults
  < global  $PI_CODING_AGENT_DIR/settings.json
  < project <cwd>/.pi/settings.json        (trusted projects only)
  < supported environment overrides
  < current-session command overrides      (session-only unless persisted)
```

Global/project paths use Pi's exported `getAgentDir()` and `CONFIG_DIR_NAME`. Project configuration is read/written only for trusted projects; malformed or future-schema documents are preserved without rewrite.

## Schema

```json
{
  "piStyle": {
    "enabled": true,
    "preset": "default",
    "placement": "below",
    "startup": { "mode": "compact", "showResources": false, "alwaysExpanded": false },
    "statusLine": {
      "enabled": true,
      "separator": "powerline-thin",
      "layout": { "left": ["model", "thinking", "path", "git"], "right": ["context_pct", "cost"], "secondary": ["extension_statuses"] },
      "disabledSegments": [],
      "customItems": []
    },
    "editor": { "enabled": true, "style": "compact", "frame": "auto", "showMetadata": true },
    "messages": { "enabled": true, "assistantPrefix": true, "specialBlocks": true },
    "tools": { "enabled": true, "style": "compact-box", "maxCollapsedLines": 10, "maxExpandedLines": 50, "dimOutput": false, "showElapsed": true },
    "theme": { "nerdFonts": "auto", "terminalBackgroundSync": "auto", "colors": {}, "glyphs": {} },
    "compatibility": { "allowSafePatches": true, "allowCorePatches": false, "preferExistingEditor": true, "preferExistingFooter": true },
    "debug": false
  }
}
```

## Top-level fields

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Master switch; disabling cleans up and restores owned surfaces. |
| `preset` | string | `default` | Coordinated UI preset. |
| `placement` | `above \| below` | `below` | Primary status-line placement (input stays pinned to the bottom; status row renders beneath it). |
| `startup` | object | compact defaults | Startup/header behavior. |
| `statusLine` | object | enabled defaults | Segment layout and options. |
| `editor` | object | compact defaults | Editor style and frame. |
| `messages` | object | enabled when compatible | Message styling. |
| `tools` | object | enabled when compatible | Tool styling. |
| `theme` | object | auto defaults | Glyph/color/background behavior. |
| `compatibility` | object | conservative | Conflict and patch policy. |
| `debug` | boolean | `false` | Bounded diagnostics; never raw terminal spam. |

## Startup options

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `startup.mode` | `off \| compact \| overlay` | `compact` | `compact` renders the gradient Pi logo header through the header/widget surface; `overlay` adds the centered overlay with System & Context / Available Tools panels; `off` installs nothing. |
| `startup.showResources` | boolean | `false` | Show the `◆ Resources` chip summary (and panels when expanded). |
| `startup.alwaysExpanded` | boolean | `false` | Render the System & Context / Available Tools panels in `compact` mode without the overlay. |

## Presets

A preset establishes defaults; explicit nested settings override it.

| Preset | Behavior |
| --- | --- |
| `default` | Balanced status line, compact editor, compact startup, restrained message/tool styling. |
| `minimal` | Path/Git/context essentials, native-like editor, no startup overlay, low decoration. |
| `compact` | High information density for medium terminals. |
| `full` | Broad status data and all compatible visual surfaces. |
| `ascii` | No Nerd Font assumptions and conservative separators. |
| `native` | Active Pi theme plus only low-risk status enhancements. |

## Status-line layout semantics

```json
{
  "statusLine": {
    "layout": { "left": ["model", "thinking", "path"], "right": ["context_pct"], "secondary": ["git", "extension_statuses"] }
  }
}
```

Rules:

- an omitted group inherits the preset group; an explicitly empty group clears it;
- a segment explicitly placed in one group is removed from inherited groups;
- unknown segment identifiers are ignored and reported once;
- `disabledSegments` wins over layout placement;
- duplicate segment identifiers render once;
- `statusLine.bottomMargin` reserves blank rows below the primary status row (default `1`, `0` disables);
- `statusLine.contextBarWidth` sets the context progress-bar cell count (default `10`, range 4–40).

"Right" is a right-aligned trailing group; the model row renders flush to the right edge with a minimum two-space gap.

## Custom status items

```json
{
  "statusLine": {
    "customItems": [{ "id": "tasks", "statusKey": "pi-tasks", "label": "tasks", "priority": 40, "placement": "secondary", "color": "accent" }]
  }
}
```

Values only select an existing extension status and presentation options; they cannot execute commands or import code.

## Messages and tool presentation options

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `messages.assistantPrefix` | boolean | `true` | Prepend the `│` prefix to assistant messages. Requires `--pi-style-message-assistant` plus `--pi-style-core-patches`. |
| `messages.specialBlocks` | boolean | `true` | Boxed presentation for compaction, skill, branch, and custom (MCP) message blocks. Requires `--pi-style-message-special-blocks` plus `--pi-style-core-patches`. |
| `messages.hideThinkingLabel` | boolean | `true` | Hide Pi's `Thinking...` placeholder label for hidden thinking blocks (the empty label renders zero lines). Set `false` to restore the default label. |
| `tools.style` | `marker \| compact-box` | `compact-box` | `marker` prefixes tool lines (`[tool]`, `[tool:result]`); `compact-box` renders boxed call headers and compact/expanded result boxes for read, write, edit, bash, ls, find, grep, quick-edit, substitute-edit, target-edit, and a boxed generic fallback. |
| `tools.maxCollapsedLines` | number | `10` | Line budget for collapsed tool results (head/tail). |
| `tools.maxExpandedLines` | number | `50` | Maximum body lines for expanded results (read/bash/grep/fallback). |
| `tools.dimOutput` | boolean | `false` | Render tool output lines in the dim semantic color instead of `toolOutput`. |
| `tools.showElapsed` | boolean | `true` | Include wall-clock elapsed time in tool result footers. |

The boxed tool and special-block adapters are fingerprint-certified against Pi `0.83.0` and install through the same reversible, generation-tracked compatibility wrapper as message prefixes and tool markers; shutdown restores the native identities exactly.

## Theme configuration

**Font mode** — `theme.nerdFonts`: `auto` (conservative detection), `on`, `off`. Env override: `PI_STYLE_NERD_FONTS=1|0`.

**Background sync** — `terminalBackgroundSync`: `auto`, `on`, `off`. `auto` follows the platform policy in `ui/THEMING.md` and `COMPATIBILITY.md`; terminal-global synchronization remains unsupported/off for technical v1.

**Color/glyph overrides** — maps of known semantic keys. Unknown keys are ignored with a diagnostic; empty strings hide icons.

## Normalization rules

- **CFG-001:** Missing values use defaults.
- **CFG-002:** Nested objects merge recursively; arrays replace per their documented semantics.
- **CFG-003:** Invalid enum values fall back to defaults and record one warning.
- **CFG-004:** Wrong-type objects are ignored rather than causing startup failure.
- **CFG-005:** Unknown fields are preserved only if migration needs them; otherwise ignored.
- **CFG-006:** Configuration parsing has no side effects.
- **CFG-007:** Project configuration is ignored for untrusted projects.
- **CFG-008:** Environment variables are narrow, documented, and never replace the full schema.

## Session flags (Tier C authorization)

Registered public boolean flags for the current session; immutable, session-only, never persisted:

| Flag | Effect |
| --- | --- |
| `--pi-style-core-patches` | Permits Tier C consideration. |
| `--pi-style-message-assistant` | Authorizes the certified assistant-message prefix. |
| `--pi-style-message-special-blocks` | Authorizes boxed special message blocks. |
| `--pi-style-tools` | Authorizes certified tool call/result selectors. |
| `--pi-style-ascii` | Selects ASCII Tier C markers only. |

Tier C is default-deny: core alone, surface-only flags, and ordinary product defaults install nothing. The product gate `compatibility.allowCorePatches` is deny-only — an explicit literal `false` in any accepted layer blocks Tier C; literal `true` never grants authorization.

## Commands

| Command | Behavior |
| --- | --- |
| `/pi-style` | Show active preset, surfaces, placement, glyph mode, and compatibility summary. |
| `/pi-style on\|off` | Toggle the package for the session or selected persistence scope. |
| `/pi-style preset <name>` | Apply a named preset. |
| `/pi-style placement above\|below` | Move the primary status row. |
| `/pi-style editor <style> [frame]` | Select compact, boxed, dock, or native editor. |
| `/pi-style startup <off\|compact\|overlay>` | Select startup mode. |
| `/pi-style surface <name> on\|off` | Toggle startup/status/editor/messages/tools. |
| `/pi-style set <path> <JSON>` | Set one documented leaf/array/map/custom item after validation, e.g. `set statusLine.layout.left ["model","git"]`. |
| `/pi-style persist global\|project set <path> <JSON>` | Persist the same validated mutation to the selected durable scope. |
| `/pi-style reload` | Re-read configuration and reinstall affected surfaces. |
| `/pi-style doctor` | Show capability/conflict/fallback diagnostics. |

Ordinary mutations are session-only; persistence requires an explicit `global` or `project` scope and trusted projects. `set` is a finite recursive allowlist, not an executable DSL; unknown paths and malformed values are rejected. Writes recursively merge the validated `piStyle` namespace and preserve unrelated settings.

## Environment variables

| Variable | Meaning |
| --- | --- |
| `PI_STYLE_DISABLED=1` | Disable all surfaces for emergency recovery. |
| `PI_STYLE_NERD_FONTS=1\|0` | Force glyph mode. |
| `PI_STYLE_EDITOR=native\|compact\|boxed\|dock` | Temporary editor override. |
| `PI_STYLE_STATUS=above\|below\|off` | Temporary status placement/state. |
| `PI_STYLE_OSC11=1\|0` | Force terminal background sync policy. |
| `PI_STYLE_DEBUG=1` | Enable bounded diagnostics. |

## Persistence and migration

- Writes preserve unrelated Pi settings.
- Project writes require trust and explicit user intent.
- Migrations are pure, versioned transformations with tests.
- Missing `schemaVersion` is accepted as bounded-warning v1-shaped input; v1 is identity. Future versions fail closed/read-only and are never downgraded or overwritten. No historical v0 aliases are invented.

## Example configurations

**Conservative/native**

```json
{
  "piStyle": {
    "preset": "native",
    "editor": { "style": "native" },
    "messages": { "enabled": false },
    "tools": { "enabled": false },
    "compatibility": { "allowCorePatches": false }
  }
}
```

**Full visual treatment**

```json
{
  "piStyle": {
    "preset": "full",
    "startup": { "mode": "overlay" },
    "editor": { "style": "boxed", "frame": "outline" },
    "theme": { "nerdFonts": "auto", "terminalBackgroundSync": "auto" },
    "compatibility": { "allowSafePatches": true, "allowCorePatches": true }
  }
}
```

**ASCII-safe remote session**

```json
{
  "piStyle": {
    "preset": "ascii",
    "startup": { "mode": "compact" },
    "theme": { "nerdFonts": "off", "terminalBackgroundSync": "off" }
  }
}
```

## Editor configuration

Styles: `compact`, `boxed`, `dock`, `native`. Frames: `auto`, `halfblock`, `line`, `solid`, `outline`, `native`. Unknown values normalize to the safe defaults (`compact`/`auto`). `native` and narrow-width fallback preserve Pi's editor semantics before decoration. The editor never executes configuration values.

## Acceptance criteria

- Defaults/global/project/env/session precedence is proven in tests.
- Invalid config cannot prevent Pi startup.
- Config commands update runtime state immediately and persist only when requested.
- Every field has exactly one owning feature contract.
- `/pi-style doctor` shows effective values and their source without exposing secrets.

## Roadmap coverage

- Schema foundation: Phase 1.
- Status/editor/startup fields: Phases 2–4.
- Message/tool fields: Phase 5.
- Persistence, migrations, explicit-scope commands, diagnostics: Phase 6.
- Requirement IDs: `CFG-001` through `CFG-008`.
