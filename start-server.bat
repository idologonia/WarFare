@echo off
chcp 65001 >nul
title WarFare - сервер гри
cd /d "%~dp0"

rem ---- Node.js: системний або портативний (завантажується сам, один раз) ----
set "NODEV=v22.11.0"
set "NODEDIR=%~dp0tools\node-%NODEV%-win-x64"
where node >nul 2>nul
if errorlevel 1 (
  if not exist "%NODEDIR%\node.exe" (
    echo Завантажую Node.js ^(один раз, ~30 МБ^)...
    if not exist tools mkdir tools
    powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest https://nodejs.org/dist/%NODEV%/node-%NODEV%-win-x64.zip -OutFile tools\node.zip; Expand-Archive tools\node.zip -DestinationPath tools -Force; Remove-Item tools\node.zip"
  )
  set "PATH=%NODEDIR%;%PATH%"
)
where node >nul 2>nul
if errorlevel 1 (
  echo [!] Не вдалося підготувати Node.js. Перевірте інтернет і запустіть ще раз.
  pause
  exit /b 1
)

echo == Підготовка гри ^(перший раз — кілька хвилин^) ==
call npm install --no-audit --no-fund
if errorlevel 1 goto fail
call npm run build
if errorlevel 1 goto fail
call npm run build:server
if errorlevel 1 goto fail

echo.
echo == Запуск сервера. Чекайте рядка "СЕРВЕР ОНЛАЙН" ==
node dist-server\index.js 8080 --public
goto end

:fail
echo [!] Помилка під час збірки. Надішліть текст вище розробнику.
pause
:end
