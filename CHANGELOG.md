# Changelog

## [Unreleased]

### Features

- New `editor.frame: "rounded"` mode for the editor input: a rounded box (`╭─╮ / │ text │ / ╰─╯`) with vertical side borders around the input and the autocomplete dropdown. Requires `editor.style: "dock"`; side borders reserve two columns and the cursor stays aligned inside the box (`outline` keeps the previous square-corner look without side borders).
- New `editor.hint` config leaf: a dim placeholder (semantic `hint` token, `theme.colors.hint`, default muted gray) shown after the prompt while the input is empty — e.g. `"Ask Pi anything"`. Any typed character hides it.

### Changed

- The default editor frame is now the rounded input box (`editor.style: "dock"` + `editor.frame: "rounded"`) with vertical side borders. `frame: "outline"` restores the previous square-corner box without side borders; the `compact`, `minimal`, and `native` presets keep their explicit compact/native editor and are unaffected.

### Bug Fixes

- `messages.hideThinkingLabel` now truly leaves zero trace: Pi wraps even an empty label in ANSI codes, so its `Text` still rendered one invisible full-width row, and the native layout added a trailing spacer — together the visible "gap" where the `Thinking...` label used to sit. A certified `AssistantMessageComponent.updateContent` patch (fingerprint-verified for 0.83.0) drops the invisible label row and its trailing spacer, leaving the same single top padding as a text-only assistant message. Disabling the option restores the native label/layout; on any other Pi build the surface falls back native.

## [0.1.4] - 2026-08-05

### Features

- Strict boxed tool-card state machine with live running/streaming/terminal states

## [0.1.3] - 2026-08-04

### Bug Fixes

- *(test)* Drop timing-dependent 0.00s assertion in batch header

### Features

- Group consecutive quiet-tool calls into a boxless batch panel

### Refactor

- Render lone read/ls/find calls with the same boxless tree
- Boxless output trees, readonly tool activation, drop user prefix

### Bug Fixes

- `messages.hideThinkingLabel` now truly leaves zero trace: Pi wraps even an empty label in ANSI codes, so its `Text` still rendered one invisible full-width row, and the native layout added a trailing spacer — together the visible "gap" where the `Thinking...` label used to sit. A certified `AssistantMessageComponent.updateContent` patch (fingerprint-verified for 0.83.0) drops the invisible label row and its trailing spacer, leaving the same single top padding as a text-only assistant message. Disabling the option restores the native label/layout; on any other Pi build the surface falls back native.

## [0.1.2] - 2026-08-04

### Bug Fixes

- Re-decorate tool/message boxes after session resume

### Features

- Adaptive unified/split diffs and rounded boxed tool surfaces

## [0.1.1] - 2026-08-03

### Documentation

- Add demo screenshot to README

### Features

- Implement phase 1A foundation
- Implement phase 2 status line foundation
- Complete phase 2 status line
- Complete phase 3 styled editor
- Complete phase 4 startup presentation
- Complete phase 5 messages and tools
- Complete phase 6 configuration and composition
- Boxed tool/message presentation ported from pi-droid-styling

### Miscellaneous Tasks

- Complete phase 0 foundation
- Add CI and release workflows with git-cliff changelog
- Point changelog repo links at quanpersie2001/pi-style
- Use npm ci for deterministic installs
- Use npm install like pi-rules to tolerate cross-platform lockfile gaps

### Styling

- More breathing room inside boxed surfaces

### Testing

- Close phase 2 status line gaps

