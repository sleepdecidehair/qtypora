import { calculateWritingStatistics, type WritingStatistics, type WritingStatisticsRequest, type WritingStatisticsSnapshot } from './word-statistics-core'
export { calculateWritingStatistics, countWords, writingStatistics } from './word-statistics-core'
export type { WritingStatistics, WritingStatisticsRequest, WritingStatisticsSnapshot } from './word-statistics-core'

export type StatisticsTaskSchedule = (task: () => void) => () => void

export interface WritingStatisticsScheduler {
  request(request: WritingStatisticsRequest): void
  cancel(): void
  release(): void
  dispose(): void
}

/** Debounce edits, then yield until the renderer has idle time before parsing the complete Markdown source. */
export function scheduleStatisticsTask(task: () => void, delay = 300): () => void {
  const idleHost = globalThis as typeof globalThis & {
    requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number
    cancelIdleCallback?: (handle: number) => void
  }
  let cancelled = false
  let idle: number | null = null
  let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    timer = null
    const run = () => { if (!cancelled) task() }
    if (idleHost.requestIdleCallback) idle = idleHost.requestIdleCallback(run, { timeout: 1200 })
    else timer = setTimeout(run, 0)
  }, delay)
  return () => {
    cancelled = true
    if (timer !== null) clearTimeout(timer)
    if (idle !== null) idleHost.cancelIdleCallback?.(idle)
  }
}

export function createWritingStatisticsScheduler(
  onResult: (snapshot: WritingStatisticsSnapshot) => void,
  schedule: StatisticsTaskSchedule = scheduleStatisticsTask,
  calculate: (request: WritingStatisticsRequest) => WritingStatisticsSnapshot = calculateWritingStatistics,
): WritingStatisticsScheduler {
  let generation = 0
  let cancelScheduled: (() => void) | null = null
  return {
    request(request) {
      const current = ++generation
      cancelScheduled?.()
      cancelScheduled = schedule(() => {
        cancelScheduled = null
        const snapshot = calculate(request)
        if (current === generation) onResult(snapshot)
      })
    },
    cancel() {
      generation++
      cancelScheduled?.()
      cancelScheduled = null
    },
    release() {
      generation++
      cancelScheduled?.()
      cancelScheduled = null
    },
    dispose() {
      generation++
      cancelScheduled?.()
      cancelScheduled = null
    },
  }
}

export function createWorkerWritingStatisticsScheduler(
  onResult: (snapshot: WritingStatisticsSnapshot) => void,
  schedule: StatisticsTaskSchedule = scheduleStatisticsTask,
  onFailure: (request: WritingStatisticsRequest) => void = () => undefined,
): WritingStatisticsScheduler {
  let generation = 0
  let latest: WritingStatisticsRequest | null = null
  let postedGeneration = 0
  let cancelScheduled: (() => void) | null = null
  let disposed = false
  let worker: Worker | null = null
  let retries = 0

  const createWorker = () => {
    const next = new Worker(new URL('./word-statistics.worker.ts', import.meta.url), { type: 'module' })
    next.onmessage = (event: MessageEvent<{ generation: number; statistics: WritingStatistics }>) => {
      if (disposed || event.data.generation !== generation || !latest) return
      postedGeneration = 0
      retries = 0
      onResult({ ...latest, statistics: event.data.statistics })
    }
    next.onerror = () => handleWorkerFailure(next)
    return next
  }

  const stopWorker = () => {
    worker?.terminate()
    worker = null
    postedGeneration = 0
  }

  const postRequest = (request: WritingStatisticsRequest, current: number) => {
    try {
      if (!worker) worker = createWorker()
      postedGeneration = current
      worker.postMessage({ generation: current, request })
    } catch {
      stopWorker()
      if (!disposed && current === generation && retries++ === 0) postRequest(request, current)
      else if (!disposed && current === generation) onFailure(request)
    }
  }

  function handleWorkerFailure(failedWorker: Worker): void {
    const current = postedGeneration
    if (disposed || !current || worker !== failedWorker || current !== generation || !latest) return
    const request = latest
    stopWorker()
    if (retries++ === 0) postRequest(request, current)
    else onFailure(request)
  }

  return {
    request(request) {
      latest = request
      const current = ++generation
      retries = 0
      cancelScheduled?.()
      if (postedGeneration) stopWorker()
      cancelScheduled = schedule(() => {
        cancelScheduled = null
        if (disposed || current !== generation) return
        postRequest(request, current)
      })
    },
    cancel() {
      generation++
      latest = null
      cancelScheduled?.()
      cancelScheduled = null
      if (postedGeneration) stopWorker()
    },
    release() {
      generation++
      latest = null
      cancelScheduled?.()
      cancelScheduled = null
      stopWorker()
    },
    dispose() {
      disposed = true
      generation++
      latest = null
      cancelScheduled?.()
      cancelScheduled = null
      stopWorker()
    },
  }
}
