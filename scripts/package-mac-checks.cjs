const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const hashFile = file => {
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
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))

function validateVersion(version) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? '')) throw new Error('Unsupported release version.')
  return version
}

function artifactNames(version) {
  const valid = validateVersion(version)
  return ['arm64', 'x64'].map(arch => `QTypora-${valid}-internal-mac-${arch}.dmg`)
}

function classifyArchitecture(output) {
  const architectures = output.match(/(?:^|\s)(arm64|x86_64)(?=\s|$)/g)?.map(value => value.trim()) ?? []
  const unique = [...new Set(architectures)]
  if (!unique.length) throw new Error(`Unsupported packaged architecture: ${output.trim()}`)
  if (unique.length !== 1) throw new Error('The packaged executable must contain exactly one architecture.')
  if (unique[0] === 'arm64') return 'arm64'
  if (unique[0] === 'x86_64') return 'x64'
  throw new Error(`Unsupported packaged architecture: ${unique[0]}`)
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (result.error || result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${(result.stderr || result.stdout || result.error?.message || 'unknown error').trim()}`)
  return `${result.stdout ?? ''}${result.stderr ?? ''}`
}

function childPath(parent, relative) {
  const resolvedParent = path.resolve(parent)
  const resolved = path.resolve(resolvedParent, relative)
  const remainder = path.relative(resolvedParent, resolved)
  if (!remainder || remainder === '..' || remainder.startsWith(`..${path.sep}`) || path.isAbsolute(remainder)) throw new Error(`Path escapes its parent: ${relative}`)
  return resolved
}

function applicationBundles(output) {
  const apps = []
  for (const entry of fs.readdirSync(output, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^mac(?:-|$)/.test(entry.name)) continue
    const directory = childPath(output, entry.name)
    for (const app of fs.readdirSync(directory, { withFileTypes: true })) {
      if (app.isDirectory() && app.name.endsWith('.app')) apps.push(childPath(directory, app.name))
    }
  }
  return apps
}

function plist(appPath) {
  return JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', path.join(appPath, 'Contents/Info.plist')]))
}

function executableInfo(appPath) {
  const info = plist(appPath)
  const executable = childPath(appPath, path.join('Contents/MacOS', info.CFBundleExecutable))
  if (!fs.statSync(executable).isFile()) throw new Error(`Missing application executable: ${executable}`)
  return { info, executable, arch: classifyArchitecture(run('lipo', ['-archs', executable])) }
}

function verifySignature(appPath) {
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
  const details = run('codesign', ['-dv', '--verbose=4', appPath])
  if (!/(?:^|\n)Signature=adhoc(?:\n|$)/.test(details)) throw new Error(`Expected an ad-hoc signature: ${appPath}`)
  return hash(details)
}

function verifyDocumentTypes(info) {
  const definitions = Array.isArray(info.CFBundleDocumentTypes) ? info.CFBundleDocumentTypes : []
  const markdown = definitions.find(item => item.CFBundleTypeRole === 'Editor' && Array.isArray(item.CFBundleTypeExtensions) && ['md', 'markdown'].every(extension => item.CFBundleTypeExtensions.includes(extension)))
  if (!markdown) throw new Error('The application does not register .md and .markdown as editable document types.')
}

function verifyPayload(appPath) {
  const { info, executable, arch } = executableInfo(appPath)
  if (info.CFBundleIdentifier !== 'com.qtypora.internal') throw new Error(`Unexpected bundle identifier: ${info.CFBundleIdentifier}`)
  verifyDocumentTypes(info)
  const resources = childPath(appPath, 'Contents/Resources')
  const iconName = String(info.CFBundleIconFile || 'icon.icns')
  const icon = childPath(resources, path.extname(iconName) ? iconName : `${iconName}.icns`)
  if (!fs.statSync(icon).isFile() || fs.statSync(icon).size < 1024) throw new Error('The packaged macOS icon is missing or empty.')
  for (const [source, destination] of [['build/icon.svg', 'branding/icon.svg'], ['build/icon-512.png', 'branding/icon.png']]) {
    if (hash(fs.readFileSync(path.join(root, source))) !== hash(fs.readFileSync(childPath(resources, destination)))) throw new Error(`Packaged branding mismatch: ${destination}`)
  }
  const asarPath = childPath(resources, 'app.asar')
  const asar = require('@electron/asar')
  const files = asar.listPackage(asarPath).map(file => file.replace(/\\/g, '/'))
  if (files.some(file => /^\/(?:src|tests|docs|scripts|build)(?:\/|$)/.test(file) || /\.(?:pfx|p12|key)$/i.test(file))) throw new Error('Development sources or private signing material found in ASAR.')
  const html = asar.extractFile(asarPath, path.join('out', 'renderer', 'index.html')).toString()
  const asset = html.match(/href="\.\/assets\/(icon-[^"]+\.svg)"/)
  if (!asset || hash(asar.extractFile(asarPath, path.join('out', 'renderer', 'assets', asset[1]))) !== hash(fs.readFileSync(path.join(root, 'build/icon.svg')))) throw new Error('Renderer logo differs from the master SVG.')
  const signatureSha256 = verifySignature(appPath)
  return {
    arch,
    app: path.relative(root, appPath),
    executable: path.relative(root, executable),
    bundleIdentifier: info.CFBundleIdentifier,
    icon: path.relative(appPath, icon),
    iconSha256: hash(fs.readFileSync(icon)),
    signature: 'adhoc',
    signatureDescriptionSha256: signatureSha256,
    asarSha256: hash(fs.readFileSync(asarPath)),
    asarEntries: files.length,
  }
}

function verifyDmg(file, expectedArch) {
  run('hdiutil', ['verify', file])
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'qtypora-dmg-'))
  const mount = path.join(temporary, 'volume')
  fs.mkdirSync(mount)
  let attached = false
  try {
    run('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, file])
    attached = true
    const appName = fs.readdirSync(mount).find(name => name.endsWith('.app'))
    if (!appName) throw new Error(`DMG does not contain an application: ${file}`)
    const applications = path.join(mount, 'Applications')
    if (!fs.lstatSync(applications).isSymbolicLink() || fs.readlinkSync(applications) !== '/Applications') throw new Error(`DMG does not contain the Applications link: ${file}`)
    const appPath = childPath(mount, appName)
    const actualArch = executableInfo(appPath).arch
    if (actualArch !== expectedArch) throw new Error(`DMG architecture mismatch: expected ${expectedArch}, found ${actualArch}`)
    verifySignature(appPath)
  } finally {
    if (attached) run('hdiutil', ['detach', mount])
    fs.rmSync(temporary, { recursive: true, force: true })
  }
  return { file: path.basename(file), arch: expectedArch, size: fs.statSync(file).size, sha256: hashFile(file) }
}

function verify(output) {
  const resolved = path.resolve(output)
  if (!resolved.startsWith(path.join(root, '.debug', 'package-runs') + path.sep)) throw new Error('Unexpected macOS package verification directory.')
  const version = validateVersion(readJson(path.join(root, 'package.json')).version)
  const apps = applicationBundles(resolved).map(verifyPayload)
  if (apps.length !== 2 || new Set(apps.map(app => app.arch)).size !== 2 || !apps.some(app => app.arch === 'arm64') || !apps.some(app => app.arch === 'x64')) throw new Error('Expected one unpacked arm64 app and one unpacked x64 app.')
  const dmgs = artifactNames(version).map(name => verifyDmg(childPath(resolved, name), name.includes('-arm64.') ? 'arm64' : 'x64'))
  return { version, apps: Object.fromEntries(apps.map(app => [app.arch, app])), dmgs }
}

module.exports = { artifactNames, classifyArchitecture, validateVersion, verify }

if (require.main === module) {
  const [command, output, destination] = process.argv.slice(2)
  try {
    if (command !== 'verify' || !output || !destination) throw new Error('Usage: node scripts/package-mac-checks.cjs verify <output> <destination>')
    const result = verify(output)
    fs.writeFileSync(destination, JSON.stringify(result, null, 2) + '\n')
    console.log('macOS package checks passed.')
  } catch (error) {
    console.error(`macOS package checks failed: ${error.message}`)
    process.exitCode = 1
  }
}
