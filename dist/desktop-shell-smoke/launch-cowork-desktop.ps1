param(
  [switch]$DryRun
)
$RepoRoot = 'C:\Users\Labry\Documents\CLAUDE_COWORK\PROJET_CLAUDE'
Push-Location $RepoRoot
try {
  if ($DryRun) {
    node desktop\launch-shell.mjs --dry-run
  } else {
    node desktop\launch-shell.mjs
  }
} finally {
  Pop-Location
}