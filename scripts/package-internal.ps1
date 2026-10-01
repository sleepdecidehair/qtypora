param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'This packaging command requires Windows.' }
$env:PSModulePath = "$PSHOME\Modules;${env:ProgramFiles}\WindowsPowerShell\Modules"
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1')
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')
Import-Module PKI

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$debugRoot = Join-Path $projectRoot '.debug'
$releaseRoot = Join-Path $projectRoot 'release'
New-Item -ItemType Directory -Path $debugRoot, $releaseRoot -Force | Out-Null
$lockPath = Join-Path $debugRoot 'package.lock'
try { $lock = [IO.File]::Open($lockPath, 'CreateNew', 'ReadWrite', 'None') }
catch { throw 'Packaging is locked. Wait for the current run; after an interrupted run, remove .debug/package.lock only when no packaging process remains.' }

$runId = (Get-Date).ToString('yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$runRoot = Join-Path $debugRoot "package-runs\$runId"
$staging = Join-Path $runRoot 'package'
$logs = Join-Path $runRoot 'logs'
$environmentNames = @('QTYPORA_SIGNING_THUMBPRINT', 'QTYPORA_SIGNTOOL', 'QTYPORA_RELEASE_DIR', 'QTYPORA_PACKAGED_EXE', 'QTYPORA_PACKAGE_LOG_DIR', 'PLAYWRIGHT_JSON_OUTPUT_FILE')
$oldEnvironment = @{}
foreach ($name in $environmentNames) { $oldEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$transcribing = $false
$promoted = $false
Push-Location $projectRoot

function Invoke-Step {
    param([string]$Name, [string]$Executable, [string[]]$Arguments)
    Write-Host "--- $Name ---"
    # Route native output through the host so Windows PowerShell transcripts capture it.
    # Native stderr may contain warnings; the original process exit code decides success.
    $previousErrorAction = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $Executable @Arguments 2>&1 | Out-Host
        $exitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousErrorAction }
    if ($exitCode -ne 0) { throw "$Name failed (exit $exitCode). See $logs." }
}
function Write-Json {
    param($Value, [string]$Path)
    $Value | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $Path -Encoding UTF8
}
function Assert-ChildPath {
    param([string]$Path, [string]$Parent)
    $resolved = [IO.Path]::GetFullPath($Path)
    $prefix = [IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Path outside expected directory: $resolved" }
}

try {
    New-Item -ItemType Directory -Path $logs, $staging -Force | Out-Null
    Start-Transcript -LiteralPath (Join-Path $logs 'pipeline.log') | Out-Null
    $transcribing = $true
    $preflightPath = Join-Path $logs 'inputs.json'
    Invoke-Step 'Locked dependencies and source snapshot' 'node.exe' @('scripts/package-checks.cjs', 'preflight', $preflightPath)
    $inputs = Get-Content -LiteralPath $preflightPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $version = (Get-Content -LiteralPath 'package.json' -Raw -Encoding UTF8 | ConvertFrom-Json).version
    if ($version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') { throw 'Unsupported release version.' }
    $destination = Join-Path $releaseRoot "$version-internal-x64-$runId"
    if (Test-Path -LiteralPath $destination) { throw 'Release destination already exists.' }

    $sdkRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
    $signTool = Get-ChildItem -LiteralPath $sdkRoot -Directory |
        Where-Object { $_.Name -match '^10\.0\.\d+\.\d+$' } |
        Sort-Object { [version]$_.Name } -Descending |
        ForEach-Object { Join-Path $_.FullName 'x64\signtool.exe' } |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (-not $signTool) { throw 'Install Windows SDK x64 SignTool before packaging.' }
    $certificate = Get-ChildItem -Path Cert:\CurrentUser\My |
        Where-Object { $_.Subject -eq 'CN=QTypora Internal Test' -and $_.FriendlyName -eq 'QTypora Internal Test Code Signing' -and $_.HasPrivateKey -and $_.NotBefore -le (Get-Date) -and $_.NotAfter -gt (Get-Date).AddDays(30) -and @($_.EnhancedKeyUsageList | Where-Object { $_.ObjectId -eq '1.3.6.1.5.5.7.3.3' }).Count -gt 0 } |
        Sort-Object NotAfter -Descending | Select-Object -First 1
    if (-not $certificate) {
        $certificate = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=QTypora Internal Test' -FriendlyName 'QTypora Internal Test Code Signing' `
            -CertStoreLocation 'Cert:\CurrentUser\My' -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 `
            -KeyExportPolicy NonExportable -NotAfter (Get-Date).AddYears(1)
    }
    $env:QTYPORA_SIGNING_THUMBPRINT = $certificate.Thumbprint
    $env:QTYPORA_SIGNTOOL = $signTool
    $env:QTYPORA_RELEASE_DIR = $staging
    $env:QTYPORA_PACKAGE_LOG_DIR = $logs
    $env:PLAYWRIGHT_JSON_OUTPUT_FILE = Join-Path $logs 'desktop-tests.json'

    Invoke-Step 'Type checking' 'npm.cmd' @('run', 'typecheck')
    Invoke-Step 'Unit tests' 'npm.cmd' @('test', '--', '--reporter=default', '--reporter=json', "--outputFile=$(Join-Path $logs 'unit-tests.json')")
    $unit = Get-Content -LiteralPath (Join-Path $logs 'unit-tests.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $unit.success -or $unit.numPassedTests -lt 1 -or $unit.numFailedTests -ne 0) { throw 'Unit test report did not confirm success.' }
    Invoke-Step 'Generate icons from the master SVG' 'npm.cmd' @('run', 'build:icon')
    Invoke-Step 'Compile application' 'npm.cmd' @('run', 'build')
    Invoke-Step 'Build signed NSIS installer' (Join-Path $projectRoot 'node_modules\.bin\electron-builder.cmd') @('--config', 'electron-builder.internal.cjs', '--win', 'nsis', '--x64', '--publish', 'never')
    Invoke-Step 'Windows Shell icons and file association lifecycle' 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/test-installer-icons.ps1', '-OutputDirectory', $logs)
    Invoke-Step 'Verify embedded icons and packaged resources' 'node.exe' @('scripts/package-checks.cjs', 'verify', $staging, (Join-Path $logs 'payload.json'))

    $installerName = "QTypora-$version-internal-x64-setup.exe"
    $installer = Join-Path $staging $installerName
    $appExe = Join-Path $staging 'win-unpacked\QTypora.exe'
    . (Join-Path $PSScriptRoot 'verify-signature.ps1')
    $signatures = @()
    foreach ($file in @($installer, $appExe)) { $signatures += Assert-InternalSignature -Path $file -Thumbprint $certificate.Thumbprint }
    Write-Json $signatures (Join-Path $logs 'signatures.json')

    $env:QTYPORA_PACKAGED_EXE = $appExe
    Invoke-Step 'Real packaged application smoke test' (Join-Path $projectRoot 'node_modules\.bin\playwright.cmd') @('test', 'tests/packaged.spec.ts', '--reporter=list,json', "--output=$(Join-Path $logs 'desktop-artifacts')")
    $desktop = Get-Content -LiteralPath (Join-Path $logs 'desktop-tests.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($desktop.stats.expected -lt 1 -or $desktop.stats.unexpected -ne 0 -or $desktop.stats.skipped -ne 0 -or $desktop.stats.flaky -ne 0) { throw 'Packaged desktop test report did not confirm success.' }

    $afterPath = Join-Path $logs 'inputs-after.json'
    Invoke-Step 'Reject source changes during packaging' 'node.exe' @('scripts/package-checks.cjs', 'snapshot', $afterPath)
    $after = Get-Content -LiteralPath $afterPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($after.sha256 -ne $inputs.source.sha256) { throw 'Build inputs changed during packaging. Run the command again after edits finish.' }
    Export-Certificate -Cert $certificate -FilePath (Join-Path $staging 'QTypora-Internal-Test.cer') -Type CERT | Out-Null
    $hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $installerName" | Set-Content -LiteralPath (Join-Path $staging 'SHA256SUMS.txt') -Encoding ASCII
    $payload = Get-Content -LiteralPath (Join-Path $logs 'payload.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $shellIcons = Get-Content -LiteralPath (Join-Path $logs 'installer-icons.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($shellIcons.status -ne 'passed' -or @($shellIcons.checks).Count -lt 5) { throw 'Installer icon lifecycle report did not confirm success.' }
    $metadata = [ordered]@{
        status = 'complete'; runId = $runId; version = $version; architecture = 'x64'; installer = $installerName
        sha256 = $hash; certificateThumbprint = $certificate.Thumbprint
        certificateExpires = $certificate.NotAfter.ToUniversalTime().ToString('o')
        recordedAt = (Get-Date).ToUniversalTime().ToString('o'); timestamped = $false
        publiclyTrusted = (@($signatures | Where-Object { -not $_.PubliclyTrusted }).Count -eq 0)
        node = $inputs.node; npm = (& npm.cmd --version); electron = $inputs.electron; builder = $inputs.builder
        signTool = $signTool; sourceSha256 = $inputs.source.sha256; payload = $payload
        checks = @{ unitPassed = $unit.numPassedTests; desktopPassed = $desktop.stats.expected; shellIconLifecyclePassed = @($shellIcons.checks).Count; installerExecution = 'isolated NSIS custom macros tested; full installer does not replace the current installation' }
    }
    if ($LASTEXITCODE -ne 0) { throw 'Unable to record npm version.' }
    Write-Json $metadata (Join-Path $staging 'internal-build.json')
    Invoke-Step 'Copy UTF-8 release guide' 'node.exe' @('scripts/package-checks.cjs', 'notes', $staging, (Join-Path $logs 'guide.json'))
    Stop-Transcript | Out-Null
    $transcribing = $false
    Copy-Item -LiteralPath $logs -Destination (Join-Path $staging 'logs') -Recurse
    # Both absolute paths must stay under the intended workspace before the directory move.
    Assert-ChildPath $staging $runRoot
    Assert-ChildPath $destination $releaseRoot
    Move-Item -LiteralPath $staging -Destination $destination
    $promoted = $true
    $latest = @{ directory = [IO.Path]::GetFileName($destination); installer = $installerName; sha256 = $hash; runId = $runId }
    $latestTemporary = Join-Path $releaseRoot "latest-$runId.tmp"
    Write-Json $latest $latestTemporary
    $latestPath = Join-Path $releaseRoot 'latest.json'
    if (Test-Path -LiteralPath $latestPath) { [IO.File]::Replace($latestTemporary, $latestPath, (Join-Path $destination 'logs\previous-latest.json')) }
    else { [IO.File]::Move($latestTemporary, $latestPath) }
    Write-Host "Verified internal installer: $(Join-Path $destination $installerName)"
    Write-Host "Passed $($unit.numPassedTests) unit tests and $($desktop.stats.expected) packaged desktop test."
} catch {
    if (Test-Path -LiteralPath $logs) {
        Write-Json @{ status = 'failed'; error = $_.Exception.Message; promoted = $promoted } (Join-Path $logs 'failure.json')
    }
    throw
} finally {
    if ($transcribing) { Stop-Transcript | Out-Null }
    foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name, $oldEnvironment[$name], 'Process') }
    Pop-Location
    $lock.Dispose()
    Remove-Item -LiteralPath $lockPath -Force
}
