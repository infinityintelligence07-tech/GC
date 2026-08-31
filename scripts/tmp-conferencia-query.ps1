# Script temporário de conferência: lê o token do Supabase CLI no Credential
# Manager e executa uma consulta SOMENTE LEITURA via Management API.
param([Parameter(Mandatory = $true)][string]$Query)

$sig = @"
[DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern bool CredRead(string target, int type, int flags, out IntPtr credentialPtr);
[DllImport("advapi32.dll")]
public static extern void CredFree(IntPtr cred);
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct CREDENTIAL {
  public int Flags; public int Type; public string TargetName; public string Comment;
  public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
  public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
  public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
}
"@
Add-Type -MemberDefinition $sig -Namespace Win32 -Name CredMan

[IntPtr]$ptr = [IntPtr]::Zero
if (-not [Win32.CredMan]::CredRead("Supabase CLI:supabase", 1, 0, [ref]$ptr)) {
  throw "Não foi possível ler o token do Supabase CLI no Credential Manager."
}
$cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][Win32.CredMan+CREDENTIAL])
$bytes = New-Object byte[] $cred.CredentialBlobSize
[System.Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $cred.CredentialBlobSize)
[Win32.CredMan]::CredFree($ptr)
$token = [System.Text.Encoding]::UTF8.GetString($bytes).Trim([char]0).Trim()

$body = @{ query = $Query } | ConvertTo-Json -Compress
try {
  $r = Invoke-RestMethod -Method Post `
    -Uri "https://api.supabase.com/v1/projects/cbqkoverzdzmhceztldv/database/query" `
    -Headers @{ Authorization = "Bearer $token" } `
    -ContentType "application/json" -Body $body
  $r | ConvertTo-Json -Depth 8
} finally {
  $token = $null
}
