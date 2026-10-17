# Starts the ScholarFlow server and Cloudflare Tunnel concurrently
$env:Path = "C:\Program Files\nodejs;" + $env:Path

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " 🚀 Starting ScholarFlow Server + Cloud Public Tunnel" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Start dev server in the background if not already running
$serverProcess = Start-Process -FilePath "npm.cmd" -ArgumentList "run", "dev" -PassThru -NoNewWindow

Start-Sleep -Seconds 3

# 2. Start Cloudflare Tunnel
if (Test-Path "tools\cloudflared.exe") {
    Write-Host "`n🌐 Launching Cloudflare Tunnel for Public HTTPS URL..." -ForegroundColor Green
    & ".\tools\cloudflared.exe" tunnel --url http://localhost:3000
} else {
    Write-Host "`nTools\cloudflared.exe not found. Running dev server on port 3000..." -ForegroundColor Yellow
    $serverProcess.WaitForExit()
}
