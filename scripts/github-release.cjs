const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { snapshot } = require('./package-checks.cjs')

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))

function createContext(repository, commit, version) {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][\w.-]*$/.test(repository ?? '') || !/^[a-f0-9]{40}$/.test(commit ?? '')) throw new Error('Invalid GitHub repository or commit.')
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? '')) throw new Error('Invalid release version.')
  const tag = `v${version}-internal-${commit.slice(0, 12)}`
  return { repository, commit, version, tag, marker: `<!-- qtypora-source:${commit} -->`, names: [`QTypora-${version}-internal-x64-setup.exe`, 'SHA256SUMS.txt', 'QTypora-Internal-Test.cer'] }
}

function childPath(parent, relative) {
  const base = fs.realpathSync(parent)
  const resolved = fs.realpathSync(path.resolve(base, relative))
  const remainder = path.relative(base, resolved)
  if (!remainder || remainder === '..' || remainder.startsWith(`..${path.sep}`) || path.isAbsolute(remainder)) throw new Error('Release path escapes its parent directory.')
  return resolved
}

function loadBuild(root, context, sourceHash = snapshot().sha256) {
  const pointer = readJson(path.join(root, 'release/latest.json'))
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?-internal-x64-\d{8}-\d{6}-[a-f0-9]{8}$/.test(pointer.directory ?? '')) throw new Error('Invalid release directory.')
  const directory = childPath(path.join(root, 'release'), pointer.directory)
  const receipt = readJson(childPath(directory, 'internal-build.json'))
  if (receipt.status !== 'complete' || receipt.version !== context.version || receipt.architecture !== 'x64' || receipt.installer !== context.names[0] || pointer.installer !== receipt.installer || receipt.runId !== pointer.runId || receipt.sha256 !== pointer.sha256) throw new Error('Build receipt and release pointer do not match.')
  if (receipt.sourceSha256 !== sourceHash) throw new Error('The installer was built from different source inputs. Build this commit again.')
  if (!(receipt.checks?.unitPassed > 0 && receipt.checks?.desktopPassed > 0 && receipt.checks?.shellIconLifecyclePassed >= 5 && receipt.checks?.releasePublisherTests === 'passed')) throw new Error('Required build checks did not pass.')
  const assets = context.names.map(name => {
    const file = childPath(directory, name)
    const bytes = fs.readFileSync(file)
    if (!fs.statSync(file).isFile() || !bytes.length) throw new Error(`Missing release file: ${name}`)
    return { name, file, size: bytes.length, digest: `sha256:${sha256(bytes)}` }
  })
  if (assets[0].digest !== `sha256:${receipt.sha256}` || fs.readFileSync(assets[1].file, 'utf8').trim() !== `${receipt.sha256}  ${context.names[0]}`) throw new Error('Installer or checksum file was modified after packaging.')
  const certificateBytes = fs.readFileSync(assets[2].file)
  const certificate = new crypto.X509Certificate(certificateBytes)
  if (!certificate.raw.equals(certificateBytes) || certificate.fingerprint.replaceAll(':', '') !== receipt.certificateThumbprint) throw new Error('Public certificate does not match the build signer.')
  return { receipt, assets }
}

function parseApiResponse(result, missing = false) {
  if (result.error) throw new Error(`GitHub CLI could not complete the request: ${result.error.code ?? 'process error'}`)
  const status = Number(result.stdout?.match(/^HTTP\/[\d.]+ (\d+)/)?.[1])
  if (missing && status === 404) return null
  if (result.status !== 0 || status < 200 || status >= 300 || !status) throw new Error(`GitHub API request failed (HTTP ${status || 'unknown'}, exit ${result.status}).`)
  const boundary = result.stdout.search(/\r?\n\r?\n/)
  if (boundary === -1) throw new Error('GitHub API response headers are missing.')
  return JSON.parse(result.stdout.slice(boundary).trim())
}

function createClient(root, context) {
  const prefix = `repos/${context.repository}`
  const request = (method, endpoint, body, missing = false) => {
    const args = ['api', `${prefix}/${endpoint}`, '--method', method, '--include']
    if (body) args.push('--input', '-')
    try {
      return parseApiResponse(spawnSync('gh', args, { cwd: root, encoding: 'utf8', input: body ? JSON.stringify(body) : undefined, timeout: 120_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }), missing)
    } catch (error) { throw new Error(`${method} ${endpoint}: ${error.message}`) }
  }
  return {
    request,
    findRelease() {
      const published = request('GET', `releases/tags/${context.tag}`, undefined, true)
      if (published) return published
      // GitHub's by-tag endpoint only serves published releases; drafts need listing.
      for (let page = 1; page <= 20; page++) {
        const releases = request('GET', `releases?per_page=100&page=${page}`)
        const draft = releases.find(release => release.tag_name === context.tag)
        if (draft) return draft
        if (releases.length < 100) return null
      }
      throw new Error('Release lookup exceeded 2,000 entries. Clean up old drafts before retrying.')
    },
    upload(assets) {
      const result = spawnSync('gh', ['release', 'upload', context.tag, ...assets.map(asset => asset.file), '--repo', context.repository, '--clobber'], { cwd: root, stdio: 'inherit', timeout: 20 * 60_000, windowsHide: true })
      if (result.error || result.status !== 0) throw new Error('Release upload failed. The release remains a draft; rerun the workflow to retry.')
    },
  }
}

function assertOwned(release, context) {
  if (release.tag_name !== context.tag || release.prerelease !== true || !release.body?.includes(context.marker) || !Number.isSafeInteger(release.id)) throw new Error('The release tag is already used by another release. Nothing was overwritten.')
  if (release.assets.some(asset => !context.names.includes(asset.name))) throw new Error('Unexpected assets exist in the release. Nothing was overwritten.')
}

function assertAssets(release, context, expected) {
  if (release.assets.length !== context.names.length) throw new Error('Release has missing or duplicate assets.')
  for (const name of context.names) {
    const matches = release.assets.filter(asset => asset.name === name)
    const wanted = expected?.find(asset => asset.name === name)
    if (matches.length !== 1 || matches[0].state !== 'uploaded' || !(matches[0].size > 0) || !/^sha256:[a-f0-9]{64}$/.test(matches[0].digest ?? '') || (wanted && (matches[0].size !== wanted.size || matches[0].digest !== wanted.digest))) throw new Error(`Release asset is incomplete or has an incorrect digest: ${name}`)
  }
}

function assertTag(client, context, required = false) {
  const ref = client.request('GET', `git/ref/tags/${context.tag}`, undefined, true)
  if ((!ref && required) || (ref && (ref.object.type !== 'commit' || ref.object.sha !== context.commit))) throw new Error('Release tag does not point to the pushed commit.')
}

function getStatus(client, context) {
  assertTag(client, context)
  const release = client.findRelease()
  if (!release) return { published: false, tag: context.tag }
  assertOwned(release, context)
  if (release.draft) return { published: false, tag: context.tag }
  assertTag(client, context, true)
  assertAssets(release, context)
  return { published: true, tag: context.tag, url: release.html_url }
}

function releaseNotes(context, build) {
  return [
    `QTypora ${context.version} Windows x64 internal build.`, '', context.marker,
    `Source commit: ${context.commit}`, '',
    'Includes the installer, SHA256SUMS.txt and the public signing certificate. No private signing keys are distributed.',
    'This is a self-signed internal prerelease without a public timestamp. Windows may show an unknown-publisher or SmartScreen prompt.', '',
    `Installer SHA-256: ${build.receipt.sha256}`, '',
    `Verified: ${build.receipt.checks.unitPassed} unit tests, release publisher tests, ${build.receipt.checks.shellIconLifecyclePassed} Shell lifecycle checks and ${build.receipt.checks.desktopPassed} packaged desktop test(s).`,
    'The full installation wizard, upgrades and uninstallation still need validation on a separate test machine.', '',
    `[Build and signing guide](https://github.com/${context.repository}/blob/${context.commit}/docs/Windows-%E5%86%85%E6%B5%8B%E6%89%93%E5%8C%85.md)`,
  ].join('\n')
}

function publish(client, context, buildLoader) {
  const status = getStatus(client, context)
  if (status.published) return status
  const build = buildLoader()
  const commit = client.request('GET', `git/commits/${context.commit}`)
  if (commit.sha !== context.commit) throw new Error('The source commit is not available on GitHub.')
  let release = client.findRelease()
  if (!release) release = client.request('POST', 'releases', { tag_name: context.tag, target_commitish: context.commit, name: `QTypora ${context.version} Windows x64 (${context.commit.slice(0, 12)})`, body: releaseNotes(context, build), draft: true, prerelease: true, make_latest: 'false' })
  assertOwned(release, context)
  if (!release.draft) throw new Error('Release became public during upload preparation. Rerun to check its status.')
  const pending = build.assets.filter(asset => !release.assets.some(remote => remote.name === asset.name && remote.state === 'uploaded' && remote.size === asset.size && remote.digest === asset.digest))
  // Workflows for the same commit are serialized. Only this owned draft can be replaced.
  if (pending.length) client.upload(pending)
  release = client.request('GET', `releases/${release.id}`)
  assertOwned(release, context)
  if (!release.draft) throw new Error('Release became public before verification. No public assets were intentionally replaced.')
  assertAssets(release, context, build.assets)
  release = client.request('PATCH', `releases/${release.id}`, { draft: false, prerelease: true, make_latest: 'false', body: releaseNotes(context, build) })
  assertOwned(release, context)
  if (release.draft) throw new Error('GitHub did not publish the verified release.')
  assertAssets(release, context, build.assets)
  assertTag(client, context, true)
  return { published: true, tag: context.tag, url: release.html_url }
}

function main() {
  const command = process.argv[2]
  if (!['status', 'publish'].includes(command)) throw new Error('Usage: node scripts/github-release.cjs status|publish (inside GitHub Actions).')
  if (process.env.GITHUB_ACTIONS !== 'true' || !process.env.GH_TOKEN) throw new Error('Run this publisher through the Windows internal release workflow. No personal token is required.')
  const root = path.resolve(__dirname, '..')
  const context = createContext(process.env.GITHUB_REPOSITORY, process.env.GITHUB_SHA, readJson(path.join(root, 'package.json')).version)
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true })
  const dirty = spawnSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, encoding: 'utf8', windowsHide: true })
  if (head.status !== 0 || head.stdout.trim() !== context.commit || dirty.status !== 0 || dirty.stdout.trim()) throw new Error('The checkout must be clean and match the pushed commit.')
  const client = createClient(root, context)
  const result = command === 'status' ? getStatus(client, context) : publish(client, context, () => loadBuild(root, context))
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `published=${result.published}\ntag=${result.tag}\n`)
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, result.url ? `Windows internal release: [${result.tag}](${result.url})\n` : `Preparing Windows internal release for ${context.commit}.\n`)
  console.log(JSON.stringify(result))
}

module.exports = { createContext, loadBuild, parseApiResponse, getStatus, publish }
if (require.main === module) {
  try { main() } catch (error) { console.error(`GitHub release failed: ${error.message}`); process.exitCode = 1 }
}
