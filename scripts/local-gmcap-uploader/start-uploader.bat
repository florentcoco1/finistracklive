@echo off
REM ============================================================
REM  FinisTrackLive — Lancement de l'uploader GMCAP
REM  Ce fichier est appelé par le Planificateur de tâches Windows
REM ============================================================

cd /d "%~dp0"

REM Crée le dossier logs si besoin
if not exist "logs" mkdir "logs"

REM Nom du log daté (YYYY-MM-DD)
for /f "tokens=1-3 delims=/-. " %%a in ("%date%") do set TODAY=%%c-%%b-%%a
set LOGFILE=logs\uploader-%TODAY%.log

REM Lance Python en arrière-plan, sortie redirigée vers le log
python uploader.py >> "%LOGFILE%" 2>&1
