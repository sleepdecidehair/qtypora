const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { createContext, loadBuild, parseApiResponse, getStatus, publish } = require('./github-release.cjs')

// Public DER fixture only: no private signing material is needed by these tests.
const certificate = Buffer.from('MIIEEDCCAnigAwIBAgIQJADJDy8aZZxG+A+l5qpfwzANBgkqhkiG9w0BAQsFADAgMR4wHAYDVQQDDBVRVHlwb3JhIEludGVybmFsIFRlc3QwHhcNMjYxMDAxMDI0NjU4WhcNMjcxMDAxMDI1NjU4WjAgMR4wHAYDVQQDDBVRVHlwb3JhIEludGVybmFsIFRlc3QwggGiMA0GCSqGSIb3DQEBAQUAA4IBjwAwggGKAoIBgQDCIP21haEUYMSl2hUMsD9o7rUCHR+FRG7psO9ef8tqZw7G87yARnh5X6+iTavXGtTPapdn1/WeW9/1zNn6BjrLwk/6yLAUJVKY3AtOSIr0GydzFrhzX0Yh1IkYRfEWwFooVY6Gg4AFXW6aI0PJKccfLfK5omE0zfUXMIOQMB5hj0reai5I3KKGgDpSgi3RMxrMqa8tbkOZTjQqXeutkspmpcT3lRRFAUynrOoa4ClfcqK2XtmbUVkzNvsyOB+D7axAEGa1ep9iZK1EcRg2j9RPpCjWWFeL5um0CcP6qlzNKHjdTCZXllvUY53tiEReXoUGA6K3Ze61i+H69IZitQKmtFLquCrCmPzrRikohyJBbuNOa62MYafjpeT+jWgqkeJ2zxngtM7f2qJhr56xKc14WkOzW1/RcxhOB28fHxiLloO5nwpnSy5kqHsHnmR8H1HR+BfkdfByvQ06dbJwRwJ+eBFyWd98Fz9qAhLTNEbMSgtxalURSYYykGa9dAI9n10CAwEAAaNGMEQwDgYDVR0PAQH/BAQDAgeAMBMGA1UdJQQMMAoGCCsGAQUFBwMDMB0GA1UdDgQWBBT62Uyl5XypJWCJjXyY0isn0qC4SzANBgkqhkiG9w0BAQsFAAOCAYEAGnB0z6Vl3yLo4kI0qt4vgB8LmraOFoHS3nQAs6hOFGlH3r7TH7YAC/ir0YzzKxDqKWbchGYPtmaxtxrInGLHHpW5BWNlmvP273t+Hk2q+xtstLmUegJPMLZ4KubCfgt7pA0z+g4DQYyccjrKK98SMph+pF+HoTiPikGs65Ol84F0LMbsLLw0gs3K1yZ6Ryc9Wow7NV9KtFUikgTlv5h4NsSFLmgTrVVvDv30CkRsjHBVGfU+aGnD9qSi1tILCnwHaeP6cwQVhfB26LkDZGGeT8d0VndkXyWdwJj5rPKWHLjy6lsjnGeZISv7iO+6/Twl9JcJqxHUqaZkoyD7gKEaai7msPfjxGJ1Xl8/9fbiKcn6DGWF96kwGWUOkWCWZnELFviGOIvAjszZxf+iqBFDrDZQ55gM4eVDk1qw5SjjONqBC7Afcp51DGsoucI9x/GhdwR0iAyCGukJzpkcNB6hvOjCMXlhH8eu8GyqM2/B791rXd152IhEYZ8I2v8DiqUb', 'base64')
const context = createContext('example/qtypora', 'a'.repeat(40), '0.1.0')
const sourceHash = 'b'.repeat(64)
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qtypora-release-test-'))
  t.after(() => {
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('qtypora-release-test-')) throw new Error('Unsafe fixture cleanup path.')
    fs.rmSync(root, { recursive: true, force: true })
  })
  const directory = '0.1.0-internal-x64-20261001-120000-abcdef12'
  const output = path.join(root, 'release', directory)
  fs.mkdirSync(output, { recursive: true })
  const installer = Buffer.from('signed installer fixture')
  const receipt = { status: 'complete', version: '0.1.0', architecture: 'x64', installer: context.names[0], runId: '20261001-120000-abcdef12', sha256: hash(installer), sourceSha256: sourceHash, certificateThumbprint: new crypto.X509Certificate(certificate).fingerprint.replaceAll(':', ''), checks: { unitPassed: 1, desktopPassed: 1, shellIconLifecyclePassed: 5, releasePublisherTests: 'passed' } }
  const pointer = { directory, installer: receipt.installer, sha256: receipt.sha256, runId: receipt.runId }
  const write = (name, value) => fs.writeFileSync(path.join(output, name), value)
  const updateReceipt = () => write('internal-build.json', JSON.stringify(receipt))
  updateReceipt()
  fs.writeFileSync(path.join(root, 'release/latest.json'), JSON.stringify(pointer))
  write(context.names[0], installer)
  write(context.names[1], `${receipt.sha256}  ${context.names[0]}\n`)
  write(context.names[2], certificate)
  return { root, output, pointer, receipt, write, updateReceipt, load: () => loadBuild(root, context, sourceHash) }
}

function fakeClient(build, initial) {
  const state = { release: initial ?? null, tag: initial && !initial.draft ? context.commit : null, writes: [], uploads: [], corrupt: false, failUpload: false }
  const copy = value => value === null ? null : structuredClone(value)
  return {
    state,
    findRelease: () => copy(state.release),
    request(method, endpoint, body) {
      if (method === 'GET' && endpoint.startsWith('git/ref/tags/')) return state.tag ? { object: { type: 'commit', sha: state.tag } } : null
      if (method === 'GET' && endpoint.startsWith('git/commits/')) return { sha: context.commit }
      if (method === 'GET' && endpoint === 'releases/1') return copy(state.release)
      state.writes.push({ method, endpoint, body })
      if (method === 'POST' && endpoint === 'releases') {
        state.release = { ...body, id: 1, assets: [], html_url: 'https://github.com/example/qtypora/releases/tag/' + context.tag }
        return copy(state.release)
      }
      if (method === 'PATCH' && endpoint === 'releases/1') {
        Object.assign(state.release, body)
        if (!body.draft) state.tag = context.commit
        return copy(state.release)
      }
      throw new Error('Unexpected request: ' + method + ' ' + endpoint)
    },
    upload(assets) {
      state.uploads.push(...assets.map(asset => asset.name))
      for (const asset of assets) {
        state.release.assets = state.release.assets.filter(previous => previous.name !== asset.name)
        state.release.assets.push({ name: asset.name, size: asset.size, digest: state.corrupt ? 'sha256:' + '0'.repeat(64) : asset.digest, state: 'uploaded' })
        if (state.failUpload) throw new Error('Upload interrupted')
      }
    },
  }
}

function release(build, draft = true) {
  return { id: 1, tag_name: context.tag, target_commitish: context.commit, body: context.marker, prerelease: true, draft, html_url: 'https://github.com/example/qtypora/releases/tag/' + context.tag, assets: build.assets.map(asset => ({ name: asset.name, size: asset.size, digest: asset.digest, state: 'uploaded' })) }
}

test('release tags are stable per commit and distinct across commits', () => {
  assert.equal(createContext('example/qtypora', context.commit, '0.1.0').tag, context.tag)
  assert.notEqual(createContext('example/qtypora', 'c'.repeat(40), '0.1.0').tag, context.tag)
  for (const args of [['example/qtypora\n', context.commit, '0.1.0'], ['../qtypora', context.commit, '0.1.0'], ['example/../other', context.commit, '0.1.0'], ['example/qtypora', 'HEAD', '0.1.0'], ['example/qtypora', context.commit, '0.1.0;echo']]) assert.throws(() => createContext(...args), /Invalid/)
})

test('API parsing distinguishes an absent resource from permission and transport failures', () => {
  assert.deepEqual(parseApiResponse({ status: 0, stdout: 'HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n{"id":1}' }), { id: 1 })
  assert.equal(parseApiResponse({ status: 1, stdout: 'HTTP/2.0 404 Not Found\n\n{}' }, true), null)
  assert.throws(() => parseApiResponse({ status: 1, stdout: 'HTTP/2.0 403 Forbidden\n\n{}' }, true), /403/)
  assert.throws(() => parseApiResponse({ status: 0, stdout: 'not an HTTP response' }), /unknown/)
  assert.throws(() => parseApiResponse({ error: { code: 'ETIMEDOUT' } }), /ETIMEDOUT/)
})

test('verified build files include exactly the installer, checksum and public DER certificate', t => {
  const build = fixture(t).load()
  assert.deepEqual(build.assets.map(asset => asset.name), context.names)
  assert.ok(build.assets.every(asset => /^sha256:[a-f0-9]{64}$/.test(asset.digest)))
})

test('stale build inputs cannot be published', t => {
  const files = fixture(t)
  assert.throws(() => loadBuild(files.root, context, 'c'.repeat(64)), /different source inputs/)
})

test('a failed or skipped required check blocks publication', t => {
  const files = fixture(t)
  files.receipt.checks.desktopPassed = 0
  files.updateReceipt()
  assert.throws(files.load, /Required build checks/)
  files.receipt.checks.desktopPassed = 1
  files.receipt.checks.releasePublisherTests = 'skipped'
  files.updateReceipt()
  assert.throws(files.load, /Required build checks/)
})

test('modified installer or checksum file is rejected', t => {
  const files = fixture(t)
  files.write(context.names[1], 'wrong checksum')
  assert.throws(files.load, /checksum file was modified/)
  files.write(context.names[1], `${files.receipt.sha256}  ${context.names[0]}\n`)
  files.write(context.names[0], 'unsigned replacement')
  assert.throws(files.load, /modified after packaging/)
})

test('certificate with appended material or a different signer is rejected', t => {
  const files = fixture(t)
  files.write(context.names[2], Buffer.concat([certificate, Buffer.from('extra material')]))
  assert.throws(files.load, /certificate does not match/)
  files.write(context.names[2], certificate)
  files.receipt.certificateThumbprint = '0'.repeat(40)
  files.updateReceipt()
  assert.throws(files.load, /certificate does not match/)
})

test('directory traversal and a release directory junction cannot escape release/', t => {
  const files = fixture(t)
  files.pointer.directory = '../outside'
  fs.writeFileSync(path.join(files.root, 'release/latest.json'), JSON.stringify(files.pointer))
  assert.throws(files.load, /Invalid release directory/)
  const other = fixture(t)
  const junction = '0.1.0-internal-x64-20261001-120000-abcdef99'
  fs.symlinkSync(other.output, path.join(files.root, 'release', junction), 'junction')
  files.pointer.directory = junction
  fs.writeFileSync(path.join(files.root, 'release/latest.json'), JSON.stringify(files.pointer))
  assert.throws(files.load, /escapes its parent/)
})

test('successful publication verifies all assets and uses the exact pushed commit', t => {
  const build = fixture(t).load()
  const client = fakeClient(build)
  const result = publish(client, context, () => build)
  assert.equal(result.published, true)
  assert.equal(client.state.release.draft, false)
  assert.equal(client.state.writes[0].body.target_commitish, context.commit)
  assert.deepEqual(client.state.uploads, context.names)
  assert.equal(client.state.tag, context.commit)
})

test('an already published commit does not rebuild, reupload or modify the release', t => {
  const build = fixture(t).load()
  const client = fakeClient(build, release(build, false))
  assert.equal(publish(client, context, () => { throw new Error('Must not rebuild') }).published, true)
  assert.deepEqual(client.state.writes, [])
  assert.deepEqual(client.state.uploads, [])
})

test('wrong tag targets and foreign drafts fail without writes', t => {
  const build = fixture(t).load()
  const client = fakeClient(build)
  client.state.tag = 'f'.repeat(40)
  assert.throws(() => publish(client, context, () => build), /does not point/)
  assert.deepEqual(client.state.writes, [])
  client.state.tag = null
  client.state.release = { ...release(build), body: 'Created by another publisher' }
  assert.throws(() => publish(client, context, () => build), /already used/)
  assert.deepEqual(client.state.writes, [])
})

test('a draft can resume after an interrupted upload', t => {
  const build = fixture(t).load()
  const client = fakeClient(build)
  client.state.failUpload = true
  assert.throws(() => publish(client, context, () => build), /interrupted/)
  assert.equal(client.state.release.draft, true)
  assert.equal(client.state.writes.some(write => write.method === 'PATCH'), false)
  client.state.failUpload = false
  client.state.uploads = []
  assert.equal(publish(client, context, () => build).published, true)
  assert.deepEqual(client.state.uploads, context.names.slice(1))
})

test('a rebuilt certificate can replace only mismatching assets in an owned draft', t => {
  const build = fixture(t).load()
  const draft = release(build)
  draft.assets[0].digest = 'sha256:' + 'e'.repeat(64)
  const client = fakeClient(build, draft)
  publish(client, context, () => build)
  assert.deepEqual(client.state.uploads, [context.names[0]])
})

test('remote size or digest mismatch leaves the release unpublished', t => {
  const build = fixture(t).load()
  const client = fakeClient(build)
  client.state.corrupt = true
  assert.throws(() => publish(client, context, () => build), /incorrect digest/)
  assert.equal(client.state.release.draft, true)
  assert.equal(client.state.writes.some(write => write.method === 'PATCH'), false)
})

test('incomplete public releases and unexpected assets never get overwritten', t => {
  const build = fixture(t).load()
  const publicRelease = release(build, false)
  publicRelease.assets.pop()
  const client = fakeClient(build, publicRelease)
  assert.throws(() => getStatus(client, context), /missing or duplicate/)
  assert.deepEqual(client.state.writes, [])
  client.state.release = release(build)
  client.state.release.assets.push({ name: 'private.pfx' })
  assert.throws(() => publish(client, context, () => build), /Unexpected assets/)
  assert.deepEqual(client.state.uploads, [])
})
