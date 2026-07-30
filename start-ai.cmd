@echo off
rem Interverse Studio AI bridge — double-click to start (Windows).
rem Needs: Node.js (nodejs.org) + Claude Code (claude.com/claude-code, run `claude` once to sign in).
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is required but was not found.
  echo Install it from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)
node scripts\ai-bridge.mjs
echo.
echo The bridge stopped. Read any message above for the reason.
pause
