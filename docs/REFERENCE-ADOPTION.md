# Reference adoption plan

> Status: **Planned**

## Purpose

This document records what pi-style will absorb from the two repositories under `references/`, what will be reworked, and what will not be included. It prevents “combine the references” from becoming either an uncontrolled copy or an implementation that loses the desired behavior.

The references are design and implementation research inputs. pi-style does not depend on them at runtime.

## Provenance and license policy

Both reference `package.json` files declare the MIT license. The vendored reference roots do not currently contain standalone license files. Before copying substantial source verbatim, implementation work must verify upstream license text and preserve required attribution. Prefer clean reimplementation of documented behavior using current Pi APIs.

Every copied or closely adapted nontrivial algorithm should include a source comment or release-note attribution when required.

## `pi-powerline-footer` adoption matrix

| Concept | Decision | pi-style interpretation |
| --- | --- | --- |
| Native Pi layout | **Adopt** | Use widgets, editor/footer/header APIs; Pi retains feed and terminal layout ownership. |
| Segment registry/context | **Adopt** | Define pure domain segment contracts fed by immutable snapshots. |
| Named presets | **Adopt** | Ship coordinated layout/style presets with documented custom overrides. |
| Primary/secondary responsive rows | **Adopt** | Fit by priority; move overflow; hide optional segments at extreme widths. |
| Live thinking event | **Adopt** | Update immediately on `thinking_level_select`; initialize from current context/session state. |
| Model/context/Git/usage segments | **Adopt** | Reimplement as isolated providers and pure renderers. |
| Extension-status custom items | **Adopt** | Treat Pi extension statuses as an integration boundary. |
| Nerd Font auto-detection | **Adapt** | Keep environment/terminal detection, rename overrides for pi-style, default conservatively. |
| Settings merge | **Adapt** | Use a documented Pi settings namespace and one precedence ladder. |
| Render scheduler and caches | **Adopt** | Promote to shared app-level services rather than closure-local helpers. |
| Empty footer data bridge | **Adapt** | Use only if branch/status data is unavailable otherwise; document singleton conflict. |
| Previous editor autocomplete pass-through | **Adapt** | Preserve provider composition when capability exists; do not claim full arbitrary editor composition. |
| Welcome overlay | **Adapt** | Compact startup is default; overlay is optional. |
| Large monolithic entrypoint | **Reject** | Replace with layered modules and feature installers. |
| Bash mode | **Reject** | Shell workflow is not visual styling. |
| Prompt stash/history | **Reject** | Productivity workflow outside product scope. |
| `/cd` and jump shortcuts | **Reject** | Directory navigation is not owned by pi-style. |
| Working vibes | **Reject** | AI-generated text is unrelated to UI styling. |
| Currency/network rates | **Reject** | No network dependency for status cost display. |

## `pi-droid-styling` adoption matrix

| Concept | Decision | pi-style interpretation |
| --- | --- | --- |
| Compact structured editor | **Adopt** | Implement code-defined compact/boxed/dock styles on top of `CustomEditor`. |
| Prompt glyph and spacing | **Adopt** | Use `❯`/fallback glyphs with width-safe continuation alignment. |
| Metadata/runtime rows | **Adapt** | Feed from shared snapshot and obey metadata ownership rules. |
| Thinking-sensitive editor frame | **Adopt** | Border/frame semantic color follows current thinking level. |
| Compact startup information | **Adopt** | Render through public header/overlay APIs where possible. |
| User/assistant prefixes | **Adopt later** | Optional compatibility-gated surface after native widgets/editor are stable. |
| Special message blocks | **Adopt later** | Isolated patch/adapter with native fallback. |
| Compact tool badges/boxes | **Adopt later** | Reimplement with current tool renderer APIs or isolated patches. |
| Semantic theme extras | **Adapt** | Define one documented pi-style semantic resolver shared by all features. |
| Explicit cell backgrounds | **Adopt** | Prefer painting actual rendered cells over global terminal mutation. |
| OSC 11 background sync | **Adapt** | Optional and platform-gated; restore on shutdown. |
| Fixed user-zone compositor | **Defer post-v1** | Requires a separate product/architecture decision and terminal matrix. |
| Terminal split/scroll-region ownership | **Reject for v1** | Conflicts with native-layout goal. |
| Selection/copy in fixed zone | **Defer with compositor** | Not needed in native layout. |
| Chat virtualization | **Reject for v1** | Performance optimization unrelated to core styling; revisit only with evidence. |
| Render-frame physical sync/self-heal | **Defer** | Add only for reproduced terminal drift. |
| Broad prototype patching | **Restrict** | Allowed only under compatibility tier policy. |
| Core tool re-registration | **Restrict** | Prefer renderer-only integration and preserve execution semantics. |
| Tasks widget styling | **Optional integration** | Consume extension status/widget APIs; do not hard-depend on task extensions. |

## Visual synthesis

pi-style should not visually resemble a generic powerline bar pasted onto an unchanged Pi screen. The synthesis is:

- **Powerline information architecture:** ordered segments, presets, priority, overflow, live status, extension-status bridge.
- **Droid visual language:** compact spacing, strong prompt marker, restrained borders, state badges, semantic accent hierarchy, visually distinct user/assistant/tool blocks.
- **Native Pi behavior:** standard feed, selection, editor lifecycle, resize, and public TUI APIs.

## Conflict resolution rules

### Native layout versus fixed zone

Native layout wins for v1. The fixed-zone compositor is a separate terminal architecture, not a style toggle.

### Footer data versus footer ownership

Do not replace the footer only for decoration. If a minimal footer bridge is needed for branch or extension statuses, detect an existing footer owner and degrade rather than silently taking it over.

### Status line versus editor metadata

A preset resolves ownership for each datum. The default must not show the same model/path/context text twice. Thinking level may affect both status text and editor border because the second use is a visual state signal rather than duplicate text.

### Active Pi theme versus pi-style colors

The active Pi theme is the base. pi-style semantic overrides are narrow and optional. The extension must remain usable with custom user themes.

### Tool styling versus tool execution

pi-style never changes built-in tool behavior merely to style it. Renderer overrides must preserve exact execution/result shapes and must not add prompt metadata unless intentionally part of the product.

### Another extension already owns a surface

Prefer composition if the public API supports it. Otherwise preserve the existing owner and report the pi-style surface as disabled. A force option may be added later, but silent replacement is not acceptable.

## Rejected feature rationale

The rejected items are valuable in their original projects but would expand pi-style into a shell manager, productivity suite, or terminal compositor. Excluding them keeps the product centered on visual presentation and allows stronger compatibility guarantees.

## Review checklist for adopting a new reference idea

1. Is the behavior visual presentation or a separate workflow?
2. Can it use a public Pi API?
3. Does it preserve native layout and input behavior?
4. Can it be isolated and disposed independently?
5. Does it require I/O during render?
6. Does it duplicate an existing pi-style surface?
7. What terminal/Pi-version proof is required?
8. Does it need an ADR or roadmap change?
9. Is upstream attribution required?

## Roadmap coverage

- Introduced: Phase 0.
- Revisited: every feature phase before implementation.
- Completed by: Phase 7 release review.
- Blocking decisions: ADR 0002 and ADR 0004.
