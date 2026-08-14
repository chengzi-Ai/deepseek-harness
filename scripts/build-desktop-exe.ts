/**
 * Build the Windows desktop distribution: `pnpm run build` (lib + web dist),
 * then deploy the `@deepseek-ai/dsh` web-profile closure into
 * `apps/desktop/out/harness`, complete the peer closure, materialize every
 * junction into real files (pnpm's Windows junctions look like directories to
 * `lstat`, so the tree is flattened with a dereferencing copy instead),
 * boot-smoke the staged harness hermetically from outside the repo, and run
 * electron-builder to produce the portable exe in `apps/desktop/release/`.
 */

import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { cp, lstat, mkdir, readFile, readdir, readlink, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'

const root = resolve(import.meta.dirname, '..')

/** The shipped web-capable app whose dependency closure the desktop exe bundles. */
const DEPLOY_PACKAGE = '@deepseek-ai/dsh'
/** The staged closure: the deploy target and electron-builder extraResources source.
 * Wrapped in `payload/` so the harness's `node_modules` is a SUBdirectory of the
 * copy root: electron-builder's filter hard-excludes a root-level `node_modules`
 * before pattern matching, so the closure must not sit at the copy root. */
const STAGING = 'apps/desktop/out/payload/harness'
/** Where legacy deploy hoists peer-specialized workspace packages back to. */
const DEPLOY_SOURCE_NODE_MODULES = 'apps/cli/node_modules'
/** electron-builder output directory (the electron-builder.yml `directories.output`). */
const OUT_DIR = 'apps/desktop/release'
/** The staged harness entry the smoke boots. */
const STAGED_BIN = join(STAGING, 'lib', 'bin.js')

/** Render a command for logs and errors, quoting arguments with spaces. */
function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map(part => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ')
}

/**
 * Run one subprocess with inherited stdio. On Windows the pnpm launcher is a
 * .cmd shim, which Node can only execute through a shell.
 * @param label - the step name used in logs and error messages.
 * @param command - the executable.
 * @param args - its arguments.
 * @param cwd - the working directory; defaults to the repo root.
 */
async function run(label: string, command: string, args: string[], cwd: string = root): Promise<void> {
  const printable = formatCommand(command, args)
  console.log('build-desktop-exe: ' + label + ': ' + printable)
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      // Artifact builds must not mutate or validate a developer's Git hooks.
      env: { ...process.env, CI: 'true' },
    })
    child.once('error', (error) => {
      reject(new Error('build-desktop-exe: ' + label + ' failed to spawn: ' + error.message + ' (' + printable + ')'))
    })
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      const cause = code === null ? 'signal ' + (signal ?? 'unknown') : 'exit code ' + String(code)
      reject(new Error('build-desktop-exe: ' + label + ' failed (' + cause + '): ' + printable))
    })
  })
}

/** Build all package artifacts (lib + web dist) unless `--skip-build` was passed. */
async function build(skipBuild: boolean): Promise<void> {
  if (skipBuild) {
    console.log('build-desktop-exe: skipping pnpm run build (--skip-build)')
    return
  }
  await run('build', 'pnpm', ['run', 'build'])
}

/** Compile the Electron shell with tsc. */
async function buildShell(): Promise<void> {
  await run('shell build', 'pnpm', ['exec', 'tsc', '-p', 'apps/desktop/tsconfig.json'])
}

/** Clear and deploy the harness closure into the staging directory. */
async function deployStaging(): Promise<void> {
  const staging = resolve(root, STAGING)
  if (staging === root || root.startsWith(staging + sep)) {
    throw new Error('build-desktop-exe: refusing to clear staging dir ' + staging + ': it contains the repo root.')
  }
  await rm(staging, { recursive: true, force: true })
  await run('deploy', 'pnpm', [
    '--filter',
    DEPLOY_PACKAGE,
    'deploy',
    '--legacy',
    '--prod',
    '--config.node-linker=hoisted',
    '--config.link-workspace-packages=true',
    STAGING,
  ])
  await restoreLegacyHoists()
  // Flatten FIRST so the deployed registry closure (deploy keeps it in the
  // .pnpm virtual store) becomes the real flat node_modules the peer repair
  // below assumes, then complete the closure with workspace peers.
  await materializeStagedLinks()
  await completePeerClosure()
}

/**
 * Restore direct packages that pnpm's legacy hoister places beside the deploy
 * source instead of in the target. Package-local node_modules trees are
 * omitted to preserve one flat Cordis instance.
 */
async function restoreLegacyHoists(): Promise<void> {
  const staging = resolve(root, STAGING)
  const manifestPath = join(staging, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    dependencies?: Record<string, string>
  }
  const sourceNodeModules = resolve(root, DEPLOY_SOURCE_NODE_MODULES)
  const restored: string[] = []
  for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
    const destination = join(staging, 'node_modules', dependency)
    if (existsSync(destination)) continue
    const source = join(sourceNodeModules, dependency)
    if (!existsSync(source)) {
      throw new Error(
        'build-desktop-exe: deployed dependency ' + dependency + ' is absent from both ' + destination + ' and ' + source + '.',
      )
    }
    await mkdir(join(destination, '..'), { recursive: true })
    await copyPackageWithoutNestedModules(source, destination)
    restored.push(dependency)
  }
  if (restored.length > 0) {
    console.log('build-desktop-exe: restored legacy deploy hoists: ' + restored.join(', '))
  }
}

/**
 * Resolve a package's root directory from one anchor without depending on the
 * package exporting `./package.json`: probe the require-resolution paths for a
 * directory holding the named manifest (the same lookup app-boot's profile
 * machinery uses, so the result matches what the Loader would import).
 */
function packageDirFromAnchor(anchor: string, packageName: string): string | undefined {
  for (const searchPath of createRequire(anchor).resolve.paths(packageName) ?? []) {
    const candidate = join(searchPath, packageName)
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  return undefined
}

/** Whether a .pnpm store entry belongs to `name` (`commander@15.0.0`, `@scope+name@1.0.0`). */
function storeEntryMatches(entry: string, name: string): boolean {
  if (name.startsWith('@')) {
    const [scope, bare] = name.split('/')
    return scope !== undefined && bare !== undefined && entry.startsWith(scope + '+' + bare + '@')
  }
  return entry.startsWith(name + '@')
}

/**
 * Resolve a registry package from the workspace's own virtual store: the flat
 * workspace node_modules links only declared deps, so a transitive the deploy
 * did not materialize (e.g. a peer's own dependency) lives in
 * `node_modules/.pnpm` under a `<name>@<version>` directory.
 */
function packageFromRootPnpm(name: string): string | undefined {
  const store = join(root, 'node_modules', '.pnpm')
  if (!existsSync(store)) return undefined
  const leaf = join('node_modules', name)
  for (const entry of readdirSync(store)) {
    if (!storeEntryMatches(entry, name)) continue
    const candidate = join(store, entry, leaf)
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  return undefined
}

/**
 * Complete the peer closure. `pnpm deploy` installs only declared
 * dependencies; the published app's consumer install would auto-install peers
 * too (service definitions such as dsh-shell or dsh-invariants appear in this
 * tree only as peers), so every dependency+peer reachable from the staged
 * manifest must land flat in the staged node_modules. The staged tree is
 * already flattened at this point; missing workspace peers are copied from the
 * workspace, and their own (registry) dependencies resolve from the deployed
 * closure or the workspace store.
 */
async function completePeerClosure(): Promise<void> {
  const staging = resolve(root, STAGING)
  const nodeModules = join(staging, 'node_modules')
  const appAnchor = resolve(root, 'apps', 'cli', 'package.json')
  const visited = new Set<string>()
  const queue: string[] = [DEPLOY_PACKAGE]
  while (queue.length > 0) {
    const name = queue.shift()
    if (name === undefined || visited.has(name)) continue
    visited.add(name)
    const destination = join(nodeModules, name)
    if (!existsSync(destination)) {
      const source = packageDirFromAnchor(appAnchor, name) ?? packageFromRootPnpm(name)
      if (source === undefined) {
        throw new Error('build-desktop-exe: closure package ' + name + ' is not resolvable from the workspace.')
      }
      await mkdir(dirname(destination), { recursive: true })
      await copyPackageWithoutNestedModules(source, destination)
      console.log('build-desktop-exe: closure repair: copied ' + name)
    }
    const manifest = JSON.parse(await readFile(join(destination, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
      peerDependenciesMeta?: Record<string, { optional?: boolean }>
    }
    // Optional peers (peerDependenciesMeta.optional) are not part of the
    // required closure: consumers never auto-install them, so the BFS must
    // not demand them either.
    const requiredPeers = Object.keys(manifest.peerDependencies ?? {}).filter(name => {
      return manifest.peerDependenciesMeta?.[name]?.optional !== true
    })
    const reachable = [...Object.keys(manifest.dependencies ?? {}), ...requiredPeers]
    for (const dependency of reachable) {
      queue.push(dependency)
    }
  }
}

/** Copy a package directory, omitting its own nested node_modules (deps land flat at the staging root). */
async function copyPackageWithoutNestedModules(source: string, destination: string): Promise<void> {
  const nestedNodeModules = join(source, 'node_modules')
  await cp(source, destination, {
    recursive: true,
    dereference: true,
    filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
  })
}

/** Whether a path is a link: a symlink, or a Windows junction (which lstat reports as a directory). */
async function isLink(path: string): Promise<boolean> {
  const stats = await lstat(path)
  if (stats.isSymbolicLink()) return true
  if (process.platform !== 'win32' || !stats.isDirectory()) return false
  try {
    await readlink(path)
    return true
  } catch {
    // A real directory: readlink throws EINVAL on Windows.
    return false
  }
}

/**
 * Materialize the staged tree into real files and hoist it flat. The deploy
 * always uses the isolated layout (.pnpm virtual store) on this pnpm version,
 * so the staged node_modules is a web of Windows junctions that
 * electron-builder refuses to follow (and that would dangle once the repo is
 * gone), with transitive dependencies nested under per-package node_modules.
 * The harness's profile fallback resolves plugins flat from the app anchor
 * (npm-install semantics), so the tree must also be hoisted: flattening copies
 * each top-level entry with dereference and drops the virtual store, then
 * every nested `node_modules/<name>` moves to the root (same-version
 * duplicates collapse; version conflicts stay nested for their parent).
 */
async function materializeStagedLinks(): Promise<void> {
  const staging = resolve(root, STAGING)
  const nodeModules = join(staging, 'node_modules')
  const flattened = nodeModules + '.flattened'
  await rm(flattened, { recursive: true, force: true })
  await mkdir(flattened, { recursive: true })
  for (const entry of await readdir(nodeModules, { withFileTypes: true })) {
    if (entry.name === '.pnpm' || entry.name === '.bin') continue
    await cp(join(nodeModules, entry.name), join(flattened, entry.name), {
      recursive: true,
      dereference: true,
    })
  }
  await rm(nodeModules, { recursive: true, force: true })
  await rename(flattened, nodeModules)
  await hoistNestedModules(nodeModules)
  const remaining = await findLink(nodeModules)
  if (remaining !== undefined) {
    throw new Error('build-desktop-exe: staged tree still contains a link: ' + remaining)
  }
}

/** Collect every `node_modules` directory below a root (excluding the root itself). */
async function collectNestedModuleDirs(directory: string, acc: string[] = []): Promise<string[]> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const path = join(directory, entry.name)
    if (entry.name === 'node_modules') {
      acc.push(path)
      continue
    }
    await collectNestedModuleDirs(path, acc)
  }
  return acc
}

/** The flat package names directly inside one node_modules directory (scoped groups expanded). */
async function flatPackageNames(dir: string): Promise<string[]> {
  const names: string[] = []
  for (const name of await readdir(dir)) {
    if (name === '.bin') continue
    if (name.startsWith('@')) {
      for (const inner of await readdir(join(dir, name))) {
        names.push(name + '/' + inner)
      }
      continue
    }
    names.push(name)
  }
  return names
}

/**
 * Move packages out of nested `node_modules` directories to the flat root,
 * matching the hoisted layout the harness's flat profile fallback expects.
 * A name already at the root with the same version collapses (the nested copy
 * is dropped); a different version stays nested so its parent keeps it.
 */
async function hoistNestedModules(nodeModules: string): Promise<void> {
  const rootVersions = new Map<string, string | null>()
  for (const name of await flatPackageNames(nodeModules)) {
    rootVersions.set(name, await packageVersion(join(nodeModules, ...name.split('/'))))
  }
  for (const nested of await collectNestedModuleDirs(nodeModules)) {
    for (const name of await flatPackageNames(nested)) {
      const source = join(nested, ...name.split('/'))
      const rootVersion = rootVersions.get(name)
      const sourceVersion = await packageVersion(source)
      if (rootVersion !== undefined && rootVersion !== null && rootVersion === sourceVersion) {
        await rm(source, { recursive: true, force: true })
        continue
      }
      if (rootVersion === undefined) {
        await mkdir(join(nodeModules, ...name.split('/'), '..'), { recursive: true })
        await rename(source, join(nodeModules, ...name.split('/')))
        rootVersions.set(name, sourceVersion)
      }
      // A version conflict: keep the copy nested, its parent resolves it first.
    }
  }
}

/** Read a directory's package version, or null when it is not a package. */
async function packageVersion(dir: string): Promise<string | null> {
  try {
    const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : null
  } catch {
    // Not a package directory (scoped group folders like node_modules/@scope).
    return null
  }
}

/** Return the first link below a directory (junction-aware), if one exists. */
async function findLink(directory: string): Promise<string | undefined> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink() || await isLink(path)) return path
    if (entry.isDirectory()) {
      const nested = await findLink(path)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

/**
 * Boot the staged harness against a throwaway DSH_HOME and require the
 * readiness URL plus a served index carrying the injected boot manifest, then
 * kill the tree. The staged tree is copied outside the repo first: Node's
 * parent-directory walk from a tree inside apps/ would reach the workspace's
 * own node_modules and mask missing closure packages.
 */
async function smokeStagedHarness(): Promise<void> {
  const stagedBin = resolve(root, STAGED_BIN)
  if (!existsSync(stagedBin)) {
    throw new Error('build-desktop-exe: ' + stagedBin + ' missing — run without --skip-build so lib/ artifacts exist.')
  }
  const smokeDir = join(tmpdir(), 'dsh-desktop-smoke-' + randomUUID())
  const smokeHarness = join(smokeDir, 'harness')
  const smokeHome = join(smokeDir, 'home')
  await rm(smokeDir, { recursive: true, force: true })
  await mkdir(smokeHome, { recursive: true })
  await cp(resolve(root, STAGING), smokeHarness, { recursive: true, dereference: true })
  console.log('build-desktop-exe: smoke: booting the staged harness from ' + smokeHarness)
  const child = spawn(process.execPath, [join(smokeHarness, 'lib', 'bin.js'), 'web', '--port', '0'], {
    cwd: smokeDir,
    env: { ...process.env, DSH_HOME: smokeHome, CI: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let stdout = ''
  let url: string | undefined
  const killTree = (): void => {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  }
  const timeout = setTimeout(() => {
    killTree()
    console.error('build-desktop-exe: smoke timed out waiting for the readiness line')
    console.error(stdout.slice(-2000))
    process.exit(1)
  }, 120_000)
  const check = async (): Promise<void> => {
    clearTimeout(timeout)
    const response = await fetch(url as string)
    const html = await response.text()
    if (response.status !== 200) {
      console.error('build-desktop-exe: smoke: ' + String(url) + ' returned ' + String(response.status))
      process.exit(1)
    }
    if (!html.includes('window.__DSH_BOOT__')) {
      console.error('build-desktop-exe: smoke: served index carries no injected boot manifest')
      process.exit(1)
    }
    console.log('build-desktop-exe: smoke: served ' + String(url) + ' (HTTP ' + String(response.status) + ', boot manifest injected)')
    killTree()
  }
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8')
    const match = /dsh web: (http:\/\/127\.0\.0\.1:\d+)/.exec(stdout)
    if (match !== null && url === undefined) {
      url = match[1]
      void check()
    }
  })
  child.stderr.on('data', () => {})
}

/** Run electron-builder to produce the portable exe. */
async function pack(): Promise<void> {
  await run('electron-builder', 'pnpm', [
    '--filter',
    '@deepseek-ai/dsh-desktop',
    'exec',
    'electron-builder',
    '--config',
    'electron-builder.yml',
    '--win',
    'portable',
  ])
}

/** Print each product path and its size. */
async function printProducts(): Promise<void> {
  const outDir = resolve(root, OUT_DIR)
  if (!existsSync(outDir)) throw new Error('build-desktop-exe: ' + outDir + ' missing after electron-builder.')
  for (const entry of await readdir(outDir)) {
    if (!entry.endsWith('.exe')) continue
    const path = join(outDir, entry)
    console.log('build-desktop-exe: product ' + path + ' (' + (statSync(path).size / (1024 * 1024)).toFixed(1) + ' MB)')
  }
}

/** Validated CLI flags. */
interface BuildCliFlags {
  'skip-build': boolean
  'skip-smoke': boolean
  help: boolean
}

/** Validate the CLI and run the pipeline. */
async function main(): Promise<void> {
  let options: BuildCliFlags
  try {
    const parsed = parseArgs({
      args: process.argv.slice(2),
      options: {
        'skip-build': { type: 'boolean', default: false },
        'skip-smoke': { type: 'boolean', default: false },
        'help': { type: 'boolean', default: false },
      },
    })
    options = parsed.values as BuildCliFlags
  } catch (error) {
    console.error('build-desktop-exe: ' + (error instanceof Error ? error.message : String(error)))
    console.error(usage())
    process.exit(1)
  }
  if (options.help) {
    console.log(usage())
    process.exit(0)
  }
  await build(options['skip-build'])
  await buildShell()
  await deployStaging()
  if (!options['skip-smoke']) await smokeStagedHarness()
  await pack()
  await printProducts()
}

function usage(): string {
  return [
    'Usage: pnpm exec tsx scripts/build-desktop-exe.ts [flags]',
    '',
    '  --skip-build   skip `pnpm run build` (lib/ and apps/web dist must already exist).',
    '  --skip-smoke   skip boot-smoking the staged harness before packaging.',
    '  --help         print this help.',
    '',
    'Deploys the @deepseek-ai/dsh web-profile closure to apps/desktop/out/harness and',
    'writes the portable exe to apps/desktop/release/.',
  ].join('\n')
}

await main()
