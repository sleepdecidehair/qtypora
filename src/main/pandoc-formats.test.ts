import { describe, expect, it } from 'vitest'
import { runPandoc, PANDOC_EXPORT_FORMATS } from './pandoc'

const executable = process.env.QTYPORA_TEST_PANDOC
const html = '<!doctype html><html><head><meta charset="utf-8"><title>Export test</title></head><body><h1>转换测试</h1><p>中文 <strong>bold</strong></p><ul><li>first</li></ul></body></html>'

describe('installed Pandoc format conversion', () => {
  for (const format of PANDOC_EXPORT_FORMATS) it.skipIf(!executable)(`writes a real ${format} document to stdout`, async () => {
    const output = await runPandoc(Buffer.from(html), 'html', format, executable)
    expect(output.length).toBeGreaterThan(20)
    if (['docx', 'odt', 'epub', 'pptx'].includes(format)) expect(output.subarray(0, 2).toString()).toBe('PK')
    else if (format === 'rtf') expect(output.toString()).toMatch(/^\{\\rtf/)
    else expect(output.toString()).toContain('bold')
  })
})
