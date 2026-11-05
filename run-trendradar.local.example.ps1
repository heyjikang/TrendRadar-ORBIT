# 本地敏感配置模板
# 使用方法：复制为 run-trendradar.local.ps1（该文件已被 .gitignore 排除，不会上传仓库），按需填写。

$env:FEISHU_WEBHOOK_URL = ""
$env:AI_MODEL           = ""
$env:AI_API_BASE        = ""
$env:AI_API_KEY         = ""
$env:AI_TIMEOUT         = "900"
# 推理模型关闭思考（避免思考耗尽 max_tokens 导致正文为空）
$env:AI_ENABLE_THINKING = "false"
