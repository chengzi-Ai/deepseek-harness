/**
 * The dsh web readiness line: `dsh web: http://127.0.0.1:PORT` (with an
 * optional ` (LAN: ...)` suffix), printed once the webserver has bound and the
 * Loader tree settled. The desktop shell turns this line into the window URL.
 * @module @deepseek-ai/dsh-desktop/url-line
 */

/** The readiness-line prefix the web-app bundle prints on stdout. */
const READINESS_PREFIX = 'dsh web: '

/**
 * Parse one stdout line into the local GUI URL, when it is the readiness line.
 * The LAN suffix is display-only and never part of the URL.
 * @param line - one line of the harness child's stdout.
 * @returns the `http://127.0.0.1:<port>` URL, or `undefined` for any other line.
 */
export function parseWebUrlLine(line: string): string | undefined {
  if (!line.startsWith(READINESS_PREFIX)) return undefined
  const match = /^http:\/\/127\.0\.0\.1:\d+/.exec(line.slice(READINESS_PREFIX.length))
  return match?.[0]
}
