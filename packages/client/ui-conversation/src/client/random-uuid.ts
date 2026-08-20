/** Browser-safe UUID generation for attachment draft ids. */

/**
 * Generate an RFC 4122 version 4 UUID without requiring a secure context.
 * `crypto.randomUUID()` exists only on secure origins (https/localhost), so a
 * phone reaching the GUI over plain http would crash at draft creation; this
 * mirrors the connection package's wire-correlation helper instead.
 * @returns a UUID backed by `crypto.getRandomValues()`, which browsers expose on insecure origins.
 */
export function randomUuid(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  view.setUint8(6, (view.getUint8(6) & 0x0f) | 0x40)
  view.setUint8(8, (view.getUint8(8) & 0x3f) | 0x80)
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
