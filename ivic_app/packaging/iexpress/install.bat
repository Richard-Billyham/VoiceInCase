@echo off
setlocal

set "APP_NAME=InVoice InCase"
set "APP_EXE=ivic-app.exe"
set "INSTALL_DIR=%LOCALAPPDATA%\Programs\InVoice InCase"
set "SHORTCUT=%APPDATA%\Microsoft\Windows\Start Menu\Programs\InVoice InCase.lnk"
set "UNINSTALL_KEY=HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\InVoiceInCase"

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
copy /Y "%~dp0%APP_EXE%" "%INSTALL_DIR%\%APP_EXE%" >nul
copy /Y "%~dp0uninstall.bat" "%INSTALL_DIR%\uninstall.bat" >nul

powershell -NoProfile -ExecutionPolicy Bypass -Command "$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($env:APPDATA + '\Microsoft\Windows\Start Menu\Programs\InVoice InCase.lnk'); $shortcut.TargetPath = $env:LOCALAPPDATA + '\Programs\InVoice InCase\ivic-app.exe'; $shortcut.WorkingDirectory = $env:LOCALAPPDATA + '\Programs\InVoice InCase'; $shortcut.IconLocation = $shortcut.TargetPath; $shortcut.Save()"

reg add "%UNINSTALL_KEY%" /v DisplayName /d "%APP_NAME%" /f >nul
reg add "%UNINSTALL_KEY%" /v DisplayVersion /d "2.1.0" /f >nul
reg add "%UNINSTALL_KEY%" /v Publisher /d "InVoice InCase Project" /f >nul
reg add "%UNINSTALL_KEY%" /v InstallLocation /d "%INSTALL_DIR%" /f >nul
reg add "%UNINSTALL_KEY%" /v DisplayIcon /d "%INSTALL_DIR%\%APP_EXE%" /f >nul
reg add "%UNINSTALL_KEY%" /v UninstallString /d "\"%INSTALL_DIR%\uninstall.bat\"" /f >nul

start "" "%INSTALL_DIR%\%APP_EXE%"
endlocal
