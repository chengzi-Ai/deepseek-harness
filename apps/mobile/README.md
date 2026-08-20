# dsh-mobile — Android client shell for the DeepSeek Harness GUI

`dsh-mobile` is a thin Android app: a Capacitor WebView that connects to a
**remote `dsh web` server** and shows its GUI fullscreen. It bundles no
harness runtime — the GUI cannot be served statically, because the host
injects `window.__DSH_BOOT__`, serves `/plugins/*/client.js`, and owns `/api`.

On first launch the app shows a setup screen; enter your server URL (for
example `https://your-server.example`, or a Tailscale/LAN address such as
`http://100.64.0.1:3080`) and tap connect. The URL is stored on the device
(localStorage) and reused until the app data is cleared.

## Security

The remote server can execute code, so only connect to servers you control,
preferably over Tailscale or a VPN. The webserver binds only loopback
(`0.0.0.0` is disabled for safety), so serve the phone through the bundled
zero-dependency reverse proxy, which listens on the private interface and
streams to a loopback `dsh web`:

```sh
node apps/cli/src/bin.ts web --port 3081 --trusted-host 100.71.130.70:3080
node apps/mobile/scripts/dsh-proxy.mjs 100.71.130.70 3080 3081
```

Then enter `http://100.71.130.70:3080` in the app. The desktop distribution's
[Agent Note](../../.agents/notes/implemented/architecture/2026-08-15-desktop-windows-distribution.md)
describes the harness's host bind and trust-fence options.

## Build

```sh
pnpm install --filter dsh-mobile
pnpm --filter dsh-mobile exec cap add android     # once
pnpm --filter dsh-mobile exec cap sync android
cd apps/mobile/android
./gradlew assembleDebug                          # debug APK
```

Release signing follows the standard Capacitor/Android flow (generate a
keystore, then `./gradlew assembleRelease` with a signing config). The
checked-in configuration points the WebView at whatever URL the user enters
at first launch, so one APK serves any deployment.

## Known Limitations and Deferred Work

- The server address is changed by pressing the Android back button on the
  remote GUI's entry page, which returns to the bundled setup screen
  (`MainActivity` overrides `onBackPressed` when the WebView has no history).
- There is no login flow in the app itself; protect the server side (auth
  proxy or private network) instead.
- iOS is out of scope for now (requires a macOS build host and an Apple
  Developer account); the Capacitor web assets in `www/` are platform-neutral.
