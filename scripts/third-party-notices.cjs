const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trimEnd()
const lock = JSON.parse(read('package-lock.json'))
const entries = Object.entries(lock.packages).filter(([location, entry]) => location && !entry.dev).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
const blocks = [
  'QTypora third-party notices',
  'Generated from the installed packages named in package-lock.json by scripts/third-party-notices.cjs.\nThis file preserves package license/notice texts and the vendored sequence-diagram notice.\nIt does not grant a license to QTypora itself. Electron/Chromium runtime notices are distributed with Electron.\nPandoc and user-configured external converters/uploaders are not bundled with QTypora.',
]

for (const [location, entry] of entries) {
  if (!location.startsWith('node_modules/') || location.split('/').includes('..')) throw new Error('Invalid package location')
  const directory = path.join(root, location)
  const metadata = JSON.parse(read(`${location}/package.json`))
  if (metadata.version !== entry.version) throw new Error(`Install locked dependencies before generating notices: ${location}`)
  const names = fs.readdirSync(directory).filter(name => /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i.test(name) && fs.statSync(path.join(directory, name)).isFile()).sort()
  const texts = names.map(name => `Source: ${location}/${name}\n\n${read(`${location}/${name}`)}`)
  if (!texts.length && ['fastdom', 'strictdom'].includes(metadata.name)) {
    const source = read(`${location}/README.md`)
    const start = source.search(/^## License\s*$/m)
    if (start < 0) throw new Error(`Missing README license for ${metadata.name}`)
    texts.push(`Source: ${location}/README.md (License section)\n\n${source.slice(start)}`)
  }
  if (!texts.length && metadata.name === '@mathjax/mathjax-newcm-font' && metadata.license === 'Apache-2.0') {
    const definition = read(`${location}/def/mathjax-newcm.ts`)
    const copyright = definition.match(/addCopyright: '(Copyright[^']+)'/)?.[1]
    if (!copyright) throw new Error('Missing MathJax font copyright')
    texts.push(`License declaration: ${location}/package.json\nCopyright source: ${location}/def/mathjax-newcm.ts\n${copyright}\n\nThe package declares Apache-2.0 and omits a standalone license file.\nThe Apache-2.0 text below is reproduced from node_modules/@mathjax/src/LICENSE.\n\n${read('node_modules/@mathjax/src/LICENSE')}`)
  }
  if (!texts.length) throw new Error(`Missing license text for ${metadata.name}; inspect the upstream package before distribution.`)
  blocks.push(`${'='.repeat(72)}\n${metadata.name} ${metadata.version}\nDeclared license: ${metadata.license || entry.license || 'See license text'}\n\n${texts.join('\n\n')}`)
}

blocks.push(`${'='.repeat(72)}\njs-sequence-diagrams v2.0.1 (local browser adapter)\n\n${read('src/renderer/editor/vendor/sequence/README.md')}\n\n${read('src/renderer/editor/vendor/sequence/LICENSE')}`)
const output = blocks.join('\n\n') + '\n'
const destination = path.join(root, 'src/renderer/public/third-party-notices.txt')
if (process.argv.includes('--check')) {
  if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8') !== output) throw new Error('Third-party notices are stale. Run node scripts/third-party-notices.cjs.')
} else {
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.writeFileSync(destination, output)
}
console.log(`Third-party notices ${process.argv.includes('--check') ? 'verified' : 'generated'}: ${entries.length} locked production packages and js-sequence-diagrams.`)
