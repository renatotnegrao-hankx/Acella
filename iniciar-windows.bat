@echo off
chcp 65001 >nul
title Acella - Sistema local
cd /d "%~dp0server"
where node >nul 2>nul
if errorlevel 1 (
  echo O Node.js nao foi encontrado. Instale a versao 22 ou mais nova em https://nodejs.org e tente de novo.
  pause
  exit /b 1
)
for /f "tokens=1 delims=." %%v in ('node -v') do set NV=%%v
set NV=%NV:v=%
if %NV% LSS 22 (
  echo Seu Node.js e antigo. Instale a versao 22 ou mais nova em https://nodejs.org
  pause
  exit /b 1
)
echo Iniciando o sistema Acella. NAO feche esta janela enquanto estiver usando o sistema.
echo Endereco: http://localhost:3000
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000/area-restrita.html"
node --no-warnings server.js
pause
