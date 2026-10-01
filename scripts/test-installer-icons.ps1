param([Parameter(Mandatory = $true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
$debugPrefix = (Join-Path $projectRoot '.debug').TrimEnd('\') + '\'
if (-not $outputRoot.StartsWith($debugPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Installer tests must stay inside .debug.' }
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

$token = [guid]::NewGuid().ToString('N')
$testRoot = Join-Path $outputRoot "shell-icons-$token"
New-Item -ItemType Directory -Path $testRoot | Out-Null
$extension = ".qtypora-icon-test-$token"
$appId = "com.qtypora.icon-test.$token"
$exeName = "QTypora-Icon-Test-$token.exe"
$applicationKey = "Software\Classes\Applications\$exeName"
$typeKey = "Software\Classes\$appId.Markdown"
$extensionKey = "Software\Classes\$extension"
$otherType = "$appId.Other"
$privateKeys = @($applicationKey, $typeKey, $extensionKey, "Software\Classes\$otherType")
foreach ($key in $privateKeys) {
    $existing = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($key)
    if ($existing) { $existing.Dispose(); throw "Unexpected existing test registry key: $key" }
}

function Assert-Equal($Actual, $Expected, [string]$Description) {
    if ($Actual -cne $Expected) { throw "$Description mismatch. Expected '$Expected', received '$Actual'." }
}
function Read-Value([string]$Key, [string]$Name = '') {
    $opened = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($Key)
    if (-not $opened) { return $null }
    try { return $opened.GetValue($Name, $null, 'DoNotExpandEnvironmentNames') }
    finally { $opened.Dispose() }
}
function Write-Value([string]$Key, [string]$Name, [string]$Value) {
    $opened = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($Key)
    try { $opened.SetValue($Name, $Value, 'String') } finally { $opened.Dispose() }
}
function Run-TestProgram([string]$File, [string[]]$Arguments) {
    $process = Start-Process -FilePath $File -ArgumentList $Arguments -WindowStyle Hidden -PassThru
    try {
        if (-not $process.WaitForExit(60000)) { $process.Kill(); throw "Installer test timed out: $File" }
        if ($process.ExitCode -ne 0) { throw "Installer test exited $($process.ExitCode): $File" }
    } finally { $process.Dispose() }
}

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;
public static class QTyporaShellIconTest {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct FileInfo {
        public IntPtr Icon; public int Index; public uint Attributes;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string DisplayName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)] public string TypeName;
    }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr SHGetFileInfo(string path, uint attributes, ref FileInfo info, uint size, uint flags);
    [DllImport("shell32.dll")]
    private static extern void SHChangeNotify(uint eventId, uint flags, IntPtr first, IntPtr second);
    [DllImport("user32.dll")]
    private static extern bool DestroyIcon(IntPtr icon);
    public static void Refresh() { SHChangeNotify(0x08000000, 0x1000, IntPtr.Zero, IntPtr.Zero); }
    public static void AssertMatches(string expected, string actual) {
        byte[] first = Convert.FromBase64String(expected), second = Convert.FromBase64String(actual);
        if (first.Length != second.Length) throw new InvalidOperationException("Shell icon dimensions differ.");
        // Shell premultiplied-alpha conversion can round a channel by one level.
        for (int index = 0; index < first.Length; index++)
            if (Math.Abs(first[index] - second[index]) > 1)
                throw new InvalidOperationException("Shell icon differs from the approved ICO at channel " + index);
    }
    public static string Pixels(string path, string png) {
        FileInfo info = new FileInfo();
        if (SHGetFileInfo(path, 0, ref info, (uint)Marshal.SizeOf(info), 0x100) == IntPtr.Zero || info.Icon == IntPtr.Zero)
            throw new InvalidOperationException("Shell could not resolve icon: " + path);
        try {
            using (Icon icon = Icon.FromHandle(info.Icon))
            using (Bitmap bitmap = icon.ToBitmap()) {
                bitmap.Save(png, System.Drawing.Imaging.ImageFormat.Png);
                byte[] pixels = new byte[bitmap.Width * bitmap.Height * 4];
                int offset = 0;
                for (int y = 0; y < bitmap.Height; y++)
                    for (int x = 0; x < bitmap.Width; x++) {
                        Color color = bitmap.GetPixel(x, y);
                        pixels[offset++] = color.R; pixels[offset++] = color.G;
                        pixels[offset++] = color.B; pixels[offset++] = color.A;
                    }
                return Convert.ToBase64String(pixels);
            }
        } finally { DestroyIcon(info.Icon); }
    }
}
'@

$cacheRoot = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache'
$compiler = Get-ChildItem -LiteralPath $cacheRoot -Directory -Filter 'nsis-3.*' |
    ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -Recurse -Filter 'makensis.exe' } |
    Where-Object { $_.Directory.Name -ne 'Bin' } | Select-Object -First 1
$plugin = Get-ChildItem -LiteralPath $cacheRoot -Directory -Filter 'nsis-resources-*' |
    ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -Recurse -Filter 'WinShell.dll' } |
    Where-Object { $_.Directory.Name -eq 'x86-unicode' } | Select-Object -First 1
if (-not $compiler -or -not $plugin) { throw 'NSIS tools are missing; build the installer before running this test.' }

$source = @'
Unicode true
RequestExecutionLevel user
SilentInstall silent
SilentUnInstall silent
Name "QTypora isolated icon test"
Icon "@PROJECTROOT@\build\icon.ico"
OutFile "@TESTROOT@\icon-harness.exe"
!include "LogicLib.nsh"
!addplugindir /x86-unicode "@PLUGINDIR@"
!define APP_ID "@APPID@"
!define APP_EXECUTABLE_FILENAME "@EXENAME@"
!define APP_DESCRIPTION "QTypora"
!define QTYPORA_MARKDOWN_EXTENSION "@EXTENSION@"
Var appExe
Var newDesktopLink
Var newStartMenuLink
!include "@PROJECTROOT@\build\installer.nsh"
Section
  SetOutPath "$INSTDIR\resources\branding"
  File /oname=icon-test.ico "@PROJECTROOT@\build\icon.ico"
  StrCpy $appExe "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  StrCpy $newDesktopLink "$INSTDIR\Desktop.lnk"
  StrCpy $newStartMenuLink "$INSTDIR\StartMenu.lnk"
  CopyFiles /SILENT "$EXEPATH" "$appExe"
  IfFileExists "$INSTDIR\skip-shortcuts" skipLinks
  CreateShortCut "$newDesktopLink" "$appExe"
  CreateShortCut "$newStartMenuLink" "$appExe"
  skipLinks:
  !insertmacro customInstall
  WriteUninstaller "$INSTDIR\uninstall.exe"
SectionEnd
Section "Uninstall"
  !insertmacro customUnInstall
  Delete "$INSTDIR\Desktop.lnk"
  Delete "$INSTDIR\StartMenu.lnk"
  Delete "$INSTDIR\resources\branding\icon-test.ico"
  Delete "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
SectionEnd
'@
foreach ($replacement in @{
    TESTROOT = $testRoot; PROJECTROOT = $projectRoot; PLUGINDIR = $plugin.Directory.FullName
    APPID = $appId; EXENAME = $exeName; EXTENSION = $extension
}.GetEnumerator()) { $source = $source.Replace("@$($replacement.Key)@", $replacement.Value) }
$harness = Join-Path $testRoot 'harness.nsi'
[IO.File]::WriteAllText($harness, $source, [Text.UTF8Encoding]::new($false))
$installA = Join-Path $testRoot 'Install A'
$installB = Join-Path $testRoot 'Install B'
$shell = New-Object -ComObject WScript.Shell
$checks = [Collections.Generic.List[string]]::new()

function Assert-Registration([string]$InstallPath) {
    $expectedIcon = '"' + (Join-Path $InstallPath 'resources\branding\icon-test.ico') + '",0'
    $expectedCommand = '"' + (Join-Path $InstallPath $exeName) + '" "%1"'
    Assert-Equal (Read-Value $applicationKey 'FriendlyAppName') 'QTypora' 'Open With name'
    foreach ($key in @($applicationKey, $typeKey)) {
        Assert-Equal (Read-Value "$key\DefaultIcon") $expectedIcon 'Icon registration'
        Assert-Equal (Read-Value "$key\shell\open\command") $expectedCommand 'Quoted open command'
    }
    Assert-Equal (Read-Value "$applicationKey\SupportedTypes" $extension) '' 'Supported file type'
    Assert-Equal (Read-Value "$extensionKey\OpenWithProgids" "$appId.Markdown") '' 'Open With candidate'
}

try {
    & $compiler.FullName /V2 $harness
    if ($LASTEXITCODE -ne 0) { throw 'NSIS icon test failed to compile.' }
    Write-Value $extensionKey '' $otherType
    Write-Value "$extensionKey\OpenWithProgids" $otherType ''
    Write-Value "Software\Classes\$otherType" '' 'Existing application sentinel'
    Run-TestProgram (Join-Path $testRoot 'icon-harness.exe') @('/S', "/D=$installA")
    Assert-Registration $installA
    Assert-Equal (Read-Value $extensionKey) $otherType 'Existing default preserved'
    foreach ($name in @('Desktop', 'StartMenu')) {
        $shortcut = $shell.CreateShortcut((Join-Path $installA "$name.lnk"))
        Assert-Equal $shortcut.TargetPath (Join-Path $installA $exeName) 'Shortcut target'
        Assert-Equal $shortcut.IconLocation ((Join-Path $installA 'resources\branding\icon-test.ico') + ',0') 'Shortcut icon'
    }
    $checks.Add('install: both links and application/document registrations use the approved ICO')

    $document = Join-Path $testRoot "document$extension"
    [IO.File]::WriteAllText($document, '# Icon test')
    $reference = [QTyporaShellIconTest]::Pixels((Join-Path $installA 'resources\branding\icon-test.ico'), (Join-Path $testRoot 'reference.png'))
    Write-Value $extensionKey '' "$appId.Markdown"
    [QTyporaShellIconTest]::Refresh()
    [QTyporaShellIconTest]::AssertMatches($reference, [QTyporaShellIconTest]::Pixels($document, (Join-Path $testRoot 'document-icon.png')))
    $checks.Add('Shell: rendered document pixels match the ICO (one-level alpha rounding tolerance)')

    Run-TestProgram (Join-Path $testRoot 'icon-harness.exe') @('/S', "/D=$installA")
    Assert-Registration $installA
    Assert-Equal (Read-Value $extensionKey) "$appId.Markdown" 'Default preserved during reinstall'
    $checks.Add('reinstall: registration remains valid and the chosen default is preserved')

    New-Item -ItemType Directory -Path $installB | Out-Null
    New-Item -ItemType File -Path (Join-Path $installB 'skip-shortcuts') | Out-Null
    Run-TestProgram (Join-Path $testRoot 'icon-harness.exe') @('/S', "/D=$installB")
    Assert-Registration $installB
    foreach ($name in @('Desktop', 'StartMenu')) {
        if (Test-Path -LiteralPath (Join-Path $installB "$name.lnk")) { throw 'Installer recreated an unselected shortcut.' }
    }
    Run-TestProgram (Join-Path $installA 'uninstall.exe') @('/S', "_?=$installA")
    Assert-Registration $installB
    $checks.Add('old uninstall: newer installation registration and disabled shortcuts are preserved')

    Run-TestProgram (Join-Path $installB 'uninstall.exe') @('/S', "_?=$installB")
    Assert-Equal (Read-Value "$applicationKey\DefaultIcon") $null 'Application cleanup'
    Assert-Equal (Read-Value "$typeKey\DefaultIcon") $null 'Document type cleanup'
    Assert-Equal (Read-Value "$extensionKey\OpenWithProgids" "$appId.Markdown") $null 'Own candidate cleanup'
    Assert-Equal (Read-Value "$extensionKey\OpenWithProgids" $otherType) '' 'Other application retained'
    Assert-Equal (Read-Value $extensionKey) "$appId.Markdown" 'Uninstall does not change default'
    $checks.Add('uninstall: only owned registration removed; existing defaults and other applications retained')
    @{ status = 'passed'; scope = 'isolated NSIS macros and native Windows Shell'; checks = @($checks); artifacts = $testRoot } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $outputRoot 'installer-icons.json') -Encoding UTF8
    Write-Host "Passed $($checks.Count) Windows installer icon/association checks."
} finally {
    # All keys include this run's fresh GUID and use a private extension.
    foreach ($key in $privateKeys) { [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($key, $false) }
    [QTyporaShellIconTest]::Refresh()
}
