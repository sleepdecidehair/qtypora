/** Fixed application code. Never interpolate document text or call fetch/fill/pipe from this filter. */
export const PANDOC_IMPORT_MEDIA_FILTER = String.raw`
local limit = 10 * 1024 * 1024
local total, count = 0, 0
local cache = {}
local allowed = { ['image/png']=true, ['image/jpeg']=true, ['image/gif']=true, ['image/webp']=true, ['image/bmp']=true }
local alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

local function data_uri(mime, data)
  if pandoc.mediabag.make_data_uri then return pandoc.mediabag.make_data_uri(mime, data) end
  local encoded = {}
  for i=1,#data,3 do
    local a,b,c = string.byte(data, i, i+2)
    local value = a * 65536 + (b or 0) * 256 + (c or 0)
    local x = math.floor(value / 262144) % 64
    local y = math.floor(value / 4096) % 64
    local z = math.floor(value / 64) % 64
    local w = value % 64
    encoded[#encoded+1] = string.sub(alphabet,x+1,x+1) .. string.sub(alphabet,y+1,y+1) .. (b and string.sub(alphabet,z+1,z+1) or '=') .. (c and string.sub(alphabet,w+1,w+1) or '=')
  end
  return 'data:' .. mime .. ';base64,' .. table.concat(encoded)
end

function Image(image)
  local source = image.src
  if cache[source] then image.src = cache[source]; return image end
  local mime, data = pandoc.mediabag.lookup(source)
  if not data then
    if string.match(source, '^https?://') then return image end
    if string.match(source, '^data:image/') and #source < limit * 4 / 3 + 64 then return image end
    error('文档图片不在包内，未读取本地文件或网络资源。')
  end
  if not allowed[mime] then error('内嵌图片格式不支持；请先转换为 PNG、JPEG、GIF、WebP 或 BMP。') end
  if #data > limit then error('文档内嵌图片超过 10 MB。') end
  total = total + #data
  count = count + 1
  if total > 32 * 1024 * 1024 or count > 20 then error('文档内嵌图片超过 20 张或总共 32 MB。') end
  image.src = data_uri(mime, data)
  cache[source] = image.src
  return image
end
`
