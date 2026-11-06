@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0integrations\setup-feishu.ps1" %*
set "RC=%ERRORLEVEL%"
exit /b %RC%
