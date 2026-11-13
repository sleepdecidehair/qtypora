const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { artifactNames, classifyArchitecture, validateVersion } = require('./package-mac-checks.cjs')
const { acquireMacPackagingLock, primaryWorktreeFromPorcelain, repositoryRootFromCommonDirectory, sharedMacLockPath } = require('./package-mac-internal.cjs')

test('macOS artifact names keep the two architectures separate', () => {
  assert.deepEqual(artifactNames('1.2.3'), [
    'QTypora-1.2.3-internal-mac-arm64.dmg',
    'QTypora-1.2.3-internal-mac-x64.dmg',
  ])
})

test('lipo architecture output must describe one expected architecture', () => {
  assert.equal(classifyArchitecture('arm64\n'), 'arm64')
  assert.equal(classifyArchitecture('Non-fat file: app is architecture: x86_64'), 'x64')
  assert.throws(() => classifyArchitecture('x86_64 arm64'), /exactly one architecture/)
  assert.throws(() => classifyArchitecture('i386'), /Unsupported/)
})

test('release versions reject path and macro injection', () => {
  assert.equal(validateVersion('0.1.0'), '0.1.0')
  assert.equal(validateVersion('1.0.0-beta.2'), '1.0.0-beta.2')
  assert.throws(() => validateVersion('../release'), /Unsupported/)
})

test('linked worktrees resolve one shared macOS packaging lock and acquire it atomically', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'qtypora-mac-lock-'))
  const primary = path.join(temporary, 'repository')
  const linked = path.join(temporary, 'worktrees', 'feature')
  const commonDirectory = path.join(primary, '.git')
  const primaryLock = sharedMacLockPath(primary, '.git')
  const linkedLock = sharedMacLockPath(linked, commonDirectory)
  let descriptor
  try {
    assert.equal(repositoryRootFromCommonDirectory(primary, '.git'), primary)
    assert.equal(repositoryRootFromCommonDirectory(linked, commonDirectory), primary)
    assert.equal(linkedLock, primaryLock)
    descriptor = acquireMacPackagingLock(primaryLock)
    assert.throws(() => acquireMacPackagingLock(linkedLock), /locked across linked worktrees/)
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
    if (fs.existsSync(primaryLock)) fs.unlinkSync(primaryLock)
    fs.rmSync(temporary, { recursive: true, force: true })
  }
})

test('custom Git common directories still share one lock and primary release root', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'qtypora-mac-custom-git-'))
  const primary = path.join(temporary, 'primary repository')
  const linkedA = path.join(temporary, 'worktrees', 'a')
  const linkedB = path.join(temporary, 'worktrees', 'b')
  const commonDirectory = path.join(temporary, 'git-storage', 'qtypora-meta')
  try {
    assert.equal(sharedMacLockPath(linkedA, commonDirectory), path.join(commonDirectory, 'qtypora-package-mac.lock'))
    assert.equal(sharedMacLockPath(linkedB, commonDirectory), path.join(commonDirectory, 'qtypora-package-mac.lock'))
    assert.equal(primaryWorktreeFromPorcelain(linkedA, `worktree ${primary}\0HEAD abc\0\0worktree ${linkedA}\0HEAD def\0\0`), primary)
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
})
