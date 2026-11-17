# Image and tool rendering performance audit (Pi 1.5.2)

## Delivered changes

- Stack prompt previews: **one native image anchor per line**. Pi 1.5.2's fullscreen upload/placement and crop helpers recognize only the first image in a combined grid line. The old grid left later images' complete payloads in placement-only redraws. No TUI/protocol monkey patch is added.
- Validate and prepare prompt previews asynchronously with maximum 960px backing. Original attachments/session payloads remain unchanged; pending/failed preparation shows metadata, never the full original. Every source, including small PNGs, must pass worker validation before native image admission.
- Preserve ready PNG `Image` encoding caches across `CustomEntryComponent.invalidate()` and rebuilds. Invalidate for changed protocol/cell geometry; native width caching handles resize and Ctrl+O. Labels/fallback colors still refresh; OFF hides preview content while retaining the host spacer for later hydration. Native image components receive only bounded PNGs; labels/metadata stay theme-current.
- Encode raw clipboard artifacts from a zero-copy buffer view, respecting byte offset/length. Base64 allocation remains necessary; attachments/model input are not downsampled or changed.
- Memoize long tool cache-key fingerprints in a bounded, four-entry **per-tool state** cache. Keep the old key format and all theme/config/expanded/error/elapsed inputs; changed text on the same result object is still detected. Memoize finalized edit diff statistics too.
- Index batch members with their batch by call ID instead of scanning the member array on each call/result/final-output lookup. Reset clears the same registry; chunk merges register the actual member.
- Standardize decorative tool header markers to `●` (`>` in ASCII mode), with `theme.glyphs.toolHeader` override. Progress, error, disclosure and team-state glyphs remain distinct.
- Share the status widgets' full layout through a bounded two-entry per-installation cache. Preserve unequal widths, live footer/status changes, snapshot/config invalidation and theme/ownership lifecycle. Same-width widget pairs read the model segment **3 instead of 6 times**; 100 unchanged pairs add zero reads.
- Clear staged image-preview data and deferred flush timers on session start/shutdown and actual tree-leaf replacement. Generation guards prevent obsolete callbacks from clearing a replacement session's timer; same-leaf events and assistant-start fallback remain intact.

## Evidence

Local macOS 26.5.2 / arm64, Node 24.13.0, Pi packages 1.5.2. Baseline source: `84fe9f5f969b8a90a3a10d88c180ae98689c4984`; updated working tree from this audit. Timings below are illustrative single local workload samples, **not terminal latency**, confidence intervals or CI thresholds. Count reductions are the stronger evidence.

### Prompt image CPU/cache work

Fixtures have valid PNG dimension headers and padded payloads of 1 or 8 MiB. They exercise encoding and layout, **not PNG decoding by a terminal**. The probe counts real native `Image.render()` cache misses and source base64 characters re-encoded; actual native `CustomEntryComponent` invalidation is exercised separately.

| Workload | Before | After |
| --- | ---: | ---: |
| One 8 MiB image, 100 invalidate/render passes: encoding misses | 100 | 1 |
| Same: source base64 characters re-encoded | 1,118,481,200 | 11,184,812 |
| Same: sampled total CPU time | 252.8 ms | 7.9 ms |
| Real CustomEntry host, one 8 MiB image, 30 invalidate/render cycles: misses | 30 | 1 |
| Portrait/landscape 8 MiB pair, 30 cycles: misses | 120 | 2 |
| Raw 20 MiB clipboard artifact: extra full binary copies | 1 | 0 |

The old portrait/landscape grid also rendered candidates before deciding to stack, encoding twice at different widths. Stacking removes that speculative work. Unchanged ordinary renders were already memoized; the improvement targets invalidation/rebuild and multi-image cases, not every frame.

### Native fullscreen transfer boundary

Real native `TuiAltScreen.prepareKittyScreen()` with distinct `Image` IDs; each source payload is 1 MiB. Initial upload occurs first. Subsequent placement preparation is repeated 30 times with stable source lines.

| Layout | Images | Characters retained across 30 placement outputs |
| --- | ---: | ---: |
| Old combined grid row | 2 | 42,037,950 |
| Separate stacked anchors | 2 | 2,280 |
| Old combined grid row | 3 | 84,074,760 |
| Separate stacked anchors | 3 | 3,420 |

Counts exclude labels/spacing and include placement commands. These are prepared output sizes, not a claim that every streaming frame redraws every image. Native fullscreen only prepares placements on image/covered-cell redraws. The regression test uses actual production preview lines, also across invalidation; no later image may retain its payload.

### Other render hot paths

- Finalized collapsed Bash dispatch returned the **same cached component**, yet previously re-hashed its full output. A 10,000,000-character fixture measured about **21.4 ms/dispatch before** versus **0.26 ms after**; 1,000,000 characters measured **3.15 ms before** versus **0.03 ms after**. This is warm renderer dispatch, not terminal drawing. First-use hashing and any unrelated text traversal remain.
- Re-registering all 5,000 existing read members previously read **12,502,500 member IDs**; the indexed version reads **zero member IDs** for lookup. A separate uninstrumented sweep measured **198.7 ms before** versus **0.37 ms after**. This is a stress workload, not a typical batch-size claim. Rendering/status aggregation/chunk-contiguity work can still scan members.

## Regression commands

```sh
npx vitest run test/unit/image-preview.test.ts test/unit/image-input.test.ts \
  test/performance/image-native-placement.test.ts \
  test/performance/tool-fingerprint-cache.test.ts test/performance/batch-lookup.test.ts \
  test/performance/status-rendering-bounds.test.ts test/unit/status-layout.test.ts \
  test/integration/image-preview-lifecycle.test.ts
npm run check
```

The tests enforce native payload reuse, distinct stacked image anchors, exact protocol/cell changes, mutable/replaced themes, config OFF/ON, Ctrl+O/resize, buffer subviews, bounded fingerprints, changed text/diff freshness, and indexed batch cleanup. Tests assert work/freshness, not wall-clock thresholds. Private native placement access exists **only in the regression test**; production remains on public `Image`/entry APIs.

Exploratory scripts/logs from this run were `/tmp/pi-style-image-probe.pkd2ER`, `/tmp/pi-style-native-image`, and `/tmp/pi-style-audit.rLN0jq`. These are temporary diagnostic artifacts, not committed benchmark infrastructure. The automated commands above reproduce the current correctness/work-count contracts, not historical timing samples.

## Verification outcome

- Latest `npm run check`: **passed**, including typecheck, lint, dependency boundaries, **81 files / 1,302 tests**, build and package smoke. Earlier waves passed 75 files / 1,234 tests and 77 files / 1,249 tests; thumbnail preparation adds codec/resource/repaint/lifecycle coverage.
- `git diff --check`: **passed**.
- Independent read-only reviews: first-wave rendering/icon fixes and second-wave status/preview-lifecycle fixes were mergeable. Thumbnail review identified an unsafe unvalidated small-PNG path and OFF-time transcript admission loss; both were corrected with targeted regressions and full-suite verification. Both independent thumbnail re-reviews found those issues resolved and returned **mergeable** within their complementary resource-safety and lifecycle/package scopes. Production/test checksums matched the reviewed snapshot; no production code changed afterward.
- Real-terminal visual/latency and long-session heap measurements: **not run**.

## Remaining bottlenecks and priorities

1. **Regular-mode native redraws.** In an actual `TuiMainScreen` probe, changing text *above* a static 1 MiB image produced about 42 MB of output across 30 frames; changing text *below* it produced about 1.1 KB. Main-screen redraw/delete/re-upload belongs to Pi, not pi-style. Prefer Pi's fullscreen mode for image-heavy work; a native fix needs image placement lifetime/cleanup ownership, not an extension patch.
2. **Initial upload and pixel count — bounded for prompt previews.** Prompt images now validate and prepare off the UI thread at maximum 960px backing, with a metadata placeholder. Native tool-result images still use Pi's own original upload/conversion path. Thumbnail processing has startup cost and does not guarantee smaller payload for every PNG.
3. **Duplicate persistence.** The display-only CustomEntry stores image bytes separately from the user's attachment. Large sessions pay extra JSON serialization/disk/resume cost. Fixing this needs a host-supported stable attachment reference or a separate storage/lifetime contract; not render-loop caching.
4. **Status layout duplication — resolved in follow-up.** The shared cache now computes equal-width widget pairs once. A local default-layout probe of 1,000 update-and-render pairs measured a seven-sample median of roughly 30.0 ms before versus 25.5 ms after. This is illustrative CPU work, not terminal latency; unequal-width, native-status mutation, theme and lifecycle regressions pass.
5. **Terminal/platform verification.** Real screenshot PNG/JPEG/WebP rendering, scrolling, overlays, resize, Ctrl+O and theme changes need visual validation on Ghostty/Kitty/WezTerm/iTerm2 and relevant multiplexers. No automated probe here measures GPU paint, terminal decoder throughput, SSH bandwidth, long-session heap retention or end-to-end input latency.

## Approved asynchronous thumbnails: delivered

A separate teammate exercised real, decodable synthetic screenshot-pattern PNG/JPEG fixtures with Pi's public `resizeImage` and `convertToPng`. Unlike the header-only encoding fixtures above, these probes include actual decoding/resampling. Temporary contract/probes: `/tmp/pi-style-thumbnail-contract.Xm2MUH/contract.md`.

- A 3840×2160 mixed-pattern PNG reduced from 8,543,376 to 1,091,564 base64 characters at a 960-pixel maximum backing size, with 93.75% fewer pixels. Outer worker startup plus preparation took roughly 1.07–1.46 s in three local samples; not measured terminal first-paint latency.
- The public resizer selected JPEG even for PNG inputs. PNG normalization therefore introduces display-only compression loss, and a highly compressible PNG **grew** from 140,220 to 630,852 characters despite fewer pixels. Smaller dimensions do not guarantee smaller payload.
- Both public APIs can execute synchronous CPU. An extension-owned worker successfully isolated the native resize fallback in a forced nested-worker-denial probe; a promise alone is insufficient isolation.
- The implementation uses bounded queued work/artifact retention, stale-completion disposal, metadata placeholders, public-API/worker-unavailable fallback, and explicit expanded-image resolution semantics.
- The user approved display-only resampling and capped backing detail. Thumbnails are now implemented; Ctrl+O changes 30/configured cells to 60 using the same maximum 960px image, not full original detail. Model attachments and persisted originals remain unchanged. No config/storage schema, dependencies or native patches were added.

Generic native tool-result images, regular-mode image lifetime and duplicate persisted attachment references remain host-owned; no unsupported patch was added.

### Delivered resource/lifecycle contract

- One active preparation and up to eight queued jobs. Input admission is at most 20 MiB decoded estimate per image and 64 MiB accounted queued/active source-string references. Each request has a 10s deadline including public-root resolution; abort/timeout prevents stale worker launch and waits for existing worker teardown before replacement.
- Worker admission accepts still PNG/JPEG/WebP with readable bounded headers, sane dimensions (at most 24M pixels / 16384 per edge). Native public resize and PNG conversion, including synchronous fallback, execute in the outer worker, never in a renderer. Unsupported/animated/malformed/over-limit data remains metadata.
- At most 16 ready artifacts and 32 MiB conservatively accounted derived retention, reserving at least `6 * base64.length + 4096` per artifact; normalized output is at most 4 MiB base64 and 960px per edge. Eviction drops the native Image/encoding references and does not re-prepare history on every frame. Queue/admission overflow and evicted demands intentionally remain metadata until a generation reset, rather than repeatedly retrying during streaming. This bounds extension-owned admission/retention, **not total process/WASM/terminal RSS**.
- A dedicated zero-line public widget captures repaint independently of editor/status/core patches. Valid persisted entries created before bind or while OFF stay admitted with zero preview content (Pi retains its native one-line spacer), then hydrate afterward; completion only requests a frame. OFF/shutdown/new session/changed tree leaf cancel and clear the generation. Stale completion/widget disposal cannot claim a new UI; async session start cannot rebind after shutdown. Headless/unbound or unavailable public APIs/workers remain metadata-only with no background processing.
- Source and dist builds ship the plain worker module. Actual-host `getPackageDir()` plus its declared public manifest entry supports managed/jiti-alias installs without scanning installations or importing private decoder paths.

### New screenshot/package evidence

`assets/demo.png` is a real 2438×1716 PNG (938,952 base64 characters). The delivered processor produced a 960×676 PNG (444,164 characters, approximately 53% smaller encoded payload and 84% fewer pixels). One cold local preparation took about 1.58s including worker/import startup. This proves real decoding and payload reduction for this fixture, **not terminal input/paint latency**. A live native CustomEntry + public repaint integration test passes with this screenshot; originals remain identical.

After rebuilding, an actual `npm pack` tarball was extracted outside repository `node_modules`. A diagnostic extension was loaded using the managed Pi 1.5.2 **bundled public extension/Jiti loader**. Both packed-source default worker resolution and the copied dist worker successfully processed that screenshot to the same 960×676 / 444,164-character result. Source/dist worker bytes matched. This tests the actual alias-loader path, not only a simulated host manifest. Diagnostic artifacts: `/tmp/pi-style-thumbnails/{check.log,managed-probe.mjs,managed-probe.log,packed/}`. Nothing was installed or published.

Deterministic preparation tests cover 1,000 pending renders with zero native image renders and one deferred processor call, then 1,000 invalidation/render passes reusing the same native thumbnail encoding. Worker tests cover real PNG/JPEG/WebP, unavailable APIs/workers, source/packed layouts, full-request deadlines, cancellation teardown barriers and forced nested-worker denial. New runtime tests cover real screenshot composition, unavailable public widget API, ON/OFF, old async start, unbound/resumed entry hydration, stale completion/disposal and independent status/editor-disabled operation. No timing threshold is enforced in CI.
