import { afterEach, describe, expect, it, vi } from 'vitest'
import { calculateWritingStatistics, countWords, createWorkerWritingStatisticsScheduler, createWritingStatisticsScheduler, scheduleStatisticsTask, writingStatistics, type StatisticsTaskSchedule } from './wordStatistics'
import { DEFAULT_MARKDOWN_OPTIONS } from '../../shared/markdown-options'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('writing statistics', () => {
  it('counts prose without formatting, link destinations or front matter', () => {
    const content = '---\ntitle: metadata excluded\n---\n\n# 中文标题\n\nA **bright** [day](https://example.com/extra/words).\n\n[toc]\n'
    const stats = writingStatistics(content)
    expect(stats.words).toBe(7)
    expect(stats.characters).toBe(Array.from(content).length)
    expect(stats.readingMinutes).toBe(1)
  })
  it('counts Chinese beyond the BMP and keeps internal word punctuation', () => {
    expect(countWords('中文𠀀 hello-world don’t 42 😊')).toBe(6)
    expect(writingStatistics('').readingMinutes).toBe(0)
    expect(writingStatistics('word '.repeat(601), 300).readingMinutes).toBe(3)
  })
  it('counts visible code and text but excludes HTML comments and invisible scripts', () => {
    expect(writingStatistics('Text\n\n<!-- hidden comment -->\n\n<script>hidden code</script>\n\n`const value`').words).toBe(3)
    expect(writingStatistics('Visible <script>hidden words</script> end.').words).toBe(2)
    expect(writingStatistics('<p>First &mdash; second &eacute;lan.</p>').words).toBe(3)
  })

  it('debounces work and cancellation prevents the delayed parse', () => {
    vi.useFakeTimers()
    const task = vi.fn()
    const cancel = scheduleStatisticsTask(task, 50)
    vi.advanceTimersByTime(49)
    expect(task).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    vi.runAllTimers()
    expect(task).toHaveBeenCalledOnce()

    const cancelled = vi.fn()
    const stop = scheduleStatisticsTask(cancelled, 50)
    stop()
    vi.runAllTimers()
    expect(cancelled).not.toHaveBeenCalled()
    cancel()
  })

  it('does not publish cancelled or stale statistics and keeps the latest result exact', () => {
    const tasks: (() => void)[] = []
    const schedule: StatisticsTaskSchedule = task => { tasks.push(task); return () => undefined }
    const results: ReturnType<typeof calculateWritingStatistics>[] = []
    const scheduler = createWritingStatisticsScheduler(result => results.push(result), schedule)
    scheduler.request({ content: 'old words', readingSpeed: 300, markdownOptions: DEFAULT_MARKDOWN_OPTIONS })
    scheduler.request({ content: '最新内容', readingSpeed: 300, markdownOptions: DEFAULT_MARKDOWN_OPTIONS })

    tasks[0]()
    expect(results).toEqual([])
    tasks[1]()
    expect(results).toHaveLength(1)
    expect(results[0].content).toBe('最新内容')
    expect(results[0].statistics).toEqual(writingStatistics('最新内容'))

    scheduler.request({ content: 'cancelled', readingSpeed: 300, markdownOptions: DEFAULT_MARKDOWN_OPTIONS })
    scheduler.cancel()
    tasks[2]()
    expect(results).toHaveLength(1)
  })

  it('coalesces rapid document versions into one final calculation', () => {
    vi.useFakeTimers()
    const calculate = vi.fn(calculateWritingStatistics)
    const results: ReturnType<typeof calculateWritingStatistics>[] = []
    const scheduler = createWritingStatisticsScheduler(result => results.push(result), scheduleStatisticsTask, calculate)
    for (const content of ['v1', 'v2', '最终版本']) scheduler.request({ content, readingSpeed: 300, markdownOptions: DEFAULT_MARKDOWN_OPTIONS })

    vi.runAllTimers()
    expect(calculate).toHaveBeenCalledOnce()
    expect(calculate).toHaveBeenCalledWith(expect.objectContaining({ content: '最终版本' }))
    expect(results[0].content).toBe('最终版本')
  })

  it('moves calculation to a worker, terminates stale work and preserves the current request identity', () => {
    class FakeWorker {
      static instances: FakeWorker[] = []
      onmessage: ((event: MessageEvent<{ generation: number; statistics: ReturnType<typeof writingStatistics> }>) => void) | null = null
      onerror: (() => void) | null = null
      messages: { generation: number; request: { content: string } }[] = []
      terminated = false
      constructor() { FakeWorker.instances.push(this) }
      postMessage(message: { generation: number; request: { content: string } }) { this.messages.push(message) }
      terminate() { this.terminated = true }
    }
    vi.stubGlobal('Worker', FakeWorker)
    const results: ReturnType<typeof calculateWritingStatistics>[] = []
    const immediate: StatisticsTaskSchedule = task => { task(); return () => undefined }
    const scheduler = createWorkerWritingStatisticsScheduler(result => results.push(result), immediate)
    expect(FakeWorker.instances).toHaveLength(0)
    const firstOptions = { ...DEFAULT_MARKDOWN_OPTIONS }
    scheduler.request({ content: 'old', readingSpeed: 300, markdownOptions: firstOptions })
    expect(FakeWorker.instances).toHaveLength(1)
    const first = FakeWorker.instances[0]
    scheduler.request({ content: 'current', readingSpeed: 400, markdownOptions: DEFAULT_MARKDOWN_OPTIONS })
    const second = FakeWorker.instances[1]
    expect(first.terminated).toBe(true)
    first.onmessage?.({ data: { generation: 1, statistics: writingStatistics('old') } } as MessageEvent<{ generation: number; statistics: ReturnType<typeof writingStatistics> }>)
    first.onerror?.()
    expect(results).toEqual([])
    second.onmessage?.({ data: { generation: 2, statistics: writingStatistics('current') } } as MessageEvent<{ generation: number; statistics: ReturnType<typeof writingStatistics> }>)
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ content: 'current', readingSpeed: 400 })
    expect(results[0].markdownOptions).toBe(DEFAULT_MARKDOWN_OPTIONS)
    scheduler.dispose()
    expect(second.terminated).toBe(true)
  })

  it('creates workers only for requested statistics and releases active work on cancel', () => {
    class FakeWorker {
      static instances: FakeWorker[] = []
      onmessage = null
      onerror = null
      terminated = false
      constructor() { FakeWorker.instances.push(this) }
      postMessage() {}
      terminate() { this.terminated = true }
    }
    vi.stubGlobal('Worker', FakeWorker)
    const immediate: StatisticsTaskSchedule = task => { task(); return () => undefined }
    const scheduler = createWorkerWritingStatisticsScheduler(() => undefined, immediate)

    expect(FakeWorker.instances).toHaveLength(0)
    scheduler.request({ content: 'selected text', readingSpeed: 300, markdownOptions: DEFAULT_MARKDOWN_OPTIONS })
    expect(FakeWorker.instances).toHaveLength(1)
    scheduler.cancel()
    expect(FakeWorker.instances[0].terminated).toBe(true)
    scheduler.dispose()
    expect(FakeWorker.instances).toHaveLength(1)
  })

  it('releases an idle worker when its statistics channel becomes empty', () => {
    class FakeWorker {
      static instances: FakeWorker[] = []
      onmessage: ((event: MessageEvent<{ generation: number; statistics: ReturnType<typeof writingStatistics> }>) => void) | null = null
      onerror = null
      terminated = false
      constructor() { FakeWorker.instances.push(this) }
      postMessage() {}
      terminate() { this.terminated = true }
    }
    vi.stubGlobal('Worker', FakeWorker)
    const immediate: StatisticsTaskSchedule = task => { task(); return () => undefined }
    const scheduler = createWorkerWritingStatisticsScheduler(() => undefined, immediate)
    scheduler.request({ content: 'selection', readingSpeed: 300, markdownOptions: DEFAULT_MARKDOWN_OPTIONS })
    FakeWorker.instances[0].onmessage?.({ data: { generation: 1, statistics: writingStatistics('selection') } } as MessageEvent<{ generation: number; statistics: ReturnType<typeof writingStatistics> }>)

    scheduler.release()
    expect(FakeWorker.instances[0].terminated).toBe(true)
    scheduler.dispose()
  })

  it('retries worker failures off the renderer thread and reports a bounded failure', () => {
    class FakeWorker {
      static instances: FakeWorker[] = []
      onmessage = null
      onerror: (() => void) | null = null
      terminated = false
      constructor() { FakeWorker.instances.push(this) }
      postMessage() {}
      terminate() { this.terminated = true }
    }
    vi.stubGlobal('Worker', FakeWorker)
    const failures: { content: string }[] = []
    const immediate: StatisticsTaskSchedule = task => { task(); return () => undefined }
    const scheduler = createWorkerWritingStatisticsScheduler(() => undefined, immediate, request => failures.push(request))
    scheduler.request({ content: 'large document', readingSpeed: 300, markdownOptions: DEFAULT_MARKDOWN_OPTIONS })

    FakeWorker.instances[0].onerror?.()
    expect(FakeWorker.instances).toHaveLength(2)
    expect(FakeWorker.instances[0].terminated).toBe(true)
    expect(failures).toEqual([])
    FakeWorker.instances[1].onerror?.()
    expect(FakeWorker.instances[1].terminated).toBe(true)
    expect(failures).toEqual([expect.objectContaining({ content: 'large document' })])
    scheduler.dispose()
  })
})
