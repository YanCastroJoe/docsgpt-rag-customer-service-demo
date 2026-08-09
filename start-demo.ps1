[CmdletBinding()]
param(
    [string]$DocsGPTPath = $env:DOCSGPT_HOME,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

function Resolve-DocsGPTPath {
    param([string]$RequestedPath)

    $candidates = @()
    if ($RequestedPath) {
        $candidates += $RequestedPath
    }
    $candidates += @(
        (Join-Path (Split-Path -Parent $PSScriptRoot) "DocsGPT"),
        "E:\codex\DocsGPT",
        "C:\codex\DocsGPT"
    )

    foreach ($candidate in $candidates | Select-Object -Unique) {
        if (-not $candidate) {
            continue
        }
        $compose = Join-Path $candidate "deployment\docker-compose-hub.yaml"
        if (Test-Path -LiteralPath $compose) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    throw "DocsGPT was not found. Pass -DocsGPTPath or set DOCSGPT_HOME."
}

function Wait-HttpReady {
    param(
        [string]$Url,
        [int]$TimeoutSeconds = 120
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 4
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                return
            }
        }
        catch {
            Start-Sleep -Seconds 3
        }
    } while ((Get-Date) -lt $deadline)

    throw "Service did not become ready: $Url"
}

$resolvedPath = Resolve-DocsGPTPath -RequestedPath $DocsGPTPath
$composeFile = Join-Path $resolvedPath "deployment\docker-compose-hub.yaml"
$envFile = Join-Path $resolvedPath ".env"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker is not installed. Install and start Docker Desktop first."
}
docker info *> $null
if ($LASTEXITCODE -ne 0) {
    throw "Docker Engine is not running. Start Docker Desktop first."
}
if (-not (Test-Path -LiteralPath $envFile)) {
    throw "DocsGPT .env is missing. Complete the first-time setup in RUNBOOK.md."
}

Push-Location $resolvedPath
try {
    Write-Host "[DocsGPT] Starting PostgreSQL and Redis..."
    docker compose --env-file $envFile -f $composeFile up -d postgres redis
    if ($LASTEXITCODE -ne 0) {
        throw "Database or cache startup failed."
    }

    $postgresId = docker compose --env-file $envFile -f $composeFile ps -q postgres
    $deadline = (Get-Date).AddSeconds(90)
    do {
        $postgresState = docker inspect --format "{{.State.Health.Status}}" $postgresId 2>$null
        if ($postgresState -eq "healthy") {
            break
        }
        Start-Sleep -Seconds 3
    } while ((Get-Date) -lt $deadline)
    if ($postgresState -ne "healthy") {
        throw "PostgreSQL health check failed."
    }

    Write-Host "[DocsGPT] Starting backend, worker, and frontend..."
    docker compose --env-file $envFile -f $composeFile up -d backend worker frontend
    if ($LASTEXITCODE -ne 0) {
        throw "DocsGPT application startup failed."
    }

    Wait-HttpReady -Url "http://127.0.0.1:7091/api/health"
    Wait-HttpReady -Url "http://127.0.0.1:5173"

    Write-Host ""
    docker compose --env-file $envFile -f $composeFile ps
    Write-Host ""
    Write-Host "[PASS] DocsGPT RAG demo is ready: http://127.0.0.1:5173"
    Write-Host "       Select the V3 customer-service Agent described in DEMO.md."

    if (-not $NoBrowser) {
        Start-Process "http://127.0.0.1:5173"
    }
}
finally {
    Pop-Location
}
