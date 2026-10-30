import { describe, expect, it } from 'vitest'
import { DocumentOperationGate } from './document-operation-gate'

describe('document save and reload reservation', () => {
  it('excludes overlapping operations on the same document but allows other documents', () => {
    const gate = new DocumentOperationGate()
    const first = gate.begin('one')
    expect(() => gate.begin('one')).toThrow('正在保存或重新载入')
    const second = gate.begin('two')
    first(); first()
    const retry = gate.begin('one')
    second(); retry()
    expect(() => gate.begin('two')).not.toThrow()
  })
})
