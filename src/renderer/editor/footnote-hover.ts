import { Prec, type Extension } from '@codemirror/state'
import { activateHover, closeHoverTooltip, EditorView, hoverTooltip } from '@codemirror/view'
import { editorLocale } from './editor-i18n'
import { markdownDocumentModel, markdownOptionsFacet } from './markdown-config'
import { renderedFootnoteDefinition } from './markdown-references'
import { sanitizeMarkdownHtml } from './markdown'
import './footnote-hover.css'

let tooltipId = 0

export function footnoteHoverExtension(onLinkOpen: (href: string) => void): Extension {
  const hover = hoverTooltip((view, pos, side) => {
    if (!view.state.facet(markdownOptionsFacet).footnotes) return null
    const reference = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.cm-live-footnote')).find(element => {
      const from = Number(element.dataset.footnoteFrom)
      const to = Number(element.dataset.footnoteTo)
      return (pos > from || pos === from && side > 0) && (pos < to || pos === to && side < 0)
    })
    if (!reference) return null
    const from = Number(reference.dataset.footnoteFrom)
    const end = Number(reference.dataset.footnoteTo)
    const label = view.state.doc.sliceString(from, end).match(/^\[\^([^\]\s]+)\]$/)?.[1]
    if (!label) return null
    const model = markdownDocumentModel(view.state)
    const html = renderedFootnoteDefinition(model.parser, model.tokens, model.environment, label)
    if (!html) return null
    return {
      pos: from,
      end,
      above: true,
      create() {
        const staging = document.createElement('template')
        staging.innerHTML = html
        for (const image of staging.content.querySelectorAll('img')) image.replaceWith(document.createTextNode(image.alt))
        for (const media of staging.content.querySelectorAll('audio,video,source,iframe,object,embed,script,style,.footnote-backref')) media.remove()
        const dom = document.createElement('div')
        dom.className = 'cm-footnote-tooltip md-preview-block'
        dom.id = `footnote-preview-${++tooltipId}`
        dom.setAttribute('role', 'tooltip')
        dom.contentEditable = 'false'
        dom.innerHTML = sanitizeMarkdownHtml(staging.innerHTML, view.state.facet(editorLocale))
        for (const element of dom.querySelectorAll('*')) {
          for (const attribute of Array.from(element.attributes)) {
            if (attribute.name === 'id' || attribute.name === 'name' || attribute.name.startsWith('data-')) element.removeAttribute(attribute.name)
          }
        }
        for (const anchor of dom.querySelectorAll('a')) anchor.replaceWith(...Array.from(anchor.childNodes))
        dom.addEventListener('mousedown', event => event.preventDefault())
        return {
          dom,
          getCoords: () => reference.getBoundingClientRect(),
          mount: () => reference.setAttribute('aria-describedby', dom.id),
          destroy: () => { if (reference.getAttribute('aria-describedby') === dom.id) reference.removeAttribute('aria-describedby') },
        }
      },
    }
  }, { hideOnChange: true, hideOn: transaction => transaction.reconfigured })
  return [hover, Prec.highest(EditorView.domEventHandlers({
    scroll(_event, view) {
      if (view.state.field(hover.active).length) view.dispatch({ effects: closeHoverTooltip(hover) })
    },
    focusin(event, view) {
      const reference = event.target instanceof Element ? event.target.closest<HTMLElement>('.cm-live-footnote') : null
      if (reference) activateHover(view, Number(reference.dataset.footnoteFrom), 1, { tooltip: hover, until: transaction => transaction.docChanged || Boolean(transaction.selection) || transaction.reconfigured })
    },
    focusout(event, view) {
      if (event.target instanceof Element && event.target.closest('.cm-live-footnote')) view.dispatch({ effects: closeHoverTooltip(hover) })
    },
    keydown(event, view) {
      if (event.key === 'Escape' && view.state.field(hover.active).length) {
        event.preventDefault()
        view.dispatch({ effects: closeHoverTooltip(hover) })
        return true
      }
      const reference = event.target instanceof Element ? event.target.closest<HTMLElement>('.cm-live-footnote') : null
      if (event.key !== 'Enter' || !reference?.dataset.href) return false
      event.preventDefault()
      view.dispatch({ effects: closeHoverTooltip(hover) })
      onLinkOpen(reference.dataset.href)
      return true
    },
  }))]
}
