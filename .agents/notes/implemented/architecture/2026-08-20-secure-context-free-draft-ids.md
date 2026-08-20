# Agent Note: Secure-context-free draft attachment ids (ui-conversation)

Status: implemented

English | [中文](2026-08-20-secure-context-free-draft-ids.zh.md)

## Problem

The Web GUI ran fine on `http://127.0.0.1` and `http://localhost` (secure
contexts), but a phone reaching the same host over plain http on a private
address (`http://100.71.130.70:3080` through the mobile reverse proxy) crashed
at startup with `crypto.randomUUID is not a function`: the browser exposes
`crypto.randomUUID()` only on secure origins, while the attachment draft code
in `dsh-client-ui-conversation` called it directly.

## Decision

`ui-conversation/src/client/random-uuid.ts` generates an RFC 4122 v4 UUID from
`crypto.getRandomValues()`, which browsers expose on insecure origins, and
`service.ts` uses it for draft attachment ids. The helper mirrors
`dsh-client-connection`'s existing wire-correlation `randomUuid`, which already
proved this exact need; cross-package imports of another plugin's internals
are forbidden, so the five-line implementation is local. No public exports
change: the helper is package-internal.

## Testing

- Unit: `packages/client/ui-conversation/tests/random-uuid.client.spec.ts`
  asserts the v4/variant format and distinctness.
- Suite: `pnpm run test:gui` green; the client aggregate typechecks.
- The frontend dist was rebuilt and the phone-facing server restarted with it.

## Consequences

**Bought**: the GUI boots over plain http on private (Tailscale/LAN)
interfaces, which is the only reachability the mobile deployment has without
certificates; draft attachments work on insecure origins.

**Paid**: a second copy of a five-line UUID helper (the cross-package export
rules forbid sharing the connection package's copy); nothing else.
