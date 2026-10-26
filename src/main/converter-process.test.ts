import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runConverter } from './converter-process'
import { runCustomExport } from './custom-export'
import { runPandoc } from './pandoc'

let root: string
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'qtypora-converter-process-')) })
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

describe('bounded converter processes', () => {
  it('collects complete binary stdout and reports unsuccessful conversion without exposing unbounded logs', async () => {
    const output = await runConverter(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], { label: '测试', input: new Uint8Array([0, 1, 255, 10]) })
    expect(output).toEqual(Buffer.from([0, 1, 255, 10]))
    await expect(runConverter(process.execPath, ['-e', 'process.stderr.write("failure");process.exitCode=2'], { label: '测试' })).rejects.toThrow('failure')
    await expect(runConverter(process.execPath, ['-e', 'process.stdout.write(Buffer.alloc(16384));setInterval(()=>{},100)'], { label: '测试', outputLimit: 1024 })).rejects.toMatchObject({ code: 'UNSUPPORTED' })
  })

  it.skipIf(process.platform === 'win32')('kills a SIGTERM-resistant process group before removing its staging input', async () => {
    const script = path.join(root, 'stubborn.cjs'), observed = path.join(root, 'observed.json'), heartbeat = path.join(root, 'heartbeat')
    const worker = 'const fs=require("node:fs");process.on("SIGTERM",()=>{});setInterval(()=>fs.appendFileSync(process.argv[1],"x"),20)'
    await fs.writeFile(script, `const fs=require('node:fs');const {spawn}=require('node:child_process');process.on('SIGTERM',()=>{});const child=spawn(process.execPath,['-e',${JSON.stringify(worker)},process.argv[5]],{stdio:'inherit'});fs.writeFileSync(process.argv[4],JSON.stringify({pid:process.pid,child:child.pid,input:process.argv[2]}));setInterval(()=>{},100)`)
    let pid: number | undefined
    try {
      await expect(runCustomExport({ name: 'Stubborn', executable: process.execPath, extension: 'txt', input: 'markdown', template: '', args: [script, '{input}', '{output}', observed, heartbeat] }, 'private source', '', { timeoutMs: 500 })).rejects.toThrow('已取消本次转换')
      const info = JSON.parse(await fs.readFile(observed, 'utf8')) as { pid: number; child: number; input: string }
      pid = info.pid
      expect(() => process.kill(info.pid, 0)).toThrow()
      await expect(fs.stat(info.input)).rejects.toMatchObject({ code: 'ENOENT' })
      const bytes = (await fs.stat(heartbeat)).size
      await new Promise(resolve => setTimeout(resolve, 100))
      expect((await fs.stat(heartbeat)).size).toBe(bytes)
    } finally {
      if (!pid) {
        try { pid = (JSON.parse(await fs.readFile(observed, 'utf8')) as { pid: number }).pid } catch { /* Process may not have started. */ }
      }
      if (pid) { try { process.kill(-pid, 'SIGKILL') } catch { /* The tested group is already gone. */ } }
    }
  })

  it('rejects a non-absolute trusted filter instead of adding document-controlled commands', async () => {
    await expect(runPandoc(Buffer.from('content'), 'html', 'gfm', '', 'relative-filter.lua')).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })
})
