@echo off
rem Polywav React shell launcher — runs the REAL app with the React UI.
rem Same data, same engine, same localStorage as the shipping shell.
rem To make this the permanent default: main.js -> change the UI gate default
rem (search POLYWAV_UI) from 'shipping' to 'react'. One line, git-revertable.
setlocal
set POLYWAV_UI=react
cd /d "%~dp0"
start "" "%~dp0node_modules\electron\dist\electron.exe" .
endlocal
