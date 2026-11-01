@echo off
rem 필기 요약 실행 화면 (Windows): 이 파일을 더블클릭하세요.
chcp 65001 >nul
cd /d "%~dp0"

if exist ".venv\Scripts\python.exe" goto run

echo 처음 실행이라 필요한 것을 설치합니다. 1~2분 걸려요...
where py >nul 2>nul && py -3 -m venv .venv
if not exist ".venv\Scripts\python.exe" python -m venv .venv
if not exist ".venv\Scripts\python.exe" goto nopython

".venv\Scripts\python.exe" -m pip install --quiet --upgrade pip
".venv\Scripts\python.exe" -m pip install --quiet -e .
if errorlevel 1 goto installfail

:run
".venv\Scripts\python.exe" -m pdfsummary.app
pause
exit /b 0

:nopython
echo.
echo [!] Python을 찾지 못했습니다. https://www.python.org/downloads/ 에서 Python 3.10 이상을 설치하고,
echo     설치 화면의 "Add python.exe to PATH" 를 체크한 뒤 다시 실행해 주세요.
pause
exit /b 1

:installfail
echo.
echo [!] 설치에 실패했습니다. 인터넷 연결을 확인하고, .venv 폴더를 지운 뒤 다시 실행해 주세요.
pause
exit /b 1
