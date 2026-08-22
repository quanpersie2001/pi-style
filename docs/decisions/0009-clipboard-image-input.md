# ADR 0009: Clipboard image input (standalone image attach)

- Status: **Accepted**
- Date: 2026-08-22
- Supersedes: the input-domain exclusion clause of [ADR 0008](0008-user-prompt-image-previews.md) (the preview-channel decision of ADR 0008 remains fully in force).

## Context

ADR 0008 delivered inline previews for user-prompt images but deliberately left the *input half* to input-domain packages: a preview needs something to preview, and the only in-process paths that produce prompt images were CLI file arguments and third-party extensions like `@pi-archimedes/image-paste`. The product decision has changed: **pi-style owns the complete feature** — paste an image, it attaches to the model's message and previews in the feed — with no dependency on any other extension.

The input mechanism follows from three verified facts about Pi 0.84.2 (no new core patch needed):

1. **The built-in paste already materializes clipboard images on disk.** `Ctrl+V` (`app.clipboard.pasteImage` → `InteractiveMode.handleClipboardPaste`) reads the clipboard image, writes it to `path.join(os.tmpdir(), \`pi-clipboard-${crypto.randomUUID()}.${ext}\`)` with `ext ∈ {png, jpg, webp, gif}`, and inserts that absolute path into the editor as plain text. The keystroke, the clipboard reading, and the temp file are all Pi's — nothing to duplicate, nothing to conflict with (the failure mode image-paste works around by re-registering `ctrl+v` and telling users to clear the built-in binding).
2. **The `input` extension event can transform both text and images.** `InputEventResult` supports `{ action: "transform", text, images }`; `agent-session.prompt()` applies `currentImages = inputResult.images ?? currentImages` before building the user message, and the same images flow to `before_agent_start` — where ADR 0008's preview entry is already wired.
3. **`!` bash input never reaches the event.** Interactive-mode intercepts `!`-prefixed submits before `session.prompt`, so the input handler cannot mangle shell commands.

## Decision

pi-style intercepts interactive input containing Pi clipboard-paste path tokens and upgrades them to real image attachments, in three layers:

### Editor keystroke ownership (instant marker)

`StyledEditor.handleInput` matches the built-in paste keybinding (`app.clipboard.pasteImage`) through the same KeybindingsManager Pi uses. When the surface is enabled and a synchronous native-module probe (`@mariozechner/clipboard.hasImage()`) confirms the clipboard holds an image, the keystroke is owned: an `[Image #N] ` marker is inserted **synchronously at keystroke time** (single hop, no path flash, no temp artifact — the bytes fill asynchronously from `getImageBinary`). Text pastes (no image) and probe-unavailable hosts fall through to the native path; there the artifact fallback (`insertTextAtCursor`) converts the pasted path and **requests a repaint after the async insert** — Pi's own paste handler repaints before the conversion completes, which would otherwise leave the marker invisible until the next keystroke.

Probe resolution detail (verified against a live install): `@mariozechner/clipboard` is an *optionalDependency* of pi-coding-agent — often installed only nested inside pi's own global install and invisible from an extension project's `node_modules`. The probe resolves it from `dirname(realpathSync(process.argv[1]))` — pi's real cli location (argv[1] is the `bin/pi` symlink, so realpath is required) — falling back to the extension's own graph. Measured on macOS: the native clipboard probe costs ~90–110 ms regardless of API (`hasImage` or `getImageBinary`), so that is the floor for paste→marker feedback; the previous two-hop flow (native read → path insert → artifact read → marker swap → no repaint) is what made it feel broken.

### Atomic marker backspace

Backspacing with the cursor directly after a registered `[Image #N] ` marker deletes the whole marker as one unit (single `setText` surgery — one undo step; cursor restored through public left-arrow input) and discards the pending image. Markers without a registry entry (typed by hand, restored history) backspace character-by-character as ordinary text.

### Submit transform (both layers)

On the `input` event (`source === "interactive"` only): (1) `[Image #N]` markers resolve against the pending registry — the registry is consumed one-shot per submit (markers kept verbatim in the text, filled images attached in index order, removed markers discard their images, image-paste semantics; a submit awaits in-flight fills so a fast submit right after a paste still attaches); (2) remaining raw clipboard path tokens (probe unavailable, native editor style, config toggled after paste) are read (base64) and attached with the extension-derived mime type, and the token is rewritten to `[image]` (the message text stays non-empty and readable). On submit the model receives the message text plus real image blocks — no longer just a path it would have to `read`.

- **Detection**: tokens matching `^<os.tmpdir()>/pi-clipboard-<uuid>\.(png|jpe?g|webp|gif)$` — exact pattern of the built-in paste (UUID is `crypto.randomUUID()`'s lowercase v4 shape), with non-alphanumeric boundaries so punctuation typed right after a pasted path still matches. The pattern is deliberately narrow: an arbitrary image path typed by the user is *text the user meant*, never silently converted; only Pi's own paste artifacts are upgraded.
- **Guards**: clipboard read failure discards the pending entry (the marker stays plain text — nothing is lost); artifact files missing/unreadable or over 20 MB keep their token verbatim; no readable tokens → no transform (`action: "continue"`). Filesystem/native reads happen on the input path only — the render path stays I/O-free (TOOL-007 holds; input is not render).
- **Config**: the leaf `messages.clipboardImages: boolean` (default `true`) gates all three layers. Off restores the exact native behavior: the pasted path rides as plain text.
- **Preview**: unchanged ADR 0008 surface — `before_agent_start` sees the transformed `images` and appends the preview entry below the user message.

### Compatibility

No keybinding registration (the built-in `Ctrl+V` stays the only keystroke), no core patch, no new fingerprint. Coexistence with `@pi-archimedes/image-paste`: if installed and its shortcut wins, its markers attach images directly and ADR 0008 previews them; if the built-in paste stays, this transform handles it. Either way at most one attach happens (different token shapes never both match), and the known double-preview with image-paste's own custom messages is ADR 0008's documented `messages.showImagePreviews: false` escape hatch.

## Alternatives considered

### Re-registering `ctrl+v` with our own clipboard reader (image-paste's approach)

Rejected. It duplicates clipboard reading Pi already owns (native module + platform fallbacks), conflicts with the built-in binding (`Extension shortcut conflict: 'ctrl+v' …`), and forces users to edit `keybindings.json`. Intercepting the artifact the built-in paste produces achieves the same attach with zero new surface.

### Attaching every image-path token found in the text

Rejected. A path the user typed deliberately ("compare ./a.png and ./b.png by name") is text; converting it changes meaning without consent. Only Pi's own paste artifacts (`pi-clipboard-<uuid>`) are unambiguous machine-inserted attachments.

### Keeping the original path text alongside the attachment

Rejected. A `/tmp/pi-clipboard-3f2a8c…png` token in the message is noise to the model and the feed; `[image]` keeps the text short, and the preview entry below the message shows what the token refers to.

## Consequences

### Benefits

- the complete image-paste feature — paste → attach → preview — works with pi-style alone;
- zero keybinding or clipboard conflicts: Pi's paste keystroke and file handling stay untouched;
- graceful degradation at every step (missing file, oversize, config off → exact native behavior);
- composes with ADR 0008 unchanged (the preview needs no changes).

### Costs

- the transform reads temp files on the input path (bounded by the narrow pattern and the 20 MB guard);
- `source: "interactive"` only — images attached via RPC/extension sources are not upgraded (they arrive as ImageContent already, via their own producers);
- session entries record `[image]` tokens rather than original paths (paths remain discoverable in the temp dir only until reboot — same as native).

## Validation implications

- Unit tests: pattern acceptance (tmpdir + uuid + each extension; case; punctuation boundaries), rejection (non-tmp path, malformed uuid, wrong extension, ordinary text, `./rel.png`, http URL, glued alphanumerics); interceptor behavior (marker + registry, increments, missing/oversize/config-off → original path); marker resolution (order, one-shot registry, removed-marker discard, unknown markers stay text); submit transform (single/multiple tokens, mixed readable/missing, oversize guard, `[image]` substitution, never-empty text); editor override (plain text verbatim, non-token verbatim, interceptor routing, throw → fallback, end-to-end paste→marker→attach); config gate; source gate (non-interactive passthrough).
- Lifecycle: pasted-path input → transform + preview entry in one submit; `messages.clipboardImages: false` → verbatim native flow.
- Requirement mapping: new `IMG-006`–`IMG-009` in `docs/ui/MESSAGES-AND-TOOLS.md`.
- Compatibility: no new fingerprint, no shortcut registration, no render-path I/O.

## Supersedes

The clause in [ADR 0008](0008-user-prompt-image-previews.md): *"The input half (clipboard reading, marker queue, input transform, shortcuts) is explicitly not absorbed."* ADR 0008's channel decision (CustomEntry previews) is untouched. Superseded-by: none.
