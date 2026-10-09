const test = require('node:test')
const assert = require('node:assert/strict')
const { artifactNames, classifyArchitecture, validateVersion } = require('./package-mac-checks.cjs')

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
