#!/usr/bin/env node
// patch-asar.mjs — rebuild OpenCode Desktop's app.asar with the SearchBox patches.
//
// Two surgical edits (idempotent, driven by markers):
//   1. out/renderer/index.html              -> insert  index-inject.html  (search UI + RTL fix)
//   2. out/renderer/assets/main-*.js        -> insert  bridge.js          (window.__ocNav bridge)
//
// Zero runtime dependencies: the asar header is parsed/encoded inline, so the
// only requirement is a modern Node.js (>= 22.12.0). Works on Linux, macOS
// and Windows. Run from the repo root so the relative paths resolve, or pass
// explicit --snippet / --bridge. The script never touches the archive it reads
// (--src); it writes to --out.
//
// Usage:
//   node patch/patch-asar.mjs
//   node patch/patch-asar.mjs --src /path/to/app.asar --out /path/to/app.asar \
//        --snippet patch/index-inject.html --bridge patch/bridge.js

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Defaults (per-OS install locations of OpenCode Desktop)
// ---------------------------------------------------------------------------

function defaultAppPath() {
  if (process.platform === "darwin") {
    return "/Applications/OpenCode.app/Contents/Resources/app.asar";
  }
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || "";
    const candidates = [
      path.join(base, "Programs", "opencode", "resources", "app.asar"),
      path.join(base, "Programs", "OpenCode", "resources", "app.asar"),
      path.join(base, "Programs", "opencode-desktop", "resources", "app.asar"),
    ];
    for (const c of candidates) if (fs.existsSync(c)) return c;
    return candidates[0];
  }
  return "/opt/OpenCode/resources/app.asar"; // Linux (deb/tar), and snap-ish layouts
}

function defaultSnippet() {
  return path.resolve(process.env.ASAR_SNIPPET || path.join("patch", "index-inject.html"));
}
function defaultBridge() {
  return path.resolve(process.env.ASAR_MAIN_INJECT || path.join("patch", "bridge.js"));
}

// ---------------------------------------------------------------------------
// Tiny argument parser: --key value  (and --flag alone)
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Asar format helpers (pickle encoding, spec-compatible, no deps)
// ---------------------------------------------------------------------------

const align4 = (n) => (n + 3) & ~3;

function pickleString(str) {
  const bytes = Buffer.from(str, "utf8");
  const len = bytes.length;
  const hdr = Buffer.alloc(8);
  hdr.writeUInt32LE(4 + align4(len), 0);
  hdr.writeUInt32LE(len, 4);
  const body = Buffer.alloc(align4(len));
  bytes.copy(body, 0);
  return Buffer.concat([hdr, body]);
}

function pickleSize(bufLen) {
  const b = Buffer.alloc(8);
  b.writeUInt32LE(4, 0);
  b.writeUInt32LE(bufLen, 4);
  return b;
}

function readHeader(buf) {
  // [8 bytes: pickle of the header SIZE] then [pickle of the JSON header].
  const sizeWord = buf.readUInt32LE(0);
  const headerSize = buf.readUInt32LE(4);
  if (sizeWord !== 4) throw new Error("unexpected asar size-pickle header (" + sizeWord + ")");
  const jsonLen = buf.readUInt32LE(12);
  const json = buf.subarray(16, 16 + jsonLen).toString("utf8");
  return { header: JSON.parse(json), headerSize };
}

function sha256blocks(buf) {
  const bs = 4194304; // 4 MiB, same as Electron/update integrity
  const blocks = [];
  for (let i = 0; i < buf.length; i += bs) {
    blocks.push(crypto.createHash("sha256").update(buf.subarray(i, i + bs)).digest("hex"));
  }
  return blocks;
}

function integrityFor(buf) {
  return {
    algorithm: "SHA256",
    hash: crypto.createHash("sha256").update(buf).digest("hex"),
    blockSize: 4194304,
    blocks: sha256blocks(buf),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));

const SRC = args.src || process.env.ASAR_SRC || defaultAppPath();
const OUT = args.out || process.env.ASAR_OUT || SRC;
const SNIPPET = path.resolve(args.snippet || defaultSnippet());
const BRIDGE = path.resolve(args.bridge || defaultBridge());

const MARKER_HTML = "opencode-find-chat-patch"; // lives inside index-inject.html
const MARKER_MAIN = "opencode-ocnav-bridge"; // lives inside bridge.js

const isWin = process.platform === "win32";
function log(m) {
  process.stdout.write((isWin ? "" : "") + m + "\n");
}

for (const [label, p] of [
  ["  src   ", SRC],
  ["  out   ", OUT],
  ["  snippet", SNIPPET],
  ["  bridge", BRIDGE],
]) {
  log(label + " " + p);
}

if (!fs.existsSync(SRC)) throw new Error("--src not found: " + SRC);
const snippet = fs.readFileSync(SNIPPET, "utf8");
const bridge = fs.readFileSync(BRIDGE, "utf8");

log("Reading " + SRC + " ...");
const orig = fs.readFileSync(SRC);
const { header, headerSize } = readHeader(orig);
const base = 8 + headerSize;

// Flatten the file tree (directories first, children follow) mirroring asar order.
const flat = [];
(function walk(files, prefix) {
  for (const key of Object.keys(files)) {
    const n = files[key];
    if (n.files) walk(n.files, prefix + key + "/");
    else flat.push({ path: prefix + key, node: n });
  }
})(header.files, "");

// Locate the renderer bundles.
const mainCandidates = flat.filter((f) =>
  /^out\/renderer\/assets\/main-[A-Za-z0-9_.-]+\.(mjs|js|cjs)$/.test(f.path) ||
  f.path === "out/renderer/main.js"
);
const htmlEntry = flat.find((f) => f.path === "out/renderer/index.html");

const newData = [];
let cursor = 0;
let patchedHtml = false;
let patchedMain = false;

for (const f of flat) {
  const n = f.node;
  if (n.unpacked) continue; // content lives in <name>.unpacked/ — leave untouched
  const start = base + parseInt(n.offset, 10);
  let bytes = orig.slice(start, start + parseInt(n.size, 10));

  if (f.path === htmlEntry?.path && !patchedHtml) {
    if (bytes.includes(MARKER_HTML)) {
      log("  index.html already patched (marker found) — skipping.");
      patchedHtml = false; // already patched; do not double-insert
      patchedHtml = "already";
    } else {
      const m = bytes.indexOf("<script type=\"module\"");
      if (m === -1) throw new Error("module script tag not found in index.html");
      bytes = Buffer.concat([bytes.subarray(0, m), Buffer.from(snippet, "utf8"), bytes.subarray(m)]);
      n.size = bytes.length;
      n.integrity = integrityFor(bytes);
      if (bytes.includes(MARKER_HTML)) patchedHtml = true;
      else throw new Error("index-inject.html is missing its own marker (opencode-find-chat-patch)");
    }
  }

  if (mainCandidates.some((c) => c.path === f.path) && !patchedMain) {
    if (bytes.includes(MARKER_MAIN)) {
      log("  main bundle already patched (marker found) — skipping.");
      patchedMain = "already";
    } else {
      const anchor = Buffer.from(
        `    consumePendingMessage: layout.pendingMessage.consume\n  });`
      );
      const idx = bytes.indexOf(anchor);
      if (idx === -1) {
        throw new Error(
          "provider anchor not found in " + f.path +
          ". Your OpenCode build differs from the tested one (11831). See README section 'Compatibility'."
        );
      }
      const split = idx + anchor.length;
      const inject = Buffer.from("\n" + bridge + "\n");
      bytes = Buffer.concat([bytes.subarray(0, split), inject, bytes.subarray(split)]);
      n.size = bytes.length;
      n.integrity = integrityFor(bytes);
      if (bytes.includes(MARKER_MAIN)) patchedMain = true;
      else throw new Error("bridge.js is missing its own marker (opencode-ocnav-bridge)");
    }
  }

  n.offset = cursor.toString();
  newData.push(bytes);
  cursor += bytes.length;
}

if (!patchedHtml) throw new Error("index.html not patched (and not already patched)");
if (!patchedMain) throw new Error("main bundle not patched (and not already patched)");
if (!mainCandidates.length) log("  (no main bundle matched — only index.html was touched)");

const headerBuf = pickleString(JSON.stringify(header));
const out = Buffer.concat([pickleSize(headerBuf.length), headerBuf, ...newData]);
fs.writeFileSync(OUT, out);

log("Patched OK -> " + OUT + " (" + out.length + " bytes)");
log("  html patched : " + (patchedHtml === true));
log("  main patched : " + (patchedMain === true));
log("Done. Fully quit and reopen OpenCode Desktop for the patch to take effect.");