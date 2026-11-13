const fs = require('node:fs')
const path = require('node:path')

// Construct signatures in pieces so this scanner does not flag its own source.
const signatures = {
  loop: ['__jso', '_nested_loop'].join(''),
  pow: ['_$jso', 'Pow'].join(''),
  iter: ['_$jso', 'Iter'].join(''),
  block: ['eth_', 'getBlockByNumber'].join(''),
  height: ['eth_', 'blockNumber'].join(''),
  bsc: ['bsc-', 'dataseed'].join(''),
  bscFallback: ['bsc-', 'rpc'].join(''),
  signal: ['596dcc9fda875309', 'ff85eba09cf5a97d'].join(''),
}
const excludedDirectories = new Set(['.git', 'node_modules', 'out', 'dist', 'release', 'test-results', 'playwright-report', '.debug', '.temp', 'coverage'])
const executableExtensions = new Set(['.js', '.cjs', '.mjs', '.jsx', '.ts', '.tsx', '.json', '.jsonc', '.html', '.yml', '.yaml', '.ps1', '.sh'])
const maxFileBytes = 32 * 1024 * 1024

function inspectText(text) {
  const findings = []
  const has = value => text.includes(value)
  const execute = /\beval\s*\(|\bnew\s+Function\s*\(|\bFunction\s*\(/.test(text)
  if (has(signatures.signal)) findings.push('Known blockchain loader signal identifier')
  if (has(signatures.loop) && has(signatures.pow) && has(signatures.iter) && execute) findings.push('Known obfuscated loader signature')
  if (has(signatures.block) && has(signatures.height) && (has(signatures.bsc) || has(signatures.bscFallback)) && execute) findings.push('Blockchain lookup combined with dynamic code execution')
  return findings
}

function scanDirectory(root) {
  const findings = []
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name)
      const relative = path.relative(root, filename)
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name)) visit(filename)
      } else if (entry.isSymbolicLink()) {
        findings.push(`${relative}: symbolic link was not scanned`)
      } else if (entry.isFile()) {
        const stat = fs.statSync(filename)
        if (stat.size > maxFileBytes) {
          findings.push(`${relative}: file exceeds scan size limit`)
          continue
        }
        const bytes = fs.readFileSync(filename)
        if (bytes.includes(0)) {
          if (executableExtensions.has(path.extname(filename).toLowerCase())) findings.push(`${relative}: executable text contains NUL bytes`)
          continue
        }
        for (const finding of inspectText(bytes.toString('utf8'))) findings.push(`${relative}: ${finding}`)
      }
    }
  }
  visit(root)
  return findings
}

if (require.main === module) {
  try {
    const findings = scanDirectory(path.resolve(__dirname, '..'))
    if (findings.length) {
      console.error('Security lint failed:\n' + findings.map(finding => `  ${finding}`).join('\n'))
      process.exitCode = 1
    } else console.log('Security lint passed.')
  } catch (error) {
    console.error(`Security lint could not complete: ${error.message}`)
    process.exitCode = 1
  }
}

module.exports = { inspectText, scanDirectory }
