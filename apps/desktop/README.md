# dsh-desktop — Windows desktop shell for the dsh web profile

`@deepseek-ai/dsh-desktop` is an Electron shell that runs the packaged
DeepSeek Harness browser UI as a native Windows window. It spawns the bundled
`dsh` CLI (`lib/bin.js web --port 0`) as a child Node process — using
`ELECTRON_RUN_AS_NODE` plus `--expose-internals`, so no separate Node ships
and the vendored Loader reaches Node's internal ESM loader without its
Node-ABI-compiled fallback addon — waits for the harness's readiness URL, and
opens a `BrowserWindow` at it. Closing the window terminates the harness
process tree and exits.

## What is inside the exe

- The Electron shell (this package).
- The full `@deepseek-ai/dsh` web-profile closure: every plugin, the vendored
  Cordis instance, and the built `apps/web` frontend dist, deployed through the
  same legacy-deploy + symlink-materialization route as the single-exe SDK
  runtime (`.agents/notes/implemented/architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md`)
  and staged under `apps/desktop/out/harness` as electron-builder
  extraResources.

The exe runs the same `dsh web` composition as the CLI. It shares the default
Harness home (`$DSH_HOME`, else `~/.dsh`), so an existing `dsh web` install
keeps its credentials (`~/.dsh/.credentials.yaml`), settings, sessions, and
profiles.

## Build

```sh
pnpm exec tsx scripts/build-desktop-exe.ts
```

The script builds the repository (lib + web dist), deploys and materializes
the closure, boot-smokes the staged harness against a throwaway `DSH_HOME`,
then runs electron-builder. Two Windows artifacts land in
`apps/desktop/release/`:

- `DeepSeek-Harness-<version>-setup-x64.exe` — the **recommended** per-user
  NSIS installer (installs once; launches take seconds and the shell shows a
  startup window immediately).
- `DeepSeek-Harness-<version>-portable-x64.exe` — a single-file portable exe;
  it re-extracts its ~300 MB payload to a temp directory on every launch, so
  the first window can take minutes on slow disks with Defender scanning.

Flags: `--skip-build` (artifacts already exist), `--skip-smoke` (skip the
staged-harness boot test).

## Development

Run the shell against the repository's built CLI without packaging:

```sh
pnpm run build          # repo lib + web dist once
pnpm --filter @deepseek-ai/dsh-desktop exec tsc -p tsconfig.json
pnpm --filter @deepseek-ai/dsh-desktop exec electron .
```

The shell boots `apps/cli/lib/bin.js web --port 0` from the checkout. Harness
output is mirrored to `harness.log` under the Electron user-data directory
(`%APPDATA%/DeepSeek Harness/` when packaged).

## Known Limitations and Deferred Work

- The harness is terminated with `taskkill /T /F` on quit: Windows delivers no
  graceful signal to a hidden console-less child, so the JSONL session log's
  per-event synchronous writes are the durability boundary.
- The portable target self-extracts the ~300 MB payload into a temp directory
  on every launch, so startup takes a few seconds; an NSIS installer is the
  natural follow-up for installed launches.
- No application icon is shipped yet; electron-builder falls back to the
  default Electron icon.
- The exe is unsigned, so SmartScreen may warn on first launch.
