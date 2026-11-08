# ACELLA – Backend (fase 1)
Requisitos: Node 22+ (sem dependências). 
    cd server && node --no-warnings server.js      # http://localhost:3000
    node --no-warnings test.js                      # 10 testes ponta a ponta
Produção: defina ACELLA_KEY (64 hex, guarde fora do servidor de banco), ACELLA_HTTPS=1 atrás de HTTPS, ACELLA_ADMIN_PASSWORD, e faça backup de server/data/ (banco + chave) em local separado.
Admin inicial: jonaelrenato@gmail.com – troca de senha obrigatória no 1º acesso.

## Telas (todas ligadas à API)
- /area-restrita.html – login individual; menus por perfil (administrador, psicólogo/assistente social, cliente)
- /pesquisa.html?t=TOKEN – pesquisa anônima, otimizada para celular
- Botão "CHAME AQUI!" em todas as páginas públicas (assets/chame.js)
Abra o site SEMPRE pelo servidor (http://localhost:3000), nunca pelo arquivo. Para uso local: veja ../LEIA-ME-LOCAL.md e os atalhos iniciar-windows.bat / iniciar.sh.
Testes: `node --no-warnings server/test.js` (API) e `python3 server/e2e-browser.py` (navegador, requer playwright).

## Fase 3
- Exportação XLSX/PDF (server/export.js, sem dependências) · comparação de campanhas · acesso excepcional a prontuários · direitos do titular (/titular.html) · retenção · códigos individuais de pesquisa.
- Testes: `node --no-warnings server/test.js` (14), `python3 server/e2e-browser.py`, `python3 server/e2e-export.py`, `python3 server/e2e-lgpd.py`.

## Fase 4 (colaboradores, prontuários ligados a atendimentos, novas pesquisas)
- Colaboradores (nome, CPF validado, cargo/função, empresa) · prontuário por colaborador e por especialidade, com dependentes · chamado → atendimento → prontuário · todo atendimento de profissional exige colaborador (e, portanto, prontuário).
- Pesquisas-modelo: NR-1, Clima, Satisfação (CSAT), Saúde e bem-estar, Saúde financeira, Liderança, Pulso; além de formulários próprios.
- Testes: `node --no-warnings server/test.js` (19) · `python3 server/e2e-fluxo.py` (fluxo completo) · e2e-browser.py · e2e-export.py · e2e-lgpd.py

## Fase 5 (operação diária)
- **Chame aqui**: catálogo de serviços (psicologia e serviço social) em `/api/public/temas`; CPF opcional liga o pedido ao cadastro (não é gravado); localhost não é limitado por IP.
- **Horários automáticos**: início ao *Iniciar atendimento* (carimbo do servidor); término ao finalizar o atendimento ou marcar o chamado *Finalizado*. Lançamento retroativo só por profissional e marcado como manual.
- **Colaboradores**: data de nascimento (cifrada), lista por empresa paginada, **importação .xlsx/.csv** (`server/importar.js`, sem dependências) de colaboradores e dependentes, sempre dentro de uma empresa. Dependentes pertencem ao cadastro do colaborador.
- **Clientes**: mensalidade e valor do km; despesas variáveis; **faturamento mensal** (mensalidade + despesas com descritivo + qtd de atendimentos validados) com Excel/PDF.
- **Usuários**: login por e-mail ou usuário; troca de senha no 1º acesso opcional.
- **Servidor** escuta só em 127.0.0.1 (use `ACELLA_HOST=0.0.0.0` para abrir na rede).
- Testes: `node --no-warnings test.js` (27) · `python3 e2e-browser.py` · `e2e-fluxo.py` · `e2e-export.py` · `e2e-lgpd.py` · `e2e-v5.py`.

## Dados de demonstração
`node --no-warnings server/seed-demo.js` carrega (pela API, em banco vazio) 10 clientes × 100 colaboradores, 2 psicólogas, 4 assistentes sociais, 20 atendimentos com prontuário, reembolsos de km (pendentes de aprovação) e pedágios de 10/2026. Nenhum fechamento é simulado. Gera `DADOS-DEMONSTRACAO.md`. Dados fictícios: não usar em produção.

## Fase 6 (fechamento mensal de clientes e prontuários simulados)
- **Fechamento mensal** (Faturamento de clientes → painel *Fechamento mensal de clientes*): escolha mês e ano e veja, de todos os clientes, mensalidade, despesas, atendimentos e situação (**Em aberto / Fechado / Faturado / Nada a faturar**). Fechar e reabrir **por cliente** ou **em lote** (*Fechar todos em aberto*, *Reabrir fechamentos do mês*).
- **Reabrir**: desfaz o fechamento (despesas voltam a ficar em aberto; o novo fechamento recalcula com os atendimentos aprovados até então). Mês **já faturado** só reabre com confirmação e **motivo**; tudo vai para o histórico do cliente/mês (*Detalhes*) e para a auditoria.
- API: `GET /api/faturamentos/mes`, `POST /api/faturamentos/lote`, `POST /api/faturamentos/:id/reabrir`, `POST /api/faturamentos/reabrir-lote`, `GET /api/faturamentos/historico`.
- `node --no-warnings server/seed-prontuarios.js` (sistema fechado) acrescenta à demonstração 69 atendimentos de set–nov/2026 a colaboradores e dependentes, com prontuários, relatos e reembolsos de km pendentes. Não fecha nenhum mês. Gera/atualiza `DADOS-DEMONSTRACAO.md`.
- Testes: `node --no-warnings test.js` (28) · `python3 e2e-fechamento.py` (novo).

## Fase 7 (aba Prontuários e abertura do site)
- **Prontuários** (psicólogo(a) e assistente social): lista com busca por colaborador, dependente, cargo ou empresa, filtro de situação e totais; no prontuário, cada **atendimento** mostra data, horário, paciente (titular ou dependente), tipo, situação, autor e o **relato detalhado** ligado a ele (formulário Demanda · Relato · Intervenção · Encaminhamento · Plano). Relatos sem atendimento ficam em “Relato avulso”.
- **Sigilo entre especialidades** verificado no servidor em toda a API: Psicologia só lê/escreve prontuários de Psicologia e Serviço Social só os de Serviço Social (um mesmo colaborador pode ter os dois, separados); administração e cliente recebem 403, salvo acesso excepcional autorizado e auditado. Dentro de uma especialidade a equipe compartilha os prontuários, com o autor de cada registro identificado.
- API: `relatos.atend_id` (POST `/api/prontuarios/:id/relatos` com `atend_id`), lista `/api/prontuarios` com dependentes, nº de atendimentos, último atendimento e nº de relatos. Migração única liga relatos antigos ao atendimento pelo cabeçalho.
- **Abrir o site com dois cliques no arquivo** (`file://`): se o sistema estiver ligado, a página segue sozinha para `http://localhost:3000`; se não estiver, mostra a instrução para iniciá-lo.
- Testes: `node --no-warnings test.js` (29) · `python3 e2e-prontuarios.py` (novo; precisa da porta 3000 livre) · `e2e-fechamento.py` e demais.

## Fase 8 (reembolsos de km, fechamento do profissional com reembolsos e DRE)
- **Reembolsos de km** (aba *Reembolsos de km*): lançados por psicólogo, assistente social e administrador (km × valor do km do cliente, gravado no lançamento); o administrador aprova ou rejeita (motivo obrigatório); quem lançou pode corrigir e reenviar; aprovado não se altera (o administrador pode desfazer a aprovação antes do fechamento). Sem lançamento de km como despesa do administrador.
- **Fechamento do profissional**: líquido = honorários + ajuste + reembolsos de km aprovados (do mês ou de meses anteriores ainda não fechados); aceita mês só com reembolso (administrador). Prévia em `GET /api/fechamentos/previa`.
- **Fechamento do cliente**: reembolsos aprovados que já estão em fechamento de profissional entram como itens de km; reabrir o cliente os libera. O custo dos atendimentos do mês é gravado no fechamento (`custo_prof`) para o DRE.
- **DRE** (`GET /api/dre?de=AAAA-MM&ate=AAAA-MM`, `GET /api/export/dre.xlsx`): só meses de clientes fechados; receita bruta → impostos → receita líquida → honorários e reembolsos → resultado antes de IRPJ/CSLL → IRPJ/CSLL → resultado líquido, por período, cliente e mês. Alíquotas em `GET/PUT /api/dre/config` (padrão: Lucro Presumido para serviços; também Simples Nacional). **Estimativa para gestão: confirme com a contabilidade.**
- API: `GET/POST /api/reembolsos`, `PATCH/DELETE /api/reembolsos/:id`, `POST /api/reembolsos/:id/aprovar|rejeitar|desfazer`, `POST /api/reembolsos/aprovar-lote`.
- Barra lateral: menu rolável com rodapé fixo (usuário e *Sair*), sempre visível.
- Testes: `node --no-warnings test.js` (31) · `python3 e2e-reembolso-dre.py` (novo) · `e2e-fechamento.py` e demais.
