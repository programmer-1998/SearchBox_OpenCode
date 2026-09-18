# 🔍 SearchBox for OpenCode Desktop

**Find your own prompts inside an OpenCode Desktop chat — instantly, with a live count, per-match stepping and pen-drop scrolling.**

> **Persian version:** [README.fa.md](README.fa.md)

![SearchBox in action](screenshot.png)

---

## What is it?

OpenCode Desktop shows model replies on both sides of the conversation, so visually finding *your* prompt in a long thread is slow. **SearchBox** adds a small "Find in my prompts" box to the top of every loaded chat:

- type a phrase → it is searched **only in your (user) messages** of the **current chat**
- a **live match count** updates as you type (`n matches`)
- matches are **highlighted and bottom‑first**: results closer to the end of the chat are marked in the visible window
- step between matches with the **▲/▼ buttons, Enter / Shift+Enter**, or the **Up/Down arrows**
- a **✕ button** clears the query, the highlights and the panel in one click
- the search is **per chat**: switching chats or tabs clears the query automatically
- the box only appears when a chat is **loaded and actually has messages** — never floats over empty chats or the tab bar
- it is **RTL‑ready**: the box and input flip automatically for Persian/Arabic interface languages
- navigation uses the app's **own scroll engine**, so it is smooth — it never fights the virtualized message list

It is an **unofficial, surgical patch** on top of OpenCode Desktop. Everything is reversible; the original archive is always backed up first.

---

## Features at a glance

| Feature | What it does |
|---|---|
| User‑prompt‑only search | Model replies are never searched, so results are always *your* words |
| Live count | `n matches` updates on every keystroke |
| Highlight + step | Current match flash‑highlights on arrival; ▲/▼, Enter / Shift+Enter move between matches |
| Sticky, non‑floating box | Docked inside the chat area — never overlaps the tabs |
| Auto show / hide | Appears only when a chat with messages is loaded |
| Clear button | ✕ wipes query + highlights in one click |
| Per‑chat state | Switching chats/tabs clears the query |
| RTL support | Mirrored UI for Persian/Arabic locales |
| Smooth scrolling | Uses OpenCode's native message loader + reveal pipeline (`loadMore → scrollToMessage → seek`) |
| Idempotent & reversible | Marker‑guarded injection; pristine backup kept; one command restores |

---

## What the patch changes, step by step

`patch-asar.mjs` re‑builds OpenCode Desktop's `app.asar` from your pristine backup. It performs **two** surgical edits — nothing else.

### 1. `out/renderer/index.html` — the search UI

The whole SearchBox (styles, markup, logic) is injected *before* the app's `<script type="module">` entry point.

Inside a loaded chat it:

1. builds the box (`input`, live count, prev/next buttons, ✕ clear) and docks it at the top of the message area;
2. hides itself until a chat with messages is loaded (`sessionId()` present **and** `[data-message-id]` rows exist);
3. on keystroke, walks the current session's messages, keeps only `role === "user"`, and builds the hit list with **matching‑count** tracking;
4. renders **bottom‑first highlights** on the visible window by stepping the virtual list with the app's own `messageAt`-style machinery;
5. drives navigation: ▲/▼, Enter (next) / Shift+Enter (previous), ✕ (clear);
6. clears all state when the active chat/session changes;
7. flips to RTL when the UI language is RTL.

The injection is guarded by the marker `opencode-find-chat-patch`, so re‑running the patch never double‑injects.

### 2. `out/renderer/assets/main-<hash>.js` — the navigation bridge

OpenCode Desktop's renderer bundle is compiled minified, so it cannot be patched "cleanly" by reading source. Instead, the patch appends a small **bridge** (`window.__ocNav`) right after the app's *pending‑message* effect (`consumePendingMessage: layout.pendingMessage.consume`), i.e. at the top of the **provider scope**, where the app's own helpers are still in scope.

The bridge exposes a **union of the app's own functions** — it does not re‑implement scrolling:

- `setPendingMessage(id)` / `pendingMessage` / `clearPendingMessage` — the app's own "navigate here" slot, normally filled by share‑links;
- `sessionID()` — the active session id (from the router),
- `messagesReady`, `historyMore()`, `historyLoading`, `loadMore(sid)` — the lazy history loader,
- `currentMessageId()` / `setActiveMessage(id)` — the active row/session of the store,
- `revealMessage(id)` / `scrollToEnd()` / `anchor` / `scroller` — the app's reveal + scroll utilities,
- `autoScroll.pause() / resume()` — pinning control.

The SearchBox uses the **app's own navigation chain** "dance" to a target:

```
setPendingMessage(id)
  -> app's hash‑scroll effect: if not in messageById() and historyMore()
        -> input2.loadMore(sessionID)   // loads all older history until found
  -> once found:  autoScroll.pause()
                   -> scrollToMessage(msg, "auto")
                   -> seek (requestAnimationFrame retries)
                   -> scrollToElement()
  -> SearchBox flash‑highlights the arrived row
```

This is why the pen‑drop is **smooth**: it is the identical code path OpenCode already uses to jump to a shared/timestamp message. We deliberately avoid writing `scrollTop` directly, which fights the DOM virtualization (`shouldAnchorBottom` + Virtua reconcile) and causes the stutter.

If the target exists only in **lazy‑loaded history**, the loader loads the older pages first. If the matching turn is *reasoning‑gated* (a generated thinking block that the app will not render as a row), SearchBox shows a **"gated" chip** instead of pretending to land somewhere.

The bridge is guarded by the marker `opencode-ocnav-bridge`.

### 3. Archive integrity

After the edits `patch-asar.mjs`:

- recomputes each patched file's **SHA‑256 block integrity** (4 MiB blocks, Electron/update‑style) and size;
- rebuilds the asar header (file offsets) and writes a fully valid archive;
- **never touches the archive it reads** — it writes to a separate output path (see install scripts).

---

## Requirements

| Thing | Requirement |
|---|---|
| OpenCode Desktop | any current build; **compatibility anchor tested on build 11831** |
| Node.js | **≥ 22.12.0** (needed only during install, not at runtime) |
| OS | Linux, macOS, Windows |
| Permission | sudo (Linux/macOS) or Administrator (Windows) — only for the final file copy |

If your OpenCode build is **newer/older** and the internal anchor changed, `patch-asar.mjs` aborts with a clear "provider anchor not found" message instead of corrupting anything. That build is safe — just not yet compatible.

---

## Installation

> Close OpenCode Desktop completely first.

### Linux

```bash
git clone git@github.com:programmer-1998/SearchBox_OpenCode.git
cd SearchBox_OpenCode
bash scripts/install.sh
```

Default archive: `/opt/OpenCode/resources/app.asar`. Custom path:

```bash
OPENCODE_ASAR=/path/to/app.asar bash scripts/install.sh
```

### macOS

```bash
git clone git@github.com:programmer-1998/SearchBox_OpenCode.git
cd SearchBox_OpenCode
bash scripts/install.sh
```

Default archive: `/Applications/OpenCode.app/Contents/Resources/app.asar`.

> **Apple Silicon note:** modifying the app bundle may invalidate the code signature. If OpenCode refuses to launch after patching, re‑sign it:

```bash
codesign --force --deep --sign - /Applications/OpenCode.app
```

or restore (see *Uninstall*).

### Windows

```powershell
git clone git@github.com:programmer-1998/SearchBox_OpenCode.git
cd SearchBox_OpenCode
powershell -ExecutionPolicy Bypass -File scripts/install.ps1
```

The script auto‑discovers the archive under `%LOCALAPPDATA%\Programs\opencode\resources\app.asar` (other common paths are tried too), elevates itself once for the final copy, and never needs Administrator for the rest. Custom path: `/path` — use `-App C:\path\to\app.asar`.

---

After install:

1. **Fully quit** OpenCode Desktop (Cmd+Q / Ctrl+Q / exit from tray — a closed window is not enough).
2. Reopen it and open any chat that has messages.
3. Type in the box — it is already focused and counting.

---

## Usage

| Action | How |
|---|---|
| Focus search | the box is auto‑focused when it appears; click to refocus |
| Search your prompts | type a phrase; only `user` messages of the current chat are searched |
| Match count | shown live next to the input (`n matches`) |
| Next match | **Enter** or the **▼** button (or Down arrow) |
| Previous match | **Shift+Enter** or the **▲** button (or Up arrow) |
| Leave the box | Esc / focus anywhere else |
| Clear everything | the **✕** button |
| New chat / switch chat | the box resets automatically (and hides if the chat is empty) |

---

## Uninstall / restore

Every install keeps a pristine backup at `app.asar.bak-original` next to the live archive.

**Linux / macOS**

```bash
bash scripts/restore.sh
```

**Windows**

```powershell
powershell -ExecutionPolicy Bypass -File scripts/restore.ps1
```

You can also do it manually:

```bash
sudo cp -f "$(dirname app.asar)/app.asar.bak-original" app.asar
```

---

## Updating OpenCode Desktop

A desktop app update overwrites `app.asar` and also makes the old backup stale. After an update:

1. delete the old backup (`app.asar.bak-original`),
2. re‑run the installer — it will snapshot the current version and re‑apply the patch.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Box does not appear | By design it only shows for a chat that is loaded **and has messages**. Open a chat with content (or switch tabs). |
| "0 matches" for a phrase you are sure about | Searching user prompts only — the phrase must be inside one of *your* messages, not a model reply. |
| Navigate shows a "gated" chip | The match is a reasoning‑gated turn OpenCode will not render as a row; the closest renderable row/position is used. |
| "provider anchor not found" during install | Your OpenCode build differs from the tested 11831. Open an issue with your app/version — the anchor is a one‑line constant. |
| "already patched (marker found)" | Safe: re‑runs are idempotent, nothing double‑injects. |
| macOS: app won't launch after patch | Code signature invalidated → re‑sign with `codesign --force --deep --sign - /Applications/OpenCode.app`. |
| Windows: antivirus blocks the copy | Add an exclusion for the OpenCode install dir; the archive is only ever written, never executed. |
| Patch gone after an app update | Normal — re‑run the installer (and delete the stale backup first, see *Updating*). |

---

## Repository layout

```
SearchBox_OpenCode/
├── patch/
│   ├── index-inject.html     Search UI + RTL styles + all the search logic (marker: opencode-find-chat-patch)
│   ├── bridge.js             window.__ocNav navigation bridge (marker: opencode-ocnav-bridge)
│   └── patch-asar.mjs        Zero-dependency asar rebuild tool (no npm install needed)
├── scripts/
│   ├── install.sh            Linux + macOS installer (auto backup, elevated copy)
│   ├── install.ps1           Windows installer (auto discovery, self-elevating)
│   ├── restore.sh            Linux + macOS restore
│   └── restore.ps1           Windows restore
├── screenshot.png
├── README.md                 this file
├── README.fa.md              Persian documentation
├── CHANGELOG.md
└── LICENSE                   MIT
```

`patch-asar.mjs` has **zero runtime dependencies** — the asar header is parsed and re‑encoded inline, so there is nothing to `npm install`. Node.js ≥ 22.12.0 is the only requirement.

---

## Compatibility & safety

- **Tested on:** OpenCode Desktop build **11831**, Linux (Electron). The macOS/Windows installers ship the same schema with per‑OS paths and are not hardware‑tested by the author yet.
- The patch is **marker‑guarded and idempotent** — running it twice is safe and produces an identical archive.
- The original `app.asar` is **always backed up** before the first patch.
- It is an **unofficial patch**: you patch at your own risk, keep backups, and report issues upstream honestly — this is a consumer tool, not affiliated with OpenCode.

---

## Credits

Created by **سینا خانزاده** — **Sina Khanzadeh** (`programmer_1998`)

- Discord / Telegram / Instagram: **programmer_1998**
- Website: https://sina-khanzadeh.ir
- Email: **khanzadeh.1377@gmail.com**
- GitHub: https://github.com/programmer-1998

Big part of the work is *deliberately not re‑implementing* anything: SearchBox rides on OpenCode's own history loader and message‑reveal pipeline, which is what makes the experience smooth.

---

## License

[MIT](LICENSE) © 2026 Sina Khanzadeh