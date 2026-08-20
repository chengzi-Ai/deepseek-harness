/** Local storage key holding the configured dsh web server URL. */
const SERVER_URL_KEY = 'dshServerUrl'

/** Navigate to the server GUI inside this WebView. */
function connect(url) {
  location.replace(url)
}

const saved = localStorage.getItem(SERVER_URL_KEY)
if (saved !== null && validateServerUrl(saved)) {
  connect(saved)
} else {
  document.getElementById('setup').addEventListener('submit', (event) => {
    event.preventDefault()
    const input = document.getElementById('url')
    const url = input.value.trim()
    if (!validateServerUrl(url)) {
      document.getElementById('error').hidden = false
      return
    }
    localStorage.setItem(SERVER_URL_KEY, url)
    connect(url)
  })
}
