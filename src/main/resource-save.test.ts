import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { canonicalPath } from './files'
import { resourceBytes, validateResourceSave, writeResource } from './resource-save'

const svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 60000 1000"><defs><path id="letter" d="M0 0L1 1"/></defs><style>.label{fill:url(#letter)}</style><use xlink:href="#letter"/></svg>'
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII='
let directory: string
beforeEach(async () => { directory = await canonicalPath(await fs.mkdtemp(path.join(os.tmpdir(), 'qtypora-save-resource-'))) })
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }) })

describe('Exported resource validation', () => {
  it('supports standalone SVG with internal definitions and PNG data URLs', () => {
    expect(resourceBytes({ id: 'doc', format: 'svg', data: svg }).toString()).toContain('xlink:href="#letter"')
    expect(resourceBytes({ id: 'doc', format: 'png', data: png }).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(() => validateResourceSave({ id: 'doc', format: 'gif', data: png })).toThrow()
    expect(() => resourceBytes({ id: 'doc', format: 'jpeg', data: png })).toThrow()
  })

  it('rejects script-bearing, malformed and externally dependent XML', () => {
    const unsafe = ['<script>alert(1)</script>', '<foreignObject><div>HTML</div></foreignObject>', '<use href="file:///C:/private.png"/>', '<use href="&#106;avascript:alert(1)"/>', '<path onload="alert(1)"/>', '<style>@import "https://bad";</style>', '<path fill="u\\72l(http://bad)"/>', '<style>.x{fill:url(https://bad)}</style>', '<path><rect/></g>']
    for (const child of unsafe) expect(() => resourceBytes({ id: 'doc', format: 'svg', data: `<svg xmlns="http://www.w3.org/2000/svg">${child}</svg>` })).toThrow()
    expect(() => resourceBytes({ id: 'doc', format: 'svg', data: '<!DOCTYPE svg [<!ENTITY x "y">]>' + svg })).toThrow()
    expect(() => resourceBytes({ id: 'doc', format: 'svg', data: '<?xml version="1.0"?>' + svg })).toThrow()
  })

  it('rejects huge PNG dimensions and corrupt data before decoding', () => {
    const bytes = Buffer.from(png.split(',')[1], 'base64')
    bytes.writeUInt32BE(20000, 16)
    expect(() => resourceBytes({ id: 'doc', format: 'png', data: `data:image/png;base64,${bytes.toString('base64')}` })).toThrow()
    expect(() => resourceBytes({ id: 'doc', format: 'png', data: 'data:image/png;base64,bm90LXBpY3R1cmU=' })).toThrow()
    expect(() => resourceBytes({ id: 'doc', format: 'jpeg', data: 'data:image/jpeg;base64,/9j/2Q==' })).toThrow()
  })

  it('writes actual resource bytes atomically and rejects incompatible destinations', async () => {
    const destination = path.join(directory, 'graph.svg')
    const bytes = resourceBytes({ id: 'doc', format: 'svg', data: svg })
    expect(await writeResource(destination, 'svg', bytes)).toBe(destination)
    expect(await fs.readFile(destination)).toEqual(bytes)
    await expect(writeResource(path.join(directory, 'graph.html'), 'svg', bytes)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(writeResource(directory, 'svg', bytes)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect((await fs.readdir(directory)).some((name) => name.endsWith('.tmp'))).toBe(false)
  })
})
