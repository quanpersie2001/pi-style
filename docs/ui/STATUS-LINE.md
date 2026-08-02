# Status line

> Status: **Implemented — Phase 2 complete**

## Purpose

The status line is the primary information surface in pi-style. It borrows the segment/preset/responsive model from `pi-powerline-footer`, but is rebuilt as pure domain logic plus native Pi widgets.

It must answer, at a glance:

- which model and thinking level are active;
- where the session is working;
- whether the repository is clean;
- how much context is used;
- what the session is consuming;
- which other extensions expose relevant state.

## Native surface layout

The current Phase 2 foundation installs the primary and secondary namespaced widgets through the public widget API, preserves footer ownership, and removes only widgets still owned by pi-style. The primary row follows configured above/below placement; the secondary row is emitted only when rendered content exists.

Planned widget IDs and placement:

```text
aboveEditor: pi-style.notifications
aboveEditor or belowEditor: pi-style.status.primary
belowEditor: pi-style.status.secondary
```

The primary row placement follows configuration. The secondary row appears only when it contains visible segments. No blank row is reserved when a widget has no content.

A footer data bridge may be installed only when public status/Git branch data is otherwise unavailable and footer ownership is compatible. The visual status line itself remains a widget.

## Segment contract

A segment has a stable identifier and consumes a render-ready snapshot:

```ts
interface StatusSegment {
  id: StatusSegmentId;
  defaultPriority: number;
  render(context: SegmentContext): SegmentRenderResult;
}

interface SegmentRenderResult {
  visible: boolean;
  content: string;
  compactContent?: string;
  minWidth?: number;
}
```

Actual types may differ, but these properties are required conceptually:

- stable ID for layout/configuration;
- visibility without throwing;
- normal and optional compact representations;
- priority and width behavior separate from styling;
- no I/O in `render()`.

## Segment context

`SegmentContext` is an immutable subset of the current `UiSnapshot`:

- active model/provider;
- effective thinking level;
- cwd/project display path;
- Git branch/status snapshot;
- context tokens/window/percentage;
- usage totals and live usage;
- cache read/write totals;
- cost and subscription mode;
- session ID/name/start time;
- auto-compaction/custom compaction state;
- extension statuses/custom items;
- selected glyph and separator set;
- semantic theme resolver;
- normalized segment options.

Segments never reach back into `ExtensionContext` or session storage.

## Built-in segments

| ID | Content | Default importance |
| --- | --- | --- |
| `pi` | Package/Pi glyph | Decorative; first to drop |
| `model` | Model name, optionally provider | Essential |
| `thinking` | Live `think:off`, `think:min`, `think:low`, `think:med`, `think:high`, `think:xhigh`, or `think:max` | Essential for reasoning models |
| `path` | Basename, abbreviated, or full cwd | High |
| `git` | Branch and staged/unstaged/untracked indicators | High in repositories |
| `context_pct` | Context percentage and threshold state | High |
| `context_total` | Current/context-window token counts | Medium |
| `auto_compact` | Auto/custom compaction state | Medium |
| `token_in` | Input tokens | Medium |
| `token_out` | Output tokens | Medium |
| `cache_read` | Cache-read usage | Low/medium |
| `cache_write` | Cache-write usage | Low |
| `cost` | Session cost when meaningful | Medium |
| `time_spent` | Session elapsed time | Low |
| `time` | Clock | Low |
| `hostname` | Host identity | Low; useful remotely |
| `session` | Session name/short ID | Low/medium |
| `extension_statuses` | Remaining Pi extension statuses | Secondary |
| configured custom item | Selected status by key | User-defined |

Segments with unavailable or unreliable data hide themselves instead of showing invented zero values.

## Live thinking-level indicator

Thinking state resolution order:

1. latest live `thinking_level_select` event for the active session;
2. current context/API value on session start;
3. restored branch/session value if needed for consistency;
4. `off` fallback.

The event handler updates the snapshot and requests an immediate render without typing deferral.

Display mapping:

| Pi level | Text |
| --- | --- |
| `off` | `think:off` |
| `minimal` | `think:min` |
| `low` | `think:low` |
| `medium` | `think:med` |
| `high` | `think:high` |
| `xhigh` | `think:xhigh` |
| `max` | `think:max` |

High levels may use stronger semantic styling, but color/glyph is never the sole indication.

## Model formatting

The default renderer favors a recognizable short model ID. It may strip redundant date/vendor prefixes only through tested normalization rules. When two scoped models would become ambiguous, retain enough provider/model text to distinguish them.

At narrow widths, use compact content before truncating the middle/end of an identifier.

## Path formatting

Modes:

- `basename` — current directory name;
- `abbreviated` — home as `~`, intermediate path components shortened;
- `full` — normalized path subject to max width.

The status line must not reveal a path outside what Pi already displays in the local terminal. It never sends path data externally.

## Git provider and rendering

Git work happens asynchronously outside render.

Snapshot fields:

```ts
interface GitSnapshot {
  available: boolean;
  branch: string | null;
  staged: number;
  unstaged: number;
  untracked: number;
  ahead?: number;
  behind?: number;
  refreshing: boolean;
  error?: string;
}
```

Default compact rendering:

```text
⎇ main +2 *1 ?3
```

Rules:

- clean branch uses `gitClean` semantics;
- any change uses `gitDirty` for branch/icon plus state-specific indicators;
- staged uses `+N`, unstaged `*N`, untracked `?N`;
- options can hide individual counters;
- not-a-repository hides the segment;
- provider errors keep a stale value when safe and appear in doctor output.

Invalidation sources include writes/edits and detected branch/worktree-changing Bash or user Bash commands. Refreshes are timeout-bounded and deduplicated.

## Context and compaction

The context segment uses Pi's context usage API when available. It shows percentage and optionally current/window tokens.

Suggested semantic thresholds:

| Usage | Semantic state |
| --- | --- |
| <50% | low |
| 50–74% | medium |
| 75–89% | high |
| ≥90% | critical |

Thresholds may become configurable later, but defaults must be shared by status/editor/startup.

Auto-compaction is represented by a compact marker or label. Custom compaction status takes precedence over a misleading native auto marker when detected.

## Usage and cost

Usage aggregation includes finalized assistant usage and any tool-reported nested model usage that Pi records. Live streaming usage can temporarily replace the latest finalized usage but must not double count after finalization.

Cost is hidden when:

- no reliable cost exists;
- subscription/OAuth mode makes currency cost misleading and the user has not requested it;
- all relevant totals are zero and the preset omits zero values.

No network currency conversion exists in pi-style.

## Extension statuses and custom items

`extension_statuses` renders statuses not claimed by configured custom items. It preserves status strings supplied by other extensions and filters only keys explicitly consumed elsewhere.

Configured custom items can add a label/icon/color/priority and choose a status key. They cannot execute code or parse arbitrary terminal control sequences beyond the safety policy.

Notifications that should remain visually separate from compact metadata use the notifications widget rather than the segment row.

## Presets

### `default`

```text
left: model, thinking, path, git
trailing: context_pct, cost
secondary: extension_statuses
separator: powerline-thin or Unicode fallback
```

### `minimal`

```text
left: path, git
trailing: context_pct
secondary: none
separator: dot/slash
```

### `compact`

```text
left: model, thinking, git
trailing: context_pct
secondary: extension_statuses
```

### `full`

```text
left: hostname, model, thinking, path, git, session
trailing: token_in, token_out, cache_read, cost, context_pct, time_spent, time
secondary: extension_statuses
```

### `ascii`

ASCII labels and separators; no private-use glyphs.

### `native`

Minimal color and decoration, preserving the active Pi theme's visual character.

## Custom layout

Layout groups are `left`, `right` (logical trailing), and `secondary`. Configuration semantics are defined in `CONFIGURATION.md`.

The renderer should not promise hard terminal right alignment. If alignment is used, it must remain stable under ANSI width, resizing, and narrow widths; otherwise render the trailing group after a deliberate separator.

## Responsive algorithm

1. Resolve layout and remove disabled/duplicate IDs.
2. Render each candidate once into normal/compact variants.
3. Remove invisible/empty candidates.
4. Calculate ANSI-aware widths including separators and padding.
5. Fit essential segments in primary order.
6. Replace eligible items with compact variants.
7. Move overflow-capable items to the secondary row by priority/order.
8. Remove lowest-priority optional items when secondary also exceeds width.
9. Truncate only a segment that explicitly allows truncation, usually path/model/custom text.
10. Verify both output lines fit the width.

Essential order defaults to model → thinking → path/Git → context, but presets can alter priority.

## Caching and refresh

Cache key includes:

- width;
- layout/config revision;
- snapshot revision;
- theme generation;
- glyph mode;
- streaming state where it changes values.

Refresh triggers:

- model/thinking selection;
- context/usage update;
- Git provider completion/invalidation;
- extension status change;
- theme/config change;
- session tree/compaction/name change;
- terminal resize through normal render width changes.

## Error and fallback behavior

- A failing segment is omitted and recorded, not allowed to break the row.
- Missing footer data hides only dependent segments.
- Unknown separators fall back to a safe Unicode/ASCII separator.
- Extremely narrow widths may render only `model think:<level>` or one truncated essential segment.
- Width zero or negative returns no lines.

## Phase 2 implementation notes

Implemented and tested foundations include immutable status snapshots with generation/revision tracking, preset-aware layout normalization with explicit empty groups and duplicate removal, cached Git/usage/context provider contracts, and a pure ANSI-aware responsive renderer. Built-in segment registration covers the documented segment identifiers and hides unavailable data. Public event adapters schedule immediate model/thinking updates and coalesced/deferred status refreshes.

The Phase 2 status-line subsystem is implemented with native Pi component widgets, effective runtime configuration, async cached Git refresh/invalidation, live context updates, typed custom extension-status items, responsive width-safe rendering, and lifecycle cleanup. Automated proof covers the documented responsive widths, thinking labels, provider deduplication/finalization, malformed/disabled segments, component factories, and headless behavior.

## Requirements

- **STAT-001:** use native Pi widget layout.
- **STAT-002:** thinking level updates live.
- **STAT-003:** configured segments are deterministic and deduplicated.
- **STAT-004:** primary and secondary lines never exceed width.
- **STAT-005:** render performs no I/O/session scan.
- **STAT-006:** Git refresh is cached, asynchronous, deduplicated, and invalidatable.
- **STAT-007:** missing data hides only affected segments.
- **STAT-008:** ASCII/no-font mode remains meaningful.
- **STAT-009:** extension statuses can be surfaced without altering their owners.
- **STAT-010:** theme/config/session changes invalidate relevant caches.
- **STAT-011:** usage aggregation avoids double counting.
- **STAT-012:** logical trailing layout does not make an unsupported alignment promise.

## Validation coverage

- every preset at widths 40/60/80/120/160;
- all thinking levels, including model changes that clamp a level;
- long model/path/branch/custom status;
- no Git, clean Git, all dirty counters, Git error/stale refresh;
- context thresholds and missing window;
- subscription versus API-cost mode;
- duplicate/disabled/explicit-empty layout configuration;
- Unicode, Nerd, ASCII, and no-color rendering;
- live/final usage transition;
- widget install/remove and render-request events.

## Roadmap coverage

- Implemented in: Phase 2.
- Extended custom configuration: Phase 6.
- Platform/performance proof: Phase 7.
- Requirement IDs: `STAT-001` through `STAT-012`.
