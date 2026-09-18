# Changelog

All notable behavior changes of the SearchBox patch. Versions below are the
internal iteration numbers used while developing against OpenCode Desktop
build 11831 (`app-11831-vNN.asar`); the public project starts at **1.0.0**.

## [1.0.0] – 2026-09-18

Public release. Everything is bundled as a zero-dependency, cross-platform
patch kit:

- Standalone `patch-asar.mjs` (no `npm install`; inline asar header read/re-encode).
- Installers for **Linux**, **macOS** and **Windows** with auto discovery of
  the archive, pristine backup and a self-elevated final copy.
- `restore` scripts for every platform.
- English + Persian documentation and screenshot.

### v22 (included in 1.0.0)

- Search is restricted to **user prompts only** (`role === "user"`).
- Search box is **hidden until a chat is loaded and has messages**; it no
  longer floats over empty chats or the tab bar.
- **✕ clear button** wipes the whole query + highlights in one click.
- Search state is **reset on chat switch** (query, results, highlights).

### v21

- Navigation switched to the app's **native pending-message chain**:
  `setPendingMessage → input2.loadMore (until found) → autoScroll.pause →
  scrollToMessage → seek → scrollToElement`, then flash-highlight.
- No scrollTop writes at all → no fighting with Virtua / `shouldAnchorBottom`.
- Reasoning-gated targets show a **gated chip** instead of a dead jump;
  exhausted-history targets show a chip too (no walking through pages).
- Legacy scroll path kept only as a fallback when the bridge is unavailable.

### v20

- First bridge (`window.__ocNav`) into the compiled renderer bundle with
  `revealMessage` + `scrollToEnd`; fallback snippet-first path added.

### v19

- Rollback of scrollTop-based marching for large distances; prove the app
  scrolls only via `scrollToMessage`/`seek` after a render.

### v18

- Match navigation moved to the app's `messageRowIndex`/`messageAt` virtual
  stepping to survive virtualization.

### v13–v17

- Initial in-page script: Ctrl+F-style box, match list + count, previous/next
  buttons, arrow-key stepping, highlight flashes.
- RTL fixes for the injected UI and the app's own list direction.
- Direct `scrollTop` attempts → still stuttery at distance (root cause:
  lazy history loading + `shouldAnchorBottom`), motivating the bridge work.

[1.0.0]: https://github.com/programmer-1998/SearchBox_OpenCode/releases/tag/v1.0.0