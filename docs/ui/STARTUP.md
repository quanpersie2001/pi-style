# Startup presentation

> Status: **Planned**

## Purpose

The startup surface introduces the pi-style visual identity and summarizes the active environment without delaying entry into the editor. Its compact information design is inspired by `pi-droid-styling`; its lifecycle/dismissal discipline follows the safer native Pi approach.

## Modes

### `compact` (default)

A small header/resource summary rendered through Pi's header API or a nonblocking widget fallback.

Example structure:

```text
π pi-style
model  gpt-5.x  ·  think high  ·  project pi-style
resources  2 context · 4 extensions · 3 skills · 12 tools
```

### `overlay`

An optional centered branded overlay with the same information plus concise navigation hints. It is visual presentation only; it does not become a session browser or command launcher in v1.

### `off`

No custom startup surface. Status/editor/message/tool styling can remain active.

## Information model

Potential fields:

- package/Pi identity;
- active provider/model and thinking level;
- context window estimate;
- cwd/project name;
- loaded context files;
- extension count/names subject to width;
- loaded skills and prompt templates;
- active tool count/groups;
- active pi-style preset and compatibility fallback count.

Only data exposed through stable Pi APIs or already collected by the runtime is shown. Recent sessions are excluded unless Pi exposes a stable source and a separate product requirement approves it.

## Data collection

Startup data is collected once before mounting and refreshed only on an explicit resource reload. Render methods consume a snapshot and perform no filesystem scans.

Long lists are summarized by count and optionally a few names. The startup view must not expose secrets or full configuration content.

## Session reason rules

Default behavior:

| `session_start` reason | Show? |
| --- | --- |
| `startup` | yes |
| `reload` | no overlay; compact header may refresh |
| `new` | compact only, configurable |
| `resume` | compact only, configurable |
| `fork` | compact only, configurable |

An overlay should never repeatedly interrupt session replacement unless explicitly configured.

## Quiet startup

A `quiet` option suppresses notifications and overlay animation. Compact header may still appear if selected. `off` disables all startup customization.

## Dismissal

Overlay dismissal triggers:

- any relevant terminal input;
- agent start;
- tool call or user Bash execution;
- Escape/explicit close;
- session shutdown/replacement;
- optional timeout.

The dismiss scheduler uses generation tokens. A stale timeout cannot close or mount UI in a replacement session.

## Width behavior

Degradation order:

1. hide optional names and retain counts;
2. remove navigation hints;
3. abbreviate provider/model/project;
4. use two compact lines;
5. use one identity line;
6. disable overlay when minimum usable width/height is unavailable.

Every line obeys the component width.

## Theme and glyphs

Startup uses the shared semantic resolver. Branding may use a restrained gradient only when truecolor/color mode is available; no-color mode uses plain text and borders.

The Pi glyph uses Nerd/Unicode/ASCII selection. Branding cannot depend on private-use glyphs.

## Failure fallback

- Missing header API → use a startup widget or skip compact presentation.
- Overlay unsupported/headless → compact/off behavior.
- Resource discovery error → show known model/project only and record diagnostics.
- Theme error → plain active Pi theme tokens.

## Requirements

- **START-001:** compact startup is the default mode.
- **START-002:** overlay is optional and nonblocking.
- **START-003:** startup render performs no resource/filesystem discovery.
- **START-004:** dismissal is safe across session generations.
- **START-005:** startup reason behavior is configurable and nonintrusive by default.
- **START-006:** narrow/no-color/ASCII modes remain readable.
- **START-007:** headless modes mount no custom terminal UI.
- **START-008:** startup never exposes secrets or full settings.

## Planned tests

- each session reason and mode;
- input/agent/timeout/shutdown dismissal;
- stale generation callback;
- missing header/overlay capability;
- width and height extremes;
- long model/project/resource names;
- no-color, Unicode, ASCII, and theme invalidation;
- resource errors and headless modes.

## Roadmap coverage

- Implemented in: Phase 4.
- Full command/config control: Phase 6.
- Terminal/manual proof: Phase 7.
- Requirement IDs: `START-001` through `START-008`.
