import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { EditorDocument } from '../hooks/useDocuments'
import { SystemVersionsDialog, versionScopeMatches } from './SystemVersionsDialog'

const document: EditorDocument = { id: 'one', path: '/tmp/a.md', name: 'a.md', content: '草稿', version: 'v1', revision: 2, savedContent: '原文', lineEnding: 'LF', encoding: 'utf8', readOnly: false, isSaving: false, externalChange: null }
const scope = { snapshot: { id: document.id, content: document.content, revision: document.revision }, path: document.path, version: document.version, externalChange: document.externalChange }

describe('system version preview', () => {
  it('invalidates on switching document, changing content, revision, path, disk version or external state', () => {
    expect(versionScopeMatches(scope, document)).toBe(true)
    for (const change of [{ id: 'other' }, { content: 'different' }, { revision: 3 }, { path: '/tmp/b.md' }, { version: 'v2' }, { externalChange: 'removed' as const }]) expect(versionScopeMatches(scope, { ...document, ...change })).toBe(false)
    expect(versionScopeMatches(scope, null)).toBe(false)
  })
  it('renders a labelled read-only dialog without any restore action', () => {
    const api = { listSystemVersions: async () => ({ ok: true as const, data: [] }), readSystemVersion: async () => ({ ok: true as const, data: { content: '', encoding: 'utf8' as const } }) }
    const html = renderToStaticMarkup(createElement(SystemVersionsDialog, { api, scope, current: document, onClose: () => {} }))
    expect(html).toContain('aria-label="系统版本历史"')
    expect(html).toContain('只读预览')
    expect(html).not.toContain('恢复此版本')
    const stale = renderToStaticMarkup(createElement(SystemVersionsDialog, { api, scope, current: null, onClose: () => {} }))
    expect(stale).toContain('文档已变化或切换')
  })
})
