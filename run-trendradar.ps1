# ============================================================
# TrendRadar 原生运行启动器（无 Docker）
# 用途：供欧宝 / AuboWork / Windows 计划任务定时调用
#       执行一次「抓取热榜 + AI 筛选 + AI 日报 + 飞书推送」
#
# 调用示例（PowerShell）：
#   powershell -ExecutionPolicy Bypass -File d:\self\tendradar\run-trendradar.ps1
#
# 说明：
#   - 数据、HTML 报告统一落在 d:\self\tendradar\output\ 下，欧宝直接读该目录即可
#   - 运行结束后不会自动弹出浏览器（OPEN_REPORT_BROWSER=false）
#   - 每次运行日志写入 output\logs\run-<时间戳>.log
# ============================================================

$ErrorActionPreference = "Continue"

# 切到项目根目录（配置/关键词路径均为相对路径）
$root = $PSScriptRoot
if (-not $root) { $root = Split-Path -Parent $MyInvocation.MyCommand.Path }
Set-Location -Path $root

# ---------- 运行时环境变量（由原 docker/.env 迁移而来）----------
$env:TZ = "Asia/Shanghai"

# 敏感配置（Webhook / API Key / 内网地址）放在本地未跟踪文件里，不会提交到仓库。
# 模板见 run-trendradar.local.example.ps1，复制为 run-trendradar.local.ps1 后填写即可。
$localConfig = Join-Path $root "run-trendradar.local.ps1"
if (Test-Path $localConfig) { . $localConfig }

# 无人值守：跑完不自动打开浏览器
$env:OPEN_REPORT_BROWSER = "false"

# ---------- 日志准备 ----------
$logDir = Join-Path $root "output\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir ("run-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))

# ---------- 选择解释器（优先用项目自带 .venv，避免依赖 PATH 里的 uv）----------
$python = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    Write-Host "未找到 .venv，正在执行 uv sync 初始化..." -ForegroundColor Yellow
    uv sync
    $python = Join-Path $root ".venv\Scripts\python.exe"
}
if (-not (Test-Path $python)) {
    "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] 错误：未找到 Python 解释器 $python" |
        Tee-Object -FilePath $logFile -Append
    exit 1
}

$startTime = Get-Date
"[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] === 开始运行 TrendRadar (原生模式) ===" |
    Tee-Object -FilePath $logFile

# ---------- 执行一次完整流程 ----------
& $python -u -m trendradar 2>&1 | Tee-Object -FilePath $logFile -Append
$code = $LASTEXITCODE

$elapsed = [int]((Get-Date) - $startTime).TotalSeconds
"[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] === 结束，退出码=$code，耗时=${elapsed}s ===" |
    Tee-Object -FilePath $logFile -Append

exit $code
