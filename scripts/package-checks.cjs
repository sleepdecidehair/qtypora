const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '..')
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const json = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))

function snapshot() {
  const files = ['package.json', 'package-lock.json', 'electron-builder.internal.cjs', 'electron.vite.config.ts', 'tsconfig.json', 'vitest.config.ts', 'playwright.config.ts', 'docs/Windows-内测打包.md']
  const walk = directory => {
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const relative = `${directory}/${entry.name}`
      if (entry.isSymbolicLink()) throw new Error(`Source symlinks are unsupported: ${relative}`)
      if (entry.isDirectory()) walk(relative)
      else if (!(directory === 'build' && /^icon(?:-\d+\.png|\.ico)$/.test(entry.name))) files.push(relative)
    }
  }
  for (const directory of ['src', 'scripts', 'tests', 'build']) walk(directory)
  const inputs = Object.fromEntries(files.sort().map(file => [file, hash(fs.readFileSync(path.join(root, file)))]))
  return { sha256: hash(JSON.stringify(inputs)), inputs }
}

function preflight() {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 22 || (major === 22 && minor < 12)) throw new Error('Node.js >=22.12 is required.')
  const lock = json(path.join(root, 'package-lock.json'))
  if (lock.lockfileVersion !== 3) throw new Error('Expected a v3 package-lock.json; run npm ci.')
  for (const [location, expected] of Object.entries(lock.packages)) {
    if (!location || expected.link) continue
    const file = path.join(root, location, 'package.json')
    if (!fs.existsSync(file) && expected.optional) continue
    if (!fs.existsSync(file) || json(file).version !== expected.version) throw new Error(`Locked dependency mismatch at ${location}; run npm ci before packaging.`)
  }
  const pkg = json(path.join(root, 'package.json'))
  const ordered = dependencies => JSON.stringify(Object.entries(dependencies ?? {}).sort(([a], [b]) => a.localeCompare(b)))
  if (ordered(pkg.dependencies) !== ordered(lock.packages[''].dependencies) || ordered(pkg.devDependencies) !== ordered(lock.packages[''].devDependencies)) throw new Error('package.json differs from the lockfile; update the lockfile and run npm ci.')
  return { node: process.version, electron: json(path.join(root, 'node_modules/electron/package.json')).version, builder: json(path.join(root, 'node_modules/electron-builder/package.json')).version, source: snapshot() }
}

// Read PE resource directories using RVA-to-file mapping, for both x86 NSIS and x64 Electron.
function executableIcons(file) {
  const bytes = fs.readFileSync(file)
  if (bytes.subarray(0, 2).toString() !== 'MZ') throw new Error(`Invalid PE: ${file}`)
  const pe = bytes.readUInt32LE(0x3c)
  if (bytes.readUInt32LE(pe) !== 0x4550) throw new Error(`Invalid PE signature: ${file}`)
  const optional = pe + 24
  const magic = bytes.readUInt16LE(optional)
  if (![0x10b, 0x20b].includes(magic)) throw new Error('Unsupported PE optional header')
  const sectionTable = optional + bytes.readUInt16LE(pe + 20)
  const sections = Array.from({ length: bytes.readUInt16LE(pe + 6) }, (_, index) => sectionTable + index * 40)
  const offsetOf = rva => {
    const section = sections.find(offset => rva >= bytes.readUInt32LE(offset + 12) && rva < bytes.readUInt32LE(offset + 12) + bytes.readUInt32LE(offset + 16))
    if (section === undefined) throw new Error('PE resource RVA outside file sections')
    return rva - bytes.readUInt32LE(section + 12) + bytes.readUInt32LE(section + 20)
  }
  const base = offsetOf(bytes.readUInt32LE(optional + (magic === 0x20b ? 112 : 96) + 16))
  const entries = relative => {
    const directory = base + relative
    const count = bytes.readUInt16LE(directory + 12) + bytes.readUInt16LE(directory + 14)
    return Array.from({ length: count }, (_, index) => {
      const offset = directory + 16 + index * 8
      return { id: bytes.readUInt32LE(offset), target: bytes.readUInt32LE(offset + 4) }
    }).filter(entry => entry.id < 0x80000000)
  }
  const descend = entry => {
    if (!entry || entry.target < 0x80000000) throw new Error('Missing PE resource directory')
    return entries(entry.target & 0x7fffffff)
  }
  const payload = entry => {
    if (!entry || entry.target >= 0x80000000) throw new Error('Missing PE resource payload')
    const offset = base + entry.target
    const start = offsetOf(bytes.readUInt32LE(offset))
    const size = bytes.readUInt32LE(offset + 4)
    if (start + size > bytes.length) throw new Error('Truncated PE resource payload')
    return bytes.subarray(start, start + size)
  }
  const types = entries(0)
  const icons = descend(types.find(entry => entry.id === 3))
  return descend(types.find(entry => entry.id === 14)).flatMap(groupEntry => descend(groupEntry).map(language => {
    const group = payload(language)
    return Array.from({ length: group.readUInt16LE(4) }, (_, index) => {
      const id = group.readUInt16LE(6 + index * 14 + 12)
      return hash(payload(descend(icons.find(entry => entry.id === id))[0]))
    })
  }))
}

function verify(output) {
  const resolved = path.resolve(output)
  if (!resolved.startsWith(path.join(root, '.debug/package-runs') + path.sep)) throw new Error('Unexpected package verification directory')
  const version = json(path.join(root, 'package.json')).version
  const installer = path.join(resolved, `QTypora-${version}-internal-x64-setup.exe`)
  const app = path.join(resolved, 'win-unpacked/QTypora.exe')
  const ico = fs.readFileSync(path.join(root, 'build/icon.ico'))
  const expected = Array.from({ length: ico.readUInt16LE(4) }, (_, index) => {
    const entry = 6 + index * 16
    const start = ico.readUInt32LE(entry + 12)
    return hash(ico.subarray(start, start + ico.readUInt32LE(entry + 8)))
  })
  for (const file of [app, installer]) {
    if (!executableIcons(file).some(group => group.length === expected.length && group.every((digest, index) => digest === expected[index]))) throw new Error(`Executable icon differs from build/icon.ico: ${file}`)
  }
  const iconName = `icon-${hash(fs.readFileSync(path.join(root, 'build/icon.svg'))).slice(0, 12)}.ico`
  const brandingDirectory = path.join(resolved, 'win-unpacked/resources/branding')
  const shellIcons = fs.readdirSync(brandingDirectory).filter(file => file.endsWith('.ico'))
  if (shellIcons.length !== 1 || shellIcons[0] !== iconName) throw new Error('Expected exactly one versioned Windows Shell icon')
  for (const [source, destination] of [['build/icon.svg', 'icon.svg'], ['build/icon-512.png', 'icon.png'], ['build/icon.ico', iconName]]) {
    if (hash(fs.readFileSync(path.join(root, source))) !== hash(fs.readFileSync(path.join(resolved, 'win-unpacked/resources/branding', destination)))) throw new Error(`Packaged branding mismatch: ${destination}`)
  }
  const asar = require('@electron/asar')
  const archive = path.join(resolved, 'win-unpacked/resources/app.asar')
  const files = asar.listPackage(archive).map(file => file.replace(/\\/g, '/'))
  if (files.some(file => /^\/(?:src|tests|docs|scripts|build)(?:\/|$)/.test(file) || /\.(?:pfx|p12|key)$/i.test(file))) throw new Error('Development sources or private signing material found in ASAR')
  const html = asar.extractFile(archive, path.join('out', 'renderer', 'index.html')).toString()
  const asset = html.match(/href="\.\/assets\/(icon-[^"]+\.svg)"/)
  if (!asset || hash(asar.extractFile(archive, path.join('out', 'renderer', 'assets', asset[1]))) !== hash(fs.readFileSync(path.join(root, 'build/icon.svg')))) throw new Error('Renderer logo differs from the master SVG')
  return { iconSvgSha256: hash(fs.readFileSync(path.join(root, 'build/icon.svg'))), iconIcoSha256: hash(ico), shellIcon: `branding/${iconName}`, embeddedIconsVerified: ['application', 'installer'], asarSha256: hash(fs.readFileSync(archive)), asarEntries: files.length }
}

function notes(output) {
  const resolved = path.resolve(output)
  if (!resolved.startsWith(path.join(root, '.debug/package-runs') + path.sep)) throw new Error('Unexpected release guide directory')
  const source = path.join(root, 'docs/Windows-内测打包.md')
  const destination = path.join(resolved, '内测说明.md')
  fs.copyFileSync(source, destination)
  return { file: path.basename(destination), sha256: hash(fs.readFileSync(destination)) }
}

const [command, argument, destination] = process.argv.slice(2)
try {
  const result = command === 'preflight' ? preflight() : command === 'snapshot' ? snapshot() : command === 'verify' ? verify(argument) : command === 'notes' ? notes(argument) : (() => { throw new Error('Use preflight, snapshot, verify, or notes') })()
  fs.writeFileSync(destination ?? argument, JSON.stringify(result, null, 2) + '\n')
  console.log(`Package checks passed: ${command}`)
} catch (error) {
  console.error(`Package checks failed: ${error.message}`)
  process.exitCode = 1
}
