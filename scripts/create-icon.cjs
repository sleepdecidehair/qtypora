const fs = require('node:fs/promises')
const path = require('node:path')
const { Resvg } = require('@resvg/resvg-js')

async function main() {
  const directory = path.resolve(__dirname, '../build')
  const svg = await fs.readFile(path.join(directory, 'icon.svg'), 'utf8')
  const render = size => new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    font: { loadSystemFonts: false },
  }).render()
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const images = sizes.map(size => render(size).asPng())
  const header = Buffer.alloc(6 + 16 * sizes.length)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(sizes.length, 4)
  let offset = header.length
  for (let index = 0; index < sizes.length; index++) {
    const entry = 6 + 16 * index
    header[entry] = sizes[index] % 256
    header[entry + 1] = sizes[index] % 256
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(images[index].length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += images[index].length
  }
  await fs.writeFile(path.join(directory, 'icon.ico'), Buffer.concat([header, ...images]))
  await fs.writeFile(path.join(directory, 'icon-512.png'), render(512).asPng())
  await fs.writeFile(path.join(directory, 'icon-1024.png'), render(1024).asPng())
  console.log('Generated transparent PNG previews and 7-size Windows ICO from build/icon.svg.')
}

main().catch(error => {
  console.error('Icon generation failed:', error.message)
  process.exitCode = 1
})
