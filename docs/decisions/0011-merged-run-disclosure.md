# ADR 0011 — One merged agent-run disclosure

- **Status:** Accepted
- **Date:** 2026-10-06
- **Scope:** Supersedes ADR 0007's default row/exemption rules while `messages.mergedTurnSummary` is enabled. Native click-state authority applies to disclosures in both merged and legacy modes.

## Problem and investigation

A completed request could show both `➔ Read …` and `◈ Thought …`, expand only some members, and fail to close them again. The registries and native components had several independent failure modes:

| Cause | Location / prior behavior | Correction |
| --- | --- | --- |
| Summary scope differed from click scope | `messages/thought-summary.ts`: the header pooled all groups but `toggleThoughtGroup` touched only its first contiguous segment. | Store the whole run's groups/messages and disclose all thinking members together. |
| Run-open was not renderer-expanded | `tools/boxed/index.ts`: `forcedOpen` bypassed the turn gate, but quiet batch/chunk renderers still received `expanded: false`. | Pass effective expansion into both call and result renderers; every member renders standalone output when open. |
| Two competing expansion states | Run `forcedOpen` and native per-component flags diverged after leaf clicks or Ctrl+O. | Capture the public native `setExpanded()` control and latest render-context flag; native flags are authoritative. Aggregate clicks set one desired state for every member. |
| Re-close exemptions | Error and mutating blocks deliberately bypassed legacy collapse. | Merged mode covers all finalized members; failure/diff totals remain visible on the single header. Legacy opt-out retains exemptions. |
| Missing/duplicate attribution | Historical groups omitted thinking-less rounds; native Ctrl+T refreshes of old messages were mistaken for new-run membership; live attribution could borrow the previous run; one message in several groups was counted repeatedly. | Attribute within the user-request boundary (bindings/events, not UI-refresh time), deduplicate identities, and exclude unapplied error diffs. |
| Stale mappings and instances | Weak message-to-turn sets survived rebuilds; older retained assistant components could steal replacement bindings or vote with old open overrides. | Reset weak mappings/bridge records and prefer the newest observed native component for each thinking member. |
| Wrong branch | `getEntries()` contains the append-only log, including abandoned branches. | Startup/tree rebuilds consume `getBranch()`; prune non-branch tool controls and refresh retained components. |
| Hidden timer lifecycle skipped | Collapsed results returned before per-tool cleanup, leaving an elapsed ticker and unfrozen clock. | Stop the ticker and freeze the terminal timestamp before the collapse gate. No elapsed appears on the merged row. |

## Decision

Default ended-run presentation is exactly one duration-free row:

```text
◈ Thought 11 times · Called 33 tools · Edit +108 -43 · 4 failures
```

- The first thinking group's leader owns the row, even across visible assistant commentary.
- All assistant messages of the run contribute stats, including tools before its first thinking block and thinking-less continuations. Each message contributes once.
- A tools-only run uses the same row at its first tool, with `Thought 0 times`; a thought-only run uses `Called 0 tools`. All-error/all-mutating runs still have a reachable disclosure. ASCII mode uses `>`.
- No second `➔ Read …` aggregate appears, including when opened. Individual expanded tool headers may still use `➔`.
- Closing hides every finalized tool component with zero height, including native spacer/image containers. Opening sets every member's native expansion flag and reveals every member, bypassing quiet batching/chunk-member hiding.
- Thinking and tools receive the same desired click state. An already-open leaf or global tool expansion makes the next aggregate click close the whole run rather than independently toggling two registries.
- Ctrl+O remains Pi's global tools toggle; Ctrl+T remains its global thinking toggle. Neither a run override nor an obsolete component can defeat a native close.
- Incomplete/partial/running tools remain visible. Visible assistant prose is never removed.
- The bridge remains import-free; no sibling-feature dependency, additional Pi-core patch identity, tool re-registration, or session-content mutation is introduced.

## Alternatives

- **Hide the extra arrow only:** rejected; leaves inconsistent click state, missing tools and stale counts.
- **Only flip `forcedOpen`:** rejected; nested batch renderers and native flags disagree.
- **Patch the global keyboard handler:** rejected; unnecessary, session-wide side effects, and another core identity to certify.
- **Remove every output limit:** rejected; disclosure must reveal every tool, not perform unbounded rendering. Per-tool `maxExpandedLines` and explicit truncation notices still apply.

## Consequences

`messages.mergedTurnSummary: false` explicitly restores legacy ADR 0007 formatting and error/mutating exemptions. `tools.collapseMutatingTools` controls that legacy mode, not the unified merged disclosure. `tools.collapseAfterTurn: false` still disables automatic tool hiding.

A native tool setter may rebuild the component before the captured invalidator requests its repaint; work is bounded per member and no render-time I/O is added. Callback maps retain the latest native component per call, reset on session boundaries, and are pruned on branch changes.

## Validation

- `test/unit/merged-summary-toggle-regressions.test.ts`: actual patched `AssistantMessageComponent` / `ToolExecutionComponent`; repeated whole-run open/close, text-separated groups, quiet batches/chunks, mutations, failures, tools-only/all-error fallback, native per-leaf/global setters, duplicate stats, historical attribution, repeated rebuilds and component replacement, hidden ticker cleanup.
- `test/integration/summary-active-branch.test.ts`: actual in-memory branching `SessionManager` through extension startup and `session_tree`.
- Legacy render tests explicitly select `mergedTurnSummary: false` to retain opt-out coverage.
- Full release gates (`npm run check`) remain required. Real fullscreen mouse/keyboard and terminal-resize smoke remains a manual check in addition to native component tests.

## Update — interleaved cumulative labels

**2026-10-07.** The "exactly one row" layout detached the summary from the commentary that produced it: a long multi-round request rendered one aggregate at the very top of the turn with every text segment stacked below, which read as context-free noise. The disclosure mechanics of this ADR (whole-run click, native authority, zero-height closed members, complete attribution) are unchanged; only the label layout is revised:

- Every commentary segment keeps its own row right before its text, carrying the **cumulative** totals through that segment (`◈ Thought N times · Called M tools · …`); the last row equals the run totals, so nothing from the single-row layout is lost.
- Contiguous `thinking → tool-only → thinking` rounds still collapse into one row; the fragmentation problem this ADR originally solved stays solved — only rows that have a following text segment are added.
- Clicking any row still toggles the entire run (thinking + tools together); tools-only runs keep the single `Thought 0 times` row at their first tool.
- The `Called` part is omitted entirely when there are no tool calls: thought-only runs and tool-less prefixes render plain `◈ Thought N times` instead of `Called 0 tools` noise.

This supersedes the "exactly one duration-free row" decision line and the "first thinking group's leader owns the row" bullet above.

## Related decisions

- [0007 — Turn tool summaries](0007-turn-tool-summaries.md): legacy mode and session-content derivation.
- [0010 — Chunk-merged reads](0010-chunk-merged-reads.md): quiet live previews; full expansion must expose each chunk.
- [0002 — Native Pi layout ownership](0002-native-pi-layout-ownership.md): native lifecycle, component layout and keyboard ownership remain unchanged.
