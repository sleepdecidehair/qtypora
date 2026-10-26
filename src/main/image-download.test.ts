import { EventEmitter } from 'node:events'
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const transport = vi.hoisted(() => ({ lookup: vi.fn(), get: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup: transport.lookup }))
vi.mock('node:http', () => ({ default: { get: transport.get } }))
vi.mock('node:https', () => ({ default: { get: transport.get } }))
import { downloadRemoteImage, downloadedImage, isPublicImageAddress, remoteImageUrl } from './image-download'

const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>')
type Reply = { status?: number; location?: string; type?: string; chunks?: Buffer[]; length?: number }
let replies: Reply[]
beforeEach(() => {
  replies = []
  transport.lookup.mockReset().mockResolvedValue([{ address: '93.184.215.14', family: 4 }])
  transport.get.mockReset().mockImplementation((_url: URL, _options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    const request = Object.assign(new EventEmitter(), { destroy(error?: Error) { if (error) request.emit('error', error); request.emit('close'); return request } })
    queueMicrotask(() => {
      const reply = replies.shift() ?? {}
      const response = Object.assign(new EventEmitter(), { statusCode: reply.status ?? 200, headers: { location: reply.location, 'content-type': reply.type ?? 'image/svg+xml', 'content-length': reply.length }, destroyed: false, destroy() { response.destroyed = true; request.emit('close'); return response } })
      callback(response as unknown as IncomingMessage)
      if (!response.destroyed) {
        for (const chunk of reply.chunks ?? [svg]) { response.emit('data', chunk); if (response.destroyed) break }
        if (!response.destroyed) response.emit('end')
        request.emit('close')
      }
    })
    return request as unknown as ClientRequest
  })
})

describe('explicit bounded remote image download', () => {
  it('rejects local/private IP representations, credentials and non-HTTP protocols', () => {
    for (const address of ['127.0.0.1', '10.0.0.1', '192.168.1.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fd00::1', 'fe80::1']) expect(isPublicImageAddress(address)).toBe(false)
    expect(isPublicImageAddress('8.8.8.8')).toBe(true)
    for (const url of ['http://127.1/a.png', 'http://2130706433/a.png', 'http://localhost/a.png', 'https://user:secret@example.com/a.png', 'file:///tmp/a.png']) expect(() => remoteImageUrl(url)).toThrow()
  })
  it('pins the checked DNS address for the request and accepts a structurally safe image', async () => {
    expect(await downloadRemoteImage('https://images.example/picture.svg')).toEqual({ name: 'picture.svg', bytes: svg })
    const options = transport.get.mock.calls[0][1] as RequestOptions
    const callback = vi.fn()
    options.lookup!('images.example', { family: 4 }, callback)
    expect(callback).toHaveBeenCalledWith(null, '93.184.215.14', 4)
    expect(options.headers).toEqual({ Accept: 'image/*', 'Accept-Encoding': 'identity' })
  })
  it('rejects private DNS answers and every redirect target before making that request', async () => {
    transport.lookup.mockResolvedValueOnce([{ address: '10.1.2.3', family: 4 }])
    await expect(downloadRemoteImage('https://images.example/a.svg')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    expect(transport.get).not.toHaveBeenCalled()
    replies.push({ status: 302, location: 'http://127.0.0.1/private.svg' })
    await expect(downloadRemoteImage('https://images.example/a.svg')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    expect(transport.get).toHaveBeenCalledTimes(1)
  })
  it('bounds redirects, advertised size and chunked size, and rejects malicious SVG and HTML', async () => {
    replies.push(...Array.from({ length: 6 }, () => ({ status: 302, location: '/again.svg' })))
    await expect(downloadRemoteImage('https://images.example/a.svg')).rejects.toThrow('重定向次数')
    replies.push({ length: 10 * 1024 * 1024 + 1 })
    await expect(downloadRemoteImage('https://images.example/a.svg')).rejects.toThrow('10 MB')
    replies.push({ chunks: [Buffer.alloc(6 * 1024 * 1024), Buffer.alloc(6 * 1024 * 1024)] })
    await expect(downloadRemoteImage('https://images.example/a.svg')).rejects.toThrow('10 MB')
    await expect(downloadedImage('https://images.example/a.svg', 'image/svg+xml', Buffer.from('<svg><script>alert(1)</script></svg>'))).rejects.toThrow()
    await expect(downloadedImage('https://images.example/a.png', 'text/html', Buffer.from('html'))).rejects.toThrow()
  })
})
