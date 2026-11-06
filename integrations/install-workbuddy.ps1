# TrendRadar -> WorkBuddy 一键安装
# 用法：双击同目录的 install-workbuddy.cmd；或在 PowerShell 中执行本脚本
param(
    [string]$ProjectRoot,
    [string]$WorkBuddyHome,
    [switch]$NoPause
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
# WorkBuddy 客户端读 ~/.workbuddy/mcp.json，codebuddy CLI 读 ~/.codebuddy/mcp.json。
# 两边都写：只写后者时 WorkBuddy 侧看不到 trendradar（工具列表里一个都没有）。
$McpTargets = @(
    (Join-Path $env:USERPROFILE '.workbuddy\mcp.json'),
    (Join-Path $env:USERPROFILE '.codebuddy\mcp.json')
)
$McpJson = $McpTargets[0]

function Write-McpConfig {
    param([string]$McpJson)
    $dir = Split-Path $McpJson -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

    $cfg = $null
    if (Test-Path $McpJson) {
        try { $cfg = Get-Content $McpJson -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $cfg = $null }
    }
    if (-not $cfg) { $cfg = [pscustomobject]@{} }
    if (-not ($cfg.PSObject.Properties.Name -contains 'mcpServers') -or -not $cfg.mcpServers) {
        $cfg | Add-Member -NotePropertyName mcpServers -NotePropertyValue ([pscustomobject]@{}) -Force
    }
    if (-not ($cfg.PSObject.Properties.Name -contains 'disabledMcpServers')) {
        $cfg | Add-Member -NotePropertyName disabledMcpServers -NotePropertyValue @() -Force
    }

    # 保留 setup-feishu.ps1 等写入的额外环境变量（如 FEISHU_WEBHOOK_URL），重装时不要清掉
    $envPairs = [ordered]@{ TZ = 'Asia/Shanghai'; PYTHONIOENCODING = 'utf-8' }
    $prev = $cfg.mcpServers.trendradar
    if ($prev -and ($prev.PSObject.Properties.Name -contains 'env') -and $prev.env) {
        foreach ($p in $prev.env.PSObject.Properties) {
            if (-not $envPairs.Contains($p.Name)) { $envPairs[$p.Name] = $p.Value }
        }
    }

    $entry = [pscustomobject][ordered]@{
        type    = 'stdio'
        command = $Py
        args    = @('-m', 'mcp_server.server', '--transport', 'stdio', '--project-root', $ProjectRoot)
        env     = [pscustomobject]$envPairs
    }

    # 已有条目时只覆盖已知字段，保留客户端自己写入的其它字段（如 print）
    if ($cfg.mcpServers.PSObject.Properties.Name -contains 'trendradar') {
        $existing = $cfg.mcpServers.trendradar
        foreach ($p in $entry.PSObject.Properties) {
            $existing | Add-Member -NotePropertyName $p.Name -NotePropertyValue $p.Value -Force
        }
    } else {
        $cfg.mcpServers | Add-Member -NotePropertyName trendradar -NotePropertyValue $entry -Force
    }

    $json = $cfg | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($McpJson, $json, (New-Object System.Text.UTF8Encoding($false)))
}

# 先探测 CLI 是否可用（WorkBuddy 正在运行时 CLI 会因本地端口占用而失败）
$probeOut = & $Node $Cli mcp list 2>&1
$probeCode = $LASTEXITCODE
$cliOk = ($probeCode -eq 0)

if ($cliOk) {
    & $Node $Cli mcp remove trendradar --scope user 2>&1 | Out-Null
    $addOut = & $Node $Cli mcp add trendradar --scope user -t stdio `
        -e TZ=Asia/Shanghai -e PYTHONIOENCODING=utf-8 `
        -- $Py -m mcp_server.server --transport stdio --project-root $ProjectRoot 2>&1
    $addCode = $LASTEXITCODE
    if ($addCode -ne 0) {
        $cliOk = $false
        Warn "MCP CLI 注册失败 (exit $addCode)"
        ($addOut | Out-String).Trim() -split "`r?`n" | ForEach-Object {
            if ($_.Trim()) { Write-Host "      $($_.Trim())" -ForegroundColor DarkGray }
        }
    }
} else {
    Warn "WorkBuddy CLI 当前不可用 (exit $probeCode)，通常是 WorkBuddy 正在运行占用了本地端口。改用直接写入配置文件。"
    ($probeOut | Out-String).Trim() -split "`r?`n" | ForEach-Object {
        if ($_.Trim()) { Write-Host "      $($_.Trim())" -ForegroundColor DarkGray }
    }
}

# 无论 CLI 是否成功都直写两份配置：
# CLI 只会写 ~/.codebuddy/mcp.json，WorkBuddy 客户端读 ~/.workbuddy/mcp.json。
if (-not $cliOk) {
    Warn "改用直接写入配置文件。"
}
try {
    foreach ($t in $McpTargets) { Write-McpConfig -McpJson $t }
    Write-Host ("    已写入: " + ($McpTargets -join ' ; ')) -ForegroundColor DarkGray
} catch {
    if (-not $cliOk) {
        throw "MCP 注册失败：CLI 不可用，且写入 $McpJson 也失败：$_"
    }
    throw "MCP 配置补写失败：$_"
}
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
if ($cliOk) {
    & $Node $Cli mcp list
} else {
    Write-Host "  (CLI 不可用，跳过 mcp list；已直写配置，重启 WorkBuddy 后生效)" -ForegroundColor DarkGray
}
foreach ($t in $McpTargets) {
    if (-not (Test-Path $t)) {
        Write-Host "  trendradar: 未写入 $t" -ForegroundColor Yellow
        continue
    }
    try {
        $check = Get-Content $t -Raw -Encoding UTF8 | ConvertFrom-Json
        $entry = $check.mcpServers.trendradar
        if ($entry) {
            $cmdOk = Test-Path $entry.command
            $icon = if ($cmdOk) { "OK" } else { "命令不存在" }
            Write-Host "  trendradar: $t -> $($entry.type) $($entry.command)  [$icon]" -ForegroundColor $(if ($cmdOk) { 'Green' } else { 'Red' })
        } else {
            Write-Host "  trendradar: 未在 $t 中找到条目" -ForegroundColor Red
        }
    } catch {
        Write-Host "  $t 解析失败: $_" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "安装完成。重启 WorkBuddy 后，直接对它说:" -ForegroundColor Green
Write-Host '  「跑一下今天的热榜，整理成报告发我」' -ForegroundColor White
Write-Host ""

if (-not $NoPause) {
    $interactive = $true
    try { $interactive = -not [Console]::IsInputRedirected } catch { $interactive = $true }
    if ($interactive) { Read-Host "按回车键退出" | Out-Null }
}
