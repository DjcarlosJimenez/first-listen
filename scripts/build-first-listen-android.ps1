[CmdletBinding()]
param(
  [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security -ErrorAction Stop
$projectRoot = Split-Path -Parent $PSScriptRoot
$androidProject = Join-Path $projectRoot "android\twa"
$backupDirectory = Join-Path $env:USERPROFILE "Documents\FirstListen-Android-Signing-Backup"
$keystore = Join-Path $backupDirectory "first-listen-upload-key.jks"
$encryptedPasswordFile = Join-Path $backupDirectory "first-listen-upload-password.dpapi"
$bubblewrapRoot = Join-Path $env:USERPROFILE ".bubblewrap"
$jdkRoot = Join-Path $bubblewrapRoot "jdk17-runtime\jdk-17.0.21+9"
$androidSdk = Join-Path $bubblewrapRoot "android_sdk"
$javaTemp = "C:\jtmp"
$output = if ($OutputDirectory) {
  $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDirectory)
} else {
  Join-Path $projectRoot "artifacts\android"
}

if (-not (Test-Path -LiteralPath $keystore)) {
  throw "No se encontró la clave privada de subida en $keystore"
}
if (-not (Test-Path -LiteralPath $encryptedPasswordFile)) {
  throw "No se encontró la contraseña protegida en $encryptedPasswordFile"
}

$encryptedPasswordHex = (Get-Content -LiteralPath $encryptedPasswordFile -Raw).Trim()
if ($encryptedPasswordHex.Length % 2 -ne 0 -or $encryptedPasswordHex -notmatch '^[0-9A-Fa-f]+$') {
  throw "El archivo de contraseña protegida no tiene un formato DPAPI válido."
}

$encryptedPasswordBytes = New-Object byte[] ($encryptedPasswordHex.Length / 2)
for ($index = 0; $index -lt $encryptedPasswordBytes.Length; $index++) {
  $encryptedPasswordBytes[$index] = [Convert]::ToByte(
    $encryptedPasswordHex.Substring($index * 2, 2),
    16
  )
}

$decryptedPasswordBytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
  $encryptedPasswordBytes,
  $null,
  [System.Security.Cryptography.DataProtectionScope]::CurrentUser
)
$plainPassword = $null
$previousLocation = Get-Location

try {
  $plainPassword = [Text.Encoding]::Unicode.GetString($decryptedPasswordBytes)
  $env:BUBBLEWRAP_KEYSTORE_PASSWORD = $plainPassword
  $env:BUBBLEWRAP_KEY_PASSWORD = $plainPassword
  $env:JAVA_HOME = $jdkRoot
  $env:ANDROID_HOME = $androidSdk
  $env:ANDROID_SDK_ROOT = $androidSdk
  New-Item -ItemType Directory -Force -Path $javaTemp | Out-Null
  $env:TEMP = $javaTemp
  $env:TMP = $javaTemp
  $env:JAVA_TOOL_OPTIONS = "-Djdk.net.unixdomain.tmpdir=C:/jtmp"
  $env:PATH = "$jdkRoot\bin;$androidSdk\platform-tools;$env:PATH"

  Set-Location -LiteralPath $androidProject
  & (Join-Path $androidProject "gradlew.bat") bundleRelease assembleRelease --no-daemon
  if ($LASTEXITCODE -ne 0) {
    throw "Gradle no pudo generar el paquete Android."
  }

  $unsignedBundle = Join-Path $androidProject "app\build\outputs\bundle\release\app-release.aab"
  $unsignedApk = Join-Path $androidProject "app\build\outputs\apk\release\app-release-unsigned.apk"
  if (-not (Test-Path -LiteralPath $unsignedBundle)) {
    throw "La compilación terminó sin producir el Android App Bundle."
  }

  New-Item -ItemType Directory -Force -Path $output | Out-Null
  $bundleDestination = Join-Path $output "First-Listen-v1.aab"
  Copy-Item -LiteralPath $unsignedBundle -Destination $bundleDestination -Force

  $jarSigner = Join-Path $jdkRoot "bin\jarsigner.exe"
  & $jarSigner -sigalg SHA256withRSA -digestalg SHA-256 `
    -keystore $keystore `
    -storepass:env BUBBLEWRAP_KEYSTORE_PASSWORD `
    -keypass:env BUBBLEWRAP_KEY_PASSWORD `
    $bundleDestination firstlisten-upload
  if ($LASTEXITCODE -ne 0) {
    throw "No se pudo firmar el Android App Bundle."
  }

  if (Test-Path -LiteralPath $unsignedApk) {
    $alignedApk = Join-Path $output "First-Listen-v1-aligned.apk"
    $apkDestination = Join-Path $output "First-Listen-v1.apk"
    $zipAlign = Join-Path $androidSdk "build-tools\35.0.0\zipalign.exe"
    $apkSigner = Join-Path $androidSdk "build-tools\35.0.0\apksigner.bat"
    & $zipAlign -f -p 4 $unsignedApk $alignedApk
    if ($LASTEXITCODE -ne 0) {
      throw "No se pudo alinear el APK de prueba."
    }
    & $apkSigner sign `
      --ks $keystore `
      --ks-key-alias firstlisten-upload `
      --ks-pass env:BUBBLEWRAP_KEYSTORE_PASSWORD `
      --key-pass env:BUBBLEWRAP_KEY_PASSWORD `
      --out $apkDestination `
      $alignedApk
    if ($LASTEXITCODE -ne 0) {
      throw "No se pudo firmar el APK de prueba."
    }
    Remove-Item -LiteralPath $alignedApk -Force
  }

  $bundleStream = [IO.File]::OpenRead($bundleDestination)
  try {
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
      $hashBytes = $sha256.ComputeHash($bundleStream)
      $hashText = [BitConverter]::ToString($hashBytes).Replace("-", "")
    }
    finally {
      $sha256.Dispose()
    }
  }
  finally {
    $bundleStream.Dispose()
  }
  "$hashText  First-Listen-v1.aab" |
    Set-Content -LiteralPath (Join-Path $output "First-Listen-v1.sha256.txt") -Encoding ascii

  [pscustomobject]@{
    ApplicationId = "net.firstlisten.app"
    VersionCode = 1
    TargetSdk = 36
    Bundle = $bundleDestination
    Bytes = (Get-Item -LiteralPath $bundleDestination).Length
    Sha256 = $hashText
    SigningAlias = "firstlisten-upload"
  } | Format-List
}
finally {
  Set-Location -LiteralPath $previousLocation
  Remove-Item Env:BUBBLEWRAP_KEYSTORE_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:BUBBLEWRAP_KEY_PASSWORD -ErrorAction SilentlyContinue
  $plainPassword = $null
  [Array]::Clear($decryptedPasswordBytes, 0, $decryptedPasswordBytes.Length)
  [Array]::Clear($encryptedPasswordBytes, 0, $encryptedPasswordBytes.Length)
  $encryptedPasswordHex = $null
}
