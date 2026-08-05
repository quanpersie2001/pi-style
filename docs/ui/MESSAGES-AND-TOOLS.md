# Messages and tool presentation

> Status: **Implemented/certified subset — exact Pi 0.83.0; capability-conditioned fallbacks remain native**

## Scope

This contract covers: the assistant message prefix; thinking and tool-only assistant presentation; compaction, skill, branch-summary, and custom (MCP) message blocks; and tool call headers, results, state, expansion, and metrics. These surfaces carry a higher compatibility burden than widgets and editors and always preserve native fallback.

## Shared visual primitives

Pure, theme-consuming primitives shared by feature-local renderers (no global theme import):

- `Badge` — short state/tool label;
- `Prefix` — message-role marker with continuation indent;
- `CompactBox` — optional border/background/padding shell;
- `MetricsLine` — elapsed time, counts, truncation, or key hint;
- `StateMark` — pending/success/error/partial indicators;
- ANSI-safe line wrapping/truncation.

## User and assistant messages

User messages render **native** (no leading glyph). The editor prompt glyph is also `❯`, so prefixing sent user messages made them indistinguishable from the live input box; the `❯` prefix was therefore removed entirely:

```text
user prompt text
continuation aligned here
```

Rules: no prefix is applied to user messages (the feature and its `messages.userPrefix` option were removed); native user-message background/text tokens remain the base; long content wraps (never truncates); images/attachments preserve native rendering. User messages are never patched: the certified `native-user-message` surface was removed, so only assistant and special-block message surfaces are certified.

Assistant presentation uses a restrained prefix only when it improves role separation. It must handle normal text streaming, thinking-only updates, tool-only messages, mixed text and tool calls, aborted/error states, and final render cache reuse without stale partial content. Thinking text uses Pi's thinking token and does not visually compete with final assistant text. By default the `Thinking...` placeholder label for hidden thinking blocks is suppressed entirely (`messages.hideThinkingLabel: true`): Pi wraps even an empty label in ANSI codes so its `Text` still occupies one invisible row, and the native layout appends a trailing spacer — together the visible gap where the label used to sit. A certified `AssistantMessageComponent.updateContent` patch (fingerprint-verified 0.83.0, fail-closed elsewhere) drops the invisible row and that trailing spacer, so a hidden thinking block leaves the same single top padding as a text-only message.

## Compatibility status

The certified Tier C subset targets exact Pi `0.83.0` only (policy range `>=0.83.0 <0.84.0`). Installation is session-only; the core/message/tool surface flags are default-on (fingerprint-certified, fail-closed elsewhere, conflict-preserving), and the OFF switch is `compatibility.allowCorePatches: false` in config. No execution, tool registration, prompt, filesystem, or process behavior is changed.

Certified presentation: assistant prefix; tool call/result selectors with exact markers `[tool]`, `[tool:result]`, `[tool:pending]`, `[tool:running]`, `[tool:error]` (marker style); and boxed special blocks when `tools.style: "compact-box"` and `messages.specialBlocks` are active. Boxed special blocks are certified adapters over the native `updateDisplay`/`rebuild` identities (fingerprint-verified) and fall back to native layout whenever no session theme is cached or the component shape is unsupported. ASCII mode uses configured ASCII markers on already-authorized surfaces.

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

Full boxed shape (bash/edit/quick-edit/fallback), with the title in the top border, a single labeled divider before the result, and the metrics footer embedded in the bottom border. The `Response` divider and the metrics footer appear **only when the tool settles** — while a call runs, the same box stays open with a live running status instead of a premature result frame:

```text
╭─ ➔ Bash ◌ ─────────────────────────────────────────╮
│                                                    │
│  $ npm test                                        │
│  No output received yet                            │
│                                                    │
╰─ ◌ Running · 12.4s ────────────────────────────────╯
```

Partial output streams into the open card under an `Output` divider (no `Response`), and the first partial result renders nothing so the running card is never duplicated below a second box. Only the terminal result adds the `Response` divider and the status footer:

```text
╭─ ➔ Bash ✓ ─────────────────────────────────────────╮
│                                                    │
│  $ npm test                                        │
│                                                    │
├─ Response ────────────────────────────────────────┤
│                                                    │
│  ✓ tests passed                                    │
│                                                    │
╰─ Exit 0 · 1.2s · ~3 words ── Ctrl+O for more ───────╯
```

Compact (summary) tools render `➔ <Tool> ✓ · <detail>` with the footer in the bottom border; bash renders a full call box with the command, a `Response` divider, and the expand hint on the bottom border when output is truncated. Edit/quick-edit render the path in the header and the diff under a `Diff · +N -M` divider. Write renders a compact preview box: the path in the top border, the written content as numbered lines (cat -n style) in the body, and the metrics footer in the bottom border with a `Ctrl+O for more` hint when the preview is truncated; expanded reveals the expanded line budget. `tools.style: "marker"` keeps the marker style (`[read] src/index.ts`).

### Tool state machine

Boxed cards follow `queued → running → streaming output → completed | failed | timed out | cancelled`. The assistant's own response follows the tool's terminal state, and the renderers never draw a result frame before it:

- **Queued** (execution not started): closed card, plain `➔ Tool` title, `… Waiting for output…` footer.
- **Running** (execution started, no result yet): closed card, `➔ Tool ◌` title, `◌ Running · 12.4s` footer (live elapsed via a 1s re-render ticker), `No output received yet` body line.
- **Streaming** (partial result): the call box stays open and the result continues it — streamed output under an `Output` divider (no divider while there is nothing to show) with a `◌ Running · 12.4s` footer. The first partial result renders zero lines so the running card stands alone.
- **Completed** (`Exit 0 · 3.21s · ~45 words`), **failed** (`Exit 2 · …` or `Failed`), **timed out** (`✗ Timed out` label, `Terminated after 300.0s` footer), **cancelled** (`✗ Cancelled` label, `Cancelled` footer): `Response` divider, then the status footer.

Empty-output text is state-dependent and never `∅ (no output)`: `No output received yet` while running, `Command completed without producing output` on success, `Command failed without producing output` on failure, `No output was received before the timeout` on timeout, `Command was cancelled without producing output` on cancel. A silent command whose base command is interactive (`pi`, `vim`, `less`, `top`, …) additionally hints `The process may be waiting for terminal input` after ~1s. Elapsed is computed live from execution start and only freezes when the result is terminal, so a completed footer never shows a stale `0.00s`.

### Quiet-tool batching

Consecutive calls of the same quiet tool (`read`, `ls`, `find`) inside one assistant turn collapse into a **single boxless tree panel** instead of one box per call. Grouping is always on. The first call becomes the batch leader and renders the whole panel; later calls render zero lines, so N boxes become one. Batching is per turn and per tool: a non-batchable call (bash/edit/write/…) or the next message closes the batch, so reads separated by an edit never merge, and session history is not re-grouped.

The panel has **no surrounding box and never collapses** — the tree stays open in every state (one box per call is exactly the noise this feature removes). `read` members render a single path row; `ls`/`find` members render their **parsed output** as a file subtree once the result arrives. States:

```text
◌ Read (3) · 1/3
  ├─ ✓ backend/api/.../entities.py
  ├─ ◌ backend/api/.../dto.py
  └─ ◌ backend/api/.../ports.py
```

- **Pending** header `➔ Read (N)`.
- **Running** header `◌ Read (N) · k/N`; tree shows `✓`/`◌` per member.
- **Done** header ` Read (N) · 0.08s` (open-tree glyph; `●` unicode fallback, nerd `\u{F111}`); tree keeps the first 5 members and a `└─ N more` row.
- **Per-file color**: files read successfully render in the primary (accent) color; failed members render in the error color with the error text indented beneath, and the header becomes `✗ Read (N) · 1 failed`. Errors stay open.
- **`read` lone call**: a single read collapses to one inline line — ` Read <path:range> · <elapsed>` (pending `➔ Read <path:range>`, failed `✗ Read <path:range>` with the error beneath). No tree row, no `(1)` count.

#### ls / find output trees

A lone `ls`/`find` renders its parsed output as a **file-anchored boxless tree** (ADR 0006) under a `List:`/`Glob:` summary header; batched (2+) calls render **nested per-member subtrees**. Pending/failed calls without output fall back to the path-row tree above.

```text
Glob: **/*.ts 152 files · in .
src/
  pi/index.ts
  features/tools/index.ts
test/
  unit/output-trees.test.ts
  … 149 more files
```

- Header: `List: <N> files · in <path>` (ls) / `Glob: <pattern> <N> files · in <path>` (find); directories keep their `/` suffix.
- Body: clean indented rows (no `├─/└─` glyphs). `find` path entries group under their directory as a header row with nested entry rows; single-directory `ls` renders flat. The first ~6 entries show, then a `… N more files` row when truncated.
- Batched calls use the `<glyph> Glob/List (N) · <total> files` header with one subtree per member (`├─ <path> · <n> files` → clean indented entries).
- **File-type icons** (Nerd Font mode only): each entry is prefixed with its file icon — ` ` (folder), ` ` (TypeScript), ` ` (Markdown), … — via `theme.n` glyph mode; Unicode/ASCII modes render plain entries.

#### grep output tree

`grep` renders a **file-anchored boxless tree** (ADR 0006): a summary header, then one section per file — the file path as a standalone header, with its matches as `*line: content` rows and adjacent context (from raw `file:line-` output) as ` line:` rows beneath it. A dim `...` gap row marks elided line ranges within a file. `grep` is unbatched so match previews are never hidden.

```text
Grep: createConfig 3 matches · 2 files · in .
src/config.ts
  11: import { createConfig } from
*14: export const createConfig = (opts) => {
...
*42: 	return createConfig(opts);
test/config.test.ts
*8: 	createConfig({ preset: "native" })
```

- Match rows render `*<line>: <content>` (the `*` marks the hit); context rows render ` <line>: <content>` (leading space, dim). The marker distinguishes a hit from context without color alone (TOOL-002).
- Context rows adjacent to a shown match are free of the match budget; the budget counts matches only. A trailing `… N more matches` row collapses long results.

Header requirements: stable human-readable tool label (`formatToolName`); concise primary argument; pending/success/error via `✓`/`✗` (the native `toolPendingBg`/`toolErrorBg`/`toolSuccessBg` container fill is neutralized for boxed rendering); no leaking of hidden/sensitive values beyond native Pi behavior; incomplete streaming arguments render safely; labels and glyphs remain meaningful in ASCII/no-color mode.

#### git / gh semantic views

`git` and `gh` results render as **semantic views** ([ADR 0005](../decisions/0005-git-github-semantic-renderers.md)) when the command is a plain invocation (same gate as bash trees: no pipes, redirects, `;`, `&&`, or command substitution), otherwise the boxed command/response shell renders unchanged. A parser that cannot produce structured records always falls back to the raw shell — approximate rendering is never used. Execution, environment, timeout, and shell behavior are never changed.

Three presentation tiers, matching the bash tree pattern:

| Content | Box | Shape |
| --- | --- | --- |
| `git status`, `add`, `commit`, `push`, `pull`, `fetch`, `restore`, `reset`, `switch`/`checkout`, `diff --stat`, `show --stat`, short `log` | Boxless compact card | summary header + `├─/└─` rows + `… N more` (same family as `List`/`Glob`/`Grep`) |
| `git diff`, `git show`, conflict, CI logs | Box on the content only | `renderBoxedToolResult` + the same adaptive diff component `Edit` uses (`Diff · +N -M` divider, one frame per file) |
| `gh pr list/view/checks/create`, `issue list/view`, `run list/view` | Boxless compact card | summary header + state-colored `├─/└─` rows + `… N more` (same family as the git cards) |
| `gh run view --job=<id>` job log | Box on the content only | `renderBoxedToolResult` + a `Log · <id>` divider (one frame, head/tail budget for long logs) |

```text
Git status · main

  15 modified   1 untracked   0 staged
  +370 −71 across 16 files

  M  extension-src/pi-style/features/editor/index.ts
  M  extension-src/pi-style/features/messages/index.ts
  ?  test/unit/message-thinking-collapse.test.ts
  … 13 more

  d diff   f files   Ctrl+O raw
```

Rules:

- **No double-box.** The Git header lives outside the box; only viewer content (diff, log, error) gets a frame.
- **Branch only when it affects the result** (push/merge/ahead-behind/PR base-head) — the status line owns `⎇ main`.
- **Nonzero exit** keeps the raw stderr; a semantic error view only when the output still parses, otherwise raw fallback.
- **Git vs GitHub** is icon + title (`git` / `PR` / `Issue` / `Checks`), not a separate component system.
- **Action lines** (`d diff`, `c checks`, `Enter details`, `Ctrl+O raw`) are hints only — no keybinding registration.
- **Icons** are gated by Nerd Font mode like `List`/`Glob` file icons.
- **Out of scope:** plumbing (`git cat-file`, `rev-parse`, `for-each-ref`), `gh api`, extensions, and free-form JSON stay raw.

## Tool result body

Default body is compact when settled and supports native expansion. pi-style never suppresses information the user or model needs. States: pending/partial, success, error, cancelled, timed out, truncated, empty. `MetricsLine` can show elapsed time, result count, bytes/lines, or expansion hints when reliably available. The `Response` divider and metrics footer only render in terminal states (see [Tool state machine](#tool-state-machine)).

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
| Write | Path in the header; numbered preview of the written content (cat -n style, `Ctrl+O for more` hint when truncated, expanded reveals more); concise success/error. |
| Edit | Path in the header; adaptive diff (unified/split) with collapsed unchanged context; failed unique-match errors prominent. |
| Find/list/grep | Boxless file-anchored tree (ADR 0006): `ls`/`find` render a `List:`/`Glob: <pattern> <N> files · in <path>` tree (clean rows; `find` paths grouped by directory; nested per call when batched); `grep` renders a `Grep: <pattern> <N> matches · <M> files · in <path>` tree with per-file headers, `*line: content` match rows, and ` line:` context rows. `ls`/`find` batch like reads; `grep` is unbatched so match previews are never hidden. Pending/failed calls without output fall back to the path-row tree; a trailing `… N more` row collapses long lists. |
| Bash | Concise command header, running/exit status (including timeout/cancelled), stdout/stderr distinction where host data supports it. When the command is a plain `ls`/`find`/`grep`/`rg` (no pipes, redirects, `;`, `&&`, or command substitution), its output renders as the same boxless output tree as the native tool — including `ls -l`/`ls -la` long format (parsed into names) and single-file `rg`/`grep` (`line: content` attributed to the file). `git`/`gh` invocations render as semantic views (status/diff/log cards, boxed diffs, PR/issue/run summaries; see [git / gh semantic views](#git--gh-semantic-views)) with the same gate. Unparseable output (e.g. `rg -c`, `rg -l`) falls back to the boxed command/response shell. Execution, environment, timeout, and shell behavior are never changed. |

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

- **MSG-001:** the assistant prefix is optional and width-safe.
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
- **GIT-001:** `git status`/`add`/`commit`/`push`/`pull`/`fetch`/`restore`/`reset`/`switch`/`checkout`/`merge`/`rebase`/`diff --stat`/`show --stat`/short `log` render as a boxless compact card (summary + grouped `├─/└─` rows + `… N more`), not a full boxed shell.
- **GIT-002:** `git diff`/`git show`/conflict render the diff in a content box using the same adaptive diff component as `Edit` (per-file frame, `Diff · +N -M` divider), without a second diff visual language.
- **GIT-003:** a `git`/`gh` command with pipes/redirects/`&&`/`;`/command substitution, an unparseable result, or a plumbing/`gh api` scope renders the raw boxed Bash shell unchanged.
- **GIT-004:** nonzero exit preserves raw stderr; a semantic error view renders only when the output still parses.
- **GH-001:** `gh pr list/view/checks/create` and `issue list/view` render as boxless summary cards (table output or `gh --json`); `gh run list/view` render as boxless run cards, `gh run view --job=<id>` renders the job log in a boxed result (`Log · <id>` divider), and `gh run watch`/`gh api` stay raw.
- **GH-002:** action hints (`d diff`, `c checks`, `Enter details`, `Ctrl+O raw`) are presentation only — no keybinding registration.

## Certified and fallback tests

- assistant multiline prefixes at wide/narrow widths; partial/final transitions;
- thinking-only/tool-only/mixed messages; each special block collapsed/expanded;
- built-in tools with incomplete args, partial updates, success, error, cancellation, truncation;
- diff and syntax-highlight preservation; no-color/ASCII/theme invalidation;
- git/gh parsers (long and `--short` status, `diff --stat`, `log`, `gh --json` records) accept valid output and return `null` on hostile input;
- git/gh render snapshots: compact card, boxed diff reuse, raw fallback, nonzero-exit stderr preservation;
- unsupported target shapes; repeated reload and later-owner replacement; native fallback snapshots.

## Roadmap coverage

- Implemented in: Phase 5; git/gh semantic views: Phase 8.
- Full conflict/config controls: Phase 6.
- Performance/platform/release proof: Phase 7; manual evidence pending.
- Requirement IDs: `MSG-001` through `MSG-006`, `TOOL-001` through `TOOL-007`, `GIT-001` through `GIT-004`, `GH-001` through `GH-002`.
