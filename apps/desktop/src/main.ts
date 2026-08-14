/**
 * Electron shell for the packaged dsh web profile. The harness runs as a child
 * Node process (`ELECTRON_RUN_AS_NODE` over this executable, so no separate
 * Node ships): the shell spawns `lib/bin.js web --port 0`, waits for the
 * `dsh web: http://127.0.0.1:<port>` readiness line, and opens a
 * BrowserWindow at that URL. Closing the window terminates the harness process
 * tree and quits. All harness output is mirrored to
 * `%APPDATA%/DeepSeek Harness/harness.log` for diagnostics.
 * @module @deepseek-ai/dsh-desktop
 */

import { app, BrowserWindow, dialog, Menu } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseWebUrlLine } from './url-line.ts'

/** How long the harness may take to print its readiness line before the shell gives up. */
const BOOT_TIMEOUT_MS = 60_000
/** Log file name under the Electron user-data directory. */
const HARNESS_LOG_NAME = 'harness.log'

/** The launched harness child, or `undefined` once stopped. */
let harness: ChildProcess | undefined
/** The window showing the harness GUI, or `undefined` once closed. */
let mainWindow: BrowserWindow | undefined
/** The startup placeholder shown until the harness reports its readiness URL. */
const LOADING_PAGE = 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html>
<html><head><meta charset="utf-8"><title>DeepSeek Harness</title>
<style>
  html, body { height: 100%; margin: 0; background: #0d1117; color: #c9d1d9;
    font-family: system-ui, "Segoe UI", sans-serif; }
  main { height: 100%; display: flex; flex-direction: column; gap: 16px;
    align-items: center; justify-content: center; }
  .spin { width: 28px; height: 28px; border: 3px solid #30363d; border-top-color: #4d8dff;
    border-radius: 50%; animation: r 1s linear infinite; }
  @keyframes r { to { transform: rotate(360deg); } }
  p { margin: 0; }
  .sub { color: #8b949e; font-size: 13px; }
</style></head>
<body><main>
  <div class="spin"></div>
  <p>DeepSeek Harness</p>
  <p class="sub">正在启动，请稍候…</p>
</main></body></html>`)

/** The harness child's stdout, joined into lines for readiness parsing. */
let stdoutBuffer = ''
/** Whether the app is already shutting down, so the child's exit is not a crash. */
let quitting = false

/** The harness entry: the built `apps/cli` bin, from the repo in dev and from resources when packaged. */
function harnessBinPath(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'harness', 'lib', 'bin.js')
  return join(app.getAppPath(), '..', 'cli', 'lib', 'bin.js')
}

/** Working directory for the harness child: the repo root in dev, the documents folder when packaged. */
function harnessCwd(): string {
  if (!app.isPackaged) return resolve(app.getAppPath(), '..', '..')
  try {
    return app.getPath('documents')
  } catch {
    // The documents folder is absent on minimal Windows installs; the home
    // directory is always writable as a fallback.
    return homedir()
  }
}

/** Append one chunk to the diagnostics log; a log failure must never crash the shell. */
function appendLog(logPath: string, text: string): void {
  try {
    appendFileSync(logPath, text)
  } catch {
    // The log is best-effort diagnostics; a locked or read-only file is not a shell failure.
  }
}

/** Record the harness child's stdout and stderr in the diagnostics log. */
function mirrorOutput(logPath: string, chunk: Buffer): void {
  appendLog(logPath, chunk.toString('utf8'))
}

/** Fail the boot with a user-visible error and exit non-zero. */
function failBoot(logPath: string, message: string): void {
  appendLog(logPath, `[shell] boot failed: ${message}\n`)
  if (mainWindow === undefined) {
    dialog.showErrorBox('DeepSeek Harness failed to start', `${message}\n\nSee ${logPath} for the harness log.`)
  } else {
    void mainWindow.loadURL(`data:text/plain,${encodeURIComponent(`DeepSeek Harness stopped: ${message}`)}`)
  }
  app.exit(1)
}

/** Terminate the harness process tree. A hard kill is deliberate: the harness is a child Node
 * process that never reads stdin, and Windows delivers no graceful signal to a hidden console-less
 * process, so the JSONL session log's per-event synchronous writes are the durability boundary. */
function stopHarness(): void {
  if (harness === undefined) return
  const child = harness
  harness = undefined
  spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
}

/** Create the window immediately, showing a startup placeholder until the harness URL is ready. */
function createLoadingWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    backgroundColor: '#0d1117',
    title: 'DeepSeek Harness',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow = win
  win.once('ready-to-show', () => win.show())
  win.webContents.on('did-fail-load', (_event, code, description) => {
    appendLog(join(app.getPath('userData'), HARNESS_LOG_NAME), `[shell] page load failed (${code}): ${description}\n`)
  })
  // Ctrl+Shift+I opens DevTools without a menu bar.
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'i') {
      win.webContents.toggleDevTools()
    }
  })
  win.on('closed', () => {
    quitting = true
    mainWindow = undefined
    stopHarness()
  })
  void win.loadURL(LOADING_PAGE)
  return win
}

/** Point the existing window at the harness GUI once it reports readiness. */
function showHarness(url: string): void {
  const win = mainWindow ?? createLoadingWindow()
  void win.loadURL(url)
}

/** Spawn the harness, watch its stdout for the readiness line, and open the window. */
function startHarness(): void {
  const bin = harnessBinPath()
  const cwd = harnessCwd()
  const logPath = join(app.getPath('userData'), HARNESS_LOG_NAME)
  if (!existsSync(bin)) {
    failBoot(logPath, `harness entry not found at ${bin}`)
    return
  }
  // Show the window before spawning, so a double-click always produces a
  // visible window even while the harness (or the portable stub's extraction)
  // still needs minutes.
  createLoadingWindow()
  appendLog(logPath, `\n=== ${new Date().toISOString()} boot (bin: ${bin}, cwd: ${cwd}) ===\n`)
  // --expose-internals lets the vendored Loader reach Node's internal ESM
  // loader directly: the fallback native addon (node-addon-require-builtin) is
  // compiled against Node's ABI, which Electron's embedded Node does not share.
  const child = spawn(process.execPath, ['--expose-internals', bin, 'web', '--port', '0'], {
    cwd,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  harness = child
  stdoutBuffer = ''
  let booted = false
  const bootTimeout = setTimeout(() => {
    if (!booted) failBoot(logPath, `the harness did not report a URL within ${BOOT_TIMEOUT_MS / 1000}s`)
  }, BOOT_TIMEOUT_MS)
  child.stdout.on('data', (chunk: Buffer) => {
    mirrorOutput(logPath, chunk)
    stdoutBuffer += chunk.toString('utf8')
    let newline: number
    while ((newline = stdoutBuffer.indexOf('\n')) >= 0) {
      const line = stdoutBuffer.slice(0, newline)
      stdoutBuffer = stdoutBuffer.slice(newline + 1)
      const url = parseWebUrlLine(line)
      if (url !== undefined && !booted) {
        booted = true
        clearTimeout(bootTimeout)
        showHarness(url)
      }
    }
  })
  child.stderr.on('data', (chunk: Buffer) => mirrorOutput(logPath, chunk))
  child.on('exit', (code, signal) => {
    clearTimeout(bootTimeout)
    if (quitting) return
    if (!booted) {
      failBoot(logPath, `the harness exited before serving (code ${String(code)}, signal ${String(signal)})`)
      return
    }
    if (mainWindow !== undefined) {
      dialog.showErrorBox('DeepSeek Harness stopped', `The harness process exited (code ${String(code)}).\n\nSee ${logPath} for details.`)
    }
    app.exit(code ?? 1)
  })
}

/** Single-instance guard plus the app lifecycle. */
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow !== undefined) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', () => stopHarness())
  void app.whenReady().then(() => {
    app.setAppUserModelId('ai.deepseek.harness')
    Menu.setApplicationMenu(null)
    startHarness()
  })
}
