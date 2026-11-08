# Acella na nuvem — guia rápido

Vários usuários ao mesmo tempo (administrador, assistente social, psicóloga, clientes) já funcionam: cada um entra com seu login, e o sistema isola os dados por perfil (psicologia e serviço social não veem os prontuários uma da outra). Falta apenas hospedar o servidor em um lugar que fique ligado e tenha HTTPS.

**Regra de ouro:** rode UMA única cópia do servidor (o banco é um arquivo SQLite). Nunca ligue duas máquinas/réplicas.

## Antes de tudo: gere os segredos
    openssl rand -hex 32      # = ACELLA_KEY (guarde em cofre de senhas; sem ela os prontuários não abrem)
Escolha também uma senha provisória forte para `ACELLA_ADMIN_PASSWORD` (a troca é exigida no 1º login).
Este pacote vem SEM banco de dados e SEM chave: começa limpo, só com o administrador e os 7 modelos de pesquisa.

## Opção A — Fly.io (mais simples, região São Paulo)
1. Instale o `flyctl` e entre: `fly auth login`
2. Na pasta do pacote, edite `app = "..."` no `fly.toml` (nome único) e rode:
       fly launch --no-deploy --copy-config
       fly volumes create acella_data --region gru --size 1
       fly secrets set ACELLA_KEY=<sua chave> ACELLA_ADMIN_PASSWORD=<senha provisória>
       fly scale count 1
       fly deploy
3. Acesse `https://<app>.fly.dev/area-restrita.html`, entre como administrador e troque a senha.
4. Domínio próprio (opcional): `fly certs add plataforma.seudominio.com.br` e aponte o DNS como indicado.

## Opção B — VPS com Docker (Hetzner, DigitalOcean, Hostinger VPS…)
1. Aponte o domínio (registro A) para o IP da VPS e libere as portas 22, 80 e 443.
2. Instale Docker, envie esta pasta para o servidor e rode:
       cp .env.example .env   # preencha ACELLA_KEY e ACELLA_ADMIN_PASSWORD
       # troque plataforma.SEUDOMINIO.com.br no Caddyfile
       docker compose up -d --build
   O Caddy emite o certificado HTTPS sozinho.
(Alternativa sem Docker: veja DEPLOY.md, passo a passo com systemd.)

## Depois de ligar
1. Menu **Profissionais e usuários → + Novo usuário**: crie a assistente social e a psicóloga (usuário/e-mail + senha provisória). Cada uma troca a senha no 1º acesso.
2. **Backup (obrigatório):** o banco fica no volume `/data`. Rode `node --no-warnings server/backup.js <pasta>` (diário) e envie a cópia para outro local. A chave `ACELLA_KEY` fica guardada à parte.
3. Antes de dados reais: política de privacidade/termos revisados por jurídico e definição do encarregado (LGPD — são dados de saúde).
