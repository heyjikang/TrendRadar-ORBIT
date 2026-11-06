# TrendRadar -> 飞书群机器人 一键接入
# 用法（交互式，双击 setup-feishu.cmd 即可）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File integrations\setup-feishu.ps1
# 用法（助手代跑，webhook 作为参数传入）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File integrations\setup-feishu.ps1 -Webhook "https://open.feishu.cn/open-apis/bot/v2/hook/xxx"
param(
    [string]$Webhook,
    [string]$ProjectRoot,
    [switch]$NoTest,
    [switch]$NoPause
)

$ErrorActionPreference = 'Continue'
if (-not $ProjectRoot) { $ProjectRoot = Split-Path $PSScriptRoot -Parent }
$Py = Join-Path $ProjectRoot '.venv\Scripts\python.exe'

function Step($n, $msg) { Write-Host "[$n] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    ! $msg" -ForegroundColor Yellow }
function MaskUrl($u) {
    if (-not $u) { return '' }
    if ($u.Length -le 30) { return $u }
    return $u.Substring(0, 26) + '...' + $u.Substring($u.Length - 6)
}

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  TrendRadar -> 飞书推送 一键接入" -ForegroundColor Cyan
Write-Host "  项目目录: $ProjectRoot" -ForegroundColor DarkGray
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $Py)) {
    Write-Host "未找到 .venv，请先执行一次 install.cmd 建好环境。" -ForegroundColor Red
    if (-not $NoPause) { Read-Host "按回车键退出" | Out-Null }
    exit 1
}

# ---------- 1. 获取并校验 Webhook ----------
if (-not $Webhook) {
    Write-Host "获取地址：飞书群 -> 右上角「···」-> 设置 -> 群机器人 -> 添加机器人" -ForegroundColor White
    Write-Host "          -> 自定义机器人 -> 复制 Webhook 地址（https://open.feishu.cn/...）" -ForegroundColor White
    Write-Host "          安全设置请不要勾「签名校验」，否则本项目发不出去；可留空或选「自定义关键词」填 热点" -ForegroundColor DarkGray
    Write-Host ""
    $Webhook = Read-Host "把 Webhook 地址粘贴到下面，回车确认"
}

$Webhook = ($Webhook -replace '^\s*["'']', '' -replace '["'']\s*$', '').Trim()
if (-not $Webhook) {
    Write-Host "没有输入 Webhook，已取消。" -ForegroundColor Red
    if (-not $NoPause) { Read-Host "按回车键退出" | Out-Null }
    exit 1
}
if ($Webhook -notmatch '^https://(open\.feishu\.cn|www\.feishu\.cn|open\.larksuite\.com)/.+') {
    Write-Host "这不像飞书机器人地址：$Webhook" -ForegroundColor Red
    Write-Host "正确格式示例：https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx" -ForegroundColor DarkGray
    if (-not $NoPause) { Read-Host "按回车键退出" | Out-Null }
    exit 1
}
Step "1/3" "Webhook 格式 OK ($(MaskUrl $Webhook))"

# ---------- 2. 写入三处配置 ----------
# 刻意不写 config/config.yaml：仓库是公开的，写进去等于公开。
# 1) run-trendradar.local.ps1 —— 命令行跑 python -m trendradar 时生效（该文件已被 .gitignore 忽略）
# 2) ~/.workbuddy/mcp.json + ~/.codebuddy/mcp.json 的 env —— WorkBuddy 拉起 MCP 时注入
# 3) 用户级环境变量 —— 定时任务/其它启动方式也能读到
$LocalPs1 = Join-Path $ProjectRoot 'run-trendradar.local.ps1'
try {
    $lines = @()
    if (Test-Path $LocalPs1) { $lines = @(Get-Content $LocalPs1 -Encoding UTF8) }
    $pattern = '^\s*\$env:FEISHU_WEBHOOK_URL\s*='
    $kept = @($lines | Where-Object { $_ -notmatch $pattern })
    if (-not ($lines | Where-Object { $_ -match $pattern })) {
        if ($kept.Count -eq 0) {
            $kept += '# 本文件已被 .gitignore 忽略，可安全填写本地密钥（run-trendradar.ps1 会自动加载）'
            $kept += ''
        }
    }
    $kept += ('$env:FEISHU_WEBHOOK_URL = "' + $Webhook + '"')
    [System.IO.File]::WriteAllText($LocalPs1, (($kept -join "`r`n") + "`r`n"), (New-Object System.Text.UTF8Encoding($true)))
    Write-Host "    已写入: $LocalPs1" -ForegroundColor DarkGray
} catch {
    Warn "写入 $LocalPs1 失败：$_"
}

$McpTargets = @(
    (Join-Path $env:USERPROFILE '.workbuddy\mcp.json'),
    (Join-Path $env:USERPROFILE '.codebuddy\mcp.json')
)
$mcpTouched = 0
foreach ($t in $McpTargets) {
    if (-not (Test-Path $t)) {
        Warn "未找到 $t（还没装过？先跑 install.cmd）"
        continue
    }
    try {
        $cfg = Get-Content $t -Raw -Encoding UTF8 | ConvertFrom-Json
        if (-not $cfg.mcpServers -or -not ($cfg.mcpServers.PSObject.Properties.Name -contains 'trendradar')) {
            Warn " $t 里没有 trendradar 条目，跳过"
            continue
        }
        $entry = $cfg.mcpServers.trendradar
        if (-not ($entry.PSObject.Properties.Name -contains 'env') -or -not $entry.env) {
            $entry | Add-Member -NotePropertyName env -NotePropertyValue ([pscustomobject]@{}) -Force
        }
        $entry.env | Add-Member -NotePropertyName FEISHU_WEBHOOK_URL -NotePropertyValue $Webhook -Force
        $json = $cfg | ConvertTo-Json -Depth 10
        [System.IO.File]::WriteAllText($t, $json, (New-Object System.Text.UTF8Encoding($false)))
        Write-Host "    已写入: $t" -ForegroundColor DarkGray
        $mcpTouched++
    } catch {
        Warn "写入 $t 失败：$_"
    }
}

try {
    [Environment]::SetEnvironmentVariable('FEISHU_WEBHOOK_URL', $Webhook, 'User')
    Write-Host "    已写入: 用户环境变量 FEISHU_WEBHOOK_URL" -ForegroundColor DarkGray
} catch {
    Warn "写入用户环境变量失败：$_"
}
Step "2/3" "配置已写入（config/config.yaml 保持为空，不会进 git）"

# ---------- 3. 实发一条测试消息 ----------
if ($NoTest) {
    Step "3/3" "已跳过测试（-NoTest）"
} else {
    Write-Host ""
    Write-Host "正在向飞书发送一条测试消息..." -ForegroundColor Cyan
    $env:FEISHU_WEBHOOK_URL = $Webhook
    Push-Location $ProjectRoot
    $out = & $Py -m trendradar --test-notification 2>&1
    $code = $LASTEXITCODE
    Pop-Location
    ($out | Out-String).Trim() -split "`r?`n" | ForEach-Object {
        if ($_.Trim()) { Write-Host "    $_" -ForegroundColor DarkGray }
    }
    $text = ($out | Out-String)
    if ($text -match '测试成功' -and $text -notmatch '0/\d+ 个渠道成功') {
        Step "3/3" "飞书推送连通，去群里看那条测试消息"
    } else {
        Write-Host ""
        Write-Host "测试未通过（exit $code）。常见原因：" -ForegroundColor Red
        Write-Host "  - 机器人安全设置勾了「签名校验」：本项目不支持签名，请改成「自定义关键词」并填 热点" -ForegroundColor Yellow
        Write-Host "  - 关键词不匹配：测试消息里一定有「热点」两字，关键词填它最稳" -ForegroundColor Yellow
        Write-Host "  - 机器人已被移除或地址复制不全：回群里重新复制一次" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "完成。如果刚才是第一次配置，请重启一次 WorkBuddy 让 MCP 服务读到新环境变量。" -ForegroundColor Green
Write-Host "之后对 WorkBuddy 说「跑一下今天的热榜，整理成报告发到飞书」。  清除配置：删掉 run-trendradar.local.ps1 里那行即可。" -ForegroundColor White
Write-Host ""

if (-not $NoPause) {
    $interactive = $true
    try { $interactive = -not [Console]::IsInputRedirected } catch { $interactive = $true }
    if ($interactive) { Read-Host "按回车键退出" | Out-Null }
}
