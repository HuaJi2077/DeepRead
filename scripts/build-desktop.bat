@echo off
rem ============================================================
rem  DeepRead 一键打包桌面版（绿色免安装 zip）
rem  产物：release\DeepRead-Desktop-x.x.x.zip + release\win-unpacked\
rem  用户解压后双击 DeepRead.exe 即可运行，无需任何依赖
rem  注意：需联网下载 Electron 运行时（首次），之后有本地缓存
rem ============================================================
cd /d "%~dp0.."

call node scripts\build-desktop.mjs
if errorlevel 1 (
    echo.
    echo [build-desktop] 打包失败，请检查上方日志
    pause
    exit /b 1
)

pause
