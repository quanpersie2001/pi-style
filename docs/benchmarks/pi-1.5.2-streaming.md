# Pi 1.5.2 decorated assistant presentation benchmark

## Delivered decision: streaming coalescing only

**Implemented:** removed `AssistantPresentationBuffer`'s finalized native-render cache. `render()` now flushes the pending update and delegates every render. Deleted its WeakMap, eligibility/width/line-count checks, line copying, update invalidation and disposal reset. Kept the call signature, streaming update algorithm, immediate native state synchronization, terminal/internal-update rules, 128-component pending bound, flush/disposal and compatibility ownership gates. No runtime version branch or user configuration was added. Native Markdown caching and the separate finished decoration cache remain unchanged.

This is an internal simplification across supported hosts, **not** a claim of measured speed improvement on older Pi versions. Performance evidence here is **Pi 1.5.2 only**. Owner/coordinator acceptance of the implementation remains required.

### Historical evidence versus current policy

T6's pre-removal experiment compared disabled buffering, the then-production full cache, and a benchmark-only flush-and-call candidate. On Pi 1.5.2, mixed-content bursts improved about 4–5× through update coalescing; the additional finalized cache saved approximately **0.08–1.48 ms across 100 renders**, or roughly **1–15 µs per repeat**, across 79–1290 lines. Cache removal accepts that small traversal regression in exchange for fewer cache/eligibility/invalidation interactions. It does not assert that the old cache avoided no work.

Those are **historical observations**, not current benchmark modes or newly measured cache-on results. The current command uses only **disabled** and actual production **streaming-only**, with no method replacement, historical cache reimplementation or cache policy in production. The old three-mode timing tables have been replaced with fresh implementation measurements below.

## Reproduce

Exact commands, from repository root (benchmark command invoked twice for these tables):

```sh
npx vitest bench --run test/performance/presentation-buffer.bench.ts
npx vitest run test/performance/presentation-buffer-native.test.ts test/performance/presentation-buffer.test.ts
npx biome check extension-src/pi-style/features/messages/presentation-buffer.ts test/performance/presentation-buffer.test.ts test/performance/presentation-buffer-native.test.ts test/performance/presentation-buffer.bench.ts
npm run typecheck
```

The bench asserts installed Pi **1.5.2**, prints environment, exact work counts/parity and nine-sample min/median/max per phase as JSON. Its `.bench.ts` is outside normal test discovery; no wall-time CI assertions. Vitest's additional whole-workload summaries include probe installation/reset/construction and are **not** the phase measurements used for the decision.

## Recorded environment

- 2026-11-12, local final runs approximately 18:10–18:11 (+07); Apple M1 Pro, arm64.
- macOS 26.5.2 (25F84), Darwin 25.5.0; Node v24.13.0, Vitest 4.1.10.
- Installed `@earendil-works/pi-{coding-agent,agent-core,ai,tui}` 1.5.2.
- HEAD `4ab9c2c9596e6f65344d76da1d9ba1b842c247eb`, with existing uncommitted compatibility/user work. T8 changes only the production presentation buffer, its three scoped performance files and this report.
- Native `dist/modes/interactive/components/assistant-message.js` SHA-256: `d4820673a831e7d0470b29e09d3dadedbeaaac4c149893ef58dcae8e5a11d661`.
- Native `dist/bundle/index.js` SHA-256: `90a5b99054119815bb73e9b95210e4b3e45ddc0895fe16458cc3d808ea31d706`.

## Harness and workloads

Uses actual `dist/index.js` and `dist/bundle/index.js` assistant components, **installed production compatibility wrappers**, `decorateMessageUpdate`, `decorateMessageRender`, and production buffering. As in the existing identity-artifacts harness, temporarily redirects only the two assistant probe targets to the current artifact's prototype, restoring them afterward. This is necessary: patching the modular prototype alone does not exercise bundled classes. Installation plus actual content-container clear/render counts are asserted, so a missed bundle patch cannot silently pass.

Both modes enable assistant prefix, hidden-thinking collapse and thought summaries. Native dark theme/Markdown/code highlighting remain real; the injected thought-label `fg` function is identity (only summary-label color is omitted). `Date.now()` is frozen at 1000 for deterministic thought durations; real `performance.now()` measures time. Decorator/thought state resets before each run. Imports, fixture allocation, themes, wrapper installation, resets, construction and counter installation are outside phase timing. No filesystem/network/terminal operations occur in measured phases.

Each workload has **24 frames**, **1 or 8 updates/frame**, explicit `updateContent(final, false)`, then **100 renders at width 120**. Preallocated updates are identical between modes:

| Workload | Content | Final lines (1 / 8 updates) |
| --- | --- | ---: |
| mixed | Eleven thinking/text cycles plus a final thinking run, interleaved Markdown/code answers; final frame appends a terminal `read` tool call | 79 / 79 |
| many-blocks | 48 separate Markdown text blocks, each with a fenced TypeScript block, plus cumulatively growing tail | 387 / 394 |
| large-finished | 160 such blocks plus growing tail; substantial native render traversal | 1283 / 1290 |

Thinking/text content is cumulative; each open thought run is observed at a rendered frame before closure. Streaming messages have **no stop reason**. Only finalization sets `stop` or `toolUse`; tools are terminal in their assistant message and rendered separately by Pi, not synthesized as assistant tool UI. No manual `isStreaming=false` mutation.

Streaming timing includes **updates plus frame rendering**, including deferred native rebuilds inside render. Separate update/render timers expose moved work. Finalization is timed separately from the 100-render finished phase. Two warmup pairs precede nine measured pairs, alternating which mode runs first. Every measured run compares exact output against the disabled baseline outside phase timing, retaining output arrays equally. Untimed probes cover width 80, caller mutation, padding and finalized content replacement. Native correctness tests also cover expanded thinking and visibility setters. Whole ANSI/OSC-bearing line arrays are compared, not stripped snapshots.

## Deterministic work and coverage

Identical for both artifacts and all three workloads:

| Current mode | Streaming rebuilds (1 / 8 updates) | Streaming native renders | Finalization rebuilds | Finished native renders |
| --- | ---: | ---: | ---: | ---: |
| disabled | 24 / 192 | 24 | 1 | 100 |
| streaming-only | 24 / 24 | 24 | 1 | 100 |

**Exact output parity passed for every frame, every finalized render and all probes in both invocations.** Native tests independently assert **32 → 8** streaming rebuilds and **20 → 20** finished native renders, on both artifacts and hidden/expanded thoughts; their mixed final message exceeds 400 lines. The prior **20 → 1** optimization expectation was removed, not freshness coverage.

Timing-free tests retain completion/error/abort/length, synchronous internal updates, latest delta, disabled/unauthorized behavior, throwing-rebuild cleanup, disposal flush, changed width, caller mutation, padding/visibility setters, replacement and retained foreign-wrapper conflict coverage. The new shared-buffer ownership test fills **128 distinct pending components** without rebuilding, replaces each pending closure with its latest update, verifies components 129/130 evict the oldest two exactly once, verifies rendering an evicted owner does not replay its closure, then verifies disposal flushes the remaining 128 in order exactly once and releases all pending work. Post-disposal updates delegate immediately.

## Current-policy measurements

All values are milliseconds **per workload phase**, not per frame/render. D = disabled, S = current production streaming-only. Entries are nine-sample medians. Compare modes within a row; growing-tail sizes differ between one/eight-update rows. Independent subphase medians need not sum to the total median.

### Invocation 1

| Host | Workload | Updates/frame | Streaming D / S | 100 finished renders D / S |
| --- | --- | ---: | ---: | ---: |
| Modular | mixed | 1 | 2.014 / 2.010 | 0.288 / 0.297 |
| Modular | mixed | 8 | 8.485 / 1.980 | 0.341 / 0.298 |
| Modular | many-blocks | 1 | 8.939 / 9.190 | 0.909 / 0.947 |
| Modular | many-blocks | 8 | 11.434 / 9.601 | 0.715 / 0.746 |
| Modular | large-finished | 1 | 36.130 / 35.549 | 2.461 / 2.654 |
| Modular | large-finished | 8 | 39.611 / 38.466 | 2.904 / 2.776 |
| Bundled | mixed | 1 | 1.980 / 1.830 | 0.276 / 0.286 |
| Bundled | mixed | 8 | 8.142 / 1.962 | 0.278 / 0.282 |
| Bundled | many-blocks | 1 | 9.205 / 10.200 | 0.947 / 0.953 |
| Bundled | many-blocks | 8 | 10.656 / 9.999 | 0.776 / 0.750 |
| Bundled | large-finished | 1 | 37.199 / 37.291 | 2.598 / 2.550 |
| Bundled | large-finished | 8 | 40.150 / 38.118 | 2.732 / 2.787 |

### Invocation 2

| Host | Workload | Updates/frame | Streaming D / S | 100 finished renders D / S |
| --- | --- | ---: | ---: | ---: |
| Modular | mixed | 1 | 2.287 / 2.012 | 0.328 / 0.307 |
| Modular | mixed | 8 | 8.565 / 2.028 | 0.337 / 0.319 |
| Modular | many-blocks | 1 | 8.822 / 8.891 | 0.931 / 0.936 |
| Modular | many-blocks | 8 | 10.535 / 9.423 | 0.727 / 0.708 |
| Modular | large-finished | 1 | 35.066 / 36.419 | 2.460 / 2.441 |
| Modular | large-finished | 8 | 37.956 / 35.839 | 2.661 / 2.663 |
| Bundled | mixed | 1 | 1.802 / 1.823 | 0.271 / 0.280 |
| Bundled | mixed | 8 | 7.566 / 1.872 | 0.273 / 0.276 |
| Bundled | many-blocks | 1 | 8.770 / 11.022 | 0.928 / 0.917 |
| Bundled | many-blocks | 8 | 10.558 / 9.636 | 0.719 / 0.729 |
| Bundled | large-finished | 1 | 36.883 / 36.185 | 2.545 / 2.635 |
| Bundled | large-finished | 8 | 39.480 / 36.827 | 2.677 / 2.757 |

### Update overhead versus rendering (invocation 2)

The streaming-only render phase includes the deferred update: rebuild cost is not hidden by moving it across a timer boundary.

| Host | Workload | Updates/frame | Updates D / S | Frame renders D / S |
| --- | --- | ---: | ---: | ---: |
| Modular | mixed | 1 | 0.566 / 0.021 | 1.675 / 1.985 |
| Modular | mixed | 8 | 7.022 / 0.077 | 1.658 / 1.935 |
| Modular | many-blocks | 1 | 0.118 / 0.027 | 8.684 / 8.860 |
| Modular | many-blocks | 8 | 0.723 / 0.120 | 9.296 / 9.291 |
| Modular | large-finished | 1 | 0.359 / 0.067 | 34.658 / 36.350 |
| Modular | large-finished | 8 | 2.199 / 0.140 | 34.926 / 35.707 |
| Bundled | mixed | 1 | 0.470 / 0.019 | 1.335 / 1.802 |
| Bundled | mixed | 8 | 6.188 / 0.072 | 1.375 / 1.796 |
| Bundled | many-blocks | 1 | 0.117 / 0.032 | 8.653 / 10.986 |
| Bundled | many-blocks | 8 | 0.780 / 0.120 | 9.722 / 9.516 |
| Bundled | large-finished | 1 | 0.414 / 0.067 | 36.338 / 36.118 |
| Bundled | large-finished | 8 | 2.440 / 0.194 | 34.892 / 36.695 |

### Representative variability (invocation 2)

Min / median / max, nine samples. Full distributions for all phases/rows are printed by the command; these are descriptive samples, not confidence intervals.

| Host | Workload (8 updates/frame) | Mode | Streaming | 100 finished renders |
| --- | --- | --- | ---: | ---: |
| Modular | mixed | disabled | 7.843 / 8.565 / 12.241 | 0.255 / 0.337 / 1.990 |
| Modular | mixed | streaming-only | 1.751 / 2.028 / 3.010 | 0.252 / 0.319 / 0.396 |
| Modular | large-finished | disabled | 36.335 / 37.956 / 44.792 | 2.577 / 2.661 / 4.673 |
| Modular | large-finished | streaming-only | 34.032 / 35.839 / 41.139 | 2.525 / 2.663 / 9.737 |
| Bundled | mixed | disabled | 7.203 / 7.566 / 9.661 | 0.262 / 0.273 / 0.306 |
| Bundled | mixed | streaming-only | 1.730 / 1.872 / 2.114 | 0.264 / 0.276 / 0.291 |
| Bundled | large-finished | disabled | 35.065 / 39.480 / 40.417 | 2.572 / 2.677 / 2.833 |
| Bundled | large-finished | streaming-only | 34.718 / 36.827 / 42.004 | 2.561 / 2.757 / 6.076 |

## Interpretation and limitations

- Actual current production still improves mixed eight-update streaming workloads about **4×** on both artifacts, avoiding **168 rebuilds per 24 frames**. Many-block update overhead falls too, but rendering dominates and total gains are smaller/noisier. One-update cases show no consistent improvement. Native Markdown caching does not eliminate thinking/grouping/update-decoration work.
- Both current modes traverse native content 100 times when finished, so their repeat-render times track each other rather than showing the old full-cache savings. Historical removal costs above are an accepted tradeoff, not a current speed claim. The separate finished decoration cache still operates in both modes.
- Laptop runs are not CPU-pinned or process-isolated; JIT, GC, allocations, fixed modular-before-bundled order and concurrent work affect results. Clock mocking adds observation overhead. No forced GC, statistical significance claim or flaky timing threshold.
- Simulated synchronous frames, not recorded TUI scheduling, terminal paint/latency, scrollback, memory/heap profiling or large histories. Repeated finished renders are a stress scenario; real frequency is not established. No images, custom transformers or theme transitions measured.
- Timing fixtures use collapsed thoughts; timing-free parity also covers expanded thoughts. Open/close transitions entirely between renders, real elapsed thought timing and cross-message merged-turn summaries are **not certified by this experiment**. Freezing time removes nondeterminism but cannot prove skipped-observation timing equivalence. Coalescing eligibility and behavior were deliberately not changed.
- Only Pi **1.5.2** performance is measured. Production simplification is universal, without version gates; older-host speed/memory effects remain unmeasured. No compatibility re-audit is claimed.

## Verification

- **passed:** two explicit current-policy benchmark invocations, **24 cases each**, exact work/output assertions on both artifacts, three workloads and one/eight-update bursts.
- **passed:** focused timing-free native/buffer tests, **2 files / 18 tests**; targeted Biome on all four scoped TypeScript files; production `tsc --noEmit` (its config excludes tests/benchmarks).
- **not_run:** full test suite, repository-wide lint/build, real-terminal/memory/older-host profiling.
- **remaining:** explicit owner/coordinator acceptance. Production cache removal is delivered; no migration/probe/coordinator or unrelated user changes were edited by T8.
