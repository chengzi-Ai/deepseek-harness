/** Return true when the value looks like an http(s) server URL. */
function validateServerUrl(value) {
  return /^https?:\/\/.+/i.test(String(value).trim())
}
