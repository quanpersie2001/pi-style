# Messages and tool presentation

> Status: **Implemented/certified subset — exact Pi 0.83.0; capability-conditioned fallbacks remain native**

## Scope

This contract covers: user and assistant message prefixes; thinking and tool-only assistant presentation; compaction, skill, branch-summary, and custom (MCP) message blocks; and tool call headers, results, state, expansion, and metrics. These surfaces carry a higher compatibility burden than widgets and editors and always preserve native fallback.

## Shared visual primitives

Pure, theme-consuming primitives shared by feature-local renderers (no global theme import):

- `Badge` — short state/tool label;
- `Prefix` — message-role marker with continuation indent;
- `CompactBox` — optional border/background/padding shell;
- `MetricsLine` — elapsed time, counts, truncation, or key hint;
- `StateMark` — pending/success/error/partial indicators;
- ANSI-safe line wrapping/truncation.

## User and assistant messages

Default user treatment:

```text
❯ user prompt text
  continuation aligned here
```

Rules: prefix is optional by config/preset; multiline continuation aligns after the prefix/gap; native user-message background/text tokens remain the base; long content wraps (never truncates); images/attachments preserve native rendering.

Assistant presentation uses a restrained prefix only when it improves role separation. It must handle normal text streaming, thinking-only updates, tool-only messages, mixed text and tool calls, aborted/error states, and final render cache reuse without stale partial content. Thinking text uses Pi's thinking token and does not visually compete with final assistant text.

## Compatibility status

The certified Tier C subset targets exact Pi `0.83.0` only (policy range `>=0.83.0 <0.84.0`). Installation is session-only; the core/message/tool surface flags are default-on (fingerprint-certified, fail-closed elsewhere, conflict-preserving), and the OFF switch is `compatibility.allowCorePatches: false` in config. No execution, tool registration, prompt, filesystem, or process behavior is changed.

Certified presentation: user/assistant prefixes; tool call/result selectors with exact markers `[tool]`, `[tool:result]`, `[tool:pending]`, `[tool:running]`, `[tool:error]` (marker style); and boxed special blocks when `tools.style: "compact-box"` and `messages.specialBlocks` are active. Boxed special blocks are certified adapters over the native `updateDisplay`/`rebuild` identities (fingerprint-verified) and fall back to native layout whenever no session theme is cached or the component shape is unsupported. ASCII mode uses configured ASCII markers on already-authorized surfaces.

## Special message blocks

When `messages.specialBlocks` is enabled and authorized:

- compaction summaries — `⊟ Compaction · 12,345 tokens`;
- skill invocations — `⊟ Skill · <name>`;
- branch summaries — `⊟ Branch`;
- extension custom (MCP) messages — `⊟ Custom · <customType>`, preserving a provided `customRenderer` inside the boxed shell.

Each block embeds its title in a rounded top border, shows a compact single-line body with an expand hint (`Ctrl+O to expand`) at the right end of the bottom border, and falls back to native layout when no session theme is cached, the shape is unsupported, or the surface is unauthorized.

## Tool call header

Compact boxed shape (`tools.style: "compact-box"`):

```text
╭─ ➔ Read ✓ · Path: src/index.ts ──────────────────────╮
│                                                      │
╰─ 1.2s · ~10k words ──────────────────────────────────╯
```

Full boxed shape (bash/edit/quick-edit/fallback), with the title in the top border, a single labeled divider before the result, and the metrics footer embedded in the bottom border:

```text
╭─ ➔ Bash ✓ ──────────────────────────────────────────╮
│                                                      │
│  $ npm test                                          │
│                                                      │
├─ Response ──────────────────────────────────────────┤
│                                                      │
│  ✓ tests passed                                      │
│                                                      │
╰─ 1.2s · timeout 300s · ~45 words ── Ctrl+O for more ─╯
```

Compact (summary) tools render `➔ <Tool> ✓ · <detail>` with the footer in the bottom border; bash renders a full call box with the command, a `Response` divider, and the expand hint on the bottom border when output is truncated. Edit/quick-edit render the path in the header and the diff under a `Diff · +N -M` divider. `tools.style: "marker"` keeps the marker style (`[read] src/index.ts`).

### Quiet-tool batching

Consecutive calls of the same quiet tool (`read`, `ls`, `find`) inside one assistant turn collapse into a **single boxless tree panel** instead of one box per call. Grouping is always on. The first call becomes the batch leader and renders the whole panel; later calls render zero lines, so N boxes become one. Batching is per turn and per tool: a non-batchable call (bash/edit/write/…) or the next message closes the batch, so reads separated by an edit never merge, and session history is not re-grouped.

The panel has **no surrounding box and never collapses** — the tree stays open in every state (one box per call is exactly the noise this feature removes). States:

```text
◌ Read (3) · 1/3
  ├─ ✓ backend/api/.../entities.py
  ├─ ◌ backend/api/.../dto.py
  └─ ◌ backend/api/.../ports.py
```

- **Pending** header `➔ Read (N)`.
- **Running** header `◌ Read (N) · k/N`; tree shows `✓`/`◌` per member.
- **Done** header ` Read (N) · 0.08s` (open-tree glyph; `●` unicode fallback, nerd `\u{F111}`); tree keeps the first 5 members and a `└─ N more` row.
- **Per-file color**: files read successfully render in the primary (accent) color; failed members render in the error color with the error text indented beneath, and the header becomes `✗ Read (N) · 1 failed`. Errors stay open.
- **Lone calls are unchanged**: a single read/list/find renders exactly the pre-batch boxed single box.

Header requirements: stable human-readable tool label (`formatToolName`); concise primary argument; pending/success/error via `✓`/`✗` (the native `toolPendingBg`/`toolErrorBg`/`toolSuccessBg` container fill is neutralized for boxed rendering); no leaking of hidden/sensitive values beyond native Pi behavior; incomplete streaming arguments render safely; labels and glyphs remain meaningful in ASCII/no-color mode.

## Tool result body

Default body is compact when settled and supports native expansion. pi-style never suppresses information the user or model needs. States: pending/partial, success, error, cancelled, truncated, empty. `MetricsLine` can show elapsed time, result count, bytes/lines, or expansion hints when reliably available.

### Edit / quick-edit diffs

Edit, quick-edit, substitute-edit, and target-edit render their diff **adaptively**: split (side-by-side `old │ new`) only for short corresponding changes on a wide terminal, unified otherwise — additions/removals-only diffs, narrow terminals, and lines that would wrap badly in a half pane always render unified. Long runs of unchanged context collapse into a single `⋯ N unchanged lines hidden` row instead of arbitrary truncation; when the diff still exceeds the row budget a `⋯ N lines omitted · Ctrl+O to show full diff` row is shown, and a `Ctrl+O more` hint sits on the divider's right side. The divider carries the change stats (`Diff · +3 -0`), and the footer shows `1 file · +3 -0` (elapsed time first when known):

```text
╭─ ➔ Edit ✓ · CHANGELOG.md ─────────────────────╮
├─ Diff · +3 -0 ───────────────── Ctrl+O more ───┤
│                                                │
│     1  # Changelog                             │
│  +  5  - **Fixed: ...                          │
│  ⋯ 23 unchanged lines hidden                   │
│                                                │
╰─ 1 file · +3 -0 ──────────────────────────────╯
```

## Tool-specific presentation

| Tool | Presentation |
| --- | --- |
| Read | Badge + normalized path, optional line range; native syntax-highlighted content when possible; truncation notice preserved. Consecutive reads batch into one boxless tree panel. |
| Write | Path and created/overwritten state; concise success/error; no duplicate full file content unless native result provides it. |
| Edit | Path in the header; adaptive diff (unified/split) with collapsed unchanged context; failed unique-match errors prominent. |
| Find/list/grep | Query/path summary, result count/truncation status, compact file/result rows; expansion preserves full native details. `ls`/`find` batch like reads; `grep` stays unbatched so match previews are never hidden. |
| Bash | Concise command header, running/exit status, stdout/stderr distinction where host data supports it; long output uses native truncation/expansion; execution, environment, timeout, and shell behavior are never changed. |

## Expansion and collapse

- Use Pi's configured tool expansion state where available; default collapsed line count is configurable.
- Errors may show more detail by default than successes.
- Custom key hints use Pi keybinding helpers rather than hardcoded keys.
- No independent scrollable fixed tool box in v1.

## Streaming correctness

Message/tool renderers must distinguish partial from finalized state; cached finalized output cannot replace newer partial output or vice versa. `context.lastComponent` may be reused only when component state is explicitly updated and invalidated.

## Output safety

Preserve built-in truncation notices; never inject untrusted output into raw terminal controls without Pi-consistent sanitization; lines remain ANSI-contained; background fills do not bleed; no tool result shape is changed merely for presentation.

## Integration strategy

Preference order: public custom renderer/registration API → renderer-only override preserving execution/result shapes → isolated, version/capability-gated component patch → native fallback. Re-registering built-in tools for styling is not the default because it risks execution/prompt semantics and conflicts with other extensions.

## Conflict behavior

If another extension already owns a message/tool renderer: compose only through a supported public mechanism; otherwise preserve the existing owner by default; allow explicit user preference only with diagnostics; restore only the pi-style-installed identity on shutdown.

## Requirements — messages

- **MSG-001:** user/assistant prefixes are optional and width-safe.
- **MSG-002:** streaming, thinking-only, tool-only, and mixed messages render correctly.
- **MSG-003:** special blocks alter presentation, not model/session content.
- **MSG-004:** unsupported shapes use native rendering.
- **MSG-005:** message patches are idempotent and reversible.
- **MSG-006:** images and native rich content remain usable.

## Requirements — tools

- **TOOL-001:** styling never changes built-in execution semantics.
- **TOOL-002:** certified pending/partial/success/error states are distinct without color alone; cancelled/truncated distinction is native/neutral when reliable host state is unavailable.
- **TOOL-003:** built-in expansion and truncation behavior is preserved.
- **TOOL-004:** tool-specific headers remain concise and sanitize incomplete arguments.
- **TOOL-005:** renderer conflict/failure falls back to the existing/native renderer.
- **TOOL-006:** patches/overrides are idempotent, reversible, and identity-safe.
- **TOOL-007:** renderers perform no filesystem/process work.

## Certified and fallback tests

- user/assistant multiline prefixes at wide/narrow widths; partial/final transitions;
- thinking-only/tool-only/mixed messages; each special block collapsed/expanded;
- built-in tools with incomplete args, partial updates, success, error, cancellation, truncation;
- diff and syntax-highlight preservation; no-color/ASCII/theme invalidation;
- unsupported target shapes; repeated reload and later-owner replacement; native fallback snapshots.

## Roadmap coverage

- Implemented in: Phase 5.
- Full conflict/config controls: Phase 6.
- Performance/platform/release proof: Phase 7; manual evidence pending.
- Requirement IDs: `MSG-001` through `MSG-006`, `TOOL-001` through `TOOL-007`.
