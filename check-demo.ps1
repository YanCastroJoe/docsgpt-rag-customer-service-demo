[CmdletBinding()]
param(
    [string]$DocsGPTPath = $env:DOCSGPT_HOME
)

$ErrorActionPreference = "Stop"

if (-not $DocsGPTPath) {
    foreach ($candidate in @("E:\codex\DocsGPT", "C:\codex\DocsGPT")) {
        if (Test-Path -LiteralPath (Join-Path $candidate "deployment\docker-compose-hub.yaml")) {
            $DocsGPTPath = $candidate
            break
        }
    }
}
if (-not $DocsGPTPath) {
    throw "DocsGPT was not found. Pass -DocsGPTPath."
}

$composeFile = Join-Path $DocsGPTPath "deployment\docker-compose-hub.yaml"
$envFile = Join-Path $DocsGPTPath ".env"
if (-not (Test-Path -LiteralPath $composeFile) -or -not (Test-Path -LiteralPath $envFile)) {
    throw "The DocsGPT directory is missing its Compose file or .env."
}

$frontend = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:5173" -TimeoutSec 10
$backend = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:7091/api/health" -TimeoutSec 10
if ($frontend.StatusCode -ne 200 -or $backend.StatusCode -ge 500) {
    throw "Frontend or backend health validation failed."
}

Push-Location $DocsGPTPath
try {
    $services = @("postgres", "redis", "backend", "worker", "frontend")
    foreach ($service in $services) {
        $containerId = docker compose --env-file $envFile -f $composeFile ps -q $service
        if (-not $containerId) {
            throw "Service was not created: $service"
        }
        $running = docker inspect --format "{{.State.Running}}" $containerId
        if ($running -ne "true") {
            throw "Service is not running: $service"
        }
    }
}
finally {
    Pop-Location
}

Write-Host "[PASS] DocsGPT frontend, backend, worker, PostgreSQL, and Redis are running."
Write-Host "       Open http://127.0.0.1:5173 and follow DEMO.md."
