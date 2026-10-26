import { describe, expect, it } from 'vitest'
import { allowedEmbedUrl } from './embedded-media'

describe('embedded video URL policy', () => {
  it('keeps only fixed HTTPS players and removes autoplay, redirects and fragments', () => {
    expect(allowedEmbedUrl('https://www.youtube.com/embed/video_123?start=4&autoplay=1&origin=https://evil.test#x')).toBe('https://www.youtube.com/embed/video_123?start=4')
    expect(allowedEmbedUrl('https://player.bilibili.com/player.html?bvid=BV123&page=2&autoplay=1')).toBe('https://player.bilibili.com/player.html?bvid=BV123&page=2')
    expect(allowedEmbedUrl('https://player.vimeo.com/video/123?h=ab')).toBe('https://player.vimeo.com/video/123?h=ab')
  })
  it('rejects credentials, executable protocols, arbitrary pages and lookalike hosts', () => {
    for (const source of ['javascript:alert(1)', 'data:text/html,hi', 'file:///tmp/a.html', 'http://www.youtube.com/embed/x', 'https://www.youtube.com.evil.test/embed/x', 'https://user:pass@www.youtube.com/embed/x', 'https://www.youtube.com/watch?v=x', 'https://www.youtube.com:8443/embed/x', 'https://www.youtube.com/embed/../../watch', '//www.youtube.com/embed/x']) expect(allowedEmbedUrl(source)).toBeNull()
  })
})
