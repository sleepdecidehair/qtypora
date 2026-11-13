const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')
const { inspectText, scanDirectory } = require('./security-lint.cjs')

test('detects the observed loader even when it is hidden after whitespace', () => {
  const suspicious = 'module.exports = {};' + ' '.repeat(2000) + ['__jso', '_nested_loop'].join('') + ['_$jso', 'Pow'].join('') + ['_$jso', 'Iter'].join('') + ';eval (payload)'
  assert.match(inspectText(suspicious).join(' '), /obfuscated loader/)
})

test('detects blockchain lookup combined with dynamic execution', () => {
  const parts = [['eth_', 'getBlockByNumber'].join(''), ['eth_', 'blockNumber'].join(''), ['bsc-', 'dataseed'].join('')]
  assert.match(inspectText(parts.join(' ') + ' eval(code)').join(' '), /Blockchain lookup/)
  assert.deepEqual(inspectText(parts.join(' ')), [])
  assert.deepEqual(inspectText('eval(code)'), [])
})

test('reports suspicious untracked files and fails closed on unscannable executable content', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qtypora-security-lint-'))
  try {
    fs.mkdirSync(path.join(root, 'nested'))
    fs.writeFileSync(path.join(root, 'nested', 'payload.cjs'), ['596dcc9fda875309', 'ff85eba09cf5a97d'].join(''))
    fs.writeFileSync(path.join(root, 'hidden.js'), Buffer.from([0, 1, 2]))
    fs.mkdirSync(path.join(root, 'node_modules'))
    fs.writeFileSync(path.join(root, 'node_modules', 'ignored.js'), ['596dcc9fda875309', 'ff85eba09cf5a97d'].join(''))
    const findings = scanDirectory(root)
    assert.equal(findings.length, 2)
    assert.ok(findings.some(finding => finding.includes('payload.cjs')))
    assert.ok(findings.some(finding => finding.includes('hidden.js')))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('the lint command fails before a suspicious file can be used', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qtypora-security-gate-'))
  try {
    fs.mkdirSync(path.join(root, 'scripts'))
    fs.copyFileSync(path.join(__dirname, 'security-lint.cjs'), path.join(root, 'scripts', 'security-lint.cjs'))
    const filename = path.join(root, 'candidate.cjs')
    fs.writeFileSync(filename, ['596dcc9fda875309', 'ff85eba09cf5a97d'].join(''))
    const run = () => spawnSync(process.execPath, [path.join(root, 'scripts', 'security-lint.cjs')], { encoding: 'utf8' })
    const rejected = run()
    assert.equal(rejected.status, 1)
    assert.match(rejected.stderr, /candidate\.cjs/)
    fs.unlinkSync(filename)
    assert.equal(run().status, 0)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
