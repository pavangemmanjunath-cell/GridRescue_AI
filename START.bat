@echo off
REM GridRescue AI - one-click start (Windows). Backend on http://127.0.0.1:8000, app on http://localhost:5173.
REM Offline demo (no internet APIs): run   set GR_OFFLINE=1   before START.bat
REM Start without opening the browser: set GR_NO_BROWSER=1   (used by the automated start test)
REM Use another port for the app if 5173 is taken: set GR_UI_PORT=5180
setlocal
cd /d "%~dp0"
if not defined GR_UI_PORT set GR_UI_PORT=5173
title GridRescue AI - start

REM Already running? Then just open it.
curl -s -o nul http://127.0.0.1:8000/health && curl -s -o nul http://127.0.0.1:%GR_UI_PORT%/ && (
  echo GridRescue AI is already running.
  goto open
)

echo [0/5] Checking Python and Node.js...
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>&1
if errorlevel 1 (
  echo     Python 3.11 or newer is needed: https://www.python.org/downloads/
  echo     Tick "Add python.exe to PATH" in the installer, then run START.bat again.
  goto fail
)
node -e "const v=process.versions.node.split('.').map(Number); process.exit(v[0]>20||(v[0]===20&&v[1]>=19)?0:1)" >nul 2>&1
if errorlevel 1 (
  echo     Node.js 20.19 or newer is needed ^(22 LTS recommended^): https://nodejs.org/
  goto fail
)

echo [1/5] Backend: Python packages ^(first run takes a minute^)...
if not exist backend\.venv\Scripts\python.exe (
  python -m venv backend\.venv
  if errorlevel 1 ( echo     Could not create backend\.venv & goto fail )
)
backend\.venv\Scripts\python -m pip install -q --disable-pip-version-check -r backend\requirements.txt
if errorlevel 1 ( echo     Could not install the Python packages - check the internet connection. & goto fail )

echo [2/5] Frontend: Node packages ^(first run takes a few minutes^)...
if not exist frontend\node_modules\@mediapipe\tasks-vision (
  pushd frontend
  call npm ci --no-audit --no-fund
  if errorlevel 1 ( popd & echo     Could not install the Node packages - check the internet connection. & goto fail )
  popd
)

echo [3/5] Hands-free page: on-device hand model ^(MediaPipe, runs in the browser^)...
if not exist frontend\public\mediapipe ( pushd frontend & call node scripts\copy-mediapipe.mjs & popd )
if not exist frontend\public\models mkdir frontend\public\models
if not exist frontend\public\models\gesture_recognizer.task (
  curl -sL -o frontend\public\models\gesture_recognizer.task https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task
  if exist frontend\public\models\gesture_recognizer.task ( echo     hand model installed ) else ( echo     could not download the hand model - the Hands page will offer mouse mode )
)

echo [4/5] Starting the backend and the app in two windows...
start "GridRescue API" cmd /k "cd /d "%~dp0backend" && .venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000"
start "GridRescue UI" cmd /k "cd /d "%~dp0frontend" && npm run dev -- --port %GR_UI_PORT% --strictPort"

echo [5/5] Waiting for both servers...
set /a tries=0
:wait
set /a tries+=1
curl -s -o nul http://127.0.0.1:8000/health && curl -s -o nul http://127.0.0.1:%GR_UI_PORT%/ && goto open
if %tries% geq 90 (
  echo     The servers did not answer within 3 minutes - see the "GridRescue API" and "GridRescue UI" windows.
  goto fail
)
ping -n 3 127.0.0.1 >nul
goto wait

:open
if not defined GR_NO_BROWSER start "" http://localhost:%GR_UI_PORT%
echo.
echo GridRescue AI is running.
echo App:        http://localhost:%GR_UI_PORT%
echo API docs:   http://localhost:8000/docs
echo Hands-free: http://localhost:%GR_UI_PORT%/hands  ^(allow the webcam when asked^)
echo Close the "GridRescue API" and "GridRescue UI" windows to stop.
endlocal
exit /b 0

:fail
echo.
echo GridRescue AI did not start. Fix the message above, then run START.bat again.
if not defined GR_NO_BROWSER pause
endlocal
exit /b 1
