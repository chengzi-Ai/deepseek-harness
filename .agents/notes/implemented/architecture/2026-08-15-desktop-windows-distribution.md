# Agent Note: Windows desktop distribution (dsh-desktop)

Status: implemented

English | [中文](2026-08-15-desktop-windows-distribution.zh.md)

## Problem

The DeepSeek Harness browser UI (`dsh web`) requires a Node installation and a
browser. A person who wants a normal desktop application — double-click an
`.exe`, get a window — has no distribution form: the CLI is a terminal app and
the single-exe pipeline
([2026-07-10-single-file-executable-sdk-runtime-distribution.md](2026-07-10-single-file-executable-sdk-runtime-distribution.md))
packages a stdio JSON-RPC server, not a GUI.

## Decision

### The shell is Electron; the harness is a child Node process

[`apps/desktop`](../../../../apps/desktop/README.md) (`@deepseek-ai/dsh-desktop`)
is an Electron shell. The main process spawns the bundled harness as a child
with `ELECTRON_RUN_AS_NODE=1` over `process.execPath`, so the harness runs on
Electron's embedded Node (no separate Node ships), plus `--expose-internals`
on the child's argv: the vendored Loader reaches Node's internal ESM loader
directly under that flag, while its fallback native addon
(`node-addon-require-builtin`) is compiled against Node's ABI, which
Electron's embedded Node does not share. The child entry is the built
`apps/cli` bin (`lib/bin.js web --port 0`): the exact same composition
the CLI serves. The shell opens a startup placeholder window before spawning,
so a double-click always produces a visible window, and swaps that window to
the harness URL on the readiness line. The harness is terminated with
`taskkill /T /F` on quit: Windows delivers no graceful signal to a hidden
console-less child, so the JSONL session log's per-event synchronous writes
are the durability boundary.

The in-process alternative (importing `runProfile` inside Electron main) was
rejected: it couples the cordis tree to Electron's event loop and lifecycle,
while the child keeps the exact `dsh web` semantics and isolates crashes. A
separate bundled Node binary was rejected because `ELECTRON_RUN_AS_NODE`
removes the need.

### The closure is `@deepseek-ai/dsh` deployed directly

Unlike the Python SDK runtime, which needs a dedicated zero-code closure
manifest because the JSONRPC demo bin deliberately has a tiny dependency
surface, `apps/cli` IS the shipped web-capable app: its `dependencies` (through
`dsh-base` and `dsh-web-app`) are the full web-profile plugin set. The build
script ([`scripts/build-desktop-exe.ts`](../../../../scripts/build-desktop-exe.ts))
therefore deploys `@deepseek-ai/dsh` with the same legacy-deploy route as the
SEA pipeline (`--legacy --prod --config.node-linker=hoisted
--config.link-workspace-packages=true`), with one deliberate difference: peer
auto-install stays ON. The minimal SDK bin can afford a closed deterministic
set, but the web closure contains peer-only Service Definition packages
(`dsh-invariants`) that a consumer install of the published app would
auto-install too, so disabling peers would ship a tree the Loader cannot
resolve. The script then restores legacy hoists and materializes every symlink
so the staged tree is symlink-free. electron-builder packs the staged tree as
extraResources (real files, not asar), which keeps Node module resolution and
native addons working inside the packaged app.

### The desktop app shares the default Harness home

The child inherits the environment and `$DSH_HOME` defaults to `~/.dsh`, so an
existing `dsh web` install keeps its credentials
(`~/.dsh/.credentials.yaml`), settings, sessions, and profiles. The
`profiles/node_modules` junction fallback is re-healed by the harness on every
boot, pointing at the packaged tree.

### Verification is staged

The build script boot-smokes the staged harness against a throwaway
`DSH_HOME` before packaging: it must print the readiness URL and serve the
index with HTTP 200, which exercises profile templates, bundle resolution,
plugin loads, and frontend serving entirely against the packaged tree.

## Testing

- Unit: `apps/desktop/tests/url-line.spec.ts` covers the readiness-line
  parser (plain line, LAN-suffix line, non-readiness lines).
- Build-time: the staged-harness boot smoke described above runs in
  `scripts/build-desktop-exe.ts` and fails the build on a non-serving closure.
- Manual: `pnpm --filter @deepseek-ai/dsh-desktop exec electron .` runs the
  shell against the checkout's built CLI; the packaged exe is launched from
  `apps/desktop/release/`.

## Alternatives considered

- **In-process boot in Electron main**: rejected, see Decision.
- **Bundling a second Node binary**: rejected, `ELECTRON_RUN_AS_NODE`
  provides Electron's Node to the child.
- **`pkg --sea` for the whole app**: rejected, pkg bundles Node, not
  Chromium; Electron is the only realistic Windows GUI carrier.
- **A bare Vite wrapper**: rejected, the shell must serve the full host with
  `window.__DSH_BOOT__` injection; only `dsh web` provides it.

## Consequences

**Bought**: a double-click `.exe` desktop window for the harness GUI on
Windows; zero extra runtime beyond the exe; the exact `dsh web` composition
(no drift between CLI and desktop); shared credentials/state with the CLI via
the default home.

**Paid**: the portable target re-extracts its ~300 MB payload on every launch,
so the first window can take minutes on slow disks with Defender scanning —
the per-user NSIS installer is therefore the recommended distribution (one
install, seconds-long launches, measured 5.4s to harness readiness);
harness teardown is a hard kill, so a crash window on quit is the durability
boundary; no icon or code signing yet, so SmartScreen may warn;
Windows-only (other platforms are out of scope for now).
