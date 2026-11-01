/// <reference lib="webworker" />
import { calculateWritingStatistics, type WritingStatisticsRequest } from './word-statistics-core'

interface StatisticsWorkerRequest { generation: number; request: WritingStatisticsRequest }

self.onmessage = (event: MessageEvent<StatisticsWorkerRequest>) => {
  const snapshot = calculateWritingStatistics(event.data.request)
  self.postMessage({ generation: event.data.generation, statistics: snapshot.statistics })
}

export {}
