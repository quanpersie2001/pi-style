# Messages and tool presentation

> Status: **Planned**

## Scope

This contract covers:

- user and assistant message prefixes;
- thinking and tool-only assistant presentation;
- compaction, skill, branch-summary, and custom message blocks;
- tool call headers, results, state, expansion, and metrics.

These surfaces carry a higher compatibility burden than widgets and editors. They are implemented after the public-API foundation and must always preserve native fallback.

## Shared visual primitives

Feature-local implementations should share pure primitives:

- `Badge` — short state/tool label;
- `Prefix` — message-role marker with continuation indent;
- `CompactBox` — optional border/background/padding shell;
- `MetricsLine` — elapsed time, counts, truncation, or key hint;
- `StateMark` — pending/success/error/partial indicators;
- ANSI-safe line wrapping/truncation.

Primitives consume semantic theme functions; they do not import a global theme.

## User messages

Default compact treatment:

```text
❯ user prompt text
  continuation aligned here
```

Rules:

- prefix is optional by configuration/preset;
- multiline continuation aligns after the prefix/gap;
- native user-message background/text tokens remain the base;
- long content wraps; it is not truncated;
- images/attachments preserve native rendering.

## Assistant messages

Default treatment uses a restrained assistant prefix only when it improves role separation. It must handle:

- normal text streaming;
- thinking-only updates;
- assistant messages containing only tool calls;
- mixed text and tool calls;
- aborted/error states;
- final render cache reuse without stale partial content.

Thinking text uses Pi's thinking token and does not visually compete with final assistant text.

## Special message blocks

Planned blocks:

- compaction summaries;
- skill invocation/status;
- branch summaries;
- extension custom messages when a native/custom renderer does not already own them.

Each block has:

- semantic label;
- compact default body;
- optional expanded detail;
- width-safe border/background;
- native fallback on unsupported component shape.

pi-style does not alter the message content sent to the model. This is presentation only.

## Tool call header

Compact shape:

```text
[read] src/index.ts
[edit] 2 changes · src/config.ts
[bash] npm test
```

Header requirements:

- stable human-readable tool label;
- concise primary argument;
- pending/success/error state;
- no leaking of hidden/sensitive values beyond native Pi behavior;
- incomplete streaming arguments render safely;
- labels and glyphs remain meaningful in ASCII/no-color mode.

## Tool result body

Default body is compact when settled and supports native expansion behavior. pi-style must not suppress information needed by the user or model.

States:

- pending/partial;
- success;
- error;
- cancelled;
- truncated;
- empty result.

`MetricsLine` can show elapsed time, result count, bytes/lines, or expansion hints when reliably available.

## Tool-specific presentation

### Read

- badge and normalized path;
- optional line range;
- content through native syntax-highlighted result when possible;
- truncation notice preserved.

### Write

- path and created/overwritten state;
- concise success/error result;
- no duplicate full file content unless native result provides it.

### Edit

- path and number of replacements;
- native diff semantics/colors preserved;
- failed unique-match errors prominent.

### Find/list/grep

- query/path summary;
- result count/truncation status;
- compact file/result rows;
- expanded behavior preserves full native details.

### Bash

- concise command header;
- running/exit status;
- stdout/stderr distinction only where host data supports it;
- long output uses native truncation/expansion rules;
- pi-style does not change command execution, environment, timeout, or shell behavior.

## Expansion and collapse

- Use Pi's configured tool expansion state where available.
- Default collapsed line count is configurable.
- Errors may show more detail by default than success results.
- Custom key hints use Pi keybinding helpers rather than hardcoded keys.
- No independent scrollable fixed tool box is introduced in v1.

## Streaming correctness

Message/tool renderers must distinguish partial from finalized state. Cached finalized output cannot replace newer partial output or vice versa. `context.lastComponent` may be reused only when component state is explicitly updated and invalidated.

## Output safety

- preserve built-in truncation notices;
- never inject untrusted output into raw terminal controls without sanitization consistent with Pi;
- lines remain ANSI-contained;
- background fills do not bleed;
- no tool result shape is changed merely for presentation.

## Integration strategy

Preference order:

1. public custom renderer/registration API;
2. renderer-only override preserving built-in execution and result shapes;
3. isolated, version/capability-gated component patch;
4. native fallback.

Re-registering built-in tools for styling is not the default because it risks execution/prompt semantics and conflicts with other extensions.

## Conflict behavior

If another extension already owns a message/tool renderer:

- compose only through a supported public mechanism;
- otherwise preserve the existing owner by default;
- allow explicit user preference only with diagnostics;
- restore only the pi-style-installed identity on shutdown.

## Requirements — messages

- **MSG-001:** user/assistant prefixes are optional and width-safe.
- **MSG-002:** streaming, thinking-only, tool-only, and mixed messages render correctly.
- **MSG-003:** special blocks alter presentation, not model/session content.
- **MSG-004:** unsupported shapes use native rendering.
- **MSG-005:** message patches are idempotent and reversible.
- **MSG-006:** images and native rich content remain usable.

## Requirements — tools

- **TOOL-001:** styling never changes built-in execution semantics.
- **TOOL-002:** pending/partial/success/error/cancelled/truncated states are distinct without color alone.
- **TOOL-003:** built-in expansion and truncation behavior is preserved.
- **TOOL-004:** tool-specific headers remain concise and sanitize incomplete arguments.
- **TOOL-005:** renderer conflict/failure falls back to the existing/native renderer.
- **TOOL-006:** patches/overrides are idempotent, reversible, and identity-safe.
- **TOOL-007:** renderers perform no filesystem/process work.

## Planned tests

- user/assistant multiline prefixes and wide/narrow widths;
- assistant partial/final transitions;
- thinking-only/tool-only/mixed messages;
- each special block collapsed/expanded;
- built-in tools with incomplete args, partial updates, success, error, cancellation, truncation;
- diff and syntax-highlight preservation;
- no-color/ASCII/theme invalidation;
- unsupported target shapes;
- repeated reload and later-owner replacement;
- native fallback snapshots.

## Roadmap coverage

- Implemented in: Phase 5.
- Full conflict/config controls: Phase 6.
- Performance/platform/release proof: Phase 7.
- Requirement IDs: `MSG-001` through `MSG-006`, `TOOL-001` through `TOOL-007`.
