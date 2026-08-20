/**
 * Build the dsh-mobile Android APK (apps/mobile): sync Capacitor web assets,
 * run the Gradle Android build with the local JDK/SDK toolchain, and stage the
 * APK under apps/mobile/release/. Debug by default; `--release` signs with the
 * keystore declared by apps/mobile/keystore.properties (gitignored):
 *
 *   storeFile=<absolute path to the .jks>
 *   storePassword=<...>
 *   keyAlias=<...>
 *   keyPassword=<...>
 *
 * Generate one with the bundled JDK, e.g.:
 *   E:\android-toolchain\jdk\bin\keytool.exe -genkeypair -v -keystore dsh-mobile.jks \
 *     -alias dsh-mobile -keyalg RSA -keysize 2048 -validity 10000
 */

import { spawn } from 'node:child_process'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const root = resolve(import.meta.dirname, '..')
const MOBILE_DIR = 'apps/mobile'
const ANDROID_DIR = join(MOBILE_DIR, 'android')
const OUT_DIR = join(MOBILE_DIR, 'release')
const KEYSTORE_PROPS = join(MOBILE_DIR, 'keystore.properties')

/** Default local toolchain locations; overridable through JAVA_HOME / ANDROID_HOME. */
const DEFAULT_JAVA_HOME = 'E:\\android-toolchain\\jdk'
const DEFAULT_ANDROID_HOME = 'E:\\android-toolchain\\sdk'

/** Render a command for logs and errors, quoting arguments with spaces. */
function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map(part => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ')
}

/**
 * Run one subprocess with inherited stdio; on Windows the gradle launcher is a
 * .bat shim, which Node can only execute through a shell.
 * @param label - the step name used in logs and error messages.
 * @param command - the executable.
 * @param args - its arguments.
 * @param cwd - the working directory.
 * @param env - extra environment entries.
 */
async function run(
  label: string, command: string, args: string[], cwd: string, env: Record<string, string> = {},
): Promise<void> {
  const printable = formatCommand(command, args)
  console.log('build-android-apk: ' + label + ': ' + printable)
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, ...env },
    })
    child.once('error', (error) => {
      reject(new Error('build-android-apk: ' + label + ' failed to spawn: ' + error.message + ' (' + printable + ')'))
    })
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      const cause = code === null ? 'signal ' + (signal ?? 'unknown') : 'exit code ' + String(code)
      reject(new Error('build-android-apk: ' + label + ' failed (' + cause + '): ' + printable))
    })
  })
}

/** Read the gitignored signing properties for release builds. */
async function readKeystoreProps(): Promise<Record<string, string>> {
  const raw = await readFile(resolve(root, KEYSTORE_PROPS), 'utf8')
  const props: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z0-9_.]+)\s*=\s*(.+?)\s*$/.exec(line)
    if (match !== null && match[1] !== undefined && match[2] !== undefined) {
      props[match[1]] = match[2]
    }
  }
  return props
}

/** The toolchain environment for the Android build, resolved from env or defaults. */
function toolchainEnv(): { javaHome: string; androidHome: string } {
  const javaHome = process.env.JAVA_HOME ?? DEFAULT_JAVA_HOME
  const androidHome = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? DEFAULT_ANDROID_HOME
  if (!existsSync(join(javaHome, 'bin', 'java.exe'))) {
    throw new Error('build-android-apk: no JDK at ' + javaHome + '; set JAVA_HOME or install to ' + DEFAULT_JAVA_HOME + '.')
  }
  if (!existsSync(join(androidHome, 'platforms', 'android-36'))) {
    throw new Error('build-android-apk: android-36 platform missing under ' + androidHome + '; run sdkmanager first.')
  }
  return { javaHome, androidHome }
}

/** Validated CLI flags. */
interface BuildCliFlags {
  'skip-sync': boolean
  release: boolean
  help: boolean
}

async function main(): Promise<void> {
  let options: BuildCliFlags
  try {
    const parsed = parseArgs({
      args: process.argv.slice(2),
      options: {
        'skip-sync': { type: 'boolean', default: false },
        'release': { type: 'boolean', default: false },
        'help': { type: 'boolean', default: false },
      },
    })
    options = parsed.values as BuildCliFlags
  } catch (error) {
    console.error('build-android-apk: ' + (error instanceof Error ? error.message : String(error)))
    console.error(usage())
    process.exit(1)
  }
  if (options.help) {
    console.log(usage())
    process.exit(0)
  }

  const env = toolchainEnv()
  const gradleEnv = { JAVA_HOME: env.javaHome, ANDROID_HOME: env.androidHome, ANDROID_SDK_ROOT: env.androidHome }
  const androidDir = resolve(root, ANDROID_DIR)
  // Point the Gradle build at the local SDK. Forward slashes only: Java
  // properties parsing treats backslashes as escape characters.
  await writeFile(join(androidDir, 'local.properties'), 'sdk.dir=' + env.androidHome.replace(/\\/g, '/') + '\n')

  if (!options['skip-sync']) {
    await run('cap sync', resolve(root, MOBILE_DIR, 'node_modules', '.bin', 'cap.cmd'),
      ['sync', 'android'], resolve(root, MOBILE_DIR), gradleEnv)
  }

  const gradleArgs = options.release ? ['assembleRelease'] : ['assembleDebug']
  if (options.release) {
    const props = await readKeystoreProps()
    const required = ['storeFile', 'storePassword', 'keyAlias', 'keyPassword']
    for (const key of required) {
      if (props[key] === undefined) {
        throw new Error('build-android-apk: ' + KEYSTORE_PROPS + ' misses ' + key + ' (release builds need all four).')
      }
    }
    gradleArgs.push(
      '-Pandroid.injected.signing.store.file=' + props.storeFile,
      '-Pandroid.injected.signing.store.password=' + props.storePassword,
      '-Pandroid.injected.signing.key.alias=' + props.keyAlias,
      '-Pandroid.injected.signing.key.password=' + props.keyPassword,
    )
  }
  await run('gradle ' + gradleArgs.join(' '), 'gradlew.bat', gradleArgs, androidDir, gradleEnv)

  const variant = options.release ? 'release' : 'debug'
  const apk = join(androidDir, 'app', 'build', 'outputs', 'apk', variant, 'app-' + variant + '.apk')
  if (!existsSync(apk)) {
    throw new Error('build-android-apk: ' + apk + ' missing after the Gradle build.')
  }
  const outDir = resolve(root, OUT_DIR)
  await mkdir(outDir, { recursive: true })
  const product = join(outDir, 'dsh-mobile-0.1.0-rc.5-' + variant + '.apk')
  await copyFile(apk, product)
  console.log('build-android-apk: product ' + product + ' (' + (statSync(product).size / (1024 * 1024)).toFixed(1) + ' MB)')
}

function usage(): string {
  return [
    'Usage: pnpm exec tsx scripts/build-android-apk.ts [flags]',
    '',
    '  --release     build a signed release APK (keystore.properties required).',
    '  --skip-sync   skip `cap sync android` (web assets already synced).',
    '  --help        print this help.',
    '',
    'Debug APK is the default; the signed APK is staged under apps/mobile/release/.',
  ].join('\n')
}

await main()
