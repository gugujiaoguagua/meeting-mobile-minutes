@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "PORT=3000"
set "HOST=127.0.0.1"
set "URL=http://127.0.0.1:3000/"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Please install Node.js first.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Please check your Node.js installation.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies. First run may take a few minutes...
  where corepack >nul 2>nul
  if not errorlevel 1 (
    call corepack pnpm install --frozen-lockfile --ignore-scripts
  ) else (
    call npm install --registry=https://registry.npmjs.org --no-audit --no-fund --ignore-scripts
  )
  if errorlevel 1 (
    echo Dependency installation failed. Please check network or npm config.
    pause
    exit /b 1
  )
)

netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul
if not errorlevel 1 (
  echo Port %PORT% is already in use. A preview server may already be running.
  echo Open: %URL%
  echo If it does not open, close the node.exe using port %PORT% and retry.
  call :OpenUrl
  pause
  exit /b 0
)

call :OpenWhenReady
echo Meeting loop demo URL: %URL%
echo Closing this window will stop the preview server.
if exist "pnpm-lock.yaml" (
  where corepack >nul 2>nul
  if not errorlevel 1 (
    call corepack pnpm exec next dev -H %HOST% -p %PORT%
  ) else (
    call npm run dev -- -H %HOST% -p %PORT%
  )
) else (
  call npm run dev -- -H %HOST% -p %PORT%
)
if errorlevel 1 (
  echo.
  echo Preview server failed to start. See the error above.
)
pause
exit /b %ERRORLEVEL%

:OpenUrl
rundll32 url.dll,FileProtocolHandler %URL%
exit /b 0

:OpenWhenReady
where curl.exe >nul 2>nul
if not errorlevel 1 (
  start "" cmd /c "for /l %%I in (1,1,120) do @(curl.exe -fsS -I --max-time 5 %URL% >nul 2>nul && (rundll32 url.dll,FileProtocolHandler %URL% & exit /b 0) || timeout /t 1 >nul)"
) else (
  start "" cmd /c "timeout /t 15 >nul & rundll32 url.dll,FileProtocolHandler %URL%"
)
exit /b 0
