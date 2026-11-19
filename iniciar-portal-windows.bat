@echo off
chcp 65001 >nul
rem Liga o sistema Acella e o tunel portal.acella.com.br (usado na inicializacao do Windows)
cd /d "%~dp0server"
set ACELLA_TRUST_PROXY=1
set ACELLA_HTTPS=1
start "Acella - sistema (nao feche)" /min node --no-warnings server.js
timeout /t 3 /nobreak >nul
start "Acella - tunel (nao feche)" /min cloudflared tunnel run --url http://127.0.0.1:3000 acella
exit
