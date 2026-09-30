# ADR 0010: Chunk-merged read lines

- Status: **Accepted**
- Date: 2026-09-11

## Context

Pi's built-in `read` tool truncates at 2000 lines or 50KB per call and tells the model to "continue with offset until complete". Reading one large file therefore becomes a sequence of continuation reads — **one tool call per assistant message** (`read(path, 525)`, then `read(path, 705)`, …), because the model must see each truncation notice before choosing the next offset.

pi-style's quiet-tool batching (`batch.ts`) only groups calls dispatched back-to-back **within one assistant message**; every `message_start` closes the active batch. Sequential chunk reads each land in their own message, so each renders as its own lone line: reading a 2600-line file in 10 chunks stacks 10 `➔ Read chat.ts:525-704`-style lines in the live feed — ten lines describing one logical operation ("read this file").

The turn summary (ADR 0007) collapses them only after the run ends; during the run — exactly when the user watches progress — the noise is worst. The summary also miscounts: 10 chunks of one file render as `Read 10 files`.

## Decision

Merge sequential same-file read chunks into **one expanding inline line per file** (`tools.mergeChunkedReads`, default on):

```
➔ Read chat.ts:525-2629 · 10 chunks · 1.20s
```

- **Merge key** = the normalized display path; **contiguity** = each chunk starts at the previous chunk's end + 1. The previous end is the requested `offset + limit − 1` when a limit was passed, refined by the result's actual output line count (`details.truncation.outputLines`, else counted text lines of a complete read) once it settles — so byte-capped and offset-only reads merge exactly.
- **Across message boundaries**: a per-path candidate registry (last pure, contiguous chunk batch) survives batch closes and assistant message boundaries within the agent run; continuation chunks join their file's batch even when it was closed. A non-read tool between chunks does not break the sequence. `agent_start` (new run) and session resets clear candidates.
- **Rendering**: the batch leader renders the single line — accent path when settled, `◌` + `done/total` progress while running, `✗` + failure count + error text when a chunk failed. Later chunks' entries render zero lines (the existing batch-member contract; Pi's `hideBatchMember` hides them).
- **Deliberately NOT merged**: non-contiguous same-file reads (deliberate re-reads of an earlier region), mixed-path batches (parallel multi-file reads keep the standard `Read (N)` tree panel), and reads of a different file between chunks (each file keeps its own line).
- **Turn summary counts files, not chunks**: read members dedupe by normalized call path, so the collapsed line reads `Read 2 files` for two files read in any number of chunks.
- **Live/restore parity**: both paths replay through the same registry. On restore (no `message_start` events fire), consecutive chunk reads join the still-open active batch and the structural pure+contiguous test selects the merged rendering — the same output as the live candidate path. (Pre-existing nuance: a read of a *different* file between two chunks of one file batches differently on restore than live; unchanged by this ADR and rare.)

## Alternatives considered

- **Do nothing** — the turn summary already collapses everything after the run. Rejected: the live feed during long reads is the actual pain point, and `Read 10 files` miscounts one file.
- **Extend the batch join across messages unconditionally** (drop the `message_start` close for reads) — would also merge unrelated sequential reads (file A, then file B, both lone). The path+contiguity key is the discriminator; only true continuation sequences merge.
- **Merge only in the summary layer** — fixes the count but not the live feed.

## Consequences and trade-offs

- The merged line shows the **union range** (`525-2629`), hiding per-chunk boundaries; the chunk count suffix keeps the piecewise nature visible. Users who want per-chunk detail can turn the leaf off (`tools.mergeChunkedReads: false`) — existing batches render unchanged.
- Elapsed is wall-clock across the whole sequence (including the model's thinking time between chunks), consistent with batch-panel semantics.
- A failed chunk keeps the line visible with its error (errors never collapse), matching batch and turn-summary error policy.
- `registerBatchResult` refines chunk ends from result data; a refinement that arrives after a later chunk already joined via the requested end can make the pair non-contiguous, falling back to the standard panel — self-correcting, never wrong.

## Validation implications

- Unit: chunk-merge lifecycle (merge across `closeActiveBatch`, refined ends, offset-only continuation, non-contiguous re-read, interleave, mixed batch, error chunk, run reset, config off) in `test/unit/batch-tools.test.ts`; unique-path summary counting in `test/unit/turn-summary.test.ts`.
- The render cache signature includes the leaf so a session-command toggle re-renders settled batches.
