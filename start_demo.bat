@echo off
rem VentureCouncil - one-click start for the demo.
rem Starts the Python engine (API) and the website, skips whichever is already
rem running, waits until the engine answers, then opens the browser.
rem Close the two black windows it opens to stop everything.

cd /d "%~dp0"
echo.
echo  VentureCouncil - starting...
echo.

curl -s -m 3 http://127.0.0.1:8000/api/health >nul 2>&1
if errorlevel 1 (
    echo  [1/3] Starting the engine ^(API^)...
    start "VentureCouncil API - keep open" cmd /k python -m uvicorn api.server:app --port 8000
) else (
    echo  [1/3] Engine already running - OK
)

curl -s -m 3 http://localhost:5174 >nul 2>&1
if errorlevel 1 (
    echo  [2/3] Starting the website...
    start "VentureCouncil Website - keep open" cmd /k npm run dev --prefix frontend
) else (
    echo  [2/3] Website already running - OK
)

echo  [3/3] Waiting for the engine to be ready ^(first start takes ~30 seconds^)...
set /a tries=0
:wait
curl -s -m 3 http://127.0.0.1:8000/api/health >nul 2>&1
if not errorlevel 1 goto ready
set /a tries+=1
if %tries% geq 60 goto failed
timeout /t 2 /nobreak >nul
goto wait

:ready
echo.
echo  Engine is ready:
curl -s http://127.0.0.1:8000/api/health
echo.
echo.
echo  Opening http://localhost:5174 ...
timeout /t 3 /nobreak >nul
start http://localhost:5174
echo.
echo  In the app, the sidebar should say "Engine: groq".
echo  If it says "Offline", the engine is not connected - do not demo it.
echo.
pause
exit /b 0

:failed
echo.
echo  The engine did not start within 2 minutes.
echo  Look at the "VentureCouncil API" window for the error. Common causes:
echo    - no internet  - Supabase project paused  - .env file missing
echo  Backup for the demo: python demo.py --offline
echo.
pause
exit /b 1
