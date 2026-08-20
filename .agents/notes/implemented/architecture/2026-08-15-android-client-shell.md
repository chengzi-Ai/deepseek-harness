# Agent Note: Android client shell for the Web GUI (dsh-mobile)

Status: implemented

English | [中文](2026-08-15-android-client-shell.zh.md)

## Problem

The DeepSeek Harness browser UI is tied to a running `dsh web` host: the host
injects `window.__DSH_BOOT__`, serves `/plugins/*/client.js` bundles, and owns
`/api`, so the GUI is not a static site. A person who wants to use the harness
from a phone has no installable client.

## Decision

### The phone is a pure client; the harness stays on a server

[`apps/mobile`](../../../../apps/mobile/README.md) (`dsh-mobile`) is a
Capacitor Android app: a WebView that loads a user-configured remote `dsh web`
URL fullscreen. The app bundles nothing of the harness — the phone cannot run
the Node runtime (native modules, terminal, filesystem), and the GUI cannot be
served statically anyway, so the client/server split is structural, not a
compromise. The first-launch screen captures the server URL into localStorage
and navigates the WebView there; `server.cleartext` allows plain-http
LAN/Tailscale servers, and `allowNavigation: ['*']` keeps the remote page
inside the WebView.

The desktop distribution
([2026-08-15-desktop-windows-distribution.md](2026-08-15-desktop-windows-distribution.md))
describes the server side. The webserver schema accepts only `127.0.0.1` or
`0.0.0.0`, and the web startup deliberately rejects `0.0.0.0`, so the phone
cannot reach the harness directly on a private interface. The supported route
is a loopback `dsh web --port <p> --trusted-host <private-ip>:<port>` plus the
zero-dependency reverse proxy `apps/mobile/scripts/dsh-proxy.mjs` listening on
the Tailscale/LAN interface and streaming every request (SSE included) to the
loopback server unchanged.

### The config is JSON, not TypeScript

`capacitor.config.json` replaces the usual `.ts` form: Capacitor's TS loader
transpiles the config with the workspace's TypeScript, which on this checkout
produces an empty module and fails `cap add`. JSON needs no loader and carries
the same fields.

### The Android project is generated and committed

`android/` is `cap add android` output and is committed like a normal
Capacitor project, so a fresh checkout can run `./gradlew assembleDebug`
directly. One APK serves any deployment: the server address is runtime user
input, not a build constant.

## Testing

- The web-side logic (saved-URL redirect, validation, connect) lives in
  `www/app.js`; the URL validation is unit-tested
  (`apps/mobile/tests/validate.spec.ts`).
- Build-time: `./gradlew assembleDebug` must produce an installable APK.
- The release APK is published as a GitHub Release asset alongside the desktop
  installers.

## Alternatives considered

- **Bundling the harness on the phone**: rejected, the Node runtime with
  native modules cannot ship on iOS at all and is a maintenance trap on
  Android; the GUI also requires the host's dynamic injection.
- **Bundling the frontend dist statically**: rejected, the shell needs the
  host-composed `window.__DSH_BOOT__` graph, the plugin bundles, and `/api`.
- **A remote-URL-only WebView without a settings screen**: rejected, the
  server address is deployment-specific user input and must not be a build
  constant.
- **React Native / Flutter shells**: rejected, Capacitor reuses the exact web
  assets with the least new code.

## Consequences

**Bought**: a single installable Android client for any harness deployment;
the server URL is first-launch configuration; the web assets in `www/` stay
platform-neutral for a future iOS build.

**Paid**: the app has no in-app way to change the saved URL (clear app data
instead); the app adds no authentication layer of its own, so server-side
protection (private network or auth proxy) is mandatory; building required a
local JDK + Android SDK toolchain, which is documented in the README.
