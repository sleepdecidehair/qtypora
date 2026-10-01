const { execFile } = require('node:child_process')
const { isAbsolute, extname } = require('node:path')
const { promisify } = require('node:util')
const run = promisify(execFile)

// No password or private-key export; the key remains in CurrentUser\My.
// Internal signatures intentionally have no public timestamp service dependency.
module.exports = async function sign(configuration) {
  const thumbprint = process.env.QTYPORA_SIGNING_THUMBPRINT
  const signtool = process.env.QTYPORA_SIGNTOOL
  if (process.platform !== 'win32' || !/^[A-F0-9]{40}$/i.test(thumbprint ?? '') || !signtool || !isAbsolute(signtool)) {
    throw new Error('Local Windows signing configuration is missing or invalid.')
  }
  if (configuration.hash !== 'sha256' || configuration.isNest || extname(configuration.path).toLowerCase() !== '.exe') {
    throw new Error('Internal signing accepts one SHA-256 signature on Windows executables only.')
  }
  await run(signtool, ['sign', '/sha1', thumbprint, '/s', 'My', '/fd', 'SHA256', '/d', 'QTypora Internal Test', configuration.path], {
    windowsHide: true,
    timeout: 120_000,
  })
}
