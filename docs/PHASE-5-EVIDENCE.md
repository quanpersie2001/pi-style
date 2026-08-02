# Phase 5 evidence and disposition

Status: **Accepted by independent Peer review** for the exact Pi `0.83.0` certified subset within `>=0.83.0 <0.84.0`. Final checkpoint: **69 tests passed across 8 files**. This acceptance covers runtime/proof for the certified messages/tools subset only. Phase 6 is separately accepted after fresh independent frozen-scope Peer acceptance and Root validation; its current repository total supersedes the historical Phase 5 test count. Later release/platform checks remain outstanding and Phase 7 is blocked/not started pending Supervisor/program acceptance.

Human-authorized capability fallbacks: on exact Pi 0.83, generic cancelled/truncated tool distinction remains native/neutral because state is not reliably exposed; special message blocks and image-specific styling remain native preservation where no certified hook/adapter applies. These are accepted fallbacks, not implemented styling claims.

Cleanup evidence: terminal owner-change cleanup is removed from the active retry set and counted as later-owner; wrapper-owned restore rejection remains active and retryable. Final diagnostic archives are plain frozen objects created only after all retryable records are resolved, and repeated disposal returns the same archive object. Prototype cleanup returns structured completion state; the extension retains an incomplete probe handle and does not start a new generation until retryable records clear.

Prototype registry evidence is own-descriptor based: post-write validation, altered-flag rollback, later-owner preservation, catch-after-write rollback failure retention, and cleanup never use `Reflect.get` to decide wrapper ownership. Report views expose frozen evidence/certification/unsupported snapshots while private mutable records remain available only to disposal closures. Compatibility reports are frozen public views; disposal uses a private WeakMap state and remains functional after public mutation attempts.

Additional proof: `retains catch-after-write rollback failure for retry` demonstrates a wrapper that survives an installation exception, remains registered, and restores successfully on retry. Its post-write exception is scoped through the registry test seam, while the Proxy's own `defineProperty` trap performs the actual native restoration rejection and later success. `retains real rejected prototype cleanup and retries before a new generation` exercises the real extension lifecycle and report disposer against an actual installed prototype. `rejects mutation of frozen report evidence and still restores exactly` verifies frozen public report, certification, descriptor, unsupported, marker, and record views remain immutable while disposal still restores native descriptors. Certification descriptor views are cloned frozen plain records rather than raw `PropertyDescriptor` objects.

Exact proof tests now include `prefixes only the first nonblank line with one reduced native call`, `preserves OSC control-only lines and prefixes OSC content exactly once`, `rejects overlapping tool owners and preserves the first wrapper`, and `archives final owner diagnostics immutably and idempotently`.

Core patches are disabled by default. Pi 0.83 users may opt into the verified session path with public boolean flags registered by the extension. Tier C is explicit per-surface default-deny: absence of a flag means native fallback, and each surface requires the core flag plus its own flag:

- `--pi-style-core-patches`
- `--pi-style-message-user`
- `--pi-style-message-assistant`
- `--pi-style-tools`
- `--pi-style-ascii`

The authorization truth table is: core+user enables only user messages; core+assistant enables only assistant messages; core+tools enables only tool call/result selectors; core alone and every surface flag without core install nothing. ASCII only changes markers on already-enabled surfaces.

These are session overrides only. Pi 0.83 does not expose a public extension settings reader to this extension factory; global/project `piStyle` persistence and `/pi-style` settings commands remain planned. The extension reads parsed flag values through the public `registerFlag`/`getFlag` API at `session_start`, with no render-time I/O.

## Certification

Only exact Pi `0.83.0` is certified within policy range `>=0.83.0 <0.84.0`. `CERTIFICATION_TABLE` is immutable and keyed by exact version. Before any install, immutable native descriptor evidence is captured for every target. Runtime reports retain attempted version, matched certified version, policy range, expected table entry, actual pre-install evidence, installed/fallback outcome, and adapter status.

Certified surfaces:

| Surface | Adapter | Gate | Status |
|---|---|---|---|
| User message render | `message-prefix-osc133-v1` | core + messages + user flag | certified on exact 0.83.0 |
| Assistant message render | `message-prefix-osc133-v1` | core + messages + assistant flag | certified on exact 0.83.0 |
| Tool call renderer | `tool-renderer-component-v1` | core + tools flag | certified on exact 0.83.0 |
| Tool result renderer | `tool-renderer-component-v1` | core + tools flag | certified on exact 0.83.0 |

Native fallback with prototype identity untouched:

- compaction summary
- branch summary
- skill invocation
- custom message
- unknown/mismatched Pi builds
- disabled per-surface flags
- unsafe or malformed per-instance tool components

## Governing requirements and evidence

The exact governing meanings are defined in `docs/ui/MESSAGES-AND-TOOLS.md`.

### Messages

- **MSG-001:** user/assistant prefixes are optional and width-safe — proven by `proves one native call and exact OSC/width behavior for real messages`; flags independently gate each prefix. Leading padded lines are preserved and the first nonblank content line receives the prefix.
- **MSG-002:** streaming, thinking-only, tool-only, and mixed messages render correctly — real Pi assistant fixtures are covered; unsupported private special layouts remain native.
- **MSG-003:** special blocks alter presentation, not model/session content — special surfaces are explicitly native fallback, so no unsupported presentation claim is made.
- **MSG-004:** unsupported shapes use native rendering — malformed/narrow output and unrecognized versions use native fallback.
- **MSG-005:** message patches are idempotent and reversible — ten-cycle lifecycle proof and exact descriptor restoration.
- **MSG-006:** images and native rich content remain usable — partial/native fallback only; native rich content is preserved, but no image-specific decoration proof is claimed.

### Tools

- **TOOL-001:** styling never changes built-in execution semantics — actual read/edit/bash definition identity and metadata proof; no execute call.
- **TOOL-002:** pending/partial/success/error/cancelled/truncated states are distinct without color alone — partial: certified pending/running/error and neutral call/result are proven; cancelled/truncated distinction is not implemented and remains native/neutral.
- **TOOL-003:** built-in expansion and truncation behavior is preserved — native components and repeated `lastComponent` paths are reused.
- **TOOL-004:** tool-specific headers remain concise and sanitize incomplete arguments — native renderer receives original arguments once; malformed contexts remain native.
- **TOOL-005:** renderer conflict/failure falls back to the existing/native renderer — owner-scoped validator and identity-safe fallback.
- **TOOL-006:** patches/overrides are idempotent, reversible, and identity-safe — owner-scoped records, current-owner checks, ten cycles, later-owner preservation.
- **TOOL-007:** renderers perform no filesystem/process work — render tests invoke no `execute`; no render-time I/O is introduced.

## Ownership and diagnostics

Each compatibility probe creates its own tool decoration owner only when a certified tool surface can be acquired. Snapshot, component records, diagnostics, and disposal belong to that owner. Failed restoration remains tracked and diagnostic. Runtime diagnostics are exposed through live `getRuntimeDiagnostics()` and retained through `getFinalDiagnostics()` on the report. Disposal touches only the owner’s records.

No tool registration, message registration, entry registration, active/all tool mutation, system prompt mutation, execution wrapper, or command execution is performed by the compatibility path. Diagnostics are owner-scoped: live counters remain available while active; disposal freezes the final archive, retaining failed cleanup records for retry and later-owner protection.
