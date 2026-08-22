# ADR 0008: Inline previews for user-prompt images

- Status: **Accepted** (input-domain exclusion clause superseded by [ADR 0009](0009-clipboard-image-input.md); the preview-channel decision remains in force)
- Date: 2026-08-22

## Context

Two verified facts about image handling in Pi 0.84 shape this decision:

1. **Tool-result images already render natively.** `ToolExecutionComponent.updateDisplay()` extracts `type: "image"` blocks from the result and adds pi-tui `Image` components as children below whatever the tool renderer produced (`caps.images && showImages` gate, `imageWidthCells` default 60). Boxed renderers never need to draw them — the batch leader's panel and the image coexist. pi-style has nothing to absorb here.

2. **User-prompt images are invisible.** Images attached to the user's prompt (pasted via an input extension, image flags) render nowhere in the feed — the user message component draws text only. `@pi-archimedes/image-paste` works around this by sending display-only custom *messages* (`sendMessage` with `display: true`, `triggerTurn: false`) carrying the base64 images. That workaround has a cost Pi's own session pipeline makes explicit: `sessionEntryToContextMessages()` maps `custom_message` entries into the context message list, so every previewed image rides the session file and the context pipeline for the rest of the session (provider-dependent serialization/token cost). The presentation intent is right; the channel is wrong.

pi-style's mission is presentation, and "attached image renders nowhere" is a presentation gap on a surface pi-style already owns contracts for (`MSG-006`: images and native rich content remain usable — currently they remain usable for the model and invisible to the user). This ADR absorbs the presentation half of image-paste. ~~The input half (clipboard reading, marker queue, input transform, shortcuts) is explicitly **not** absorbed~~ (superseded by ADR 0009: pi-style now owns clipboard image input too; it is a different domain, owned by input extensions, and duplicating it would create conflicts for no gain).

## Decision

Add one display-only surface: **inline previews for user-prompt images via CustomEntry**.

### Channel

- `pi.appendEntry("pi-style-image-preview", { images: [{ data, mimeType }] })` — CustomEntry is documented as *"not sent to LLM"* and `sessionEntryToContextMessages()` returns nothing for it. The preview is feed-only and context-free by construction.
- **Ordering (stage/flush, verified against Pi 0.84.2):** appending at `before_agent_start` lands the entry **above** the user message — extension handlers run before the UI's `message_start(user)` listener adds the user message to the feed and before `message_end(user)` persists it. So the append is *staged* at `before_agent_start` (the only event carrying the prompt's `images`) and *flushed* at the first `message_start(assistant)`: by then the user message is rendered and persisted, the host inserts the entry below it (spliced before the streaming component), and the session file records user → preview → assistant so scroll-back and resume render identically. A steered prompt arriving before the first flush overwrites the staged slot (last write wins) — steer-with-image is a rare corner.

### Rendering

- `registerEntryRenderer` (public API, no core patch) returns a component of pi-tui `Image` parts with themed `fallbackColor` (`toolOutput`).
- **Labels**: each image carries a `#N · WxH` label row tying it to its `[Image #N]` marker (ADR 0009), so multi-image prompts read unambiguously.
- **Side-by-side grid** on kitty-capable terminals: kitty graphics sequences are zero-width, so per-row line zipping composes columns — but kitty places each image at the CURSOR column when its transmission completes, so each subsequent column's payload is prefixed with a CHA cursor jump (`ESC[<col>G`) to its start column (a plain gap would stack image 2 on top of image 1). Up to 3 columns (min 14 cells each, 2-cell gap), degrading to stacked when the terminal is too narrow or the protocol is not kitty (iTerm2 and others stack).
- **Size**: collapsed previews cap at `messages.previewMaxWidth` cells per image (default **30** — prompts rarely need full-width previews; bounded 8–60); Pi's global tool expansion (Ctrl+O) lifts the cap to 60 for a closer look without config changes.
- Terminals without image support need no special case in pi-style: the pi-tui `Image` component itself degrades to a single ANSI-safe fallback line (mime + dimensions) through the themed `fallbackColor`. Invalid/empty image data is filtered before staging; the renderer also guards malformed entry data (returns `undefined` → the entry renders zero lines), so hostile or hand-edited session files cannot break the feed.
- The entry renderer must never leak base64 data in any fallback path — the fallback vocabulary is mime type and dimensions only.

### Configuration

- New leaf `messages.showImagePreviews: boolean` (default `true`). The leaf gates **both** sides: `false` stops staging new entries and makes the renderer return `undefined` (existing persisted entries render zero lines), so turning the surface off is immediately effective without a session reload. Same precedence ladder, normalization-safe fallback, `/pi-style set` support, and doctor diagnostics as every other boolean leaf.
- New leaf `messages.previewMaxWidth: number` (default `30`, bounds 8–60): collapsed cell-width cap per preview image; Ctrl+O expansion always renders at 60.

### Compatibility

- No new Pi-core patch identity, no new fingerprint: the surface uses only public extension APIs (`registerEntryRenderer`, `appendEntry`, `before_agent_start`). No keybinding, no input interception, no tool registration. Works headless (entries persist; rendering is TUI-only).

## Alternatives considered

### Display-only custom messages (the image-paste approach)

Rejected. `sendMessage({ display: true })` entries are `custom_message` session entries, which `sessionEntryToContextMessages()` maps into the context message list — the preview images would ride the context pipeline. It would also require a message renderer instead of an entry renderer and interact with pi-style's own boxed special-block styling of custom messages. CustomEntry exists precisely for "feed-visible, LLM-invisible" state.

### Patching the user-message component to render images inline

Rejected. The certified `native-user-message` surface was deliberately removed (user messages render native, no prefix — see MESSAGES-AND-TOOLS); re-opening that surface with a core patch to draw images inside the message buys nothing over an adjacent entry and re-adds fingerprint/maintenance cost.

### Leaving previews to input-domain packages

Rejected. Without them the images are invisible; with them the current workaround pays the context cost above. The visibility gap is presentation, which is pi-style's domain.

## Consequences

### Benefits

- attached images become visible in the feed immediately below the user's message, in the same visual scale as tool-result images;
- context-free and resume-stable by construction — the same session content renders the same way live, in scroll-back, and after reload;
- zero new compatibility surface: public APIs only, fail-closed guards on malformed data;
- composes with input extensions: pi-style does not care *how* images were attached.

### Costs

- session files grow by ~1.33× the image size per preview (base64 in entry data) — the same cost image-paste already pays; accepted and documented;
- double render when an input extension that also previews (image-paste's `hephaestus-image-preview` messages) is installed: its custom message renders beside pi-style's entry. Documented; users disable one side (`messages.showImagePreviews: false`) — pi-style does not attempt cross-extension detection;
- `before_agent_start` handlers must stay cheap (filter + append, no decode) — the image bytes are only touched by the renderer, never on the event path.

## Validation implications

- Unit tests (`test/unit/`): entry-data filter contract (valid/invalid/malformed); renderer structure (Container with one `Image` per entry image, `maxWidthCells` honored); fallback rendering on terminals without image support (single themed line, no base64 leakage); render-config gate (append and render sides); config normalization for `messages.showImagePreviews` (default, override, invalid-value fallback).
- Render tests (`test/render/`): no-color/ASCII safety of the fallback line.
- Lifecycle: `before_agent_start` with images → exactly one entry appended; without images → no entry; config `false` → no entry and zero-line render of persisted entries.
- Requirement mapping: new `IMG-001`–`IMG-005` in `docs/ui/MESSAGES-AND-TOOLS.md`; `MSG-006` remains in force (and is now satisfied for the user side).
- Compatibility: no new fingerprint; unsupported host shapes change nothing (public API surface is version-stable across the policy range).

## Supersedes

None. Superseded-by: the input-domain exclusion clause is superseded by [ADR 0009](0009-clipboard-image-input.md); every other decision here (channel, rendering, configuration, compatibility) stands unchanged.
