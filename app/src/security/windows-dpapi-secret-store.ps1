param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("store", "retrieve", "delete", "status")]
  [string]$Action,

  [Parameter(Mandatory = $true)]
  [string]$SecretPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security

function Ensure-ParentDirectory {
  param([string]$PathValue)
  $parent = Split-Path -Parent $PathValue
  if (-not [string]::IsNullOrWhiteSpace($parent)) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }
}

function Read-SecretFromStdIn {
  return [Console]::In.ReadToEnd()
}

switch ($Action) {
  "store" {
    $secret = Read-SecretFromStdIn
    if ([string]::IsNullOrEmpty($secret)) {
      throw "No secret value was provided on stdin."
    }

    Ensure-ParentDirectory -PathValue $SecretPath
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($secret)
    $protectedBytes = [System.Security.Cryptography.ProtectedData]::Protect(
      $bytes,
      $null,
      [System.Security.Cryptography.DataProtectionScope]::CurrentUser
    )

    $payload = @{
      backend = "windows_dpapi_current_user"
      protected = [Convert]::ToBase64String($protectedBytes)
      updatedAt = [DateTime]::UtcNow.ToString("o")
    } | ConvertTo-Json -Depth 4 -Compress

    [System.IO.File]::WriteAllText($SecretPath, $payload, [System.Text.Encoding]::UTF8)
    Write-Output '{"status":"stored","backend":"windows_dpapi_current_user"}'
    break
  }
  "retrieve" {
    if (-not (Test-Path -LiteralPath $SecretPath)) {
      throw "Secret not found."
    }

    $payload = Get-Content -LiteralPath $SecretPath -Raw | ConvertFrom-Json
    $protectedBytes = [Convert]::FromBase64String([string]$payload.protected)
    $plainBytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
      $protectedBytes,
      $null,
      [System.Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    [Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($plainBytes))
    break
  }
  "delete" {
    if (Test-Path -LiteralPath $SecretPath) {
      Remove-Item -LiteralPath $SecretPath -Force
    }
    Write-Output '{"status":"deleted"}'
    break
  }
  "status" {
    if (-not (Test-Path -LiteralPath $SecretPath)) {
      Write-Output '{"status":"missing","backend":"windows_dpapi_current_user"}'
      break
    }

    $payload = Get-Content -LiteralPath $SecretPath -Raw | ConvertFrom-Json
    $response = @{
      status = "present"
      backend = [string]$payload.backend
      updatedAt = [string]$payload.updatedAt
    } | ConvertTo-Json -Depth 4 -Compress
    Write-Output $response
    break
  }
}
