const FRAME_PATHS: Record<string, RegExp> = {
  'www.youtube-nocookie.com': /^\/embed\/[A-Za-z0-9_-]{1,80}$/,
  'www.youtube.com': /^\/embed\/[A-Za-z0-9_-]{1,80}$/,
  'player.vimeo.com': /^\/video\/\d+$/,
  'player.bilibili.com': /^\/player\.html$/,
}

export function allowedEmbedUrl(source: string): string | null {
  try {
    const url = new URL(source)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !FRAME_PATHS[url.hostname]?.test(url.pathname)) return null
    const permitted = url.hostname === 'player.bilibili.com' ? ['bvid', 'aid', 'cid', 'page', 'p'] : ['start', 'end', 't', 'h']
    for (const key of Array.from(url.searchParams.keys())) if (!permitted.includes(key)) url.searchParams.delete(key)
    url.hash = ''
    return url.href
  } catch { return null }
}

export const EMBED_FRAME_POLICY = "https://www.youtube-nocookie.com https://www.youtube.com https://player.vimeo.com https://player.bilibili.com"
