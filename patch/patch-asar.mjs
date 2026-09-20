#!/usr/bin/env node
// patch-asar.mjs — rebuild OpenCode Desktop's app.asar with the SearchBox patches.
//
// Two surgical edits (idempotent, driven by markers):
//   1. out/renderer/index.html              -> insert  index-inject.html  (search UI + RTL fix)
//   2a. out/renderer/assets/main-*.js       -> insert  bridge.js          (window.__ocNav bridge, build 11831 layout)
//   2b. out/renderer/assets/route-*.js      -> insert  generated bridge   (window.__ocNav bridge, build 2.x route chunk)
// Newer builds moved the pendingMessage/scrollToMessage provider chain from the
// main bundle into a lazily-loaded route chunk with minified names, so the route
// bridge identifiers are parsed out of the matched Ck({...}) call and injected
// as one more declarator (`,__ocNavSetup=(...)`) right after it — a statement
// cannot be spliced into the middle of a `let` chain. When neither anchor is
// recognized the bridge is skipped and the search UI still works standalone
// (REST index + DOM scan + legacy scroll).
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
// Build 2.x moved the session/timeline provider into a lazily-loaded route chunk.
const routeCandidates = flat.filter((f) =>
  /^out\/renderer\/assets\/route-[A-Za-z0-9_.-]+\.js$/.test(f.path)
);
const htmlEntry = flat.find((f) => f.path === "out/renderer/index.html");

// Parse a 2.x route chunk and generate the __ocNav bridge expression for it.
// Returns the expression string, or null when the anchor shape is not recognized.
function buildRouteBridge(src) {
  const mO = src.match(/clearMessageHash:\s*(\w+)\s*,\s*scrollToMessage:\s*(\w+)\s*\}=Ck\(\{/);
  const mSes = src.match(/sessionID:\(\)=>(\w+)\.identity\.params\.id/);
  const mMR = src.match(/messagesReady:([\w$.]+?)\s*,/);
  const mHM = src.match(/historyMore:([\w$.]+?)\s*,/);
  const mHL = src.match(/historyLoading:([\w$.]+?)\s*,/);
  const mLM = src.match(/loadMore:(\w+)\s*,/);
  const mCID = src.match(/currentMessageId:\(\)=>(\w+)\.messageID/);
  const mPM = src.match(/pendingMessage:\(\)=>(\w+)\.pendingMessage/);
  const mSPM = src.match(/setPendingMessage:(.+?),\s*setActiveMessage:/);
  const mSAM = src.match(/setActiveMessage:(\w+)\s*,/);
  const mScrAnc = src.match(/scroller:\(\)=>(\w+)\s*,anchor:(\w+)\s*,/);
  if (!mO || !mSes || !mMR || !mHM || !mHL || !mLM || !mCID || !mPM || !mSPM || !mSAM || !mScrAnc) return null;
  const O = mO[2];
  const sesFn = `()=>${mSes[1]}.identity.params.id`;
  const mr = mMR[1], hm = mHM[1], hl = mHL[1], lm = mLM[1];
  const st = mCID[1];
  const spm = mSPM[1];
  const sam = mSAM[1];
  const scr = mScrAnc[1], anc = mScrAnc[2];
  const mFol = src.match(/follow:\{unpin:(\w+),toBottom:\(\)=>\{(\w+)\(\),/);
  const auto = mFol ? `,autoScroll:{pause:${mFol[1]},resume:${mFol[2]}}` : ``;
  return (
    `typeof window<"u"?void 0:(window.__ocNav=Object.freeze({` +
    `setPendingMessage:(${spm}),` +
    `pendingMessage:()=>${st}.pendingMessage,` +
    `clearPendingMessage:()=>{try{(${spm})(void 0)}catch(_e){}},` +
    `sessionID:(${sesFn}),` +
    `messagesReady:()=>${mr}(),` +
    `historyMore:()=>${hm}(),` +
    `historyLoading:()=>${hl}(),` +
    `loadMore:function(){try{return ${lm}()}catch(_e){}},` +
    `currentMessageId:()=>${st}.messageID,` +
    `setActiveMessage:${sam},` +
    `revealMessage:function(id){try{${O}({id:id},"auto")}catch(_e){}},` +
    `get scroller(){try{return ${scr}()}catch(_e){return null}},` +
    `anchor:${anc}${auto},` +
    `__ocBridge:"${MARKER_MAIN}"}))`
  );
}

const newData = [];
let cursor = 0;
let patchedHtml = false;
let patchedMain = false;
let patchedRoute = false;

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

  if (mainCandidates.some((c) => c.path === f.path) && patchedMain !== true && patchedMain !== "already") {
    if (bytes.includes(MARKER_MAIN)) {
      log("  main bundle already patched (marker found) — skipping.");
      patchedMain = "already";
    } else {
      const anchor = Buffer.from(
        `    consumePendingMessage: layout.pendingMessage.consume\n  });`
      );
      const idx = bytes.indexOf(anchor);
      if (idx === -1) {
        // Probably a 2.x build: the provider chain lives in a route chunk now.
        log("  main bundle has no 11831 anchor (" + f.path + ") — will try route chunk.");
        patchedMain = "no-anchor";
      } else {
        const split = idx + anchor.length;
        const inject = Buffer.from("\n" + bridge + "\n");
        bytes = Buffer.concat([bytes.subarray(0, split), inject, bytes.subarray(split)]);
        n.size = bytes.length;
        n.integrity = integrityFor(bytes);
        if (bytes.includes(MARKER_MAIN)) patchedMain = true;
        else throw new Error("bridge.js is missing its own marker (opencode-ocnav-bridge)");
      }
    }
  }

  if (routeCandidates.some((c) => c.path === f.path) && patchedRoute !== true && patchedRoute !== "already") {
    if (bytes.includes(MARKER_MAIN)) {
      log("  route chunk already patched (marker found) — skipping.");
      patchedRoute = "already";
    } else {
      const src = bytes.toString("utf8");
      const expr = src.includes("pendingMessage.consume(") ? buildRouteBridge(src) : null;
      if (!expr) {
        log("  WARNING: route anchor not recognized in " + f.path + " — leaving bridge out for this chunk.");
        patchedRoute = "skipped-no-anchor";
      } else {
        const ci = src.indexOf("pendingMessage.consume(");
        const close = src.indexOf("}),", ci);
        const after = close === -1 ? "" : src.slice(close, close + 40);
        if (ci === -1 || close === -1 || !/^\}\),\s*[A-Za-z_$][\w$]*\s*=\s*\(/.test(after)) {
          log("  WARNING: route insertion point unsafe in " + f.path + " — leaving bridge out.");
          patchedRoute = "skipped-no-anchor";
        } else {
          const inject = "__ocNavSetup=(" + expr + "),";
          bytes = Buffer.concat([bytes.subarray(0, close + 3), Buffer.from(inject, "utf8"), bytes.subarray(close + 3)]);
          n.size = bytes.length;
          n.integrity = integrityFor(bytes);
          if (bytes.includes(MARKER_MAIN)) {
            patchedRoute = true;
            log("  route bridge injected into " + f.path);
          } else throw new Error("generated route bridge is missing its own marker (opencode-ocnav-bridge)");
        }
      }
    }
  }

  n.offset = cursor.toString();
  newData.push(bytes);
  cursor += bytes.length;
}

if (!patchedHtml) throw new Error("index.html not patched (and not already patched)");
const bridgeOk = patchedMain === true || patchedMain === "already" || patchedRoute === true || patchedRoute === "already";
if (!bridgeOk) log("  (no native bridge in this build — search UI works standalone via REST/DOM + legacy scroll)");
if (!mainCandidates.length && !routeCandidates.length) log("  (no JS bundle matched — only index.html was touched)");

const headerBuf = pickleString(JSON.stringify(header));
const out = Buffer.concat([pickleSize(headerBuf.length), headerBuf, ...newData]);
fs.writeFileSync(OUT, out);

log("Patched OK -> " + OUT + " (" + out.length + " bytes)");
log("  html patched : " + (patchedHtml === true ? "true" : patchedHtml));
log("  main patched : " + (patchedMain === true ? "true" : patchedMain));
log("  route patched: " + (patchedRoute === true ? "true" : patchedRoute));
log("Done. Fully quit and reopen OpenCode Desktop for the patch to take effect.");