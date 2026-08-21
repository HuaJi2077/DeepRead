@echo off
rem ============================================================
rem  DeepRead 生产端启动（开发机自用，Web 分发请用 build-web.bat）
rem  单进程离线运行：node server/index.js 托管 dist/ 与 API
rem  地址：http://127.0.0.1:38617
rem ============================================================
cd /d "%~dp0.."

if not exist dist\index.html (
    echo [start-prod] 未发现构建产物 dist\，请先运行 npm run build
    pause
    exit /b 1
)

echo [start-prod] 启动本地服务，浏览器将自动打开 http://127.0.0.1:38617
start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:38617"
node server\index.js

echo.
echo [start-prod] 服务已停止
pause
