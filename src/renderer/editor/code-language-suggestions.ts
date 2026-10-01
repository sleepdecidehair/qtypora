import { codeLanguageSuggestions, type CodeLanguageOption } from './code-languages'

let nextSuggestionId = 0

export function attachCodeLanguageSuggestions(input: HTMLInputElement, onPick: (value: string) => void): () => void {
  const popup = document.createElement('div')
  popup.className = 'cm-code-language-suggestions'
  popup.popover = 'manual'
  popup.id = `code-language-suggestions-${++nextSuggestionId}`
  popup.setAttribute('role', 'listbox')
  popup.setAttribute('aria-label', '代码语言建议')
  input.parentElement!.append(popup)
  input.setAttribute('role', 'combobox')
  input.setAttribute('aria-autocomplete', 'list')
  input.setAttribute('aria-haspopup', 'listbox')
  input.setAttribute('aria-controls', popup.id)
  input.setAttribute('aria-expanded', 'false')
  let matches: readonly CodeLanguageOption[] = []
  let activeIndex = -1
  const scroller = input.closest('.cm-scroller')
  const isOpen = (): boolean => popup.matches(':popover-open')
  const close = (): void => {
    if (isOpen()) popup.hidePopover()
    input.setAttribute('aria-expanded', 'false')
    input.removeAttribute('aria-activedescendant')
    scroller?.removeEventListener('scroll', close)
    window.removeEventListener('resize', close)
  }
  const pick = (option: CodeLanguageOption): void => {
    input.value = option.value
    close()
    onPick(option.value)
  }
  const highlight = (): void => {
    Array.from(popup.children).forEach((element, index) => element.setAttribute('aria-selected', String(index === activeIndex)))
    const active = popup.children[activeIndex]
    if (active) {
      input.setAttribute('aria-activedescendant', active.id)
      active.scrollIntoView({ block: 'nearest' })
    } else input.removeAttribute('aria-activedescendant')
  }
  const show = (): void => {
    if (input.readOnly || !input.isConnected) return
    matches = codeLanguageSuggestions(input.value)
    activeIndex = -1
    popup.replaceChildren()
    for (const [index, option] of matches.entries()) {
      const item = document.createElement('button')
      item.type = 'button'; item.id = `${popup.id}-${index}`
      item.setAttribute('role', 'option'); item.setAttribute('aria-selected', 'false')
      item.tabIndex = -1; item.textContent = option.name
      item.addEventListener('mousedown', event => event.preventDefault())
      item.addEventListener('click', event => { event.stopPropagation(); pick(option) })
      popup.append(item)
    }
    if (!matches.length) { close(); return }
    const rect = input.getBoundingClientRect()
    const style = getComputedStyle(popup)
    const rowHeight = parseFloat(getComputedStyle(popup.firstElementChild!).height)
    const inset = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
    const height = Math.ceil(Math.min(matches.length, 5) * rowHeight + inset)
    const below = window.innerHeight - rect.bottom - 8
    const above = rect.top - 8
    const useAbove = below < height && above > below
    const available = Math.max(rowHeight, useAbove ? above : below)
    popup.style.width = `${Math.min(220, window.innerWidth - 16)}px`
    popup.style.maxHeight = `${Math.min(height, available)}px`
    popup.style.left = `${Math.max(8, rect.right - Math.min(220, window.innerWidth - 16))}px`
    popup.style.top = `${useAbove ? Math.max(8, rect.top - Math.min(height, available) - 4) : rect.bottom + 4}px`
    if (!isOpen()) popup.showPopover()
    input.setAttribute('aria-expanded', 'true')
    scroller?.addEventListener('scroll', close, { passive: true })
    window.addEventListener('resize', close)
  }
  const update = (event: Event): void => { if (!(event instanceof InputEvent) || !event.isComposing) show() }
  const keydown = (event: KeyboardEvent): void => {
    if (event.isComposing || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
    if (!isOpen() && ['ArrowDown', 'ArrowUp'].includes(event.key)) show()
    if (!isOpen()) return
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(event.key)) {
      const direction = ['ArrowUp', 'PageUp'].includes(event.key) ? -1 : 1
      const step = event.key.startsWith('Page') ? 5 : 1
      activeIndex = event.key === 'Home' ? 0 : event.key === 'End' ? matches.length - 1 : activeIndex < 0 ? 0 : Math.max(0, Math.min(matches.length - 1, activeIndex + direction * step))
      highlight()
    } else if (event.key === 'Enter' && activeIndex >= 0) pick(matches[activeIndex])
    else if (event.key === 'Escape') close()
    else return
    event.preventDefault(); event.stopImmediatePropagation()
  }
  input.addEventListener('focus', show)
  input.addEventListener('input', update)
  input.addEventListener('compositionend', show)
  input.addEventListener('blur', close)
  input.addEventListener('keydown', keydown)
  return () => {
    close()
    input.removeEventListener('focus', show); input.removeEventListener('input', update)
    input.removeEventListener('compositionend', show); input.removeEventListener('blur', close)
    input.removeEventListener('keydown', keydown)
    popup.remove()
  }
}
