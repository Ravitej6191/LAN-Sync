@echo off
rem Makes LAN Share start automatically when you sign in to Windows (runs hidden).
set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\LAN Share.lnk"
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%LNK%'); $s.TargetPath='wscript.exe'; $s.Arguments='\"%~dp0start-hidden.vbs\"'; $s.WorkingDirectory='%~dp0'; $s.Save()"
echo.
echo Done. LAN Share will now start automatically when you sign in.
echo To undo, run remove-from-startup.bat
pause
