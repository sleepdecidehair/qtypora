$ErrorActionPreference = 'Stop'
& node.exe (Join-Path $PSScriptRoot 'create-icon.cjs')
if ($LASTEXITCODE -ne 0) { throw 'SVG icon generation failed.' }
