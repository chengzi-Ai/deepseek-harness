/**
 * Zero-dependency reverse proxy for serving a loopback dsh web server to a
 * private Tailscale/LAN interface. The harness webserver only binds
 * 127.0.0.1 (its schema rejects other hosts and 0.0.0.0 is disabled for
 * safety), so the proxy listens on the private interface and streams every
 * request to the loopback server unchanged — SSE responses stream through.
 *
 * Usage: node dsh-proxy.mjs <listenHost> <listenPort> <targetPort>
 *   node dsh-proxy.mjs 100.71.130.70 3080 3081
 */

import http from 'node:http'

const [listenHost, listenPort, targetPort] = process.argv.slice(2)
if (listenHost === undefined || listenPort === undefined || targetPort === undefined) {
  console.error('usage: node dsh-proxy.mjs <listenHost> <listenPort> <targetPort>')
  process.exit(1)
}
if (!/^\d+$/.test(listenPort) || !/^\d+$/.test(targetPort)) {
  console.error('dsh-proxy: ports must be numbers')
  process.exit(1)
}

const server = http.createServer((req, res) => {
  const upstream = http.request(
    { host: '127.0.0.1', port: Number(targetPort), path: req.url, method: req.method, headers: req.headers },
    (upstreamResponse) => {
      res.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
      upstreamResponse.pipe(res)
    },
  )
  upstream.on('error', () => {
    // Mid-stream upstream failures (a dropped SSE connection) arrive after the
    // response head is already written; only a fresh response may carry a 502.
    if (res.headersSent) {
      res.destroy()
      return
    }
    res.writeHead(502, { 'content-type': 'text/plain' })
    res.end('dsh-proxy: upstream unavailable')
  })
  req.on('error', () => upstream.destroy())
  res.on('close', () => {
    if (!res.writableEnded) upstream.destroy()
  })
  req.pipe(upstream)
})

server.listen(Number(listenPort), listenHost, () => {
  console.log(`dsh-proxy: ${listenHost}:${listenPort} -> 127.0.0.1:${targetPort}`)
})
