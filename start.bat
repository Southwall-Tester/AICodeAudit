@echo off
cd /d "%~dp0"
python -m audit.server
if errorlevel 1 pause
