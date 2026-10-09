import { describe, expect, it } from 'vitest'
import { OpenFileQueue } from './open-files'

describe('OpenFileQueue', () => {
  it('holds startup files until the application is ready and removes duplicates', async () => {
    const opened: string[] = []
    const queue = new OpenFileQueue(async filePath => { opened.push(filePath) }, () => undefined)

    void queue.enqueue('/tmp/first.md')
    void queue.enqueue('/tmp/first.md')
    void queue.enqueue('/tmp/second.markdown')
    expect(opened).toEqual([])

    await queue.start()
    expect(opened).toEqual(['/tmp/first.md', '/tmp/second.markdown'])
  })

  it('opens later files immediately and continues after a failed file', async () => {
    const opened: string[] = []
    const errors: string[] = []
    const queue = new OpenFileQueue(async filePath => {
      opened.push(filePath)
      if (filePath.endsWith('bad.md')) throw new Error('cannot open')
    }, error => errors.push(error instanceof Error ? error.message : 'unknown'))

    await queue.start()
    await queue.enqueue('/tmp/bad.md')
    await queue.enqueue('/tmp/good.md')

    expect(opened).toEqual(['/tmp/bad.md', '/tmp/good.md'])
    expect(errors).toEqual(['cannot open'])
  })
})
