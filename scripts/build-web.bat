@echo off
rem ============================================================
rem  DeepRead 一键打包 Web 完整版（自带 Node 运行时）
rem  产物：release\DeepRead-Web-Full-x.x.x.zip（约 70MB）
rem  用户解压后双击包内 start-prod.bat 即可运行，无需安装 Node.js
rem ============================================================
cd /d "%~dp0.."

call node scripts\build-web.mjs
if errorlevel 1 (
    echo.
    echo [build-web] 打包失败，请检查上方日志
    pause
    exit /b 1
)

pause
