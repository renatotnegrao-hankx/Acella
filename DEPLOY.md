# Publicar a plataforma Acella na nuvem

## Onde funciona
| Opção | Serve? | Observação |
|---|---|---|
| **VPS** (Hetzner, DigitalOcean, Vultr, Contabo, Locaweb, Hostinger VPS…) | ✅ recomendado | Você controla tudo: disco, backup, HTTPS. Uma VPS básica (1–2 GB de RAM) basta. |
| **PaaS com disco persistente** (Railway, Fly.io, Render com *Disk*) | ✅ | Use o `Dockerfile`. Monte um volume em `/data`. **Sem volume, os dados somem a cada deploy.** |
| Hospedagem de site comum / cPanel sem Node, GitHub Pages, Netlify, Vercel | ❌ | Só servem arquivos estáticos; não rodam o servidor. |

Rode **uma única cópia** do servidor (o banco é um arquivo SQLite).

## Variáveis de ambiente
| Variável | Para quê |
|---|---|
| `ACELLA_KEY` | Chave de criptografia (64 caracteres hex). Gere com `openssl rand -hex 32`. **Guarde em cofre de senhas; sem ela os prontuários não abrem.** |
| `ACELLA_ADMIN_PASSWORD` | Senha provisória do administrador na 1ª execução. **Defina uma forte antes de ligar o servidor na internet** (o padrão 123456 é só para testes). Ainda assim a troca é exigida no 1º login. |
| `ACELLA_DATA` | Pasta dos dados (banco). Precisa ser disco persistente. |
| `ACELLA_HTTPS=1` | Marca o cookie de sessão como *Secure* (use sempre com HTTPS). |
| `ACELLA_TRUST_PROXY=1` | Use quando houver proxy na frente (Caddy/Nginx/PaaS) para limitar abusos pelo IP real. |
| `PORT` | Porta interna (padrão 3000). |

## Passo a passo em uma VPS (Ubuntu 24.04)
1. **DNS:** aponte um domínio (ex.: `plataforma.suaempresa.com.br`) para o IP da VPS (registro A).
2. **Acesso e firewall:**
   ```
   ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable
   ```
   (a porta 3000 **não** deve ficar aberta para a internet)
3. **Node 22:** instale pelo NodeSource (`https://github.com/nodesource/distributions`) e confira `node -v`.
4. **Código:** envie e extraia o zip em `/opt/acella`; crie o usuário e as pastas:
   ```
   useradd -r -s /usr/sbin/nologin acella
   mkdir -p /var/lib/acella /var/backups/acella
   chown -R acella /var/lib/acella /var/backups/acella
   ```
5. **Segredos** em `/etc/acella.env` (`chmod 600`):
   ```
   ACELLA_KEY=...64 hex...
   ACELLA_ADMIN_PASSWORD=...senha forte...
   ACELLA_DATA=/var/lib/acella
   ACELLA_HTTPS=1
   ACELLA_TRUST_PROXY=1
   PORT=3000
   ```
6. **Serviço** `/etc/systemd/system/acella.service`:
   ```
   [Unit]
   Description=Acella
   After=network.target
   [Service]
   User=acella
   EnvironmentFile=/etc/acella.env
   WorkingDirectory=/opt/acella/server
   ExecStart=/usr/bin/node --no-warnings server.js
   Restart=always
   [Install]
   WantedBy=multi-user.target
   ```
   `systemctl enable --now acella`
7. **HTTPS automático com Caddy** (instale pelo site oficial) em `/etc/caddy/Caddyfile`:
   ```
   plataforma.suaempresa.com.br {
       reverse_proxy localhost:3000
   }
   ```
   `systemctl reload caddy` (o certificado é emitido sozinho).
8. Acesse `https://plataforma.suaempresa.com.br/area-restrita.html`, entre como administrador e **troque a senha**.

## Backup (obrigatório)
- Banco, todo dia às 2h (`crontab -e` do usuário `acella`):
  ```
  0 2 * * * ACELLA_DATA=/var/lib/acella node --no-warnings /opt/acella/server/backup.js /var/backups/acella
  ```
  Mantém as últimas 14 cópias. **Envie as cópias para outro lugar** (outro servidor ou armazenamento de objetos); backup só na mesma máquina não protege contra perda do servidor.
- **Chave `ACELLA_KEY`:** guarde separada das cópias do banco. Banco sem chave = dados ilegíveis; chave junto do banco = proteção anulada.
- **Teste a restauração** pelo menos uma vez: pare o serviço, copie um backup para `/var/lib/acella/acella.db`, apague `acella.db-wal` e `acella.db-shm`, suba o serviço.

## Atualizar a versão
Pare o serviço, faça backup, substitua os arquivos de `/opt/acella` (sem apagar `/var/lib/acella`), inicie o serviço. As tabelas novas são criadas automaticamente.

## PaaS / Docker
`docker build -t acella .` e `docker run -p 3000:3000 -v acella-data:/data -e ACELLA_KEY=... -e ACELLA_ADMIN_PASSWORD=... acella`. Em Railway/Fly/Render: crie um **volume montado em `/data`** e defina as variáveis acima.

## Antes de usar com dados reais
- Contrato/termos e política de privacidade revisados pelo jurídico (inclui dados de saúde e de dependentes).
- Definir quem é o encarregado (DPO) e o canal do titular (`/titular.html` já existe).
- Manter o servidor atualizado (sistema operacional e Node) e acompanhar os logs de auditoria.
