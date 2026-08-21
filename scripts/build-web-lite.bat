@echo off
rem ============================================================
rem  DeepRead 一键打包 Web 精简版（不带 Node 运行时）
rem  产物：release\DeepRead-Web-Lite-x.x.x.zip（约 40MB）
rem  用户解压后双击包内 start-prod.bat 运行，需自备 Node.js 22+
rem ============================================================
cd /d "%~dp0.."

call node scripts\build-web.mjs --lite
if errorlevel 1 (
    echo.
    echo [build-web-lite] 打包失败，请检查上方日志
    pause
    exit /b 1
)

pause
