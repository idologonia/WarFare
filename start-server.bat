@echo off
chcp 65001 >nul
title WarFare - сервер
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [!] Не знайдено Node.js. Встановіть LTS-версію з https://nodejs.org і запустіть цей файл ще раз.
  pause
  exit /b 1
)

echo == Оновлення залежностей ==
call npm install --no-audit --no-fund
if errorlevel 1 goto fail

echo == Збірка гри й сервера ==
call npm run build
if errorlevel 1 goto fail
call npm run build:server
if errorlevel 1 goto fail

echo == Запуск сервера на порту 8080 ==
start "WarFare сервер" cmd /k node dist-server\index.js 8080

where cloudflared >nul 2>nul
if errorlevel 1 (
  echo.
  echo [!] Не знайдено cloudflared. Встановіть одною командою:
  echo     winget install --id Cloudflare.cloudflared
  echo     і запустіть цей файл ще раз. Поки що гра доступна лише у вашій мережі: http://localhost:8080
  pause
  exit /b 0
)

echo.
echo == Тунель Cloudflare ==
echo Шукайте нижче рядок з адресою https://....trycloudflare.com
echo Цю адресу надішліть другому гравцю. Не закривайте це вікно, поки граєте.
echo.
cloudflared tunnel --url http://localhost:8080
goto end

:fail
echo [!] Помилка під час збірки. Надішліть текст вище розробнику.
pause
:end
