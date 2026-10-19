param(
  [string]$ApiKey
)
$ErrorActionPreference = 'Stop'

if (-not $ApiKey) {
  $secure = Read-Host '請輸入 API key（不會回顯）' -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $ApiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
if (-not $ApiKey) { throw 'API key 不可為空白。' }

$path = Join-Path $HOME '.config\claude-joint-decision\credentials.json'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
@{ apiKey = $ApiKey } | ConvertTo-Json | Set-Content -LiteralPath $path -Encoding utf8NoBOM

# 限制為目前 Windows 使用者可讀寫；失敗時仍保留檔案，但會明確提示。
try {
   $grant = '{0}:(R,W)' -f ("$env:USERDOMAIN\$env:USERNAME")
  icacls $path /inheritance:r /grant:r $grant | Out-Null
} catch {
  Write-Warning "無法套用使用者 ACL，請手動確認 $path 的存取權限。"
}
Write-Host "API credential 已儲存至 $path"

