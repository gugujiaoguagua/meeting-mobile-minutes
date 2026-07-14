param(
  [string]$OutputRoot
)

$ErrorActionPreference = "Stop"

function Resolve-FullPath([string]$Path) {
  $item = Resolve-Path -LiteralPath $Path
  return $item.ProviderPath
}

function Invoke-RobocopyChecked {
  param(
    [string]$Source,
    [string]$Destination,
    [string[]]$ExcludeDirs,
    [string[]]$ExcludeFiles
  )

  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  $args = @($Source, $Destination, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP")
  if ($ExcludeDirs.Count -gt 0) {
    $args += "/XD"
    $args += $ExcludeDirs
  }
  if ($ExcludeFiles.Count -gt 0) {
    $args += "/XF"
    $args += $ExcludeFiles
  }

  & robocopy @args | Out-Null
  $code = $LASTEXITCODE
  if ($code -gt 7) {
    throw "robocopy failed from $Source to $Destination with exit code $code"
  }
}

$appSource = Resolve-FullPath (Join-Path $PSScriptRoot "..")
$workspaceRoot = Resolve-FullPath (Join-Path $appSource "..")

if (-not $OutputRoot) {
  $publishDirName = -join ([char[]](0x53D1, 0x5E03, 0x5305))
  $OutputRoot = Join-Path $workspaceRoot $publishDirName
}
New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$packageName = "meeting-loop-test-publish-$timestamp"
$stageRoot = Join-Path $OutputRoot $packageName
$archivePath = Join-Path $OutputRoot "$packageName.tar.gz"

if (Test-Path -LiteralPath $stageRoot) {
  Remove-Item -LiteralPath $stageRoot -Recurse -Force
}
if (Test-Path -LiteralPath $archivePath) {
  Remove-Item -LiteralPath $archivePath -Force
}

New-Item -ItemType Directory -Force -Path $stageRoot | Out-Null

Invoke-RobocopyChecked `
  -Source $appSource `
  -Destination (Join-Path $stageRoot "meeting-loop") `
  -ExcludeDirs @("node_modules", ".next", ".git", ".local-data") `
  -ExcludeFiles @(".env", ".env.local", "*.log", "*-verify.png", "verify-*.png", "preview-*.png", "tsconfig.tsbuildinfo")

tar -czf $archivePath -C $OutputRoot $packageName

Write-Output ("Created package directory: " + $stageRoot)
Write-Output ("Created archive: " + $archivePath)
