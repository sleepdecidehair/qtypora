export const MAX_DATA_IMAGE_BYTES = 10 * 1024 * 1024
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function dataImageInfo(source: string): { mime: string; byteLength: number } | null {
  if (source.length > Math.ceil(MAX_DATA_IMAGE_BYTES / 3) * 4 + 64) return null
  const prefix = /^data:(image\/(?:png|jpeg|gif|webp|bmp));base64,/i.exec(source)
  if (!prefix) return null
  const encoded = source.slice(prefix[0].length)
  if (!encoded.length || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
  const byteLength = encoded.length / 4 * 3 - padding
  if (byteLength > MAX_DATA_IMAGE_BYTES) return null
  const bytes: number[] = []
  for (let index = 0; index < Math.min(encoded.length, 32); index += 4) {
    const value = (ALPHABET.indexOf(encoded[index]) << 18) | (ALPHABET.indexOf(encoded[index + 1]) << 12) | (Math.max(0, ALPHABET.indexOf(encoded[index + 2])) << 6) | Math.max(0, ALPHABET.indexOf(encoded[index + 3]))
    bytes.push((value >>> 16) & 255, (value >>> 8) & 255, value & 255)
  }
  const ascii = (start: number, length: number): string => String.fromCharCode(...bytes.slice(start, start + length))
  const mime = prefix[1].toLowerCase()
  const matches = mime === 'image/png' ? byteLength >= 8 && bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10'
    : mime === 'image/jpeg' ? byteLength >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : mime === 'image/gif' ? byteLength >= 6 && ['GIF87a', 'GIF89a'].includes(ascii(0, 6))
        : mime === 'image/webp' ? byteLength >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP'
          : byteLength >= 2 && ascii(0, 2) === 'BM'
  return matches ? { mime, byteLength } : null
}

export function isSafeDataImage(source: string): boolean { return dataImageInfo(source) !== null }
