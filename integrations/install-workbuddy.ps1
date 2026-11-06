# TrendRadar -> WorkBuddy 一键安装
# 用法：双击同目录的 install-workbuddy.cmd；或在 PowerShell 中执行本脚本
param(
    [string]$ProjectRoot,
    [string]$WorkBuddyHome
)

$ErrorActionPreference = 'Continue'
if (-not $ProjectRoot) { $ProjectRoot = Split-Path $PSScriptRoot -Parent }

function Step($n, $msg) { Write-Host "[$n] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    ! $msg" -ForegroundColor Yellow }

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  TrendRadar -> WorkBuddy 一键安装" -ForegroundColor Cyan
Write-Host "  项目目录: $ProjectRoot" -ForegroundColor DarkGray
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

# ---------- 1. Python 环境 ----------
$Py = Join-Path $ProjectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path $Py)) {
    Write-Host "未找到 .venv，正在初始化 Python 环境（首次需要几分钟）..." -ForegroundColor Yellow
    Push-Location $ProjectRoot
    if (Get-Command uv -ErrorAction SilentlyContinue) {
        & uv sync
    } else {
        & python -m venv .venv
        & $Py -m pip install -e .
    }
    Pop-Location
}
if (-not (Test-Path $Py)) { throw "Python 环境不可用: $Py" }
Step "1/4" "Python 环境 OK"

# ---------- 2. 定位 WorkBuddy / node / CLI ----------
$CliRel = 'resources\app.asar.unpacked\cli\dist\codebuddy-lite-wb.mjs'
$Cands = @()
if ($WorkBuddyHome) { $Cands += $WorkBuddyHome }
if ($env:WORKBUDDY_HOME) { $Cands += $env:WORKBUDDY_HOME }
$proc = Get-Process -Name WorkBuddy -ErrorAction SilentlyContinue | Where-Object { $_.Path } | Select-Object -First 1
if ($proc) { $Cands += (Split-Path $proc.Path -Parent) }
$Cands += @(
    'D:\software\WorkBuddy',
    (Join-Path $env:LOCALAPPDATA 'Programs\WorkBuddy'),
    (Join-Path $env:LOCALAPPDATA 'Programs\workbuddy'),
    (Join-Path $env:ProgramFiles 'WorkBuddy'),
    'C:\Program Files\WorkBuddy'
)

$WbRoot = $null
foreach ($c in $Cands) {
    if ($c -and (Test-Path (Join-Path $c $CliRel))) { $WbRoot = $c; break }
}
if (-not $WbRoot) {
    throw "没找到 WorkBuddy 安装目录。可用 -WorkBuddyHome 指定，或设置环境变量 WORKBUDDY_HOME。"
}
$Cli = Join-Path $WbRoot $CliRel

$Node = $null
$NodeDir = Join-Path $env:USERPROFILE '.workbuddy\binaries\node\versions'
if (Test-Path $NodeDir) {
    $Node = Get-ChildItem $NodeDir -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending |
        ForEach-Object { Join-Path $_.FullName 'node.exe' } |
        Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $Node) { $Node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source }
if (-not $Node) { throw "没找到 node。请先启动一次 WorkBuddy，或安装 Node.js。" }
Step "2/4" "WorkBuddy: $WbRoot"

# ---------- 3. 注册 MCP 服务 ----------
& $Node $Cli mcp remove trendradar --scope user 2>&1 | Out-Null
& $Node $Cli mcp add trendradar --scope user -t stdio `
    -e TZ=Asia/Shanghai -e PYTHONIOENCODING=utf-8 `
    -- $Py -m mcp_server.server --transport stdio --project-root $ProjectRoot 2>&1 | Out-Null

if ($LASTEXITCODE -ne 0) { throw "MCP 注册失败 (exit $LASTEXITCODE)" }
Step "3/4" "已注册 MCP 服务 trendradar"

# ---------- 4. 安装技能 ----------
$SkillSrc = Join-Path $PSScriptRoot 'workbuddy-skill\trendradar\SKILL.md'
if (Test-Path $SkillSrc) {
    foreach ($d in @(
        (Join-Path $env:USERPROFILE '.workbuddy\skills\trendradar'),
        (Join-Path $env:USERPROFILE '.codebuddy\skills\trendradar')
    )) {
        New-Item -ItemType Directory -Force -Path $d | Out-Null
        Copy-Item $SkillSrc (Join-Path $d 'SKILL.md') -Force
    }
    Step "4/4" "已安装技能 trendradar（一句话即可触发）"
} else {
    Warn "未找到技能源文件，跳过技能安装"
}

# ---------- 验证 ----------
Write-Host ""
Write-Host "健康检查:" -ForegroundColor Cyan
& $Node $Cli mcp list

Write-Host ""
Write-Host "安装完成。重启 WorkBuddy 后，直接对它说:" -ForegroundColor Green
Write-Host '  「跑一下今天的热榜，整理成报告发我」' -ForegroundColor White
Write-Host ""
