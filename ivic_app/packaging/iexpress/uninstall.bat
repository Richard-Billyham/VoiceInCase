@echo off
setlocal

set "INSTALL_DIR=%LOCALAPPDATA%\Programs\InVoice InCase"
set "SHORTCUT=%APPDATA%\Microsoft\Windows\Start Menu\Programs\InVoice InCase.lnk"
set "UNINSTALL_KEY=HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\InVoiceInCase"

if exist "%SHORTCUT%" del /F /Q "%SHORTCUT%"
reg delete "%UNINSTALL_KEY%" /f >nul 2>nul

cd /D "%TEMP%"
start "" /B cmd /C "timeout /t 1 >nul & rmdir /S /Q \"%INSTALL_DIR%\""
endlocal
