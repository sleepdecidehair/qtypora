param([Parameter(Mandatory)][string]$InstalledDirectory)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$testRoot = Join-Path $projectRoot '.debug'
$installedPath = [IO.Path]::GetFullPath($InstalledDirectory)
if ([IO.Path]::GetDirectoryName($installedPath) -ne $testRoot -or [IO.Path]::GetFileName($installedPath) -notlike 'install-smoke-*') {
    throw 'Signature tests require the isolated workspace test installation.'
}
. (Join-Path $PSScriptRoot 'verify-signature.ps1')
$metadata = Get-Content -LiteralPath (Join-Path $projectRoot 'release\internal-build.json') -Raw | ConvertFrom-Json
$uninstaller = Join-Path $installedPath 'Uninstall QTypora.exe'
foreach ($file in @($uninstaller, (Join-Path $installedPath 'QTypora.exe'))) {
    Assert-InternalSignature -Path $file -Thumbprint $metadata.certificateThumbprint | Format-List
}
# Inspect a disposable data copy only. Never launch it or modify the installer/app.
$probePath = Join-Path $testRoot ('signature-probe-' + [guid]::NewGuid().ToString('N') + '.bin')
try {
    $bytes = [IO.File]::ReadAllBytes($uninstaller)
    $bytes[4096] = [byte]($bytes[4096] -bxor 1)
    [IO.File]::WriteAllBytes($probePath, $bytes)
    $result = [QTypora.AuthenticodeVerifier]::Verify($probePath)
    if ($result -ne [Convert]::ToUInt32('80096010', 16)) { throw ('Unexpected altered-file status: 0x{0:X8}' -f $result) }
    Write-Output ('Altered data copy correctly rejected: 0x{0:X8}' -f $result)
} finally {
    if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($probePath)) -ne $testRoot) { throw 'Unsafe probe cleanup path.' }
    Remove-Item -LiteralPath $probePath -Force -ErrorAction SilentlyContinue
}
