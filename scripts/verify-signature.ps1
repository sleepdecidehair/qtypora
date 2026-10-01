if (-not ('QTypora.AuthenticodeVerifier' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace QTypora {
    public static class AuthenticodeVerifier {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct FileInfo {
            public uint Size;
            [MarshalAs(UnmanagedType.LPWStr)] public string Path;
            public IntPtr File, Subject;
        }
        [StructLayout(LayoutKind.Sequential)]
        private struct TrustData {
            public uint Size;
            public IntPtr Policy, Sip;
            public uint Ui, Revocation, Choice;
            public IntPtr File;
            public uint State;
            public IntPtr StateData, Url;
            public uint Flags, Context;
            public IntPtr SignatureSettings;
        }
        [DllImport("wintrust.dll", ExactSpelling = true)]
        private static extern int WinVerifyTrust(IntPtr window, ref Guid action, ref TrustData data);
        public static uint Verify(string path) {
            var file = new FileInfo { Size = (uint)Marshal.SizeOf(typeof(FileInfo)), Path = path };
            IntPtr pointer = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(FileInfo)));
            Marshal.StructureToPtr(file, pointer, false);
            var data = new TrustData {
                Size = (uint)Marshal.SizeOf(typeof(TrustData)), Ui = 2, Choice = 1,
                File = pointer, State = 1, Flags = 0x1000 | 0x10
            };
            var action = new Guid("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");
            try { return unchecked((uint)WinVerifyTrust(new IntPtr(-1), ref action, ref data)); }
            finally {
                data.State = 2;
                WinVerifyTrust(new IntPtr(-1), ref action, ref data);
                Marshal.DestroyStructure(pointer, typeof(FileInfo));
                Marshal.FreeHGlobal(pointer);
            }
        }
    }
}
'@
}

function Assert-InternalSignature {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Thumbprint)
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    if (-not $signature.SignerCertificate -or $signature.SignerCertificate.Thumbprint -ne $Thumbprint) {
        throw "Expected internal signer was not found on $Path."
    }
    $result = [QTypora.AuthenticodeVerifier]::Verify([IO.Path]::GetFullPath($Path))
    # CERT_E_UNTRUSTEDROOT is expected for a self-signed test certificate. Reject all other errors.
    if ($result -ne 0 -and $result -ne [Convert]::ToUInt32('800B0109', 16)) {
        throw ('Authenticode verification failed for {0}: 0x{1:X8}' -f $Path, $result)
    }
    [pscustomobject]@{ Path = $Path; Thumbprint = $Thumbprint; WinVerifyTrust = ('0x{0:X8}' -f $result); PubliclyTrusted = ($result -eq 0) }
}
