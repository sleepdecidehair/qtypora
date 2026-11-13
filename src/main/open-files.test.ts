import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { OpenFileQueue } from './open-files'

describe('OpenFileQueue', () => {
  it('holds startup files until the application is ready and removes duplicates', async () => {
    const opened: string[] = []
    const queue = new OpenFileQueue(async filePath => { opened.push(filePath) }, () => undefined)
    const first = path.join(os.tmpdir(), 'first.md'), second = path.join(os.tmpdir(), 'second.markdown')

    void queue.enqueue(first)
    void queue.enqueue(first)
    void queue.enqueue(second)
    expect(opened).toEqual([])

    await queue.start()
    expect(opened).toEqual([first, second])
  })

  it('opens later files immediately and continues after a failed file', async () => {
    const opened: string[] = []
    const errors: string[] = []
    const bad = path.join(os.tmpdir(), 'bad.md'), good = path.join(os.tmpdir(), 'good.md')
    const queue = new OpenFileQueue(async filePath => {
      opened.push(filePath)
      if (filePath.endsWith('bad.md')) throw new Error('cannot open')
    }, error => errors.push(error instanceof Error ? error.message : 'unknown'))

    await queue.start()
    await queue.enqueue(bad)
    await queue.enqueue(good)

    expect(opened).toEqual([bad, good])
    expect(errors).toEqual(['cannot open'])
  })
})
