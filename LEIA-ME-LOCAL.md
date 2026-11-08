# Acella – como rodar no seu computador (localhost)

## 1. Instalar uma vez
Instale o **Node.js 22 ou mais novo** (https://nodejs.org). Não há mais nada para instalar.

## 2. Iniciar
- **Windows:** dê dois cliques em `iniciar-windows.bat`.
- **Mac/Linux:** no terminal, `./iniciar.sh`.

O navegador abre em `http://localhost:3000/area-restrita.html`. Se você abrir o `index.html` com dois cliques e o sistema já estiver ligado, a página segue sozinha para `http://localhost:3000`; se aparecer o aviso “aberta direto do arquivo”, o sistema não está ligado: inicie-o como acima e atualize a página. **Mantenha a janela preta aberta** enquanto usar o sistema; para encerrar, feche-a.

> Abra sempre pelo endereço `http://localhost:3000`. Abrir o arquivo `index.html` com dois cliques **não funciona** (o botão "CHAME AQUI!" e a área restrita precisam do servidor).

## 3. Primeiro acesso
- Usuário: `jonaelrenato@gmail.com` · senha provisória: `123456` (o sistema obriga a trocar já no primeiro login).
- Para definir outra senha provisória antes de iniciar: variável `ACELLA_ADMIN_PASSWORD`.

## 4. Criar o acesso das suas colegas
Menu **Profissionais e usuários → + Novo usuário**: escolha o perfil (Psicólogo(a) ou Assistente social), informe nome, **usuário ou e-mail**, registro (CRP/CRESS), valor da hora e uma **senha provisória** (botão "Gerar senha"). Depois passe usuário e senha a ela. Se esqueceu a senha de alguém: botão **Nova senha**.

## 5. Rotina do dia a dia
| Quero… | Onde |
|---|---|
| Cadastrar/importar colaboradores de uma empresa | **Colaboradores** → *Importar do Excel* (escolha a empresa; baixe o modelo se precisar) |
| Importar dependentes | **Colaboradores** → *Importar dependentes* |
| Ver quem pediu ajuda pelo "CHAME AQUI!" | **Chamados** (triagem) → encaminhe a um profissional |
| Atender | O profissional abre **Meus chamados → Iniciar atendimento** (início automático) e finaliza (término automático) |
| Escrever o relato do atendimento | **Prontuários** → abrir o colaborador → no atendimento, **Escrever relato deste atendimento** (demanda, relato, intervenção, encaminhamento, plano). Vale para o titular e para os dependentes. Psicologia e Serviço Social não enxergam os prontuários uma da outra |
| Cobrar um cliente no mês | **Clientes** (mensalidade e valor do km) → **Faturamento de clientes** → *Fechamento mensal de clientes*: escolha o mês e use *Fechar mês* (por cliente) ou *Fechar todos em aberto* |
| Corrigir um mês já fechado | Mesma tela: **Reabrir** (por cliente) ou *Reabrir fechamentos do mês* (todos). Ajuste despesas/atendimentos e feche de novo. Se já foi faturado, informe o motivo |
| Lançar km rodado (reembolso) | Psicólogo(a), assistente social e administrador: **Reembolsos de km → + Lançar reembolso** (valor = km × valor do km do cliente). O administrador **aprova ou rejeita** na mesma aba |
| Pagar profissionais | **Fechamento de profissionais → + Fechar mês**: soma atendimentos aprovados + reembolsos de km aprovados (a tela mostra o que entra e o que ficou de fora). O administrador também aparece, pois lança reembolsos |
| Ver o resultado depois dos impostos | **DRE e resultado**: por período e por cliente, só com meses de clientes já fechados. Ajuste as alíquotas em *Configurar impostos* (valores iniciais são estimativas: confirme com a contabilidade) |

**Caminho do reembolso de km:** profissional lança → administrador aprova → entra no **fechamento do profissional** (pago junto com os honorários) → depois entra no **fechamento do cliente**, para ser repassado a ele. Pedágios e outras despesas continuam sendo lançados pelo administrador em *Faturamento de clientes*.

## 6. Dados e backup (importante)
Tudo fica em `server/data/`: o banco (`acella.db`) **e** a chave de criptografia (`.key`). **Sem a chave os prontuários não abrem.**
- Copie a pasta `server/data/` inteira (com o sistema fechado) para um pendrive ou nuvem privada com frequência; **ou**
- rode `node --no-warnings server/backup.js "D:\\Backups"` para gerar uma cópia consistente do banco com o sistema aberto. Essa cópia **não inclui a chave**: guarde o arquivo `server/data/.key` separadamente, uma única vez, em local seguro.

## 7. Outras pessoas acessarem
Por padrão o sistema só responde **neste computador**. Suas colegas e os colaboradores das empresas **não** conseguem abrir `localhost` do computador deles. Para uso da equipe é preciso hospedar (veja `DEPLOY.md`) ou, só na rede interna do escritório, iniciar com `ACELLA_HOST=0.0.0.0` (sem HTTPS: não recomendado para dados de saúde).

## 8. Base limpa
Esta versão vem com o banco **vazio**, pronto para receber dados reais: apenas o administrador inicial (jonaelrenato@gmail.com, senha inicial 123456, com troca no 1º acesso) e os 7 modelos de pesquisa (NR-1, Clima, CSAT, Saúde e bem-estar, Saúde financeira, Liderança e Pulso). Não há clientes, colaboradores, profissionais, atendimentos, prontuários, despesas, reembolsos nem fechamentos. A chave de criptografia (`server/data/.key`) é criada na primeira partida: guarde-a em local seguro e separado do backup.
- Para recriar os dados fictícios de demonstração (somente em banco vazio e com o sistema fechado): `node --no-warnings server/seed-demo.js` e, em seguida, `node --no-warnings server/seed-prontuarios.js`. Não use em produção.

## 9. Simulação enxuta do plano v9 (esta versão)
Base com dados **100% fictícios**: 20 clientes (jan/2027 a fev/2028, ritmo de 1,5 contrato/mês), 1.200 colaboradores, 230 atendimentos aprovados, 1 assistente social sócia (Joyce Ellen Bezerra Machado Negrão) e 1 psicóloga autônoma. **Nada foi fechado**: sem fechamentos, custos ou reembolsos. Acessos em `SIMULACAO-PLANO.md`. Menu **Plano e evolução** mostra o plano e o já cadastrado. Para voltar à base limpa: feche o sistema, apague `server/data` e use o `acella.db` do pacote limpo.
