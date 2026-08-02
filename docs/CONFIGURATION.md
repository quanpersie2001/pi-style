# Configuration

> Status: **Foundation implemented (Phase 1A); full command/persistence surface planned**

## Goals

Configuration must support a simple zero-config default and a complete product without creating an arbitrary rendering language. Users select known presets and override documented values; they do not inject executable code.

## Storage and precedence

The preferred configuration namespace is `piStyle` inside Pi settings files:

```text
built-in defaults
  < global $PI_CODING_AGENT_DIR/settings.json
  < project <cwd>/.pi/settings.json
  < supported environment overrides
  < current-session command overrides
```

Project settings are honored only for trusted projects. The implementation should use Pi's exported configuration directory constant when constructing project paths rather than hardcoding `.pi` where the API supports rebranding.

Session command overrides are temporary unless the command explicitly persists to global or project scope.

## Proposed schema

```json
{
  "piStyle": {
    "enabled": true,
    "preset": "default",
    "placement": "above",
    "startup": {
      "mode": "compact",
      "showResources": true,
      "showModel": true
    },
    "statusLine": {
      "enabled": true,
      "separator": "powerline-thin",
      "layout": {
        "left": ["model", "thinking", "path", "git"],
        "right": ["context_pct", "cost"],
        "secondary": ["extension_statuses"]
      },
      "disabledSegments": [],
      "customItems": []
    },
    "editor": {
      "enabled": true,
      "style": "compact",
      "frame": "auto",
      "showMetadata": true
    },
    "messages": {
      "enabled": true,
      "userPrefix": true,
      "assistantPrefix": true,
      "specialBlocks": true
    },
    "tools": {
      "enabled": true,
      "style": "compact-box",
      "maxCollapsedLines": 10,
      "showElapsed": true
    },
    "theme": {
      "nerdFonts": "auto",
      "terminalBackgroundSync": "auto",
      "colors": {},
      "glyphs": {}
    },
    "compatibility": {
      "allowSafePatches": true,
      "allowCorePatches": false,
      "preferExistingEditor": true,
      "preferExistingFooter": true
    },
    "debug": false
  }
}
```

This is the target shape; fields may be introduced by phase. The implementation must not silently implement undocumented fields.

## Top-level fields

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Master switch. Cleanup and restore owned surfaces when disabled. |
| `preset` | string | `default` | Coordinated UI preset. |
| `placement` | `above \| below` | `above` | Primary status-line placement. |
| `startup` | object | compact defaults | Startup/header behavior. |
| `statusLine` | object | enabled defaults | Segment layout and options. |
| `editor` | object | compact defaults | Editor style and frame. |
| `messages` | object | enabled when compatible | Message styling. |
| `tools` | object | enabled when compatible | Tool styling. |
| `theme` | object | auto defaults | Glyph/color/background behavior. |
| `compatibility` | object | conservative | Conflict and patch policy. |
| `debug` | boolean | `false` | Bounded diagnostics; never raw terminal spam. |

## Presets

Presets coordinate defaults across surfaces. Planned presets:

- `default` — balanced status line, compact editor, compact startup, restrained message/tool styling.
- `minimal` — path/Git/context essentials, native-like editor, no startup overlay, low decoration.
- `compact` — high information density for medium terminals.
- `full` — broad status data and all compatible visual surfaces.
- `ascii` — no Nerd Font assumptions and conservative separators.
- `native` — active Pi theme plus only low-risk status enhancements.

A preset establishes defaults. Explicit nested settings override it.

## Status-line layout semantics

```json
{
  "statusLine": {
    "layout": {
      "left": ["model", "thinking", "path"],
      "right": ["context_pct"],
      "secondary": ["git", "extension_statuses"]
    }
  }
}
```

Rules:

- an omitted group inherits the preset group;
- an explicitly empty group clears that group;
- a segment explicitly placed in one group is removed from inherited groups;
- unknown segment identifiers are ignored and reported once;
- `disabledSegments` wins over layout placement;
- duplicate segment identifiers render once.

“Right” is a logical trailing group, not a guarantee of terminal right-edge alignment unless the renderer can prove stable alignment at the current width.

## Custom status items

Custom items expose selected extension statuses with presentation metadata:

```json
{
  "statusLine": {
    "customItems": [
      {
        "id": "tasks",
        "statusKey": "pi-tasks",
        "label": "tasks",
        "priority": 40,
        "placement": "secondary",
        "color": "accent"
      }
    ]
  }
}
```

Config values cannot execute commands or import code. They only select an existing extension status and presentation options.

## Theme configuration

### Font mode

`theme.nerdFonts` accepts:

- `auto` — detect conservatively;
- `on` — force Nerd glyphs;
- `off` — force Unicode/ASCII fallback.

Environment override:

```text
PI_STYLE_NERD_FONTS=1|0
```

### Background synchronization

`terminalBackgroundSync` accepts `auto`, `on`, or `off`. `auto` follows the platform policy in `ui/THEMING.md` and `COMPATIBILITY.md`.

### Color and glyph overrides

Overrides are maps of known semantic keys. Unknown keys are ignored with a diagnostic. Empty strings are valid for icons that should be hidden.

## Normalization rules

- **CFG-001:** Missing values use defaults.
- **CFG-002:** Nested objects merge recursively; arrays replace according to their documented semantics.
- **CFG-003:** Invalid enum values fall back to defaults and record one warning.
- **CFG-004:** Wrong-type objects are ignored rather than causing startup failure.
- **CFG-005:** Unknown fields are preserved only if migration needs them; otherwise ignored.
- **CFG-006:** Configuration parsing has no side effects.
- **CFG-007:** Project configuration is ignored for untrusted projects.
- **CFG-008:** Environment variables are narrow, documented, and never replace the full schema.

## Commands

The Phase 1A runtime exposes configuration contracts and reload/doctor foundations internally. The complete user command surface remains planned for Phase 6.

Planned commands:

| Command | Behavior |
| --- | --- |
| `/pi-style` | Show active preset, surfaces, placement, glyph mode, and compatibility summary. |
| `/pi-style on` / `off` | Toggle the package for the current session or selected persistence scope. |
| `/pi-style preset <name>` | Apply a named preset. |
| `/pi-style placement above\|below` | Move the primary status row. |
| `/pi-style editor <style>` | Select compact, boxed, dock, or native editor. |
| `/pi-style surface <name> on\|off` | Toggle startup/status/editor/messages/tools. |
| `/pi-style reload` | Re-read configuration and reinstall affected surfaces. |
| `/pi-style doctor` | Show capability/conflict/fallback diagnostics. |

Commands without a required argument should use Pi selection/settings components where appropriate. Persistence scope must be explicit (`session`, `global`, or `project`) before writing settings.

## Environment variables

Planned narrow overrides:

| Variable | Meaning |
| --- | --- |
| `PI_STYLE_DISABLED=1` | Disable all surfaces for emergency recovery. |
| `PI_STYLE_NERD_FONTS=1\|0` | Force glyph mode. |
| `PI_STYLE_EDITOR=native\|compact\|boxed\|dock` | Temporary editor override. |
| `PI_STYLE_STATUS=above\|below\|off` | Temporary status placement/state. |
| `PI_STYLE_OSC11=1\|0` | Force terminal background sync policy. |
| `PI_STYLE_DEBUG=1` | Enable bounded diagnostics. |

## Persistence and migration

- Config writes must preserve unrelated Pi settings.
- Project writes require trust and explicit user intent.
- Schema migrations are pure transformations with versioned tests.
- Removed fields should produce an actionable migration warning for at least one minor release.
- Preset or token renames require aliases during the documented migration window.

## Example configurations

### Conservative/native

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

### Full visual treatment

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

### ASCII-safe remote session

```json
{
  "piStyle": {
    "preset": "ascii",
    "startup": { "mode": "compact" },
    "theme": { "nerdFonts": "off", "terminalBackgroundSync": "off" }
  }
}
```

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
- Persistence, migrations, and full command surface: Phase 6.
- Requirement IDs: `CFG-001` through `CFG-008`.
