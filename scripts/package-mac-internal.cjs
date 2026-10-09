const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { artifactNames, validateVersion } = require('./package-mac-checks.cjs')

const root = path.resolve(__dirname, '..')
const gitRepositoryRoot = (() => {
  const result = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' })
  if (result.status !== 0 || !result.stdout.trim()) return root
  const commonDirectory = path.resolve(root, result.stdout.trim())
  return path.basename(commonDirectory) === '.git' ? path.dirname(commonDirectory) : root
})()
const debugRoot = path.join(root, '.debug')
const releaseRoot = path.join(gitRepositoryRoot, 'release')
const lockPath = path.join(debugRoot, 'package.lock')
let lock
let logs
let pipelineLog
let promoted = false

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
const sha256File = file => {
  const digest = crypto.createHash('sha256')
  const descriptor = fs.openSync(file, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    let length
    while ((length = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) digest.update(buffer.subarray(0, length))
  } finally {
    fs.closeSync(descriptor)
  }
  return digest.digest('hex')
}

function run(name, command, args, environment = {}) {
  const heading = `\n--- ${name} ---\n`
  process.stdout.write(heading)
  fs.appendFileSync(pipelineLog, heading)
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...environment },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (output) {
    process.stdout.write(output)
    fs.appendFileSync(pipelineLog, output)
  }
  if (result.error || result.status !== 0) {
    const reason = result.error?.message ?? (result.signal ? `signal ${result.signal}` : `exit ${result.status ?? 'unknown'}`)
    throw new Error(`${name} failed (${reason}). See ${logs}.`)
  }
  return result.stdout.trim()
}

function assertChild(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate))
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`Path outside expected directory: ${candidate}`)
}

function timestamp() {
  const date = new Date()
  const number = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}${number(date.getMonth() + 1)}${number(date.getDate())}-${number(date.getHours())}${number(date.getMinutes())}${number(date.getSeconds())}`
}

function playwrightPassed(reportFile) {
  const report = readJson(reportFile)
  if (report.stats.expected < 1 || report.stats.unexpected !== 0 || report.stats.skipped !== 0 || report.stats.flaky !== 0) throw new Error('Packaged desktop test report did not confirm success.')
  return report.stats.expected
}

function main() {
  if (process.platform !== 'darwin') throw new Error('This packaging command requires macOS.')
  if (process.arch !== 'arm64') throw new Error('Dual-architecture runtime validation requires an Apple Silicon Mac.')
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 22 || (major === 22 && minor < 12)) throw new Error('Node.js >=22.12 is required.')
  fs.mkdirSync(debugRoot, { recursive: true })
  fs.mkdirSync(releaseRoot, { recursive: true })
  try { lock = fs.openSync(lockPath, 'wx') }
  catch { throw new Error('Packaging is locked. Wait for the current run; after an interrupted run, remove .debug/package.lock only when no packaging process remains.') }

  const runId = `${timestamp()}-${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`
  const runRoot = path.join(debugRoot, 'package-runs', runId)
  const staging = path.join(runRoot, 'package')
  logs = path.join(runRoot, 'logs')
  pipelineLog = path.join(logs, 'pipeline.log')
  fs.mkdirSync(staging, { recursive: true })
  fs.mkdirSync(logs, { recursive: true })

  try {
    const inputsFile = path.join(logs, 'inputs.json')
    run('Locked dependencies and source snapshot', process.execPath, ['scripts/package-checks.cjs', 'preflight', inputsFile])
    const inputs = readJson(inputsFile)
    const version = validateVersion(readJson(path.join(root, 'package.json')).version)
    const destination = path.join(releaseRoot, `${version}-internal-mac-${runId}`)
    if (fs.existsSync(destination)) throw new Error('Release destination already exists.')
    assertChild(staging, runRoot)
    assertChild(destination, releaseRoot)

    run('Xcode command-line tools', 'xcode-select', ['-p'])
    run('Rosetta x64 runtime', 'arch', ['-x86_64', '/usr/bin/true'])
    run('Type checking', 'npm', ['run', 'typecheck'])
    const unitFile = path.join(logs, 'unit-tests.json')
    run('Unit tests', 'npm', ['test', '--', '--reporter=default', '--reporter=json', `--outputFile=${unitFile}`])
    const unit = readJson(unitFile)
    if (!unit.success || unit.numPassedTests < 1 || unit.numFailedTests !== 0) throw new Error('Unit test report did not confirm success.')
    run('macOS packaging tests', 'npm', ['run', 'test:package:mac'])
    run('Generate icons from the master SVG', 'npm', ['run', 'build:icon'])
    run('Compile application', 'npm', ['run', 'build'])

    const packageEnvironment = { QTYPORA_RELEASE_DIR: staging, QTYPORA_PACKAGE_LOG_DIR: logs }
    run('Build arm64 and x64 DMG files', path.join(root, 'node_modules/.bin/electron-builder'), ['--config', 'electron-builder.mac-internal.cjs', '--mac', 'dmg', '--arm64', '--x64', '--publish', 'never'], packageEnvironment)
    const payloadFile = path.join(logs, 'payload.json')
    run('Verify DMG, signatures, architectures and packaged resources', process.execPath, ['scripts/package-mac-checks.cjs', 'verify', staging, payloadFile], packageEnvironment)
    const payload = readJson(payloadFile)

    const desktopPassed = {}
    const playwright = path.join(root, 'node_modules/@playwright/test/cli.js')
    for (const arch of ['arm64', 'x64']) {
      const archLogs = path.join(logs, `desktop-${arch}`)
      fs.mkdirSync(archLogs, { recursive: true })
      const reportFile = path.join(archLogs, 'report.json')
      const executable = path.join(root, payload.apps[arch].executable)
      run(`Real packaged application smoke test (${arch})`, executable, [playwright, 'test', 'tests/packaged.spec.ts', '--reporter=list,json', `--output=${path.join(archLogs, 'artifacts')}`], {
        ELECTRON_RUN_AS_NODE: '1',
        QTYPORA_PACKAGED_EXE: executable,
        QTYPORA_PACKAGE_LOG_DIR: archLogs,
        PLAYWRIGHT_JSON_OUTPUT_FILE: reportFile,
      })
      desktopPassed[arch] = playwrightPassed(reportFile)
    }

    const afterFile = path.join(logs, 'inputs-after.json')
    run('Reject source changes during packaging', process.execPath, ['scripts/package-checks.cjs', 'snapshot', afterFile])
    const after = readJson(afterFile)
    if (after.sha256 !== inputs.source.sha256) throw new Error('Build inputs changed during packaging. Run the command again after edits finish.')

    const names = artifactNames(version)
    const checksums = names.map(name => `${sha256File(path.join(staging, name))}  ${name}`)
    fs.writeFileSync(path.join(staging, 'SHA256SUMS.txt'), checksums.join('\n') + '\n')
    const npmVersion = run('Record npm version', 'npm', ['--version'])
    const metadata = {
      status: 'complete', runId, version, architectures: ['arm64', 'x64'], artifacts: names,
      recordedAt: new Date().toISOString(), signing: 'adhoc', notarized: false,
      node: inputs.node, npm: npmVersion, electron: inputs.electron, builder: inputs.builder,
      sourceSha256: inputs.source.sha256, payload,
      checks: { unitPassed: unit.numPassedTests, packageTests: 'passed', desktopPassed },
      distribution: 'Internal testing only; Gatekeeper may require the user to explicitly open the application.',
    }
    writeJson(path.join(staging, 'internal-mac-build.json'), metadata)
    fs.copyFileSync(path.join(root, 'docs/macOS-内测打包.md'), path.join(staging, '内测说明.md'))
    fs.cpSync(logs, path.join(staging, 'logs'), { recursive: true })
    fs.renameSync(staging, destination)
    promoted = true
    const latest = { directory: path.basename(destination), artifacts: names, runId, sha256: Object.fromEntries(names.map((name, index) => [name, checksums[index].split(' ')[0]])) }
    const temporary = path.join(releaseRoot, `latest-mac-${runId}.tmp`)
    writeJson(temporary, latest)
    fs.renameSync(temporary, path.join(releaseRoot, 'latest-mac.json'))
    console.log(`Verified macOS internal DMG files: ${names.map(name => path.join(destination, name)).join(', ')}`)
    console.log(`Passed ${unit.numPassedTests} unit tests and ${desktopPassed.arm64 + desktopPassed.x64} packaged desktop tests.`)
  } catch (error) {
    if (logs && fs.existsSync(logs)) writeJson(path.join(logs, 'failure.json'), { status: 'failed', error: error.message, promoted })
    throw error
  } finally {
    if (lock !== undefined) fs.closeSync(lock)
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath)
  }
}

try { main() }
catch (error) {
  console.error(`macOS packaging failed: ${error.message}`)
  process.exitCode = 1
}
