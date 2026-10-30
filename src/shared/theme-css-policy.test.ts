import { describe, expect, it } from 'vitest'
import { allowsThemeCss } from './theme-css-policy'

describe('theme CSS resource gate', () => {
  it('rejects obfuscated resource tokens and unsupported at-rules', () => {
    for (const css of [
      'a{color:u/**/rl("https://example.com")}',
      'a{background:u\\72l("https://example.com")}',
      '@import/**/"https://example.com";',
      '@media screen{@font-face{src:local("example")}}',
      'a{background:image-/**/set("https://example.com")}',
      'a{color:red}/* unclosed',
      'a{font-family:"unfinished}',
    ]) expect(allowsThemeCss(css)).toBe(false)
  })

  it('allows inert quoted decoration escapes but not identifier escapes', () => {
    expect(allowsThemeCss('a:before{content:"\\f0da"}')).toBe(true)
    expect(allowsThemeCss('a{c\\6flor:red}')).toBe(false)
    expect(allowsThemeCss('@media screen and (min-width: 1400px){h1{color:red}}')).toBe(true)
  })
})
