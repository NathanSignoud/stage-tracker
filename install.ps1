# Stage Tracker : installation, mise à jour et lancement en une commande (Windows) :
#   irm https://raw.githubusercontent.com/NathanSignoud/stage-tracker/main/install.ps1 | iex
# Relancer la même commande met l'app à jour et la redémarre ; data/ et .env.local ne sont jamais touchés.

$ErrorActionPreference = "Stop"
$Repo = "NathanSignoud/stage-tracker"
$Dir = if ($env:STAGE_TRACKER_DIR) { $env:STAGE_TRACKER_DIR } else { Join-Path $HOME "stage-tracker" }
$Port = if ($env:PORT) { $env:PORT } else { "3000" }
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Say($text) { Write-Host "`n> $text" -ForegroundColor Cyan }
function NodeMajor { try { [int]((node -v) -replace '^v(\d+).*', '$1') } catch { 0 } }

# 1. Node.js 22 ou plus
if ((NodeMajor) -lt 22) {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    $answer = Read-Host "Node.js 22+ est nécessaire. L'installer maintenant avec winget ? (O/n)"
    if ($answer -notmatch '^[nN]') {
      winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
      $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
    }
  }
  if ((NodeMajor) -lt 22) {
    Write-Host "Installe Node.js 22 ou plus depuis https://nodejs.org puis relance cette commande." -ForegroundColor Yellow
    return
  }
}

# 2. Code : dernière version du dépôt (les dossiers de code sont remplacés en entier, les données restent).
Say "Téléchargement de Stage Tracker dans $Dir"
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("stage-tracker-" + [guid]::NewGuid())
try {
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  $zip = Join-Path $tmp "app.zip"
  $source = if ($env:STAGE_TRACKER_ZIP) { $env:STAGE_TRACKER_ZIP } else { "https://codeload.github.com/$Repo/zip/refs/heads/main" }
  if (Test-Path $source) { Copy-Item $source $zip } else { Invoke-WebRequest -UseBasicParsing -Uri $source -OutFile $zip }
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  $src = Get-ChildItem $tmp -Directory | Select-Object -First 1
  New-Item -ItemType Directory -Force -Path $Dir | Out-Null
  foreach ($d in "src", "scripts", "tests", "drizzle", "public") {
    if (Test-Path (Join-Path $Dir $d)) { Remove-Item -Recurse -Force (Join-Path $Dir $d) }
  }
  Copy-Item -Path (Join-Path $src.FullName "*") -Destination $Dir -Recurse -Force
} catch {
  if (-not (Test-Path (Join-Path $Dir "package.json"))) { throw }
  Write-Host "Mise à jour impossible ($($_.Exception.Message)) : lancement de la version déjà installée." -ForegroundColor Yellow
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

# 3. Dépendances puis lancement ; le navigateur s'ouvre dès que l'app répond.
Set-Location $Dir
Say "Installation des dépendances (la première fois : 1 à 3 minutes)"
npm.cmd install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "npm install a échoué" }

$url = "http://127.0.0.1:$Port"
Start-Job -ArgumentList $url {
  param($url)
  for ($i = 0; $i -lt 180; $i++) {
    try { Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2 | Out-Null; Start-Process $url; return } catch { Start-Sleep 1 }
  }
} | Out-Null
Say "Stage Tracker démarre sur $url (Ctrl+C pour l'arrêter ; relance cette même commande la prochaine fois)"
$env:PORT = $Port
npm.cmd run dev
