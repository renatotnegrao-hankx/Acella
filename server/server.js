'use strict';
// ACELLA – backend (Node >= 22, sem dependências). Execução: node --no-warnings server.js
const http=require('http'),crypto=require('crypto'),fs=require('fs'),path=require('path');
const {DatabaseSync}=require('node:sqlite');
const DATA=process.env.ACELLA_DATA||path.join(__dirname,'data');fs.mkdirSync(DATA,{recursive:true});
const db=new DatabaseSync(path.join(DATA,'acella.db'));db.exec('PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON');
/* chave de criptografia (AES-256-GCM): use ACELLA_KEY (64 hex) em produção */
const kf=path.join(DATA,'.key');let KEY=process.env.ACELLA_KEY?Buffer.from(process.env.ACELLA_KEY,'hex'):null;
if(!KEY){if(!fs.existsSync(kf))fs.writeFileSync(kf,crypto.randomBytes(32).toString('hex'),{mode:0o600});KEY=Buffer.from(fs.readFileSync(kf,'utf8').trim(),'hex')}
const enc=t=>{if(t==null||t==='')return'';const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',KEY,iv),e=Buffer.concat([c.update(String(t),'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),e]).toString('base64')};
const dec=s=>{if(!s)return'';const b=Buffer.from(s,'base64'),d=crypto.createDecipheriv('aes-256-gcm',KEY,b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return Buffer.concat([d.update(b.subarray(28)),d.final()]).toString('utf8')};
const sha=t=>crypto.createHash('sha256').update(t).digest('hex');
const hashPw=p=>{const s=crypto.randomBytes(16);return s.toString('hex')+':'+crypto.scryptSync(p,s,64).toString('hex')};
const chkPw=(p,h)=>{const[s,k]=h.split(':'),x=crypto.scryptSync(p,Buffer.from(s,'hex'),64);return crypto.timingSafeEqual(x,Buffer.from(k,'hex'))};
const now=()=>new Date().toISOString();
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,nome TEXT,cpf_enc TEXT,email TEXT UNIQUE COLLATE NOCASE,tel TEXT,role TEXT NOT NULL,registro TEXT,valor_hora REAL DEFAULT 0,inicio TEXT,pagto_enc TEXT,ativo INTEGER DEFAULT 1,hash TEXT,must_change INTEGER DEFAULT 0,client_id INTEGER,criado TEXT);
CREATE TABLE IF NOT EXISTS sessions(tok TEXT PRIMARY KEY,user_id INTEGER,exp INTEGER);
CREATE TABLE IF NOT EXISTS clients(id INTEGER PRIMARY KEY,cnpj TEXT UNIQUE,razao TEXT,fantasia TEXT,endereco TEXT,responsavel TEXT,contato TEXT,ativo INTEGER DEFAULT 1,criado TEXT);
CREATE TABLE IF NOT EXISTS prontuarios(id INTEGER PRIMARY KEY,client_id INTEGER REFERENCES clients(id),colab_enc TEXT,especialidade TEXT NOT NULL,prof_id INTEGER REFERENCES users(id),aberto_em TEXT,situacao TEXT DEFAULT 'Em acompanhamento');
CREATE TABLE IF NOT EXISTS relatos(id INTEGER PRIMARY KEY,pront_id INTEGER REFERENCES prontuarios(id),prof_id INTEGER,texto_enc TEXT,criado_em TEXT,alterado_em TEXT,versao INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS relato_versoes(id INTEGER PRIMARY KEY,relato_id INTEGER,versao INTEGER,texto_enc TEXT,quando TEXT,quem INTEGER);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,ts TEXT,user_id INTEGER,acao TEXT,alvo TEXT,ip TEXT,ok INTEGER DEFAULT 1);
CREATE TRIGGER IF NOT EXISTS audit_ro1 BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'audit imutável');END;
CREATE TRIGGER IF NOT EXISTS audit_ro2 BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'audit imutável');END;
CREATE TABLE IF NOT EXISTS chamados(id INTEGER PRIMARY KEY,protocolo TEXT UNIQUE,client_id INTEGER,tema TEXT,tipo TEXT,desc_enc TEXT,contato_enc TEXT,status TEXT DEFAULT 'Novo chamado',prof_id INTEGER,criado TEXT,atualizado TEXT);
CREATE TABLE IF NOT EXISTS forms(id INTEGER PRIMARY KEY,nome TEXT,client_id INTEGER,perguntas TEXT,modelo INTEGER DEFAULT 0,criado TEXT);
CREATE TABLE IF NOT EXISTS campaigns(id INTEGER PRIMARY KEY,form_id INTEGER,client_id INTEGER REFERENCES clients(id),nome TEXT,token TEXT UNIQUE,validade TEXT,unica INTEGER DEFAULT 1,convidados INTEGER DEFAULT 0,criado TEXT);
CREATE TABLE IF NOT EXISTS responses(id INTEGER PRIMARY KEY,campaign_id INTEGER,answers TEXT,criado TEXT);
CREATE TABLE IF NOT EXISTS respondents(campaign_id INTEGER,fp TEXT,UNIQUE(campaign_id,fp));
CREATE TABLE IF NOT EXISTS fechamentos(id INTEGER PRIMARY KEY,prof_id INTEGER,ano INTEGER,mes INTEGER,qtd INTEGER,horas REAL,valor_hora REAL,bruto REAL,ajuste REAL DEFAULT 0,liquido REAL,status TEXT DEFAULT 'Aprovado',pago_em TEXT,criado TEXT,UNIQUE(prof_id,ano,mes));
CREATE TABLE IF NOT EXISTS atend(id INTEGER PRIMARY KEY,prof_id INTEGER,client_id INTEGER,data TEXT,inicio TEXT,fim TEXT,minutos INTEGER,tipo TEXT,status TEXT DEFAULT 'Pendente de validação',valor_hora REAL,total REAL,fech_id INTEGER);`);
const NR1=[['Sobrecarga de trabalho','Com que frequência você sente que tem trabalho demais para o tempo disponível?','f'],['Excesso de demandas','Recebo pedidos urgentes que atrapalham minha rotina.','f'],['Pressão por resultados','As metas e cobranças me deixam sob pressão excessiva.','c'],['Condições de trabalho','Tenho condições adequadas (espaço, pausas, equipamentos) para trabalhar.','c'],['Relacionamento interpessoal','Tenho bom relacionamento com meus colegas.','c'],['Conflitos','Com que frequência ocorrem conflitos que me afetam no trabalho?','f'],['Assédio e constrangimento','Já vivi ou presenciei situações de humilhação ou constrangimento no trabalho?','f'],['Apoio da liderança','Minha liderança me apoia quando preciso.','c'],['Reconhecimento','Sinto que meu trabalho é reconhecido.','c'],['Autonomia e participação','Posso opinar e decidir sobre como realizo meu trabalho.','c'],['Equilíbrio vida-trabalho','Consigo conciliar o trabalho com minha vida pessoal.','c'],['Segurança psicológica','Posso falar de erros ou problemas sem medo de represálias.','c'],['Estresse','Com que frequência me sinto estressado(a) por causa do trabalho?','f'],['Bem-estar','De modo geral, me sinto bem no meu ambiente de trabalho.','c'],['Comentário (opcional)','Quer deixar algum comentário? (não coloque seu nome)','t']].map((q,i)=>({id:'q'+(i+1),cat:q[0],texto:q[1],tipo:q[2]==='f'?'frequencia':q[2]==='c'?'concordancia':'texto',invertida:['Apoio da liderança','Reconhecimento','Autonomia e participação','Equilíbrio vida-trabalho','Segurança psicológica','Bem-estar','Condições de trabalho','Relacionamento interpessoal'].includes(q[0])}));
try{db.exec("ALTER TABLE forms ADD COLUMN metrica TEXT DEFAULT 'risco'")}catch(e){}
const TC={c:'concordancia',f:'frequencia',s:'satisfacao',t:'texto'},mkq=l=>l.map((q,i)=>({id:'q'+(i+1),cat:q[0],texto:q[1],tipo:TC[q[2]],invertida:!!q[3]}));
const CM=['Comentário (opcional)','Quer deixar algum comentário? (não coloque seu nome)','t',0];
const TPL=[['Modelo NR-1 – Riscos psicossociais (14 temas)','risco',NR1],
['Clima organizacional','atencao',mkq([['Orgulho de pertencer','Tenho orgulho de trabalhar nesta empresa.','c',1],['Comunicação interna','Sou informado(a) sobre o que acontece na empresa.','c',1],['Confiança na liderança','Confio nas decisões da minha liderança.','c',1],['Colaboração entre áreas','As áreas da empresa colaboram entre si.','c',1],['Crescimento','Vejo oportunidades de crescer aqui.','c',1],['Remuneração e benefícios','Considero justos meu salário e meus benefícios.','c',1],['Condições de trabalho','Tenho as condições e ferramentas para fazer um bom trabalho.','c',1],['Reconhecimento','Meu esforço é reconhecido.','c',1],['Clareza de objetivos','Sei o que se espera do meu trabalho.','c',1],['Treinamento','Recebo treinamento suficiente para minha função.','c',1],['Respeito e diversidade','As pessoas são tratadas com respeito, sem discriminação.','c',1],['Intenção de permanência','Penso em continuar nesta empresa pelos próximos 2 anos.','c',1],['Recomendação (eNPS)','Eu recomendaria esta empresa como um bom lugar para trabalhar.','c',1],CM])],
['Satisfação com o atendimento (CSAT)','atencao',mkq([['Acolhimento','Como você avalia o acolhimento que recebeu?','s',1],['Clareza das orientações','Como você avalia a clareza das orientações recebidas?','s',1],['Respeito e sigilo','Como você avalia o respeito e o sigilo no atendimento?','s',1],['Facilidade de acesso','Como foi a facilidade para conseguir o atendimento?','s',1],['Tempo de espera','Como você avalia o tempo de espera?','s',1],['Resolutividade','O atendimento ajudou a resolver ou encaminhar sua situação?','s',1],['Satisfação geral','De modo geral, qual o seu nível de satisfação com o atendimento?','s',1],['Recomendação','Eu recomendaria este atendimento a um colega.','c',1],['Comentário (opcional)','Quer deixar uma sugestão ou elogio? (não coloque seu nome)','t',0]])],
['Saúde e bem-estar do colaborador','atencao',mkq([['Sono','Com que frequência você dorme bem?','f',1],['Atividade física','Com que frequência você pratica atividade física?','f',1],['Alimentação','Com que frequência você faz refeições equilibradas?','f',1],['Pausas','Com que frequência você consegue fazer pausas durante o trabalho?','f',1],['Dor e desconforto','Com que frequência sente dores ou desconforto por causa do trabalho?','f',0],['Cansaço','Com que frequência termina o dia exausto(a)?','f',0],['Saúde emocional','Com que frequência se sente ansioso(a) ou desanimado(a)?','f',0],['Apoio em saúde','Sei onde buscar apoio em saúde quando preciso.','c',1],['Autoavaliação de saúde','Como você avalia a sua saúde de modo geral?','s',1],CM])],
['Saúde financeira do colaborador','atencao',mkq([['Endividamento','Tenho dívidas que dificultam o meu orçamento.','c',0],['Fechamento do mês','Com que frequência o dinheiro acaba antes do fim do mês?','f',0],['Reserva de emergência','Tenho uma reserva para imprevistos.','c',1],['Planejamento','Planejo meus gastos e acompanho meu orçamento.','c',1],['Crédito caro','Com que frequência uso cheque especial ou cartão rotativo?','f',0],['Impacto no trabalho','Com que frequência preocupações financeiras atrapalham meu trabalho?','f',0],['Conhecimento financeiro','Sinto que sei lidar bem com o meu dinheiro.','c',1],['Necessidade de orientação','Gostaria de receber orientação financeira.','c',0],CM])],
['Avaliação de liderança','atencao',mkq([['Clareza de expectativas','Meu gestor deixa claro o que espera de mim.','c',1],['Feedback','Recebo feedback útil e com regularidade.','c',1],['Escuta','Meu gestor me escuta com atenção.','c',1],['Justiça','Meu gestor trata a equipe de forma justa.','c',1],['Desenvolvimento','Meu gestor apoia o meu desenvolvimento.','c',1],['Respeito','Meu gestor me trata com respeito.','c',1],['Exemplo e ética','Meu gestor dá exemplo de conduta ética.','c',1],['Decisões','Meu gestor toma decisões no tempo certo.','c',1],CM])],
['Pesquisa de pulso (5 perguntas)','atencao',mkq([['Como estou hoje','Como você se sente no trabalho esta semana?','s',1],['Carga da semana','Com que frequência a carga desta semana foi excessiva?','f',0],['Apoio da equipe','Tive apoio da minha equipe esta semana.','c',1],['Prioridades','Tenho clareza das prioridades.','c',1],['Recomendação do time','Eu recomendaria o meu time como um bom lugar para trabalhar.','c',1],CM])]];
for(const[n,m,q]of TPL)if(!db.prepare('SELECT 1 FROM forms WHERE nome=?').get(n))db.prepare('INSERT INTO forms(nome,perguntas,modelo,criado,metrica) VALUES(?,?,1,?,?)').run(n,JSON.stringify(q),now(),m);
if(!db.prepare('SELECT 1 FROM users').get()){db.prepare('INSERT INTO users(nome,email,role,hash,must_change,criado) VALUES(?,?,?,?,0,?)').run('Administrador','jonaelrenato@gmail.com','admin',hashPw(process.env.ACELLA_ADMIN_PASSWORD||'041121'),now())}
db.exec(`CREATE TABLE IF NOT EXISTS excecoes(id INTEGER PRIMARY KEY,pront_id INTEGER REFERENCES prontuarios(id),admin_id INTEGER,justificativa TEXT,status TEXT DEFAULT 'Pendente',decidido_por INTEGER,decidido_em TEXT,expira TEXT,criado TEXT);
CREATE TABLE IF NOT EXISTS titulares(id INTEGER PRIMARY KEY,protocolo TEXT UNIQUE,tipo TEXT,nome_enc TEXT,contato_enc TEXT,detalhe_enc TEXT,status TEXT DEFAULT 'Recebida',resposta TEXT,prazo TEXT,criado TEXT);
CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY,v TEXT);`);
try{db.exec('ALTER TABLE prontuarios ADD COLUMN encerrado_em TEXT')}catch(e){}
try{db.exec('ALTER TABLE campaigns ADD COLUMN por_codigo INTEGER DEFAULT 0')}catch(e){}
db.exec(`CREATE TABLE IF NOT EXISTS colaboradores(id INTEGER PRIMARY KEY,client_id INTEGER REFERENCES clients(id),nome_enc TEXT,cpf_enc TEXT,cpf_hash TEXT,cargo TEXT,ativo INTEGER DEFAULT 1,criado TEXT,criado_por INTEGER,UNIQUE(client_id,cpf_hash));
CREATE TABLE IF NOT EXISTS dependentes(id INTEGER PRIMARY KEY,pront_id INTEGER REFERENCES prontuarios(id),nome_enc TEXT,parentesco TEXT,nasc TEXT,cpf_enc TEXT,ativo INTEGER DEFAULT 1,criado TEXT);
CREATE TABLE IF NOT EXISTS prontuario_versoes(id INTEGER PRIMARY KEY,pront_id INTEGER,obs_enc TEXT,quando TEXT,quem INTEGER);`);
for(const a of['ALTER TABLE prontuarios ADD COLUMN colab_id INTEGER','ALTER TABLE prontuarios ADD COLUMN obs_enc TEXT','ALTER TABLE relatos ADD COLUMN dep_id INTEGER','ALTER TABLE atend ADD COLUMN pront_id INTEGER','ALTER TABLE atend ADD COLUMN dep_id INTEGER','ALTER TABLE atend ADD COLUMN colab_id INTEGER','ALTER TABLE atend ADD COLUMN chamado_id INTEGER','ALTER TABLE chamados ADD COLUMN colab_id INTEGER','ALTER TABLE chamados ADD COLUMN pront_id INTEGER','ALTER TABLE chamados ADD COLUMN atend_id INTEGER','ALTER TABLE chamados ADD COLUMN criado_por INTEGER','ALTER TABLE relatos ADD COLUMN atend_id INTEGER'])try{db.exec(a)}catch(e){}
/* uma única vez: liga relatos antigos ao atendimento pelo cabeçalho "ATENDIMENTO dd/mm/aaaa · hh:mm" (mesmo prontuário, profissional e paciente) */
if(!db.prepare("SELECT 1 FROM settings WHERE k='relato_atend_bf1'").get()){const usados=new Set(db.prepare('SELECT atend_id FROM relatos WHERE atend_id IS NOT NULL').all().map(x=>x.atend_id));
 for(const r of db.prepare('SELECT * FROM relatos WHERE atend_id IS NULL ORDER BY id').all()){let t='';try{t=dec(r.texto_enc)}catch(e){continue}const m=/^ATENDIMENTO (\d\d)\/(\d\d)\/(\d{4}) · (\d\d:\d\d)/.exec(t);if(!m)continue;
  const a=db.prepare('SELECT id FROM atend WHERE pront_id=? AND prof_id=? AND data=? AND inicio=? AND COALESCE(dep_id,0)=COALESCE(?,0)').all(r.pront_id,r.prof_id,m[3]+'-'+m[2]+'-'+m[1],m[4],r.dep_id).find(x=>!usados.has(x.id));if(a){db.prepare('UPDATE relatos SET atend_id=? WHERE id=?').run(a.id,r.id);usados.add(a.id)}}
 db.prepare("INSERT OR REPLACE INTO settings(k,v) VALUES('relato_atend_bf1',?)").run(now())}
db.exec('CREATE TABLE IF NOT EXISTS codigos(campaign_id INTEGER,hash TEXT,usado INTEGER DEFAULT 0,UNIQUE(campaign_id,hash))');
/* ---------- v5: nascimento, dependentes por colaborador, mensalidade/despesas/faturamento, horários automáticos, login por usuário ---------- */
for(const a of['ALTER TABLE colaboradores ADD COLUMN nasc_enc TEXT','ALTER TABLE dependentes ADD COLUMN colab_id INTEGER','ALTER TABLE dependentes ADD COLUMN cpf_hash TEXT','ALTER TABLE dependentes ADD COLUMN nasc_enc TEXT','ALTER TABLE clients ADD COLUMN mensalidade REAL DEFAULT 0','ALTER TABLE clients ADD COLUMN plano TEXT','ALTER TABLE clients ADD COLUMN funcionarios INTEGER DEFAULT 0','ALTER TABLE clients ADD COLUMN preco_func REAL DEFAULT 0','ALTER TABLE clients ADD COLUMN inicio_contrato TEXT','ALTER TABLE clients ADD COLUMN valor_km REAL DEFAULT 0','ALTER TABLE atend ADD COLUMN inicio_ts TEXT','ALTER TABLE atend ADD COLUMN fim_ts TEXT','ALTER TABLE atend ADD COLUMN manual INTEGER DEFAULT 0','ALTER TABLE chamados ADD COLUMN solicitante_enc TEXT','ALTER TABLE chamados ADD COLUMN empresa_txt TEXT','ALTER TABLE users ADD COLUMN usuario TEXT'])try{db.exec(a)}catch(e){}
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_users_usuario ON users(lower(usuario)) WHERE usuario IS NOT NULL AND usuario<>'';
UPDATE dependentes SET colab_id=(SELECT p.colab_id FROM prontuarios p WHERE p.id=dependentes.pront_id) WHERE colab_id IS NULL;
CREATE TABLE IF NOT EXISTS despesas(id INTEGER PRIMARY KEY,client_id INTEGER REFERENCES clients(id),data TEXT,tipo TEXT,descricao TEXT,km REAL,valor_km REAL,valor REAL,criado TEXT,criado_por INTEGER,fat_id INTEGER);
CREATE TABLE IF NOT EXISTS faturamentos(id INTEGER PRIMARY KEY,client_id INTEGER REFERENCES clients(id),ano INTEGER,mes INTEGER,mensalidade REAL,despesas REAL,total REAL,qtd_atend INTEGER,qtd_psico INTEGER,qtd_social INTEGER,horas REAL,itens TEXT,status TEXT DEFAULT 'Fechado',faturado_em TEXT,nf TEXT,obs TEXT,criado TEXT,UNIQUE(client_id,ano,mes));`);
/* ---------- v8: reembolsos de km (lançados pelo profissional, aprovados pelo administrador), custo por cliente e DRE ---------- */
for(const a of['ALTER TABLE fechamentos ADD COLUMN reembolso REAL DEFAULT 0','ALTER TABLE faturamentos ADD COLUMN reembolsos REAL DEFAULT 0','ALTER TABLE faturamentos ADD COLUMN custo_prof REAL DEFAULT 0'])try{db.exec(a)}catch(e){}
db.exec(`CREATE TABLE IF NOT EXISTS reembolsos(id INTEGER PRIMARY KEY,prof_id INTEGER REFERENCES users(id),client_id INTEGER REFERENCES clients(id),data TEXT,km REAL,valor_km REAL,valor REAL,descricao TEXT,status TEXT DEFAULT 'Pendente',motivo TEXT,decidido_por INTEGER,decidido_em TEXT,fech_id INTEGER,fat_id INTEGER,criado TEXT,alterado TEXT);
CREATE INDEX IF NOT EXISTS ix_reemb_prof ON reembolsos(prof_id,status);CREATE INDEX IF NOT EXISTS ix_reemb_cli ON reembolsos(client_id,status);`);
/* fechamentos de clientes feitos antes desta versão: preenche o valor de reembolsos (itens de km) e o custo dos profissionais, para o DRE */
if(!db.prepare("SELECT 1 FROM settings WHERE k='dre_bf1'").get()){
 for(const f of db.prepare('SELECT id,client_id,ano,mes,itens FROM faturamentos').all()){let it=[];try{it=JSON.parse(f.itens||'[]')}catch(e){}
  const rb=Math.round(it.filter(i=>i.tipo==='km').reduce((s,i)=>s+(+i.valor||0),0)*100)/100,
   cp=db.prepare("SELECT COALESCE(SUM(total),0) v FROM atend WHERE client_id=? AND substr(data,1,7)=? AND status IN ('Aprovado','Fechado')").get(f.client_id,f.ano+'-'+String(f.mes).padStart(2,'0')).v;
  db.prepare('UPDATE faturamentos SET reembolsos=?,custo_prof=? WHERE id=?').run(rb,Math.round(cp*100)/100,f.id)}
 db.prepare("INSERT OR REPLACE INTO settings(k,v) VALUES('dre_bf1',?)").run(now())}
for(const d of db.prepare("SELECT id,nasc FROM dependentes WHERE nasc IS NOT NULL AND nasc<>'' AND (nasc_enc IS NULL OR nasc_enc='')").all())db.prepare("UPDATE dependentes SET nasc_enc=?,nasc='' WHERE id=?").run(enc(d.nasc),d.id);
/* ---------- infra ---------- */
const audit=(u,acao,alvo,ip,ok=1)=>db.prepare('INSERT INTO audit(ts,user_id,acao,alvo,ip,ok) VALUES(?,?,?,?,?,?)').run(now(),u?u.id:null,acao,String(alvo??''),ip,ok);
const E=(s,m)=>Object.assign(new Error(m),{status:s});
const routes=[];const R=(m,p,roles,h)=>routes.push({m,re:new RegExp('^'+p.replace(/:(\w+)/g,'(?<$1>[^/]+)')+'$'),roles,h});
const tries=new Map();
const CLIN=['psicologo','assistente_social'];
const need=(c,...f)=>f.forEach(k=>{if(c.body[k]==null||c.body[k]==='')throw E(400,'Campo obrigatório: '+k)});
const pub=u=>({id:u.id,nome:u.nome,email:u.email,usuario:u.usuario,role:u.role,must_change:!!u.must_change,client_id:u.client_id});
const strong=p=>typeof p==='string'&&(/^\d{6}$/.test(p)||(p.length>=10&&/[a-z]/i.test(p)&&/\d/.test(p)));
/* ---------- autenticação ---------- */
R('POST','/api/login',null,c=>{need(c,'email','password');const k=c.ip+'|'+String(c.body.email).toLowerCase(),t=tries.get(k)||{n:0,until:0};
 if(Date.now()<t.until)throw E(429,'Muitas tentativas. Aguarde.');
 const u=db.prepare('SELECT * FROM users WHERE email=? OR lower(usuario)=lower(?)').get(String(c.body.email).trim(),String(c.body.email).trim());
 if(!u||!u.ativo||!chkPw(String(c.body.password),u.hash)){t.n++;if(t.n>=5){t.until=Date.now()+9e5;t.n=0}tries.set(k,t);audit(u,'login_falhou',c.body.email,c.ip,0);throw E(401,'E-mail ou senha incorretos.')}
 tries.delete(k);const tok=crypto.randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha(tok),u.id,Date.now()+8*36e5);audit(u,'login',u.email,c.ip);
 c.cookie=`sid=${tok}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.ACELLA_HTTPS?'; Secure':''}`;return pub(u)});
R('POST','/api/logout','any',c=>{db.prepare('DELETE FROM sessions WHERE tok=?').run(c.tokHash);audit(c.u,'logout','',c.ip);c.cookie='sid=; Max-Age=0; Path=/';return{ok:1}});
R('GET','/api/me','any',c=>pub(c.u));
R('POST','/api/password','any',c=>{need(c,'atual','nova');if(!chkPw(c.body.atual,c.u.hash))throw E(403,'Senha atual incorreta.');if(!strong(c.body.nova))throw E(400,'A nova senha deve ter 10+ caracteres, com letras e números.');
 db.prepare('UPDATE users SET hash=?,must_change=0 WHERE id=?').run(hashPw(c.body.nova),c.u.id);db.prepare('DELETE FROM sessions WHERE user_id=? AND tok<>?').run(c.u.id,c.tokHash);audit(c.u,'senha_alterada','',c.ip);return{ok:1}});
/* ---------- clientes (admin) ---------- */
R('GET','/api/clients',['admin'],()=>db.prepare('SELECT * FROM clients ORDER BY fantasia').all());
const num=(v,max=1e7,dec=2)=>{const n=+String(v??0).replace(',','.');if(!Number.isFinite(n)||n<0||n>max)throw E(400,'Valor numérico inválido.');const f=10**dec;return Math.round(n*f)/f};
const PLANOS_OK=['Essencial','Equilíbrio','Completo'];
R('POST','/api/clients',['admin'],c=>{need(c,'cnpj','razao');const b=c.body;
 try{const r=db.prepare('INSERT INTO clients(cnpj,razao,fantasia,endereco,responsavel,contato,mensalidade,valor_km,plano,funcionarios,preco_func,inicio_contrato,criado) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(b.cnpj,b.razao,b.fantasia||b.razao,b.endereco||'',b.responsavel||'',b.contato||'',num(b.mensalidade),num(b.valor_km,1e4,4),PLANOS_OK.includes(b.plano)?b.plano:null,Math.round(num(b.funcionarios,1e5,0)),num(b.preco_func,1e4,2),/^\d{4}-\d{2}(-\d{2})?$/.test(b.inicio_contrato||'')?String(b.inicio_contrato).slice(0,7):null,now());audit(c.u,'cliente_criado',r.lastInsertRowid,c.ip);return{id:Number(r.lastInsertRowid)}}
 catch(e){if(/UNIQUE/.test(e.message))throw E(409,'Já existe um cliente com este CNPJ.');throw e}});
R('PATCH','/api/clients/:id',['admin'],c=>{const b={...c.body},f=['razao','fantasia','endereco','responsavel','contato','ativo','mensalidade','valor_km','plano','funcionarios','preco_func','inicio_contrato'].filter(k=>k in b);if(!f.length)throw E(400,'Nada a alterar');
 if('plano' in b&&!PLANOS_OK.includes(b.plano))b.plano=null;if('funcionarios' in b)b.funcionarios=Math.round(num(b.funcionarios,1e5,0));if('preco_func' in b)b.preco_func=num(b.preco_func,1e4,2);if('inicio_contrato' in b)b.inicio_contrato=/^\d{4}-\d{2}/.test(b.inicio_contrato||'')?String(b.inicio_contrato).slice(0,7):null;
 if('mensalidade' in b)b.mensalidade=num(b.mensalidade);if('valor_km' in b)b.valor_km=num(b.valor_km,1e4,4);
 db.prepare(`UPDATE clients SET ${f.map(k=>k+'=?').join(',')} WHERE id=?`).run(...f.map(k=>b[k]),c.params.id);audit(c.u,'cliente_editado',c.params.id+':'+f.join(','),c.ip);return{ok:1}});
/* ---------- usuários / profissionais (admin) ---------- */
R('GET','/api/users',['admin'],()=>db.prepare('SELECT id,nome,email,usuario,tel,role,registro,valor_hora,inicio,ativo,client_id FROM users').all());
const EMAIL_RE=/^[^@\s]+@[^@\s]+\.[^@\s]+$/,LOGIN_RE=/^[a-z0-9._-]{3,40}$/i;
const dupMsg='E-mail ou usuário já cadastrado.';
R('POST','/api/users',['admin'],c=>{need(c,'nome','role','senha_inicial');const b=c.body;if(!['admin','psicologo','assistente_social','outro','cliente'].includes(b.role))throw E(400,'Perfil inválido');
 const email=String(b.email||'').trim(),usuario=String(b.usuario||'').trim();if(!email&&!usuario)throw E(400,'Informe o e-mail ou o usuário de acesso.');
 if(email&&!EMAIL_RE.test(email))throw E(400,'E-mail inválido.');if(usuario&&!LOGIN_RE.test(usuario))throw E(400,'Usuário inválido: use 3 a 40 caracteres (letras, números, ponto, hífen ou sublinhado), sem espaços nem @.');
 if(b.role==='cliente')need(c,'client_id');if(CLIN.includes(b.role))need(c,'registro');if(!strong(b.senha_inicial))throw E(400,'Senha inicial fraca (use 6 dígitos numéricos ou 10+ caracteres com letras e números).');
 const troca=b.exigir_troca===true||b.exigir_troca===1||b.exigir_troca==='1'||b.exigir_troca==='true';
 try{const r=db.prepare('INSERT INTO users(nome,cpf_enc,email,usuario,tel,role,registro,valor_hora,inicio,pagto_enc,hash,must_change,client_id,criado) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(String(b.nome).trim(),enc(b.cpf),email||null,usuario||null,b.tel||'',b.role,b.registro||'',+b.valor_hora||0,b.inicio||'',enc(b.pagamento),hashPw(b.senha_inicial),troca?1:0,b.client_id||null,now());audit(c.u,'usuario_criado',r.lastInsertRowid,c.ip);return{id:Number(r.lastInsertRowid)}}
 catch(e){if(/UNIQUE/.test(e.message))throw E(409,dupMsg);throw e}});
R('PATCH','/api/users/:id',['admin'],c=>{const b={...c.body},f=['nome','tel','registro','valor_hora','ativo','email','usuario','client_id'].filter(k=>k in b);if(!f.length)throw E(400,'Nada a alterar');
 const u0=db.prepare('SELECT * FROM users WHERE id=?').get(c.params.id);if(!u0)throw E(404,'Usuário não encontrado.');
 if(+c.params.id===c.u.id&&'ativo' in b&&!+b.ativo)throw E(400,'Você não pode desativar a si mesmo.');
 if('email' in b){b.email=String(b.email||'').trim()||null;if(b.email&&!EMAIL_RE.test(b.email))throw E(400,'E-mail inválido.')}
 if('usuario' in b){b.usuario=String(b.usuario||'').trim()||null;if(b.usuario&&!LOGIN_RE.test(b.usuario))throw E(400,'Usuário inválido: use 3 a 40 caracteres (letras, números, ponto, hífen ou sublinhado).')}
 if(('email' in b||'usuario' in b)&&!(('email' in b?b.email:u0.email)||('usuario' in b?b.usuario:u0.usuario)))throw E(400,'Mantenha ao menos o e-mail ou o usuário de acesso.');
 if('client_id' in b)b.client_id=b.client_id?+b.client_id:null;
 try{db.prepare(`UPDATE users SET ${f.map(k=>k+'=?').join(',')} WHERE id=?`).run(...f.map(k=>b[k]),c.params.id)}catch(e){if(/UNIQUE/.test(e.message))throw E(409,dupMsg);throw e}
 if('ativo' in b&&!+b.ativo)db.prepare('DELETE FROM sessions WHERE user_id=?').run(c.params.id);audit(c.u,'usuario_editado',c.params.id+':'+f.join(','),c.ip);return{ok:1}});
R('POST','/api/users/:id/reset',['admin'],c=>{need(c,'senha_temporaria');if(!strong(c.body.senha_temporaria))throw E(400,'Senha fraca.');db.prepare('UPDATE users SET hash=?,must_change=1 WHERE id=?').run(hashPw(c.body.senha_temporaria),c.params.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(c.params.id);audit(c.u,'acesso_redefinido',c.params.id,c.ip);return{ok:1}});
/* ---------- prontuários: segregação por especialidade, verificada no servidor ---------- */
const clin=c=>{if(!CLIN.includes(c.u.role)){audit(c.u,'prontuario_negado','',c.ip,0);throw E(403,'Sem acesso a conteúdo clínico.')}};
const getP=c=>{clin(c);const p=db.prepare('SELECT * FROM prontuarios WHERE id=?').get(c.params.id);if(!p||p.especialidade!==c.u.role){audit(c.u,'prontuario_negado',c.params.id,c.ip,0);throw E(404,'Prontuário não encontrado.')}return p};
/* ---------- colaboradores, dependentes e prontuários ---------- */
const PEOPLE=['admin','psicologo','assistente_social'];
const IM=require('./importar'),{digits,cpfOk,norm,parseNasc}=IM;
const cpfH=d=>crypto.createHmac('sha256',KEY).update(digits(d)).digest('hex');
const maskCpf=d=>{d=digits(d);return d?'•••.•••.•••-'+d.slice(-2):''};
const today=()=>new Date(Date.now()-new Date().getTimezoneOffset()*6e4).toISOString().slice(0,10),hhmm=()=>new Date().toTimeString().slice(0,5);
const colabOut=k=>({id:k.id,client_id:k.client_id,nome:dec(k.nome_enc),cpf:maskCpf(dec(k.cpf_enc)),nasc:dec(k.nasc_enc),cargo:k.cargo,ativo:k.ativo});
/* Lista (padrão: vetor). Com pag=1 devolve {total,itens} paginado e ordenado por nome. Cada empresa é filtrada por client_id. */
R('GET','/api/colaboradores',PEOPLE,c=>{const q=norm(c.q.get('q')||'').trim(),qd=digits(q),cid=+c.q.get('client_id')||0,only=+c.q.get('id')||0,pag=c.q.get('pag')==='1',lim=Math.min(Math.max(+c.q.get('limit')||100,1),500),off=Math.max(+c.q.get('offset')||0,0);
 const wh=[cid?'client_id='+cid:'',only?'id='+only:''].filter(Boolean);let rows=db.prepare('SELECT * FROM colaboradores '+(wh.length?'WHERE '+wh.join(' AND '):'')+' ORDER BY id DESC').all().map(k=>({k,nome:dec(k.nome_enc)}));
 if(q)rows=rows.filter(({k,nome})=>norm(nome).includes(q)||(qd.length>=3&&digits(dec(k.cpf_enc)).includes(qd))||norm(k.cargo||'').includes(q));
 const nd=Object.fromEntries(db.prepare('SELECT colab_id k,COUNT(*) n FROM dependentes WHERE ativo=1 AND colab_id IS NOT NULL GROUP BY colab_id').all().map(x=>[x.k,x.n])),out=({k})=>({...colabOut(k),deps:nd[k.id]||0});
 if(!pag)return rows.slice(0,500).map(out);
 rows.sort((a,b)=>norm(a.nome).localeCompare(norm(b.nome)));return{total:rows.length,limit:lim,offset:off,itens:rows.slice(off,off+lim).map(out)}});
R('POST','/api/colaboradores',PEOPLE,c=>{need(c,'nome','cpf','cargo','client_id');if(!cpfOk(c.body.cpf))throw E(400,'CPF inválido.');if(!db.prepare('SELECT 1 FROM clients WHERE id=? AND ativo=1').get(c.body.client_id))throw E(400,'Empresa inválida.');
 const nasc=parseNasc(c.body.nasc);if(nasc===null)throw E(400,'Data de nascimento inválida.');
 const h=cpfH(c.body.cpf);if(db.prepare('SELECT 1 FROM colaboradores WHERE cpf_hash=? AND client_id=?').get(h,c.body.client_id))throw E(409,'Já existe colaborador com este CPF nesta empresa.');
 const r=db.prepare('INSERT INTO colaboradores(client_id,nome_enc,cpf_enc,cpf_hash,cargo,criado,criado_por,nasc_enc) VALUES(?,?,?,?,?,?,?,?)').run(c.body.client_id,enc(String(c.body.nome).trim()),enc(digits(c.body.cpf)),h,String(c.body.cargo).trim(),now(),c.u.id,enc(nasc));audit(c.u,'colaborador_criado',r.lastInsertRowid,c.ip);return{id:Number(r.lastInsertRowid)}});
R('PATCH','/api/colaboradores/:id',PEOPLE,c=>{const k=db.prepare('SELECT * FROM colaboradores WHERE id=?').get(c.params.id);if(!k)throw E(404,'Colaborador não encontrado.');const b=c.body;if(b.cpf!=null&&b.cpf!==''&&!cpfOk(b.cpf))throw E(400,'CPF inválido.');const ncpf=b.cpf!=null&&b.cpf!=='';
 let nasc_enc=k.nasc_enc;if(b.nasc!==undefined){const n=parseNasc(b.nasc);if(n===null)throw E(400,'Data de nascimento inválida.');nasc_enc=enc(n)}
 try{db.prepare('UPDATE colaboradores SET nome_enc=?,cpf_enc=?,cpf_hash=?,cargo=?,client_id=?,ativo=?,nasc_enc=? WHERE id=?').run(b.nome?enc(String(b.nome).trim()):k.nome_enc,ncpf?enc(digits(b.cpf)):k.cpf_enc,ncpf?cpfH(b.cpf):k.cpf_hash,b.cargo??k.cargo,b.client_id||k.client_id,b.ativo!=null?+b.ativo:k.ativo,nasc_enc,k.id)}catch(e){if(/UNIQUE/.test(e.message))throw E(409,'Já existe colaborador com este CPF nesta empresa.');throw e}
 audit(c.u,'colaborador_editado',k.id,c.ip);return{ok:1}});
/* ---- dependentes: pertencem ao cadastro do colaborador (mesma empresa), não a um prontuário ---- */
const depNasc=d=>d.nasc_enc?dec(d.nasc_enc):(d.nasc||'');
const depOut=d=>({id:d.id,colab_id:d.colab_id,nome:dec(d.nome_enc),parentesco:d.parentesco,nasc:depNasc(d),cpf:maskCpf(dec(d.cpf_enc)),ativo:d.ativo});
const depsOf=p=>db.prepare('SELECT * FROM dependentes WHERE colab_id=? OR pront_id=? ORDER BY id').all(p.colab_id||-1,p.id);
const depOk=(id,p)=>db.prepare('SELECT id FROM dependentes WHERE id=? AND (colab_id=? OR pront_id=?)').get(id,p.colab_id||-1,p.id);
const depDados=b=>{const nome=String(b.nome||'').trim().replace(/\s+/g,' ');if(nome.length<2)throw E(400,'Informe o nome do dependente.');if(b.cpf&&!cpfOk(b.cpf))throw E(400,'CPF do dependente inválido.');const nasc=parseNasc(b.nasc);if(nasc===null)throw E(400,'Data de nascimento do dependente inválida.');return{nome,parentesco:String(b.parentesco||'outro').slice(0,40),nasc,cpf:digits(b.cpf)}};
const depDup=(colab_id,d,ignorar)=>{if(!colab_id)return false;const h=d.cpf?cpfH(d.cpf):null,n=norm(d.nome);return db.prepare('SELECT * FROM dependentes WHERE colab_id=?').all(colab_id).some(x=>x.id!==ignorar&&((h&&x.cpf_hash===h)||(norm(dec(x.nome_enc))===n&&(!d.nasc||!depNasc(x)||depNasc(x)===d.nasc))))};
const insDep=(ids,d)=>db.prepare('INSERT INTO dependentes(pront_id,colab_id,nome_enc,parentesco,nasc,nasc_enc,cpf_enc,cpf_hash,criado) VALUES(?,?,?,?,?,?,?,?,?)').run(ids.pront_id||null,ids.colab_id||null,enc(d.nome),d.parentesco,'',enc(d.nasc),enc(d.cpf),d.cpf?cpfH(d.cpf):null,now());
R('GET','/api/colaboradores/:id/dependentes',PEOPLE,c=>{const k=db.prepare('SELECT id FROM colaboradores WHERE id=?').get(c.params.id);if(!k)throw E(404,'Colaborador não encontrado.');return db.prepare('SELECT * FROM dependentes WHERE colab_id=? ORDER BY id').all(k.id).map(depOut)});
R('POST','/api/colaboradores/:id/dependentes',PEOPLE,c=>{const k=db.prepare('SELECT id FROM colaboradores WHERE id=?').get(c.params.id);if(!k)throw E(404,'Colaborador não encontrado.');const d=depDados(c.body);
 if(depDup(k.id,d))throw E(409,'Este dependente já está cadastrado para o colaborador.');const r=insDep({colab_id:k.id},d);audit(c.u,'dependente_criado',r.lastInsertRowid,c.ip);return{id:Number(r.lastInsertRowid)}});
function openPront(u,k,ip){const ex=db.prepare('SELECT id FROM prontuarios WHERE colab_id=? AND especialidade=?').get(k.id,u.role);if(ex){audit(u,'prontuario_aberto',ex.id,ip);return{id:ex.id,existente:true}}
 const r=db.prepare('INSERT INTO prontuarios(client_id,colab_enc,especialidade,prof_id,aberto_em,colab_id) VALUES(?,?,?,?,?,?)').run(k.client_id,k.nome_enc,u.role,u.id,now(),k.id);audit(u,'prontuario_criado',r.lastInsertRowid,ip);return{id:Number(r.lastInsertRowid),existente:false}}
const colabDe=p=>p.colab_id?db.prepare('SELECT * FROM colaboradores WHERE id=?').get(p.colab_id):null;
const nomeU=id=>(db.prepare('SELECT nome FROM users WHERE id=?').get(id)||{}).nome||'';
R('GET','/api/prontuarios',CLIN,c=>{clin(c);return db.prepare('SELECT * FROM prontuarios WHERE especialidade=? ORDER BY id DESC').all(c.u.role).map(p=>{const k=colabDe(p);return{id:p.id,client_id:p.client_id,aberto_em:p.aberto_em,situacao:p.situacao,prof_id:p.prof_id,colaborador:k?dec(k.nome_enc):dec(p.colab_enc),cargo:k?k.cargo:'',deps:db.prepare('SELECT COUNT(*) n FROM dependentes WHERE colab_id=? OR pront_id=?').get(p.colab_id||-1,p.id).n,
  dependentes:depsOf(p).filter(d=>d.ativo).map(d=>dec(d.nome_enc)+' ('+d.parentesco+')'),atend:db.prepare("SELECT COUNT(*) n FROM atend WHERE pront_id=? AND status<>'Cancelado'").get(p.id).n,ultimo:(db.prepare("SELECT MAX(data) u FROM atend WHERE pront_id=? AND status<>'Cancelado'").get(p.id)||{}).u||null,relatos:db.prepare('SELECT COUNT(*) n FROM relatos WHERE pront_id=?').get(p.id).n}})});
R('POST','/api/prontuarios',CLIN,c=>{clin(c);if(c.body.colab_id){const k=db.prepare('SELECT * FROM colaboradores WHERE id=? AND ativo=1').get(c.body.colab_id);if(!k)throw E(404,'Colaborador não encontrado.');return openPront(c.u,k,c.ip)}
 need(c,'colaborador','client_id');if(!db.prepare('SELECT 1 FROM clients WHERE id=? AND ativo=1').get(c.body.client_id))throw E(400,'Cliente inválido');
 const r=db.prepare('INSERT INTO prontuarios(client_id,colab_enc,especialidade,prof_id,aberto_em) VALUES(?,?,?,?,?)').run(c.body.client_id,enc(c.body.colaborador),c.u.role,c.u.id,now());audit(c.u,'prontuario_criado',r.lastInsertRowid,c.ip);return{id:Number(r.lastInsertRowid)}});
R('GET','/api/prontuarios/:id',CLIN,c=>{const p=getP(c);audit(c.u,'prontuario_lido',p.id,c.ip);const k=colabDe(p),cl=db.prepare('SELECT fantasia FROM clients WHERE id=?').get(p.client_id)||{},tit=k?dec(k.nome_enc):dec(p.colab_enc);
 const deps=depsOf(p).map(depOut),nm={};deps.forEach(d=>nm[d.id]=d.nome+' ('+d.parentesco+')');const pac=id=>id?nm[id]||'Dependente':tit+' (titular)';
 return{id:p.id,client_id:p.client_id,colab_id:p.colab_id,empresa:cl.fantasia,colaborador:tit,cpf:k?maskCpf(dec(k.cpf_enc)):'',cargo:k?k.cargo:'',especialidade:p.especialidade,aberto_em:p.aberto_em,situacao:p.situacao,observacoes:dec(p.obs_enc),dependentes:deps,
  atendimentos:db.prepare('SELECT id,data,inicio,fim,minutos,tipo,status,dep_id,chamado_id,prof_id FROM atend WHERE pront_id=? ORDER BY data DESC,inicio DESC').all(p.id).map(a=>({...a,paciente:pac(a.dep_id),meu:a.prof_id===c.u.id,autor:nomeU(a.prof_id)})),
  chamados:db.prepare('SELECT id,protocolo,tema,status,criado FROM chamados WHERE pront_id=? ORDER BY id DESC').all(p.id),
  relatos:db.prepare('SELECT * FROM relatos WHERE pront_id=? ORDER BY id').all(p.id).map(r=>({id:r.id,prof_id:r.prof_id,texto:dec(r.texto_enc),criado_em:r.criado_em,alterado_em:r.alterado_em,versao:r.versao,dep_id:r.dep_id,atend_id:r.atend_id,paciente:pac(r.dep_id),meu:r.prof_id===c.u.id,autor:nomeU(r.prof_id)}))}});
R('PATCH','/api/prontuarios/:id',CLIN,c=>{const p=getP(c),b=c.body;if(b.observacoes!=null){db.prepare('INSERT INTO prontuario_versoes(pront_id,obs_enc,quando,quem) VALUES(?,?,?,?)').run(p.id,p.obs_enc,now(),c.u.id);db.prepare('UPDATE prontuarios SET obs_enc=? WHERE id=?').run(enc(String(b.observacoes).slice(0,5000)),p.id)}
 if(b.situacao){if(!['Em acompanhamento','Encerrado'].includes(b.situacao))throw E(400,'Situação inválida.');db.prepare('UPDATE prontuarios SET situacao=?,encerrado_em=? WHERE id=?').run(b.situacao,b.situacao==='Encerrado'?now():null,p.id)}audit(c.u,'prontuario_editado',p.id,c.ip);return{ok:1}});
R('POST','/api/prontuarios/:id/dependentes',CLIN,c=>{const p=getP(c);need(c,'nome','parentesco');const d=depDados(c.body);if(depDup(p.colab_id,d))throw E(409,'Este dependente já está cadastrado para o colaborador.');
 const r=insDep({colab_id:p.colab_id,pront_id:p.id},d);audit(c.u,'dependente_criado',r.lastInsertRowid,c.ip);return{id:Number(r.lastInsertRowid)}});
R('PATCH','/api/dependentes/:id',PEOPLE,c=>{const d=db.prepare('SELECT * FROM dependentes WHERE id=?').get(c.params.id);if(!d)throw E(404,'Dependente não encontrado.');
 if(!d.colab_id){const p=d.pront_id&&db.prepare('SELECT especialidade FROM prontuarios WHERE id=?').get(d.pront_id);if(!p||p.especialidade!==c.u.role)throw E(404,'Dependente não encontrado.')}
 const b=c.body;if(b.cpf&&!cpfOk(b.cpf))throw E(400,'CPF inválido.');const nasc=b.nasc===undefined?depNasc(d):parseNasc(b.nasc);if(nasc===null)throw E(400,'Data de nascimento inválida.');
 db.prepare('UPDATE dependentes SET nome_enc=?,parentesco=?,nasc=?,nasc_enc=?,cpf_enc=?,cpf_hash=?,ativo=? WHERE id=?').run(b.nome?enc(String(b.nome).trim()):d.nome_enc,b.parentesco||d.parentesco,'',enc(nasc),b.cpf?enc(digits(b.cpf)):d.cpf_enc,b.cpf?cpfH(b.cpf):d.cpf_hash,b.ativo!=null?+b.ativo:d.ativo,d.id);audit(c.u,'dependente_editado',d.id,c.ip);return{ok:1}});
R('POST','/api/prontuarios/:id/relatos',CLIN,c=>{const p=getP(c);need(c,'texto');if(p.situacao==='Encerrado')throw E(409,'Prontuário encerrado. Reabra para registrar.');let dep=null;if(c.body.dep_id){const d=depOk(c.body.dep_id,p);if(!d)throw E(400,'Dependente inválido.');dep=d.id}
 let at=null;if(c.body.atend_id){const a=db.prepare('SELECT * FROM atend WHERE id=? AND pront_id=? AND prof_id=?').get(c.body.atend_id,p.id,c.u.id);if(!a)throw E(400,'Atendimento inválido para este prontuário.');if(c.body.dep_id&&(a.dep_id||null)!==dep)throw E(400,'O paciente do relato deve ser o mesmo do atendimento.');at=a.id;dep=a.dep_id||null}
 const t=now(),r=db.prepare('INSERT INTO relatos(pront_id,prof_id,texto_enc,criado_em,alterado_em,dep_id,atend_id) VALUES(?,?,?,?,?,?,?)').run(p.id,c.u.id,enc(c.body.texto),t,t,dep,at);audit(c.u,'relato_criado',r.lastInsertRowid,c.ip);return{id:Number(r.lastInsertRowid),criado_em:t}});
R('POST','/api/prontuarios/:id/atender',CLIN,c=>{const p=getP(c);if(!p.colab_id)throw E(409,'Este prontuário não está ligado a um colaborador cadastrado.');if(p.situacao==='Encerrado')throw E(409,'Prontuário encerrado. Reabra para atender.');
 if(db.prepare("SELECT 1 FROM atend WHERE pront_id=? AND prof_id=? AND status='Em andamento'").get(p.id,c.u.id))throw E(409,'Você já tem um atendimento em andamento neste prontuário.');let dep=null;if(c.body.dep_id){const d=depOk(c.body.dep_id,p);if(!d)throw E(400,'Dependente inválido.');dep=d.id}
 const u=db.prepare('SELECT valor_hora FROM users WHERE id=?').get(c.u.id),a=db.prepare("INSERT INTO atend(prof_id,client_id,data,inicio,inicio_ts,tipo,status,valor_hora,total,pront_id,dep_id,colab_id) VALUES(?,?,?,?,?,?,'Em andamento',?,0,?,?,?)").run(c.u.id,p.client_id,today(),hhmm(),now(),c.u.role==='psicologo'?'Psicológico':'Social',u.valor_hora,p.id,dep,p.colab_id);audit(c.u,'atendimento_iniciado',a.lastInsertRowid+':p'+p.id,c.ip);return{atend_id:Number(a.lastInsertRowid)}});
R('PATCH','/api/relatos/:id',CLIN,c=>{const r=db.prepare('SELECT r.*,p.especialidade FROM relatos r JOIN prontuarios p ON p.id=r.pront_id WHERE r.id=?').get(c.params.id);
 if(!r||r.especialidade!==c.u.role)throw E(404,'Relato não encontrado.');if(r.prof_id!==c.u.id)throw E(403,'Só é possível editar relatos próprios.');need(c,'texto');
 db.prepare('INSERT INTO relato_versoes(relato_id,versao,texto_enc,quando,quem) VALUES(?,?,?,?,?)').run(r.id,r.versao,r.texto_enc,now(),c.u.id);
 db.prepare('UPDATE relatos SET texto_enc=?,alterado_em=?,versao=versao+1 WHERE id=?').run(enc(c.body.texto),now(),r.id);audit(c.u,'relato_editado',r.id,c.ip);return{ok:1}});
R('POST','/api/prontuarios/:id/encerrar',CLIN,c=>{const p=getP(c);db.prepare("UPDATE prontuarios SET situacao='Encerrado',encerrado_em=? WHERE id=?").run(now(),p.id);audit(c.u,'prontuario_encerrado',p.id,c.ip);return{ok:1}});
/* ---------- acolhimento "Chame aqui" ---------- */
/* Catálogo de serviços do "Chame aqui": o tipo de atendimento é deduzido do tema escolhido */
const CATALOGO=[
 {grupo:'Apoio psicológico',tipo:'psicologico',temas:['Ajuda psicológica','Ansiedade e estresse','Dificuldades emocionais','Luto e perdas','Conflitos no ambiente de trabalho','Relacionamento interpessoal','Problemas familiares','Questões pessoais']},
 {grupo:'Serviço social',tipo:'social',temas:['Orientação social','Benefícios previdenciários (INSS, auxílio-doença, aposentadoria)','Afastamento e retorno ao trabalho','Direitos e benefícios sociais (CadÚnico, BPC, Bolsa Família)','Dificuldades financeiras e endividamento','Moradia e vulnerabilidade social','Cuidado com filhos, idosos ou pessoa com deficiência','Gestação, licença-maternidade/paternidade e direitos','Saúde: acesso ao SUS, tratamentos e medicamentos','Dependência química: orientação ao colaborador e à família','Violência doméstica ou familiar: acolhimento e encaminhamento','Documentação e regularização civil','Encaminhamento à rede de apoio (CRAS, CREAS, Defensoria, UBS)']},
 {grupo:'Outros assuntos',tipo:'indefinido',temas:['Assédio ou constrangimento','Outros assuntos']}];
const TEMAS_ANTIGOS=['Dificuldades financeiras'];/* chamados já registrados com os nomes antigos continuam válidos */
const TEMAS=[...new Set([...CATALOGO.flatMap(g=>g.temas),...TEMAS_ANTIGOS])];
const tipoDoTema=t=>{const g=CATALOGO.find(x=>x.temas.includes(t));return g?g.tipo:t==='Dificuldades financeiras'?'social':'indefinido'};
const isLoop=c=>/^(127\.|::1$|::ffff:127\.)/.test(c.ip||'')&&!c.fwd;/* navegador na própria máquina (localhost), sem proxy */
R('GET','/api/public/temas',null,()=>({catalogo:CATALOGO}));
R('POST','/api/public/chamados',null,c=>{need(c,'tema');if(!TEMAS.includes(c.body.tema))throw E(400,'Tema inválido');
 if(!isLoop(c)){const k='ch|'+c.ip,t=tries.get(k)||{n:0,until:0};if(t.until>Date.now())throw E(429,'Muitos pedidos. Tente mais tarde.');t.n++;if(t.n>=5){t.until=Date.now()+36e5;t.n=0}tries.set(k,t)}
 /* CPF opcional: só serve para localizar o cadastro do colaborador e agilizar o atendimento (não é gravado nem confirmado ao solicitante) */
 let col=null;const cpf=digits(c.body.cpf);if(cpf){if(!cpfOk(cpf))throw E(400,'CPF inválido. Confira os números ou deixe o campo em branco.');const ms=db.prepare('SELECT * FROM colaboradores WHERE cpf_hash=? AND ativo=1').all(cpfH(cpf));if(ms.length===1)col=ms[0]}
 const cid=col?col.client_id:(db.prepare('SELECT id FROM clients WHERE id=? AND ativo=1').get(+c.body.client_id||0)||{}).id||null;
 const proto='ACL-'+new Date().getFullYear()+'-'+crypto.randomBytes(4).toString('hex').toUpperCase(),tipo=['psicologico','social'].includes(c.body.tipo)?c.body.tipo:tipoDoTema(c.body.tema);
 db.prepare('INSERT INTO chamados(protocolo,client_id,tema,tipo,desc_enc,contato_enc,status,criado,atualizado,colab_id,solicitante_enc,empresa_txt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(proto,cid,c.body.tema,tipo,enc(String(c.body.descricao||'').slice(0,2000)),enc(String(c.body.contato||'').slice(0,200)),'Novo chamado',now(),now(),col?col.id:null,enc(String(c.body.nome||'').trim().slice(0,150)),String(c.body.empresa||'').trim().slice(0,120));
 return{protocolo:proto,mensagem:'Solicitação recebida. Guarde seu protocolo.'}});
const STAT=['Novo chamado','Aguardando triagem','Encaminhado','Em atendimento','Finalizado','Cancelado'];
R('GET','/api/chamados',PEOPLE,c=>{const adm=c.u.role==='admin',cn=Object.fromEntries(db.prepare('SELECT id,fantasia FROM clients').all().map(k=>[k.id,k.fantasia]));
 return db.prepare(adm?'SELECT * FROM chamados ORDER BY id DESC':'SELECT * FROM chamados WHERE prof_id=? OR criado_por=? ORDER BY id DESC').all(...(adm?[]:[c.u.id,c.u.id])).map(h=>({id:h.id,protocolo:h.protocolo,tema:h.tema,tipo:h.tipo,status:h.status,prof_id:h.prof_id,criado:h.criado,empresa:cn[h.client_id]||h.empresa_txt||'',...(adm?{}:{descricao:dec(h.desc_enc),contato:dec(h.contato_enc),solicitante:dec(h.solicitante_enc),colab_id:h.colab_id,pront_id:h.pront_id,atend_id:h.atend_id})}))});
/* Fila "Chamados abertos": ainda sem profissional. Cada perfil vê o seu tipo (o tipo "indefinido" aparece para os dois); o admin vê todos. */
const ABERTOS=['Novo chamado','Aguardando triagem'];
const tiposDoPerfil=u=>u.role==='psicologo'?['psicologico','indefinido']:u.role==='assistente_social'?['social','indefinido']:null;
R('GET','/api/chamados/abertos',PEOPLE,c=>{const adm=c.u.role==='admin',tp=tiposDoPerfil(c.u),cn=Object.fromEntries(db.prepare('SELECT id,fantasia FROM clients').all().map(k=>[k.id,k.fantasia]));
 return db.prepare('SELECT * FROM chamados WHERE prof_id IS NULL AND criado_por IS NULL AND status IN (?,?) ORDER BY id').all(...ABERTOS).filter(h=>adm||tp.includes(h.tipo)).map(h=>({id:h.id,protocolo:h.protocolo,tema:h.tema,tipo:h.tipo,status:h.status,criado:h.criado,empresa:cn[h.client_id]||h.empresa_txt||'',...(adm?{}:{colab_id:h.colab_id})}))});
/* O administrador direciona um chamado aberto (vindo do "Chame aqui") a uma profissional do tipo certo; ele sai da fila e aparece em "Meus chamados" dela. */
R('POST','/api/chamados/:id/direcionar',['admin'],c=>{need(c,'prof_id');const h=db.prepare('SELECT * FROM chamados WHERE id=?').get(c.params.id);if(!h)throw E(404,'Chamado não encontrado.');
 const u=db.prepare("SELECT id,role,ativo FROM users WHERE id=? AND role IN ('psicologo','assistente_social')").get(+c.body.prof_id);if(!u||!u.ativo)throw E(400,'Selecione um(a) profissional ativo(a).');
 if(h.tipo==='psicologico'&&u.role!=='psicologo')throw E(400,'Este chamado é psicológico: direcione a um(a) psicólogo(a).');if(h.tipo==='social'&&u.role!=='assistente_social')throw E(400,'Este chamado é de Serviço Social: direcione a uma assistente social.');
 const r=db.prepare("UPDATE chamados SET prof_id=?,status='Encaminhado',atualizado=? WHERE id=? AND prof_id IS NULL AND criado_por IS NULL AND status IN (?,?)").run(u.id,now(),h.id,...ABERTOS);
 if(!r.changes)throw E(409,'Este chamado já foi direcionado ou assumido por um(a) profissional.');audit(c.u,'chamado_direcionado',h.id+'>'+u.id,c.ip);return{ok:1}});
/* Administrador e profissionais excluem um chamado aberto do "Chame aqui" (teste, duplicado, trote). Só vale enquanto ninguém assumiu e não há atendimento.
   A profissional só exclui chamados do seu tipo de atendimento (os mesmos que vê na fila). Toda exclusão fica na auditoria com protocolo, tema e tipo. */
R('POST','/api/chamados/:id/excluir',['admin','psicologo','assistente_social'],c=>{const h=db.prepare('SELECT * FROM chamados WHERE id=?').get(c.params.id);if(!h)throw E(404,'Chamado não encontrado.');
 if(c.u.role!=='admin'&&!tiposDoPerfil(c.u).includes(h.tipo)){audit(c.u,'chamado_exclusao_negada',h.protocolo,c.ip,0);throw E(403,'Este chamado é de outro tipo de atendimento.')}
 if(h.prof_id!=null||h.criado_por!=null||h.atend_id!=null||!ABERTOS.includes(h.status)||db.prepare('SELECT 1 FROM atend WHERE chamado_id=?').get(h.id))throw E(409,'Só é possível excluir chamados ainda abertos, sem profissional e sem atendimento. Para os demais, use o status "Cancelado".');
 db.prepare('DELETE FROM chamados WHERE id=?').run(h.id);audit(c.u,'chamado_excluido',h.protocolo+' · '+h.tema+' · '+h.tipo,c.ip);return{ok:1}});
R('POST','/api/chamados',CLIN,c=>{need(c,'tema');if(!TEMAS.includes(c.body.tema))throw E(400,'Tema inválido');let k=null;if(c.body.colab_id){k=db.prepare('SELECT * FROM colaboradores WHERE id=?').get(c.body.colab_id);if(!k)throw E(400,'Colaborador inválido.')}
 const proto='ACL-'+new Date().getFullYear()+'-'+crypto.randomBytes(4).toString('hex').toUpperCase(),r=db.prepare("INSERT INTO chamados(protocolo,client_id,tema,tipo,desc_enc,contato_enc,status,prof_id,criado,atualizado,colab_id,criado_por) VALUES(?,?,?,?,?,?,'Encaminhado',?,?,?,?,?)").run(proto,k?k.client_id:null,c.body.tema,c.u.role==='psicologo'?'psicologico':'social',enc(String(c.body.descricao||'').slice(0,2000)),enc(String(c.body.contato||'').slice(0,200)),c.u.id,now(),now(),k?k.id:null,c.u.id);audit(c.u,'chamado_aberto_prof',r.lastInsertRowid,c.ip);return{id:Number(r.lastInsertRowid),protocolo:proto}});
/* O início do atendimento é automático (botão "Iniciar atendimento") e o término também: ao marcar o chamado como Finalizado o atendimento em andamento é encerrado com o horário do servidor. */
const tsInicio=a=>a.inicio_ts||new Date(a.data+'T'+a.inicio+':00').toISOString();
function closeAtend(a,u,ip){const f=new Date(),m=Math.max(1,Math.round((f-Date.parse(tsInicio(a)))/6e4)),tot=Math.round(m/60*a.valor_hora*100)/100,fim=f.toTimeString().slice(0,5);
 db.prepare("UPDATE atend SET fim=?,fim_ts=?,minutos=?,total=?,status='Pendente de validação' WHERE id=?").run(fim,f.toISOString(),m,tot,a.id);
 if(a.chamado_id)db.prepare("UPDATE chamados SET status='Finalizado',atualizado=? WHERE id=?").run(now(),a.chamado_id);audit(u,'atendimento_finalizado',a.id,ip);return{minutos:m,total:tot,fim}}
R('PATCH','/api/chamados/:id',PEOPLE,c=>{const h=db.prepare('SELECT * FROM chamados WHERE id=?').get(c.params.id);if(!h)throw E(404,'Chamado não encontrado.');const b=c.body,adm=c.u.role==='admin';
 if(!adm&&h.prof_id!==c.u.id&&h.criado_por!==c.u.id){audit(c.u,'chamado_negado',h.id,c.ip,0);throw E(403,'Este chamado não está sob sua responsabilidade.')}
 if(b.status&&!STAT.includes(b.status))throw E(400,'Status inválido');
 const run=h.atend_id?db.prepare("SELECT * FROM atend WHERE id=? AND status='Em andamento'").get(h.atend_id):null;
 if(b.status==='Em atendimento'&&b.status!==h.status)throw E(400,'O status "Em atendimento" é automático: começa quando o(a) profissional clica em "Iniciar atendimento".');
 if(run&&b.status&&b.status!==h.status&&b.status!=='Finalizado')throw E(409,'Há um atendimento em andamento neste chamado. Marque o chamado como Finalizado para encerrá-lo.');
 if(adm)db.prepare('UPDATE chamados SET status=COALESCE(?,status),prof_id=COALESCE(?,prof_id),atualizado=? WHERE id=?').run(b.status||null,b.prof_id||null,now(),h.id);
 else{if(b.status&&!['Em atendimento','Encaminhado','Finalizado','Cancelado'].includes(b.status))throw E(400,'Use "Iniciar atendimento" para colocar o chamado em atendimento.');if(b.tema&&!TEMAS.includes(b.tema))throw E(400,'Tema inválido');
  db.prepare('UPDATE chamados SET status=COALESCE(?,status),tema=COALESCE(?,tema),tipo=COALESCE(?,tipo),desc_enc=?,contato_enc=?,colab_id=COALESCE(?,colab_id),atualizado=? WHERE id=?').run(b.status||null,b.tema||null,['psicologico','social','indefinido'].includes(b.tipo)?b.tipo:null,b.descricao!=null?enc(String(b.descricao).slice(0,2000)):h.desc_enc,b.contato!=null?enc(String(b.contato).slice(0,200)):h.contato_enc,b.colab_id||null,now(),h.id)}
 if(b.status==='Finalizado'&&run)closeAtend(run,c.u,c.ip);
 audit(c.u,'chamado_atualizado',h.id,c.ip);return{ok:1}});
/* chamado -> atendimento -> prontuário */
R('POST','/api/chamados/:id/atender',CLIN,c=>{const h=db.prepare('SELECT * FROM chamados WHERE id=?').get(c.params.id);if(!h){throw E(404,'Chamado não encontrado.')}
 const livre=h.prof_id==null&&h.criado_por==null&&ABERTOS.includes(h.status);
 if(livre&&!tiposDoPerfil(c.u).includes(h.tipo)){audit(c.u,'chamado_negado',h.id,c.ip,0);throw E(403,'Este chamado é de outro tipo de atendimento.')}
 if(!livre&&h.prof_id!==c.u.id&&h.criado_por!==c.u.id){const mesmoTipo=h.prof_id!=null&&tiposDoPerfil(c.u).includes(h.tipo);audit(c.u,'chamado_negado',c.params.id,c.ip,0);throw E(mesmoTipo?409:403,mesmoTipo?'Este chamado já foi assumido por outro(a) profissional.':'Este chamado não está sob sua responsabilidade.')}
 if(['Finalizado','Cancelado'].includes(h.status))throw E(409,'Chamado já encerrado.');if(h.status==='Em atendimento'&&db.prepare("SELECT 1 FROM atend WHERE chamado_id=? AND status='Em andamento'").get(h.id))throw E(409,'Já existe atendimento em andamento para este chamado.');
 const kid=c.body.colab_id||h.colab_id;if(!kid)throw E(400,'Selecione o colaborador atendido (cadastre-o antes, se necessário).');const k=db.prepare('SELECT * FROM colaboradores WHERE id=? AND ativo=1').get(kid);if(!k)throw E(404,'Colaborador não encontrado.');
 if(livre){/* assume o chamado de forma atômica: se outra colega chegou antes, ninguém duplica */
  const g=db.prepare("UPDATE chamados SET prof_id=?,status='Em atendimento',atualizado=? WHERE id=? AND prof_id IS NULL AND criado_por IS NULL AND status IN (?,?)").run(c.u.id,now(),h.id,...ABERTOS);
  if(!g.changes)throw E(409,'Este chamado já foi assumido por outro(a) profissional.')}
 try{
 const pr=openPront(c.u,k,c.ip),u=db.prepare('SELECT valor_hora FROM users WHERE id=?').get(c.u.id),a=db.prepare("INSERT INTO atend(prof_id,client_id,data,inicio,inicio_ts,tipo,status,valor_hora,total,pront_id,colab_id,chamado_id) VALUES(?,?,?,?,?,?,'Em andamento',?,0,?,?,?)").run(c.u.id,k.client_id,today(),hhmm(),now(),c.u.role==='psicologo'?'Psicológico':'Social',u.valor_hora,pr.id,k.id,h.id);
 db.prepare("UPDATE chamados SET status='Em atendimento',prof_id=?,colab_id=?,pront_id=?,atend_id=?,atualizado=? WHERE id=?").run(c.u.id,k.id,pr.id,Number(a.lastInsertRowid),now(),h.id);audit(c.u,'atendimento_iniciado',a.lastInsertRowid+':chamado'+h.id,c.ip);return{atend_id:Number(a.lastInsertRowid),pront_id:pr.id}}
 catch(e){if(livre)db.prepare("UPDATE chamados SET prof_id=NULL,status=? WHERE id=?").run(h.status,h.id);throw e}});
/* ---------- pesquisas NR-1 ---------- */
R('GET','/api/forms',['admin'],()=>db.prepare('SELECT id,nome,client_id,modelo,metrica,perguntas FROM forms').all().map(f=>({...f,perguntas:JSON.parse(f.perguntas)})));
const TQ=['frequencia','concordancia','satisfacao','texto'];
function perguntasOk(q){if(!Array.isArray(q)||!q.length||q.length>80)throw E(400,'Informe de 1 a 80 perguntas.');const ids=new Set();
 return q.map((x,i)=>{const texto=String(x&&x.texto||'').trim();if(!x||!x.id||!texto||!TQ.includes(x.tipo))throw E(400,'A pergunta '+(i+1)+' está incompleta: preencha o texto e o formato.');if(ids.has(x.id))throw E(400,'Há perguntas com identificador repetido.');ids.add(x.id);
  return{id:String(x.id).slice(0,40),cat:String(x.cat||'').trim().slice(0,80)||texto.slice(0,40),texto:texto.slice(0,500),tipo:x.tipo,invertida:!!x.invertida}})}
R('POST','/api/forms',['admin'],c=>{need(c,'nome','perguntas');const q=perguntasOk(c.body.perguntas),r=db.prepare('INSERT INTO forms(nome,client_id,perguntas,criado,metrica) VALUES(?,?,?,?,?)').run(String(c.body.nome).trim(),c.body.client_id||null,JSON.stringify(q),now(),c.body.metrica==='risco'?'risco':'atencao');audit(c.u,'form_criado',r.lastInsertRowid,c.ip);return{id:Number(r.lastInsertRowid)}});
R('POST','/api/forms/:id/duplicar',['admin'],c=>{const f=db.prepare('SELECT * FROM forms WHERE id=?').get(c.params.id);if(!f)throw E(404,'Formulário não encontrado');const r=db.prepare('INSERT INTO forms(nome,client_id,perguntas,criado,metrica) VALUES(?,?,?,?,?)').run(f.nome+' (cópia)',f.client_id,f.perguntas,now(),f.metrica||'risco');return{id:Number(r.lastInsertRowid)}});
R('POST','/api/campaigns',['admin'],c=>{need(c,'form_id','client_id','nome','validade');const tok=crypto.randomBytes(18).toString('base64url');
 const r=db.prepare('INSERT INTO campaigns(form_id,client_id,nome,token,validade,unica,convidados,criado,por_codigo) VALUES(?,?,?,?,?,?,?,?,?)').run(c.body.form_id,c.body.client_id,c.body.nome,tok,c.body.validade,c.body.unica===false?0:1,+c.body.convidados||0,now(),c.body.por_codigo?1:0);audit(c.u,'campanha_criada',r.lastInsertRowid,c.ip);return{id:Number(r.lastInsertRowid),link:'/pesquisa.html?t='+tok}});
R('POST','/api/campaigns/:id/codigos',['admin'],c=>{const k=db.prepare('SELECT * FROM campaigns WHERE id=?').get(c.params.id);if(!k)throw E(404,'Campanha não encontrada.');if(!k.por_codigo)throw E(409,'A campanha não usa códigos individuais.');const n=+c.body.quantidade;if(!(n>=1&&n<=2000))throw E(400,'Informe de 1 a 2000 códigos.');
 const A='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',out=[],ins=db.prepare('INSERT OR IGNORE INTO codigos(campaign_id,hash) VALUES(?,?)');while(out.length<n){const b=crypto.randomBytes(8);const cod=[...b].map(x=>A[x%32]).join('');if(ins.run(k.id,sha(k.id+'|'+cod)).changes)out.push(cod)}
 audit(c.u,'codigos_gerados',k.id+':'+n,c.ip);return{codigos:out,aviso:'Guarde esta lista agora: por segurança, os códigos não ficam visíveis depois.'}});
const camp=t=>{const k=db.prepare('SELECT c.*,cl.fantasia FROM campaigns c JOIN clients cl ON cl.id=c.client_id WHERE token=?').get(t);if(!k)throw E(404,'Pesquisa não encontrada.');if(k.validade<now().slice(0,10))throw E(410,'Pesquisa encerrada.');return k};
R('GET','/api/public/survey/:t',null,c=>{const k=camp(c.params.t);return{nome:k.nome,empresa:k.fantasia,por_codigo:!!k.por_codigo,perguntas:JSON.parse(db.prepare('SELECT perguntas FROM forms WHERE id=?').get(k.form_id).perguntas)}});
R('POST','/api/public/survey/:t',null,c=>{const k=camp(c.params.t),qs=JSON.parse(db.prepare('SELECT perguntas FROM forms WHERE id=?').get(k.form_id).perguntas),a={};
 qs.forEach(q=>{const v=c.body.answers&&c.body.answers[q.id];if(v==null||v==='')return;if(q.tipo==='texto')a[q.id]=String(v).slice(0,1000);else{const n=+v;if(!(n>=1&&n<=5))throw E(400,'Resposta inválida em '+q.id);a[q.id]=n}});
 if(!Object.keys(a).length)throw E(400,'Responda ao menos uma pergunta.');
 if(k.por_codigo){const cod=String(c.body.codigo||'').trim().toUpperCase();if(!cod)throw E(400,'Informe o código de acesso.');if(!db.prepare('UPDATE codigos SET usado=1 WHERE campaign_id=? AND hash=? AND usado=0').run(k.id,sha(k.id+'|'+cod)).changes)throw E(403,'Código inválido ou já utilizado.')}
 else if(k.unica){if(c.cookies['sv'+k.id])throw E(409,'Você já respondeu esta pesquisa.');c.cookie=`sv${k.id}=1; Max-Age=31536000; Path=/; SameSite=Strict`}
 db.prepare('INSERT INTO responses(campaign_id,answers,criado) VALUES(?,?,?)').run(k.id,JSON.stringify(a),now().slice(0,10));return{ok:1,mensagem:'Obrigado por participar!'}});
const MIN_N=5;
function results(k){const F=db.prepare('SELECT perguntas,metrica FROM forms WHERE id=?').get(k.form_id),rs=db.prepare('SELECT answers FROM responses WHERE campaign_id=?').all(k.id).map(r=>JSON.parse(r.answers)),n=rs.length,base={metrica:F.metrica||'risco',campanha:k.nome,client_id:k.client_id,convidados:k.convidados,respostas:n,participacao:k.convidados?Math.round(n/k.convidados*100):null};
 if(n<MIN_N)return{...base,insuficiente:true,aviso:`Resultados ocultos: mínimo de ${MIN_N} respostas para evitar identificação.`};
 const qs=JSON.parse(F.perguntas);
 const cats=qs.filter(q=>q.tipo!=='texto').map(q=>({q,v:rs.map(r=>r[q.id]).filter(x=>x>0)})).filter(o=>o.v.length>=MIN_N).map(({q,v})=>{const d=[1,2,3,4,5].map(i=>v.filter(x=>x===i).length),m=v.reduce((a,b)=>a+b,0)/v.length;return{categoria:q.cat,media:+m.toFixed(2),risco:+(q.invertida?6-m:m).toFixed(2),distribuicao:d}});
 if(!cats.length)return{...base,insuficiente:true,aviso:`Resultados ocultos: nenhuma pergunta atingiu o mínimo de ${MIN_N} respostas.`};return{...base,categorias:cats}}
R('GET','/api/campaigns/:id/results',['admin','cliente'],c=>{const k=db.prepare('SELECT c.*,cl.fantasia FROM campaigns c JOIN clients cl ON cl.id=c.client_id WHERE c.id=?').get(c.params.id);if(!k||(c.u.role==='cliente'&&k.client_id!==c.u.client_id))throw E(404,'Campanha não encontrada.');return results(k)});
R('GET','/api/client/dashboard',['cliente'],c=>{const ks=db.prepare('SELECT * FROM campaigns WHERE client_id=?').all(c.u.client_id),a=db.prepare("SELECT substr(data,1,7) mes,COUNT(*) qtd FROM atend WHERE client_id=? AND status IN ('Aprovado','Fechado') GROUP BY 1 ORDER BY 1").all(c.u.client_id);
 return{pesquisas:ks.map(results),atendimentos_total:a.reduce((s,x)=>s+x.qtd,0),atendimentos_por_mes:a}});
R('GET','/api/clients/lista',['admin','psicologo','assistente_social'],()=>db.prepare('SELECT id,fantasia,valor_km FROM clients WHERE ativo=1 ORDER BY fantasia').all());
R('GET','/api/campaigns',['admin'],()=>db.prepare('SELECT c.*,cl.fantasia,(SELECT COUNT(*) FROM responses r WHERE r.campaign_id=c.id) respostas FROM campaigns c JOIN clients cl ON cl.id=c.client_id ORDER BY c.id DESC').all());
R('PUT','/api/forms/:id',['admin'],c=>{const f=db.prepare('SELECT * FROM forms WHERE id=?').get(c.params.id);if(!f)throw E(404,'Formulário não encontrado');
 if(db.prepare('SELECT 1 FROM responses r JOIN campaigns k ON k.id=r.campaign_id WHERE k.form_id=?').get(f.id))throw E(409,'Este formulário já tem respostas e não pode ser alterado, para não distorcer os resultados. Salve como uma nova cópia.');
 need(c,'nome','perguntas');const q=perguntasOk(c.body.perguntas);db.prepare('UPDATE forms SET nome=?,perguntas=? WHERE id=?').run(String(c.body.nome).trim(),JSON.stringify(q),f.id);audit(c.u,'form_editado',f.id,c.ip);return{ok:1}});
R('GET','/api/my/fechamentos',CLIN,c=>db.prepare('SELECT * FROM fechamentos WHERE prof_id=? ORDER BY ano DESC,mes DESC').all(c.u.id));
/* ---------- atendimentos e remuneração ---------- */
const mins=(a,b)=>{const f=s=>{const m=/^(\d\d):(\d\d)$/.exec(s||'');if(!m)throw E(400,'Horário inválido (HH:MM)');return+m[1]*60+ +m[2]};const d=f(b)-f(a);if(d<=0)throw E(400,'Término deve ser após o início');return d};
/* Lançamento retroativo (só profissionais, marcado como "manual"). Os atendimentos normais têm início e término automáticos. */
R('POST','/api/atend',PEOPLE,c=>{if(c.u.role==='admin')throw E(403,'Os horários são registrados automaticamente: o início quando o(a) profissional clica em "Iniciar atendimento" e o término quando o atendimento ou o chamado é finalizado.');
 need(c,'data','inicio','fim','tipo');if(!c.body.colab_id)throw E(400,'Selecione o colaborador atendido: todo atendimento tem prontuário.');
 const p=db.prepare('SELECT * FROM users WHERE id=? AND ativo=1').get(c.u.id),k=db.prepare('SELECT * FROM colaboradores WHERE id=? AND ativo=1').get(c.body.colab_id);if(!k)throw E(404,'Colaborador não encontrado.');
 const pr=openPront(c.u,k,c.ip).id;let dep=null;if(c.body.dep_id){const d=depOk(c.body.dep_id,{id:pr,colab_id:k.id});if(!d)throw E(400,'Dependente inválido.');dep=d.id}
 const m=mins(c.body.inicio,c.body.fim),tot=Math.round(m/60*p.valor_hora*100)/100;
 const r=db.prepare('INSERT INTO atend(prof_id,client_id,data,inicio,fim,minutos,tipo,valor_hora,total,pront_id,dep_id,colab_id,manual) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1)').run(c.u.id,k.client_id,c.body.data,c.body.inicio,c.body.fim,m,c.body.tipo,p.valor_hora,tot,pr,dep,k.id);audit(c.u,'atend_criado',r.lastInsertRowid,c.ip);return{id:Number(r.lastInsertRowid),minutos:m,total:tot,pront_id:pr}});
R('GET','/api/atend',PEOPLE,c=>{const adm=c.u.role==='admin',l=db.prepare(`SELECT a.*,u.nome prof FROM atend a JOIN users u ON u.id=a.prof_id ${adm?'':'WHERE a.prof_id='+c.u.id} ORDER BY data DESC,inicio DESC`).all();
 if(adm)return l.map(a=>({...a,pront_id:undefined,dep_id:undefined,colab_id:undefined,chamado_id:undefined}));
 return l.map(a=>{const k=a.colab_id?db.prepare('SELECT * FROM colaboradores WHERE id=?').get(a.colab_id):null,d=a.dep_id?db.prepare('SELECT * FROM dependentes WHERE id=?').get(a.dep_id):null;return{...a,paciente:d?dec(d.nome_enc)+' ('+d.parentesco+')':k?dec(k.nome_enc)+' (titular)':'',cargo:k?k.cargo:''}})});
R('POST','/api/atend/:id/finalizar',CLIN,c=>{const a=db.prepare('SELECT * FROM atend WHERE id=?').get(c.params.id);if(!a||a.prof_id!==c.u.id)throw E(404,'Atendimento não encontrado.');if(a.status!=='Em andamento')throw E(409,'Atendimento não está em andamento.');return closeAtend(a,c.u,c.ip)});
R('POST','/api/atend/:id/paciente',CLIN,c=>{const a=db.prepare('SELECT * FROM atend WHERE id=?').get(c.params.id);if(!a||a.prof_id!==c.u.id||!a.pront_id)throw E(404,'Atendimento não encontrado.');let dep=null;if(c.body.dep_id){const d=depOk(c.body.dep_id,db.prepare('SELECT * FROM prontuarios WHERE id=?').get(a.pront_id));if(!d)throw E(400,'Dependente inválido.');dep=d.id}
 db.prepare('UPDATE atend SET dep_id=? WHERE id=?').run(dep,a.id);audit(c.u,'atend_paciente',a.id,c.ip);return{ok:1}});
R('PATCH','/api/atend/:id',['admin'],c=>{const a=db.prepare('SELECT * FROM atend WHERE id=?').get(c.params.id);if(!a)throw E(404,'Não encontrado');if(a.fech_id)throw E(423,'Atendimento em fechamento aprovado: bloqueado.');
 if(!['Aprovado','Cancelado','Pendente de validação'].includes(c.body.status))throw E(400,'Status inválido');if(c.body.status!=='Cancelado'&&!a.fim)throw E(409,'Atendimento ainda em andamento.');db.prepare('UPDATE atend SET status=? WHERE id=?').run(c.body.status,a.id);audit(c.u,'atend_status',a.id+':'+c.body.status,c.ip);return{ok:1}});
/* Prévia do fechamento de um profissional: o que entra e o que ainda ficará de fora */
const fechPrev=(prof_id,ano,mes)=>{const ym=ano+'-'+String(mes).padStart(2,'0'),
 at=db.prepare("SELECT COUNT(*) n,COALESCE(SUM(minutos),0) m,COALESCE(SUM(total),0) v FROM atend WHERE prof_id=? AND status='Aprovado' AND fech_id IS NULL AND substr(data,1,7)=?").get(prof_id,ym),
 pend=db.prepare("SELECT COUNT(*) n FROM atend WHERE prof_id=? AND status IN ('Pendente de validação','Em andamento') AND substr(data,1,7)=?").get(prof_id,ym).n,
 rb=db.prepare("SELECT COUNT(*) n,COALESCE(SUM(valor),0) v,COALESCE(SUM(substr(data,1,7)<?),0) atras FROM reembolsos WHERE prof_id=? AND status='Aprovado' AND fech_id IS NULL AND substr(data,1,7)<=?").get(ym,prof_id,ym),
 rp=db.prepare("SELECT COUNT(*) n,COALESCE(SUM(valor),0) v FROM reembolsos WHERE prof_id=? AND status='Pendente' AND substr(data,1,7)<=?").get(prof_id,ym);
 return{atend:at.n,horas:R2(at.m/60),bruto:R2(at.v),atend_pendentes:pend,reembolsos:rb.n,reembolso_valor:R2(rb.v),reembolsos_anteriores:rb.atras,reembolsos_pendentes:rp.n,reembolsos_pendentes_valor:R2(rp.v),
  ja_fechado:!!db.prepare('SELECT 1 FROM fechamentos WHERE prof_id=? AND ano=? AND mes=?').get(prof_id,ano,mes)}};
R('GET','/api/fechamentos/previa',['admin'],c=>{const[ano,mes]=perOk(c),pid=+c.q.get('prof_id');if(!pid)throw E(400,'Selecione o profissional.');return fechPrev(pid,ano,mes)});
R('POST','/api/fechamentos',['admin'],c=>{need(c,'prof_id','ano','mes');const{prof_id,ano,mes}=c.body,ym=ano+'-'+String(mes).padStart(2,'0');
 if(!(+mes>=1&&+mes<=12&&+ano>=2000&&+ano<=2100))throw E(400,'Período inválido.');
 const u=db.prepare("SELECT * FROM users WHERE id=? AND role IN ('admin','psicologo','assistente_social')").get(prof_id);if(!u)throw E(400,'Profissional inválido.');
 if(db.prepare('SELECT 1 FROM fechamentos WHERE prof_id=? AND ano=? AND mes=?').get(prof_id,ano,mes))throw E(409,'Mês já fechado para este profissional.');
 const l=db.prepare("SELECT * FROM atend WHERE prof_id=? AND status='Aprovado' AND fech_id IS NULL AND substr(data,1,7)=?").all(prof_id,ym),
  rb=db.prepare("SELECT * FROM reembolsos WHERE prof_id=? AND status='Aprovado' AND fech_id IS NULL AND substr(data,1,7)<=?").all(prof_id,ym);
 if(!l.length&&!rb.length)throw E(400,'Não há atendimentos aprovados nem reembolsos de km aprovados no período.');
 const m=l.reduce((s,a)=>s+a.minutos,0),bruto=R2(l.reduce((s,a)=>s+a.total,0)),aj=+c.body.ajuste||0,reemb=R2(rb.reduce((s,r)=>s+r.valor,0)),liq=R2(bruto+aj+reemb);let id;
 db.exec('BEGIN');try{const r=db.prepare('INSERT INTO fechamentos(prof_id,ano,mes,qtd,horas,valor_hora,bruto,ajuste,reembolso,liquido,criado) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(prof_id,ano,mes,l.length,m/60,l.length?l[0].valor_hora:(u.valor_hora||0),bruto,aj,reemb,liq,now());id=Number(r.lastInsertRowid);
  if(l.length)db.prepare("UPDATE atend SET fech_id=?,status='Fechado' WHERE id IN ("+l.map(a=>a.id).join(',')+")").run(id);
  if(rb.length)db.prepare('UPDATE reembolsos SET fech_id=? WHERE id IN ('+rb.map(x=>x.id).join(',')+')').run(id);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}
 audit(c.u,'fechamento',id,c.ip);return{id,qtd:l.length,horas:m/60,bruto,ajuste:aj,reembolso:reemb,reembolsos:rb.length,liquido:liq}});
R('POST','/api/fechamentos/:id/pagar',['admin'],c=>{const r=db.prepare('UPDATE fechamentos SET status=?,pago_em=? WHERE id=? AND pago_em IS NULL').run('Pago',now(),c.params.id);if(!r.changes)throw E(409,'Já pago ou inexistente.');audit(c.u,'pagamento',c.params.id,c.ip);return{ok:1}});
R('GET','/api/fechamentos',['admin'],()=>db.prepare('SELECT f.*,u.nome prof FROM fechamentos f JOIN users u ON u.id=f.prof_id ORDER BY ano DESC,mes DESC').all());
R('GET','/api/audit',['admin'],()=>db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 300').all());
/* ---------- comparação e evolução das campanhas ---------- */
R('GET','/api/campaigns/compare',['admin','cliente'],c=>{const cid=c.u.role==='cliente'?c.u.client_id:+c.q.get('client_id');
 return db.prepare('SELECT * FROM campaigns WHERE client_id=? ORDER BY criado,id').all(cid).map(k=>{const r=results(k);return{id:k.id,nome:k.nome,data:k.criado.slice(0,10),respostas:r.respostas,participacao:r.participacao,insuficiente:!!r.insuficiente,indice:r.insuficiente?null:+(r.categorias.reduce((a,x)=>a+x.risco,0)/r.categorias.length).toFixed(2),categorias:r.insuficiente?[]:r.categorias.map(x=>({categoria:x.categoria,risco:x.risco}))}})});
/* ---------- acesso excepcional a prontuário: justificativa + autorização de outra pessoa + prazo + auditoria ---------- */
R('GET','/api/indice-prontuarios',['admin'],c=>{audit(c.u,'indice_prontuarios','',c.ip);return db.prepare('SELECT id,client_id,especialidade,aberto_em,situacao FROM prontuarios ORDER BY id DESC').all()});
R('POST','/api/excecoes',['admin'],c=>{need(c,'pront_id','justificativa');if(String(c.body.justificativa).trim().length<30)throw E(400,'Justifique com pelo menos 30 caracteres (finalidade e base legal).');if(!db.prepare('SELECT 1 FROM prontuarios WHERE id=?').get(c.body.pront_id))throw E(404,'Prontuário não encontrado.');
 const r=db.prepare('INSERT INTO excecoes(pront_id,admin_id,justificativa,criado) VALUES(?,?,?,?)').run(c.body.pront_id,c.u.id,String(c.body.justificativa).trim(),now());audit(c.u,'excecao_solicitada',r.lastInsertRowid+':p'+c.body.pront_id,c.ip);return{id:Number(r.lastInsertRowid)}});
R('GET','/api/excecoes',['admin','psicologo','assistente_social'],c=>{const adm=c.u.role==='admin';return db.prepare(`SELECT e.*,p.client_id,p.especialidade FROM excecoes e JOIN prontuarios p ON p.id=e.pront_id ${adm?'':'WHERE p.prof_id='+c.u.id+" AND p.especialidade='"+c.u.role+"'"} ORDER BY e.id DESC`).all().map(e=>({...e,meu:e.admin_id===c.u.id,expirada:!!e.expira&&e.expira<now()}))});
R('PATCH','/api/excecoes/:id',['admin','psicologo','assistente_social'],c=>{const e=db.prepare('SELECT e.*,p.prof_id,p.especialidade FROM excecoes e JOIN prontuarios p ON p.id=e.pront_id WHERE e.id=?').get(c.params.id);if(!e)throw E(404,'Solicitação não encontrada.');
 const ok=c.u.role==='admin'?e.admin_id!==c.u.id:(e.prof_id===c.u.id&&e.especialidade===c.u.role);if(!ok){audit(c.u,'excecao_decisao_negada',e.id,c.ip,0);throw E(403,'Você não pode decidir esta solicitação (quem pede não autoriza).')}
 if(e.status!=='Pendente')throw E(409,'Solicitação já decidida.');if(!['Autorizado','Negado'].includes(c.body.decisao))throw E(400,'Decisão inválida.');
 db.prepare('UPDATE excecoes SET status=?,decidido_por=?,decidido_em=?,expira=? WHERE id=?').run(c.body.decisao,c.u.id,now(),c.body.decisao==='Autorizado'?new Date(Date.now()+24*36e5).toISOString():null,e.id);audit(c.u,'excecao_'+c.body.decisao.toLowerCase(),e.id,c.ip);return{ok:1}});
R('GET','/api/excecoes/:id/prontuario',['admin'],c=>{const e=db.prepare('SELECT * FROM excecoes WHERE id=?').get(c.params.id);if(!e||e.admin_id!==c.u.id||e.status!=='Autorizado'){audit(c.u,'excecao_leitura_negada',c.params.id,c.ip,0);throw E(403,'Sem autorização vigente para este prontuário.')}
 if(e.expira<now()){audit(c.u,'excecao_leitura_negada',e.id+':expirada',c.ip,0);throw E(403,'Autorização expirada (validade de 24 horas).')}
 const p=db.prepare('SELECT * FROM prontuarios WHERE id=?').get(e.pront_id);audit(c.u,'acesso_excepcional_lido',e.id+':p'+p.id,c.ip);
 return{id:p.id,colaborador:dec(p.colab_enc),especialidade:p.especialidade,aberto_em:p.aberto_em,situacao:p.situacao,expira:e.expira,justificativa:e.justificativa,relatos:db.prepare('SELECT * FROM relatos WHERE pront_id=? ORDER BY id').all(p.id).map(r=>({id:r.id,texto:dec(r.texto_enc),criado_em:r.criado_em,alterado_em:r.alterado_em,versao:r.versao}))}});
/* ---------- direitos do titular (LGPD art. 18) e retenção ---------- */
const DIREITOS=['Confirmação de tratamento','Acesso aos dados','Correção de dados','Anonimização, bloqueio ou eliminação','Portabilidade','Informação sobre compartilhamento','Revogação de consentimento','Revisão de decisão automatizada'];
R('GET','/api/public/direitos',null,()=>DIREITOS);
R('POST','/api/public/titular',null,c=>{need(c,'tipo','nome','contato');if(!DIREITOS.includes(c.body.tipo))throw E(400,'Tipo inválido');const k='ti|'+c.ip,t=tries.get(k)||{n:0,until:0};if(t.until>Date.now())throw E(429,'Muitos pedidos. Tente mais tarde.');t.n++;if(t.n>=5){t.until=Date.now()+36e5;t.n=0}tries.set(k,t);
 const proto='LGPD-'+new Date().getFullYear()+'-'+crypto.randomBytes(4).toString('hex').toUpperCase();db.prepare('INSERT INTO titulares(protocolo,tipo,nome_enc,contato_enc,detalhe_enc,prazo,criado) VALUES(?,?,?,?,?,?,?)').run(proto,c.body.tipo,enc(String(c.body.nome).slice(0,200)),enc(String(c.body.contato).slice(0,200)),enc(String(c.body.detalhe||'').slice(0,2000)),new Date(Date.now()+15*864e5).toISOString().slice(0,10),now());return{protocolo:proto,mensagem:'Solicitação registrada. Responderemos em até 15 dias.'}});
R('GET','/api/titulares',['admin'],c=>{audit(c.u,'titulares_lidos','',c.ip);return db.prepare('SELECT * FROM titulares ORDER BY id DESC').all().map(t=>({id:t.id,protocolo:t.protocolo,tipo:t.tipo,nome:dec(t.nome_enc),contato:dec(t.contato_enc),detalhe:dec(t.detalhe_enc),status:t.status,resposta:t.resposta,prazo:t.prazo,criado:t.criado,atrasada:t.status!=='Atendida'&&t.status!=='Negada'&&t.prazo<now().slice(0,10)}))});
R('PATCH','/api/titulares/:id',['admin'],c=>{if(!['Recebida','Em análise','Atendida','Negada'].includes(c.body.status))throw E(400,'Status inválido');if(['Atendida','Negada'].includes(c.body.status)&&!String(c.body.resposta||'').trim())throw E(400,'Registre a resposta ao titular.');
 db.prepare('UPDATE titulares SET status=?,resposta=COALESCE(?,resposta) WHERE id=?').run(c.body.status,c.body.resposta||null,c.params.id);audit(c.u,'titular_'+c.body.status,c.params.id,c.ip);return{ok:1}});
const anosRet=()=>+(db.prepare("SELECT v FROM settings WHERE k='retencao_anos'").get()||{v:5}).v;
R('GET','/api/retencao',['admin'],()=>{const a=anosRet(),lim=new Date(Date.now()-a*365.25*864e5).toISOString();return{anos:a,elegiveis:db.prepare("SELECT id,client_id,especialidade,encerrado_em FROM prontuarios WHERE situacao='Encerrado' AND encerrado_em<?").all(lim),aviso:'Nenhuma eliminação é automática: exige justificativa, autorização e conferência com a regra do conselho profissional.'}});
R('PUT','/api/retencao',['admin'],c=>{const a=+c.body.anos;if(!(a>=1&&a<=50))throw E(400,'Informe de 1 a 50 anos.');db.prepare("INSERT INTO settings VALUES('retencao_anos',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(String(a));audit(c.u,'retencao_alterada',a,c.ip);return{ok:1}});
/* ---------- exportações (XLSX / PDF) ---------- */
const X=require('./export');
const XL='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const FX=(c,name,sheets)=>{audit(c.u,'exportacao',name,c.ip);return{file:{name,mime:XL,buf:X.xlsx(sheets)}}};
const lvl=v=>v<2.5?'Baixo':v<3.2?'Moderado':v<3.8?'Alto':'Crítico';
const RL={admin:'Administrador',psicologo:'Psicólogo(a)',assistente_social:'Assistente social',outro:'Outro'};
const resRows=(p,emp)=>p.insuficiente?[[emp,p.campanha,'(oculto: menos de '+MIN_N+' respostas)']]:p.categorias.map(c=>[emp,p.campanha,c.categoria,c.media,c.risco,lvl(c.risco),...c.distribuicao]);
const RC=[{h:'Empresa',w:24},{h:'Campanha',w:26},{h:'Categoria',w:28},{h:'Média das respostas',t:'n'},{h:'Índice de risco/atenção (1-5)',t:'n'},{h:'Nível',w:12},{h:'Resp. 1',t:'n',w:9},{h:'Resp. 2',t:'n',w:9},{h:'Resp. 3',t:'n',w:9},{h:'Resp. 4',t:'n',w:9},{h:'Resp. 5',t:'n',w:9}];
function clientData(cid){const cl=db.prepare('SELECT fantasia,razao FROM clients WHERE id=?').get(cid);if(!cl)throw E(404,'Cliente não encontrado');
 const ps=db.prepare('SELECT * FROM campaigns WHERE client_id=? ORDER BY id').all(cid).map(k=>({...results(k),validade:k.validade})),
 at=db.prepare("SELECT substr(data,1,7) mes,COUNT(*) qtd FROM atend WHERE client_id=? AND status IN ('Aprovado','Fechado') GROUP BY 1 ORDER BY 1").all(cid).map(a=>({mes:a.mes,qtd:a.qtd<3?'<3':a.qtd}));return{cl,ps,at}}
const cidOf=c=>c.u.role==='cliente'?c.u.client_id:+c.q.get('client_id');
R('GET','/api/export/clientes.xlsx',['admin'],c=>FX(c,'clientes.xlsx',[{nome:'Clientes',cols:[{h:'CNPJ',w:20},{h:'Razão social',w:34},{h:'Nome fantasia',w:26},{h:'Responsável',w:24},{h:'Contato',w:28},{h:'Endereço',w:36},{h:'Mensalidade',t:'m'},{h:'Valor do km',t:'m'},{h:'Situação',w:10},{h:'Cadastro',t:'d'}],rows:db.prepare('SELECT * FROM clients ORDER BY fantasia').all().map(k=>[k.cnpj,k.razao,k.fantasia,k.responsavel,k.contato,k.endereco,k.mensalidade,k.valor_km,k.ativo?'Ativo':'Inativo',k.criado])}]));
R('GET','/api/export/pesquisas.xlsx',['admin'],c=>{const ks=db.prepare('SELECT c.*,cl.fantasia FROM campaigns c JOIN clients cl ON cl.id=c.client_id ORDER BY c.id').all(),rs=ks.map(k=>({k,r:results(k)}));
 return FX(c,'pesquisas.xlsx',[{nome:'Campanhas',cols:[{h:'Campanha',w:28},{h:'Empresa',w:26},{h:'Criada em',t:'d'},{h:'Validade',t:'d'},{h:'Convidados',t:'n'},{h:'Respostas',t:'n'},{h:'Participação (%)',t:'n'},{h:'Participação única'}],rows:rs.map(({k,r})=>[k.nome,k.fantasia,k.criado,k.validade,k.convidados,r.respostas,r.participacao,k.unica?'Sim':'Não'])},{nome:'Resultados consolidados',cols:RC,rows:rs.flatMap(({k,r})=>resRows(r,k.fantasia))}])});
R('GET','/api/export/atendimentos.xlsx',['admin','psicologo','assistente_social'],c=>{const adm=c.u.role==='admin',l=db.prepare(`SELECT a.*,u.nome prof,u.role prole,cl.fantasia emp FROM atend a JOIN users u ON u.id=a.prof_id JOIN clients cl ON cl.id=a.client_id ${adm?'':'WHERE a.prof_id='+c.u.id} ORDER BY a.data,a.inicio`).all(),g={};
 l.forEach(a=>{const o=g[a.prof_id]??={n:a.prof,r:RL[a.prole],q:0,m:0,v:0,p:0,ap:0,c:0,vh:a.valor_hora};if(a.status==='Cancelado')o.c++;else{o.q++;o.m+=a.minutos;o.v+=a.total;a.status==='Pendente de validação'?o.p++:o.ap++}});
 return FX(c,'atendimentos.xlsx',[{nome:'Atendimentos',cols:[{h:'Data',t:'d'},{h:'Início',w:9},{h:'Término',w:9},{h:'Duração (h)',t:'n'},{h:'Profissional',w:24},{h:'Categoria',w:18},{h:'Empresa',w:24},{h:'Tipo',w:16},{h:'Situação',w:20},{h:'Valor da hora',t:'m'},{h:'Total a pagar',t:'m'}],rows:l.map(a=>[a.data,a.inicio,a.fim,a.minutos/60,a.prof,RL[a.prole],a.emp,a.tipo,a.status,a.valor_hora,a.total])},
  {nome:'Controle de horas',cols:[{h:'Profissional',w:24},{h:'Categoria',w:18},{h:'Atendimentos',t:'n'},{h:'Horas',t:'n'},{h:'Valor da hora',t:'m'},{h:'Total a pagar',t:'m'},{h:'Pendentes',t:'n'},{h:'Aprovados',t:'n'},{h:'Cancelados',t:'n'}],rows:Object.values(g).map(o=>[o.n,o.r,o.q,o.m/60,o.vh,o.v,o.p,o.ap,o.c])}])});
R('GET','/api/export/fechamentos.xlsx',['admin'],c=>{const l=db.prepare('SELECT f.*,u.nome prof,u.role prole FROM fechamentos f JOIN users u ON u.id=f.prof_id ORDER BY ano,mes,u.nome').all(),cols=[{h:'Profissional',w:24},{h:'Categoria',w:18},{h:'Período',w:10},{h:'Atendimentos',t:'n'},{h:'Horas',t:'n'},{h:'Valor da hora',t:'m'},{h:'Total bruto',t:'m'},{h:'Ajustes',t:'m'},{h:'Reembolsos de km',t:'m'},{h:'Valor líquido',t:'m'},{h:'Situação',w:12},{h:'Pago em',t:'d'}],row=f=>[f.prof,RL[f.prole],String(f.mes).padStart(2,'0')+'/'+f.ano,f.qtd,f.horas,f.valor_hora,f.bruto,f.ajuste,f.reembolso||0,f.liquido,f.pago_em?'Pago':'A pagar',f.pago_em];
 return FX(c,'fechamentos.xlsx',[{nome:'Fechamentos',cols,rows:l.map(row)},{nome:'Histórico de pagamentos',cols,rows:l.filter(f=>f.pago_em).map(row)}])});
R('GET','/api/export/fechamento/:id.xlsx',['admin','psicologo','assistente_social'],c=>{const f=db.prepare('SELECT f.*,u.nome prof FROM fechamentos f JOIN users u ON u.id=f.prof_id WHERE f.id=?').get(c.params.id);if(!f||(c.u.role!=='admin'&&f.prof_id!==c.u.id))throw E(404,'Fechamento não encontrado');
 const l=db.prepare('SELECT a.*,cl.fantasia emp FROM atend a JOIN clients cl ON cl.id=a.client_id WHERE a.fech_id=? ORDER BY data,inicio').all(f.id);
 return FX(c,`demonstrativo-${f.ano}-${String(f.mes).padStart(2,'0')}.xlsx`,[{nome:'Resumo',cols:[{h:'Item',w:30},{h:'Valor',w:20}],rows:[['Profissional',f.prof],['Período',String(f.mes).padStart(2,'0')+'/'+f.ano],['Total de atendimentos',f.qtd],['Total de horas',f.horas.toFixed(2)],['Valor contratado por hora','R$ '+f.valor_hora.toFixed(2)],['Total bruto devido','R$ '+f.bruto.toFixed(2)],['Ajustes/descontos','R$ '+f.ajuste.toFixed(2)],['Reembolsos de km aprovados','R$ '+(f.reembolso||0).toFixed(2)],['Valor líquido a pagar','R$ '+f.liquido.toFixed(2)],['Situação',f.pago_em?'Pago em '+f.pago_em.slice(0,10):'Pagamento pendente']]},{nome:'Atendimentos',cols:[{h:'Data',t:'d'},{h:'Início'},{h:'Término'},{h:'Duração (h)',t:'n'},{h:'Empresa',w:24},{h:'Tipo',w:16},{h:'Valor da hora',t:'m'},{h:'Total',t:'m'}],rows:l.map(a=>[a.data,a.inicio,a.fim,a.minutos/60,a.emp,a.tipo,a.valor_hora,a.total])},
  {nome:'Reembolsos de km',cols:[{h:'Data',t:'d'},{h:'Empresa',w:24},{h:'Descrição',w:50},{h:'Km',t:'n'},{h:'Valor do km',t:'m'},{h:'Valor',t:'m'}],rows:db.prepare('SELECT r.*,cl.fantasia emp FROM reembolsos r JOIN clients cl ON cl.id=r.client_id WHERE r.fech_id=? ORDER BY r.data,r.id').all(f.id).map(r=>[r.data,r.emp,r.descricao,r.km,r.valor_km,r.valor])}])});
/* ---------- DRE: resultado depois dos impostos, por período e por cliente ----------
   Só entram meses de clientes JÁ FECHADOS (Fechado ou Faturado). Receita = mensalidade + reembolsos/despesas repassados;
   custo = honorários dos atendimentos do mês + reembolsos pagos aos profissionais (gravados no momento do fechamento do cliente).
   Alíquotas configuráveis (padrão: Lucro Presumido para serviços). O padrão é uma estimativa: confirme com a contabilidade. */
const IMP_PAD={regime:'presumido',pis:0.65,cofins:3,iss:5,presuncao:32,irpj:15,irpj_adic:10,irpj_adic_limite:20000,csll:9,simples:6,simples_prog:false,sobre_reembolsos:false};
/* Simples Nacional – Anexo III (serviços; vale se o Fator R ≥ 28%): alíquota efetiva = (RBT12 × nominal − parcela a deduzir) ÷ RBT12.
   RBT12 = receita dos 12 meses anteriores; no 1º ano, a média dos meses de atividade × 12 (no 1º mês, a própria receita × 12). Só é usada quando simples_prog está ligado. */
const SIMPLES_III=[[180000,6,0],[360000,11.2,9360],[720000,13.5,17640],[1800000,16,35640],[3600000,21,125640],[4800000,33,648000]];
const simplesEfetiva=rbt=>{const f=SIMPLES_III.find(x=>rbt<=x[0])||SIMPLES_III[SIMPLES_III.length-1];return rbt>0?Math.max(0,(rbt*f[1]/100-f[2])/rbt*100):f[1]};
function simplesTaxas(imp){const rm={};for(const r of db.prepare('SELECT ano*100+mes k,SUM(mensalidade'+(imp.sobre_reembolsos?'+despesas':'')+') v FROM faturamentos GROUP BY k').all())rm[r.k]=r.v;
 const ks=Object.keys(rm).map(Number).sort((a,b)=>a-b),mi=k=>Math.floor(k/100)*12+k%100-1,out={};if(!ks.length)return out;const F=mi(ks[0]);
 for(const k of ks){const n=Math.min(12,mi(k)-F);let rbt;if(n<=0)rbt=rm[k]*12;else{let t=0;for(const q of ks)if(mi(q)<mi(k)&&mi(q)>=mi(k)-n)t+=rm[q];rbt=t/n*12}out[k]=Math.round(simplesEfetiva(rbt)*10000)/10000}return out}
const getImp=()=>{let o={};try{o=JSON.parse((db.prepare("SELECT v FROM settings WHERE k='impostos'").get()||{v:'{}'}).v)}catch(e){}return{...IMP_PAD,...o}};
R('GET','/api/dre/config',['admin'],()=>({config:getImp(),padrao:IMP_PAD}));
R('PUT','/api/dre/config',['admin'],c=>{const b=c.body,o={regime:b.regime==='simples'?'simples':'presumido',simples_prog:b.simples_prog===true||b.simples_prog===1||b.simples_prog==='1',sobre_reembolsos:b.sobre_reembolsos===true||b.sobre_reembolsos===1||b.sobre_reembolsos==='1'},
 NM={pis:'PIS',cofins:'COFINS',iss:'ISS',presuncao:'presunção',irpj:'IRPJ',irpj_adic:'adicional de IRPJ',csll:'CSLL',simples:'Simples Nacional'};
 for(const k of Object.keys(NM)){const n=+String(b[k]??IMP_PAD[k]).replace(',','.');if(!Number.isFinite(n)||n<0||n>100)throw E(400,'Alíquota inválida ('+NM[k]+'): informe um percentual de 0 a 100.');o[k]=Math.round(n*10000)/10000}
 const l=+String(b.irpj_adic_limite??IMP_PAD.irpj_adic_limite).replace(',','.');if(!Number.isFinite(l)||l<0||l>1e9)throw E(400,'Limite mensal do adicional de IRPJ inválido.');o.irpj_adic_limite=R2(l);
 db.prepare("INSERT INTO settings VALUES('impostos',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(JSON.stringify(o));audit(c.u,'impostos_config',o.regime,c.ip);return{ok:1,config:o}});
const DRE_K=['mensalidades','reembolsos','outras','receita_bruta','pis','cofins','iss','das','deducoes','receita_liquida','custo_prof','custo_reembolsos','custo_outras','resultado_antes_ir','base_presumida','irpj','irpj_adic','csll','ir_total','resultado_liquido','atendimentos'];
const dreZero=()=>Object.fromEntries(DRE_K.map(k=>[k,0]));
const dreSoma=l=>{const t=dreZero();for(const x of l)for(const k of DRE_K)t[k]=R2(t[k]+(x[k]||0));return t};
const dreMargem=L=>L.receita_liquida>0?Math.round(L.resultado_liquido/L.receita_liquida*1000)/10:0;
/* uma linha = um cliente em um mês fechado */
function dreLinha(f,imp,tx){const mens=f.mensalidade||0,rb=f.reembolsos||0,L=dreZero();
 L.mensalidades=R2(mens);L.reembolsos=R2(rb);L.outras=Math.max(0,R2((f.despesas||0)-rb));L.receita_bruta=R2(L.mensalidades+L.reembolsos+L.outras);
 const base=R2(mens+(imp.sobre_reembolsos?L.reembolsos+L.outras:0));
 if(imp.regime==='simples')L.das=R2(base*(tx??imp.simples)/100);
 else{L.pis=R2(base*imp.pis/100);L.cofins=R2(base*imp.cofins/100);L.iss=R2(base*imp.iss/100);L.base_presumida=R2(base*imp.presuncao/100);L.irpj=R2(L.base_presumida*imp.irpj/100);L.csll=R2(L.base_presumida*imp.csll/100)}
 L.deducoes=R2(L.pis+L.cofins+L.iss+L.das);L.receita_liquida=R2(L.receita_bruta-L.deducoes);
 L.custo_prof=R2(f.custo_prof||0);L.custo_reembolsos=L.reembolsos;L.custo_outras=L.outras;
 L.resultado_antes_ir=R2(L.receita_liquida-L.custo_prof-L.custo_reembolsos-L.custo_outras);return L}
function dreDemo(T,imp){const sim=imp.regime==='simples',N=v=>R2(-v),L=[],add=(l,v,tipo)=>L.push({l,v,tipo});
 add('Receita bruta de serviços (mensalidades)',T.mensalidades,'item');add('(+) Reembolsos de km repassados aos clientes',T.reembolsos,'item');add('(+) Outras despesas repassadas (pedágios etc.)',T.outras,'item');
 add('(=) RECEITA BRUTA',T.receita_bruta,'tot');
 if(sim)add('(−) Simples Nacional (DAS)',N(T.das),'ded');else{add('(−) PIS',N(T.pis),'ded');add('(−) COFINS',N(T.cofins),'ded');add('(−) ISS',N(T.iss),'ded')}
 add('(=) RECEITA LÍQUIDA',T.receita_liquida,'tot');
 add('(−) Honorários dos profissionais (atendimentos)',N(T.custo_prof),'ded');add('(−) Reembolsos de km pagos aos profissionais',N(T.custo_reembolsos),'ded');add('(−) Outras despesas repassadas (custo)',N(T.custo_outras),'ded');
 add(sim?'(=) RESULTADO OPERACIONAL (após o DAS)':'(=) RESULTADO ANTES DO IRPJ E DA CSLL',T.resultado_antes_ir,'tot');
 if(!sim){add('(−) IRPJ',N(T.irpj),'ded');add('(−) Adicional de IRPJ',N(T.irpj_adic),'ded');add('(−) CSLL',N(T.csll),'ded')}
 add('(=) RESULTADO LÍQUIDO (após os impostos)',T.resultado_liquido,'res');return L}
function dreCalc(de,ate){const imp=getImp(),a=+de.replace('-',''),b=+ate.replace('-',''),
 rows=db.prepare('SELECT f.*,c.fantasia FROM faturamentos f JOIN clients c ON c.id=f.client_id WHERE f.ano*100+f.mes BETWEEN ? AND ? ORDER BY f.ano,f.mes,c.fantasia').all(a,b),g={},lin=[];
 const TX=imp.regime==='simples'&&imp.simples_prog?simplesTaxas(imp):{};
 for(const f of rows)(g[f.ano*100+f.mes]??=[]).push({f,L:dreLinha(f,imp,TX[f.ano*100+f.mes])});
 for(const k of Object.keys(g).sort()){const m=g[k];
  if(imp.regime!=='simples'){/* adicional de IRPJ: calculado sobre a base presumida do MÊS da empresa e rateado entre os clientes na proporção da base */
   const bt=R2(m.reduce((s,x)=>s+x.L.base_presumida,0)),ad=R2(Math.max(0,bt-imp.irpj_adic_limite)*imp.irpj_adic/100);let rest=ad;
   m.forEach((x,i)=>{let v;if(i===m.length-1)v=rest;else{v=bt>0?R2(ad*x.L.base_presumida/bt):0;rest=R2(rest-v)}x.L.irpj_adic=R2(v)})}
  for(const x of m){const L=x.L;L.ir_total=R2(L.irpj+L.irpj_adic+L.csll);L.resultado_liquido=R2(L.resultado_antes_ir-L.ir_total);L.atendimentos=x.f.qtd_atend||0;lin.push({f:x.f,L})}}
 const grp=(kf,mk)=>{const o={};for(const x of lin)(o[kf(x)]??={meta:mk(x),l:[]}).l.push(x.L);return Object.values(o).map(e=>{const T=dreSoma(e.l);return{...e.meta,...T,margem_liquida:dreMargem(T)}})},
  T=dreSoma(lin.map(x=>x.L));
 return{de,ate,config:imp,fechamentos:lin.length,total:{...T,margem_liquida:dreMargem(T)},demonstrativo:dreDemo(T,imp),
  porCliente:grp(x=>x.f.client_id,x=>({client_id:x.f.client_id,cliente:x.f.fantasia})).sort((p,q)=>q.resultado_liquido-p.resultado_liquido),
  porMes:grp(x=>x.f.ano*100+x.f.mes,x=>({ano:x.f.ano,mes:x.f.mes}))}}
const drePer=c=>{const mm=/^\d{4}-(0[1-9]|1[0-2])$/,de=c.q.get('de')||brHoje().slice(0,7),ate=c.q.get('ate')||de;if(!mm.test(de)||!mm.test(ate))throw E(400,'Período inválido.');if(de>ate)throw E(400,'O mês inicial deve ser anterior ou igual ao final.');
 if((+ate.slice(0,4)-+de.slice(0,4))*12+(+ate.slice(5)-+de.slice(5))+1>60)throw E(400,'Escolha no máximo 60 meses.');return[de,ate]};
R('GET','/api/dre',['admin'],c=>{const[de,ate]=drePer(c);return dreCalc(de,ate)});
R('GET','/api/export/dre.xlsx',['admin'],c=>{const[de,ate]=drePer(c),d=dreCalc(de,ate),per=de===ate?de:de+'-a-'+ate,
 lin=x=>[x.receita_bruta,x.deducoes,x.receita_liquida,x.custo_prof,x.custo_reembolsos,x.custo_outras,x.resultado_antes_ir,x.ir_total,x.resultado_liquido,x.margem_liquida],
 cols=[{h:'Receita bruta',t:'m'},{h:'Impostos sobre a receita',t:'m'},{h:'Receita líquida',t:'m'},{h:'Honorários dos profissionais',t:'m'},{h:'Reembolsos de km pagos',t:'m'},{h:'Outras despesas repassadas',t:'m'},{h:'Resultado antes de IRPJ/CSLL',t:'m'},{h:'IRPJ + CSLL',t:'m'},{h:'Resultado líquido',t:'m'},{h:'Margem líquida (%)',t:'n'}];
 return FX(c,`dre-${per}.xlsx`,[{nome:'DRE',cols:[{h:'Descrição',w:58},{h:'Valor (R$)',t:'m'}],rows:[...d.demonstrativo.map(x=>[x.l,x.v]),['Margem líquida sobre a receita líquida: '+String(d.total.margem_liquida).replace('.',',')+'%',null],['Regime de impostos usado: '+(d.config.regime==='simples'?'Simples Nacional':'Lucro Presumido')+' (estimativa: confirme com a contabilidade)',null]]},
  {nome:'Por cliente',cols:[{h:'Cliente',w:30},...cols],rows:d.porCliente.map(x=>[x.cliente,...lin(x)])},
  {nome:'Por mês',cols:[{h:'Mês',w:10},...cols],rows:d.porMes.map(x=>[String(x.mes).padStart(2,'0')+'/'+x.ano,...lin(x)])}])});
/* Relatório gerencial do cliente: só dados agregados, nunca nomes, relatos ou prontuários */
R('GET','/api/export/relatorio-cliente.xlsx',['admin','cliente'],c=>{const{cl,ps,at}=clientData(cidOf(c));
 return FX(c,'relatorio-gerencial.xlsx',[{nome:'Resumo das pesquisas',cols:[{h:'Campanha',w:28},{h:'Convidados',t:'n'},{h:'Respostas',t:'n'},{h:'Participação (%)',t:'n'},{h:'Índice geral de risco',t:'n'},{h:'Nível',w:12}],rows:ps.map(p=>{const m=p.insuficiente?null:p.categorias.reduce((a,x)=>a+x.risco,0)/p.categorias.length;return[p.campanha,p.convidados,p.respostas,p.participacao,m,m==null?'Oculto (n<'+MIN_N+')':lvl(m)]})},{nome:'Resultados por categoria',cols:RC,rows:ps.flatMap(p=>resRows(p,cl.fantasia))},{nome:'Atendimentos por mês',cols:[{h:'Mês',w:12},{h:'Atendimentos realizados',t:'n',w:22}],rows:at.map(a=>[a.mes.slice(5)+'/'+a.mes.slice(0,4),a.qtd])}])});
R('GET','/api/export/relatorio-cliente.pdf',['admin','cliente'],c=>{const{cl,ps,at}=clientData(cidOf(c)),d=new X.Doc();audit(c.u,'exportacao','relatorio-cliente.pdf',c.ip);
 const COL=v=>v<2.5?[0.18,0.71,0.45]:v<3.2?[0.95,0.76,0.19]:v<3.8?[0.93,0.54,0.17]:[0.85,0.22,0.17],GR=[0.32,0.4,0.48],NAVY=[0.02,0.18,0.34],fmt=v=>v.toFixed(2).replace('.',','),cut=t=>t.length>30?t.slice(0,28)+'...':t;
 d.band('Relatório gerencial',cl.fantasia+'   |   '+new Date().toLocaleDateString('pt-BR'));
 d.line('Indicadores consolidados de pesquisas e atendimentos. Os dados são agregados e anônimos: não contêm nomes, relatos ou informações de prontuários.',12,false,50,1.5,GR);d.y-=6;
 ps.forEach((p,i)=>{if(i>0){d.pageBreak()}const rot=p.metrica==='risco'?'risco':'atenção';d.h(p.campanha,19);
  if(p.insuficiente){d.kpi4([[String(p.respostas),'Respostas',NAVY],[p.convidados?String(p.convidados):'-','Convidados',NAVY]]);d.line(p.aviso,12,false,50,1.5,[0.6,0.3,0]);return}
  const c2=p.categorias.slice().sort((a,b)=>b.risco-a.risco),m=c2.reduce((a,x)=>a+x.risco,0)/c2.length;
  d.kpi4([[String(p.respostas),'Respostas',NAVY],[p.participacao!=null?p.participacao+'%':'-','Participação',NAVY],[fmt(m),'Índice de '+rot,COL(m)],[lvl(m),'Nível geral',COL(m)]]);
  d.h('Resultado por categoria',14);c2.forEach(x=>d.bar(cut(x.categoria),x.risco));d.legend();
  const at2=c2.filter(x=>x.risco>=3.2);d.h('Pontos de atenção',14);
  if(at2.length)at2.forEach(x=>d.dot(COL(x.risco),x.categoria+'  -  '+lvl(x.risco)+' ('+fmt(x.risco)+')'));else d.line('Nenhuma categoria em nível alto ou crítico.',12)});
 if(!ps.length)d.line('Nenhuma pesquisa realizada até o momento.',12);
 d.pageBreak();d.h('Atendimentos realizados por mês',19);
 if(at.length){const mx=Math.max(1,...at.map(a=>+a.qtd||0));at.forEach(a=>d.count(a.mes.slice(5)+'/'+a.mes.slice(0,4),a.qtd,mx))}else d.line('Sem atendimentos registrados.',12);
 d.y-=16;d.line('Como ler: escala de 1 a 5. Quanto maior o índice, maior o risco ou a necessidade de atenção. Pesquisas com menos de '+MIN_N+' respostas e meses com menos de 3 atendimentos são ocultados para evitar a identificação de pessoas. Este relatório apoia o gerenciamento de riscos psicossociais (GRO/PGR) e não comprova, isoladamente, conformidade com a NR-1.',10.5,false,50,1.5,GR);
 return{file:{name:'relatorio-gerencial.pdf',mime:'application/pdf',buf:d.build('Acella - '+cl.fantasia)}}});
/* ---------- despesas variáveis e faturamento por cliente (mensalidade + km + pedágios + atendimentos) ---------- */
const TIPOS_DESP={km:'Km rodado (reembolso de km)',pedagio:'Pedágio',outra:'Outra despesa'};
const fmtBRL=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}).replace(/\u00a0/g,' ');
const dtBR=s=>s?String(s).slice(0,10).split('-').reverse().join('/'):'';
const ymOf=(a,m)=>a+'-'+String(m).padStart(2,'0');
const getCl=id=>{const cl=db.prepare('SELECT * FROM clients WHERE id=?').get(id);if(!cl)throw E(400,'Cliente inválido.');return cl};
const fatDoMes=(cid,ym)=>db.prepare('SELECT * FROM faturamentos WHERE client_id=? AND ano=? AND mes=?').get(cid,+ym.slice(0,4),+ym.slice(5,7));
R('GET','/api/despesas',['admin'],c=>{const cid=+c.q.get('client_id')||0,ab=c.q.get('abertas')==='1',ym=c.q.get('mes')||'';
 return db.prepare(`SELECT d.*,cl.fantasia FROM despesas d JOIN clients cl ON cl.id=d.client_id WHERE 1=1${cid?' AND d.client_id='+cid:''}${ab?' AND d.fat_id IS NULL':''}${/^\d{4}-\d\d$/.test(ym)?" AND substr(d.data,1,7)='"+ym+"'":''} ORDER BY d.data DESC,d.id DESC`).all()});
R('POST','/api/despesas',['admin'],c=>{need(c,'client_id','data','tipo');const b=c.body,cl=getCl(b.client_id);
 if(!/^\d{4}-\d\d-\d\d$/.test(b.data))throw E(400,'Data inválida.');if(!TIPOS_DESP[b.tipo])throw E(400,'Tipo de despesa inválido.');
 if(b.tipo==='km')throw E(400,'O reembolso de km é lançado pelo profissional na aba Reembolsos e aprovado pelo administrador. Aqui lance apenas pedágios e outras despesas.');
 if(fatDoMes(cl.id,b.data.slice(0,7)))throw E(423,'O mês desta despesa já foi fechado para este cliente.');
 let km=null,vkm=null,valor;
 if(b.tipo==='km'){km=num(b.km,1e5);if(!(km>0))throw E(400,'Informe os km rodados.');vkm=b.valor_km===''||b.valor_km==null?(cl.valor_km||0):num(b.valor_km,1e4,4);if(!(vkm>0))throw E(400,'Informe o valor do km (no cadastro do cliente ou nesta despesa).');valor=Math.round(km*vkm*100)/100}
 else{valor=num(b.valor);if(!(valor>0))throw E(400,'Informe o valor da despesa.')}
 const desc=String(b.descricao||'').trim().slice(0,200)||(b.tipo==='km'?'Km rodado: '+km+' km × '+fmtBRL(vkm):TIPOS_DESP[b.tipo]);
 const r=db.prepare('INSERT INTO despesas(client_id,data,tipo,descricao,km,valor_km,valor,criado,criado_por) VALUES(?,?,?,?,?,?,?,?,?)').run(cl.id,b.data,b.tipo,desc,km,vkm,valor,now(),c.u.id);audit(c.u,'despesa_lancada',r.lastInsertRowid+':'+cl.id,c.ip);return{id:Number(r.lastInsertRowid),valor,descricao:desc}});
R('DELETE','/api/despesas/:id',['admin'],c=>{const d=db.prepare('SELECT * FROM despesas WHERE id=?').get(c.params.id);if(!d)throw E(404,'Despesa não encontrada.');if(d.fat_id)throw E(423,'Despesa já incluída em um fechamento.');
 db.prepare('DELETE FROM despesas WHERE id=?').run(d.id);audit(c.u,'despesa_excluida',d.id,c.ip);return{ok:1}});
/* ---------- reembolsos de km ----------
   Fluxo: o(a) profissional (psicólogo, assistente social ou administrador) LANÇA  →  o administrador APROVA ou rejeita  →
   o reembolso aprovado compõe o FECHAMENTO DO PROFISSIONAL (é pago junto com os honorários)  →
   depois compõe o FECHAMENTO DO CLIENTE, para ser repassado (cobrado) ao cliente.
   O valor é km × valor do km cadastrado no cliente (gravado no lançamento). */
const brHoje=()=>new Date(Date.now()-3*36e5).toISOString().slice(0,10);
const R2=v=>Math.round((+v||0)*100)/100;
const REEMB_SQL='SELECT r.*,u.nome prof,u.role prole,cl.fantasia,f.ano fech_ano,f.mes fech_mes,f.pago_em fech_pago,d.nome decisor,fa.ano fat_ano,fa.mes fat_mes,fa.status fat_status FROM reembolsos r JOIN users u ON u.id=r.prof_id JOIN clients cl ON cl.id=r.client_id LEFT JOIN fechamentos f ON f.id=r.fech_id LEFT JOIN users d ON d.id=r.decidido_por LEFT JOIN faturamentos fa ON fa.id=r.fat_id';
const reembOut=(r,adm)=>{const o={id:r.id,prof_id:r.prof_id,prof:r.prof,prole:r.prole,client_id:r.client_id,fantasia:r.fantasia,data:r.data,km:r.km,valor_km:r.valor_km,valor:r.valor,descricao:r.descricao,status:r.status,motivo:r.motivo,decidido_em:r.decidido_em,decisor:r.decisor,fech_id:r.fech_id,fech_ano:r.fech_ano,fech_mes:r.fech_mes,pago_em:r.fech_pago,criado:r.criado};
 if(adm){o.fat_id=r.fat_id;o.fat_ano=r.fat_ano;o.fat_mes=r.fat_mes;o.fat_status=r.fat_status}return o};
R('GET','/api/reembolsos',PEOPLE,c=>{const adm=c.u.role==='admin',w=[],a=[];
 if(!adm){w.push('r.prof_id=?');a.push(c.u.id)}else{const p=+c.q.get('prof_id')||0;if(p){w.push('r.prof_id=?');a.push(p)}}
 const cid=+c.q.get('client_id')||0;if(cid){w.push('r.client_id=?');a.push(cid)}
 const s=c.q.get('status')||'';if(['Pendente','Aprovado','Rejeitado'].includes(s)){w.push('r.status=?');a.push(s)}
 const ym=c.q.get('mes')||'';if(/^\d{4}-\d\d$/.test(ym)){w.push('substr(r.data,1,7)=?');a.push(ym)}
 return db.prepare(REEMB_SQL+(w.length?' WHERE '+w.join(' AND '):'')+' ORDER BY r.data DESC,r.id DESC').all(...a).map(r=>reembOut(r,adm))});
const reembValida=(c,b,idAtual)=>{const cl=getCl(b.client_id);if(!cl.ativo)throw E(400,'Este cliente está inativo.');
 const dt=String(b.data||'');if(!/^\d{4}-\d\d-\d\d$/.test(dt)||new Date(dt+'T12:00:00Z').toISOString().slice(0,10)!==dt)throw E(400,'Data inválida.');
 if(dt>brHoje())throw E(400,'A data do deslocamento não pode ser futura.');
 const km=num(b.km,1e6);if(!(km>0))throw E(400,'Informe os km rodados.');if(km>5000)throw E(400,'Confira os km informados: o máximo por lançamento é 5.000 km.');
 const vkm=cl.valor_km||0;if(!(vkm>0))throw E(400,'Este cliente não tem valor do km cadastrado. Peça ao administrador para informá-lo em Clientes.');
 const desc=String(b.descricao||'').trim().slice(0,200);if(desc.length<3)throw E(400,'Descreva o deslocamento (origem, destino ou motivo).');
 if(db.prepare("SELECT 1 FROM reembolsos WHERE prof_id=? AND client_id=? AND data=? AND km=? AND status<>'Rejeitado' AND id<>?").get(c.u.id,cl.id,dt,km,idAtual||0))throw E(409,'Você já lançou um reembolso igual (mesmo cliente, data e km).');
 return{cl,km,vkm,valor:R2(km*vkm),desc}};
R('POST','/api/reembolsos',PEOPLE,c=>{need(c,'client_id','data','km');const v=reembValida(c,c.body);
 const r=db.prepare("INSERT INTO reembolsos(prof_id,client_id,data,km,valor_km,valor,descricao,status,criado,alterado) VALUES(?,?,?,?,?,?,?,'Pendente',?,?)").run(c.u.id,v.cl.id,c.body.data,v.km,v.vkm,v.valor,v.desc,now(),now());
 audit(c.u,'reembolso_lancado',r.lastInsertRowid+':'+v.cl.id,c.ip);return{id:Number(r.lastInsertRowid),valor:v.valor,status:'Pendente'}});
const getReemb=id=>{const r=db.prepare('SELECT * FROM reembolsos WHERE id=?').get(id);if(!r)throw E(404,'Reembolso não encontrado.');return r};
R('PATCH','/api/reembolsos/:id',PEOPLE,c=>{const r=getReemb(c.params.id);if(r.prof_id!==c.u.id)throw E(403,'Só quem lançou pode alterar o reembolso.');
 if(r.status==='Aprovado'||r.fech_id)throw E(423,'Reembolso já aprovado: peça ao administrador para desfazer a aprovação antes de alterar.');
 const b={client_id:r.client_id,data:r.data,km:r.km,descricao:r.descricao,...c.body},v=reembValida(c,b,r.id);
 db.prepare("UPDATE reembolsos SET client_id=?,data=?,km=?,valor_km=?,valor=?,descricao=?,status='Pendente',motivo=NULL,decidido_por=NULL,decidido_em=NULL,alterado=? WHERE id=?").run(v.cl.id,b.data,v.km,v.vkm,v.valor,v.desc,now(),r.id);
 audit(c.u,'reembolso_alterado',r.id,c.ip);return{ok:1,valor:v.valor}});
R('DELETE','/api/reembolsos/:id',PEOPLE,c=>{const r=getReemb(c.params.id);if(r.prof_id!==c.u.id&&c.u.role!=='admin')throw E(403,'Sem permissão para excluir este reembolso.');
 if(r.status==='Aprovado'||r.fech_id)throw E(423,'Reembolso aprovado não pode ser excluído. O administrador pode desfazer a aprovação antes.');
 db.prepare('DELETE FROM reembolsos WHERE id=?').run(r.id);audit(c.u,'reembolso_excluido',r.id,c.ip);return{ok:1}});
const reembDecide=(c,r,status,motivo)=>{db.prepare('UPDATE reembolsos SET status=?,motivo=?,decidido_por=?,decidido_em=? WHERE id=?').run(status,motivo||null,c.u.id,now(),r.id);audit(c.u,'reembolso_'+status.toLowerCase(),r.id,c.ip)};
R('POST','/api/reembolsos/aprovar-lote',['admin'],c=>{const ids=Array.isArray(c.body.ids)?c.body.ids.map(Number):null;let n=0,v=0;
 db.exec('BEGIN');try{for(const r of db.prepare("SELECT * FROM reembolsos WHERE status='Pendente'").all()){if(ids&&!ids.includes(r.id))continue;reembDecide(c,r,'Aprovado');n++;v+=r.valor}db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}
 return{aprovados:n,valor:R2(v)}});
R('POST','/api/reembolsos/:id/aprovar',['admin'],c=>{const r=getReemb(c.params.id);if(r.status==='Aprovado')throw E(409,'Reembolso já aprovado.');reembDecide(c,r,'Aprovado');return{ok:1}});
R('POST','/api/reembolsos/:id/rejeitar',['admin'],c=>{const r=getReemb(c.params.id);if(r.status!=='Pendente')throw E(409,'Só é possível rejeitar reembolsos pendentes. Para um já aprovado, desfaça a aprovação antes.');
 const m=String(c.body.motivo||'').trim();if(m.length<5)throw E(400,'Informe o motivo da rejeição (mínimo de 5 caracteres): quem lançou verá a justificativa.');reembDecide(c,r,'Rejeitado',m.slice(0,300));return{ok:1}});
R('POST','/api/reembolsos/:id/desfazer',['admin'],c=>{const r=getReemb(c.params.id);if(r.status!=='Aprovado')throw E(409,'Só reembolsos aprovados podem ter a aprovação desfeita.');if(r.fech_id)throw E(423,'Este reembolso já está em um fechamento de profissional.');
 db.prepare("UPDATE reembolsos SET status='Pendente',motivo=NULL,decidido_por=NULL,decidido_em=NULL WHERE id=?").run(r.id);audit(c.u,'reembolso_aprovacao_desfeita',r.id,c.ip);return{ok:1}});
/* Cálculo do fechamento do cliente: mensalidade + despesas em aberto do mês + quantidade de atendimentos validados */
function faturaCalc(cl,ano,mes){const ym=ymOf(ano,mes),
 desp=db.prepare('SELECT * FROM despesas WHERE client_id=? AND fat_id IS NULL AND substr(data,1,7)=? ORDER BY data,id').all(cl.id,ym),
 at=db.prepare("SELECT tipo,COUNT(*) n,SUM(minutos) m,SUM(total) v FROM atend WHERE client_id=? AND substr(data,1,7)=? AND status IN ('Aprovado','Fechado') GROUP BY tipo").all(cl.id,ym),
 /* reembolsos de km do cliente: entram os APROVADOS que já compõem um fechamento de profissional (do mês ou anterior) e ainda não foram repassados */
 rb=db.prepare("SELECT r.* FROM reembolsos r JOIN fechamentos f ON f.id=r.fech_id WHERE r.client_id=? AND r.status='Aprovado' AND r.fat_id IS NULL AND f.ano*100+f.mes<=? ORDER BY r.data,r.id").all(cl.id,ano*100+mes),
 ag=db.prepare("SELECT COALESCE(SUM(status='Pendente'),0) pend,COALESCE(SUM(status='Aprovado'),0) apr,COALESCE(SUM(valor),0) v FROM reembolsos WHERE client_id=? AND status IN ('Pendente','Aprovado') AND fech_id IS NULL AND substr(data,1,7)<=?").get(cl.id,ym),
 pend=db.prepare("SELECT COUNT(*) n FROM atend WHERE client_id=? AND substr(data,1,7)=? AND status IN ('Pendente de validação','Em andamento')").get(cl.id,ym).n,
 mens=Math.round((cl.mensalidade||0)*100)/100,rbv=R2(rb.reduce((s,r)=>s+r.valor,0)),dsp=R2(desp.reduce((s,d)=>s+d.valor,0)+rbv),custo=R2(at.reduce((s,x)=>s+(x.v||0),0)),
 itens=[{tipo:'mensalidade',data:'',descricao:'Mensalidade – '+String(mes).padStart(2,'0')+'/'+ano,qtd:1,unit:mens,valor:mens},
  ...[...desp.map(d=>({tipo:d.tipo,data:d.data,descricao:d.descricao,qtd:d.km||1,unit:d.km?d.valor_km:d.valor,valor:d.valor,despesa_id:d.id})),
   ...rb.map(r=>({tipo:'km',data:r.data,descricao:'Reembolso de km – '+r.descricao,qtd:r.km,unit:r.valor_km,valor:r.valor,reembolso_id:r.id}))].sort((a,b)=>String(a.data).localeCompare(String(b.data)))],
 q=t=>at.filter(x=>t(x.tipo)).reduce((s,x)=>s+x.n,0),tot=q(()=>true);
 return{client_id:cl.id,cliente:cl.fantasia,razao:cl.razao,cnpj:cl.cnpj,ano,mes,mensalidade:mens,despesas:dsp,reembolsos:rbv,custo_prof:custo,reembolsos_aguardando:{pendentes:ag.pend,aprovados:ag.apr,valor:R2(ag.v)},total:Math.round((mens+dsp)*100)/100,itens,pendentes:pend,
  atendimentos:{total:tot,psicologico:q(t=>t==='Psicológico'),social:q(t=>t==='Social'),outros:q(t=>t!=='Psicológico'&&t!=='Social'),horas:Math.round(at.reduce((s,x)=>s+(x.m||0),0)/60*100)/100}}}
const perOk=c=>{const ano=+c.q.get('ano')||+c.body.ano,mes=+c.q.get('mes')||+c.body.mes;if(!(mes>=1&&mes<=12&&ano>=2000&&ano<=2100))throw E(400,'Período inválido.');return[ano,mes]};
R('GET','/api/faturamentos/previa',['admin'],c=>{const cl=getCl(c.q.get('client_id')),[ano,mes]=perOk(c);return{...faturaCalc(cl,ano,mes),ja_fechado:!!fatDoMes(cl.id,ymOf(ano,mes))}});
/* histórico de fechamentos/reaberturas (quem, quando e por quê) */
db.exec('CREATE TABLE IF NOT EXISTS faturamento_hist(id INTEGER PRIMARY KEY,client_id INTEGER,ano INTEGER,mes INTEGER,evento TEXT,status_ant TEXT,total REAL,nf TEXT,motivo TEXT,user_id INTEGER,quando TEXT)');
const fatHist=(u,f,evento,motivo)=>db.prepare('INSERT INTO faturamento_hist(client_id,ano,mes,evento,status_ant,total,nf,motivo,user_id,quando) VALUES(?,?,?,?,?,?,?,?,?,?)').run(f.client_id,f.ano,f.mes,evento,f.status||null,f.total,f.nf||null,motivo||null,u.id,now());
const fatVazio=f=>!(f.mensalidade>0)&&!f.itens.some(i=>i.tipo!=='mensalidade');
/* Fecha o mês de UM cliente (usada pelo fechamento individual e pelo lote). */
function fecharCliente(c,cl,ano,mes,obs){
 if(fatDoMes(cl.id,ymOf(ano,mes)))throw E(409,'Este mês já foi fechado para este cliente.');const f=faturaCalc(cl,ano,mes);
 if(fatVazio(f))throw E(400,'Nada a faturar: informe a mensalidade no cadastro do cliente ou lance despesas do mês.');
 const a=f.atendimentos;let id;
 db.exec('BEGIN');try{const r=db.prepare('INSERT INTO faturamentos(client_id,ano,mes,mensalidade,despesas,reembolsos,custo_prof,total,qtd_atend,qtd_psico,qtd_social,horas,itens,obs,criado) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(cl.id,ano,mes,f.mensalidade,f.despesas,f.reembolsos,f.custo_prof,f.total,a.total,a.psicologico,a.social,a.horas,JSON.stringify(f.itens),String(obs||'').slice(0,500),now());id=Number(r.lastInsertRowid);
  const rids=f.itens.filter(i=>i.reembolso_id).map(i=>+i.reembolso_id);if(rids.length)db.prepare('UPDATE reembolsos SET fat_id=? WHERE id IN ('+rids.join(',')+')').run(id);
  db.prepare('UPDATE despesas SET fat_id=? WHERE client_id=? AND fat_id IS NULL AND substr(data,1,7)=?').run(id,cl.id,ymOf(ano,mes));fatHist(c.u,{client_id:cl.id,ano,mes,total:f.total},'fechado');db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}
 audit(c.u,'faturamento_fechado',id+':'+cl.id,c.ip);return{id,total:f.total,atendimentos:a.total,pendentes:f.pendentes}}
R('POST','/api/faturamentos',['admin'],c=>{need(c,'client_id','ano','mes');const[ano,mes]=perOk(c);return fecharCliente(c,getCl(c.body.client_id),ano,mes,c.body.obs)});
/* Fechar o mês de vários clientes de uma vez: sem client_ids = todos os clientes ativos ainda em aberto. Cada cliente é fechado em sua própria transação. */
R('POST','/api/faturamentos/lote',['admin'],c=>{const[ano,mes]=perOk(c),ym=ymOf(ano,mes),ids=Array.isArray(c.body.client_ids)?c.body.client_ids.map(Number):null,out={fechados:[],ignorados:[],erros:[],total:0};
 for(const cl of db.prepare('SELECT * FROM clients WHERE ativo=1 ORDER BY fantasia').all()){if(ids&&!ids.includes(cl.id))continue;
  if(fatDoMes(cl.id,ym)){out.ignorados.push({cliente:cl.fantasia,motivo:'Já fechado'});continue}
  try{const r=fecharCliente(c,cl,ano,mes,c.body.obs);out.fechados.push({client_id:cl.id,cliente:cl.fantasia,id:r.id,total:r.total,pendentes:r.pendentes});out.total=Math.round((out.total+r.total)*100)/100}
  catch(e){(e.status===400?out.ignorados:out.erros).push({cliente:cl.fantasia,motivo:e.message})}}
 audit(c.u,'faturamento_lote_fechado',ym+':'+out.fechados.length,c.ip);return out});
/* Situação do mês de TODOS os clientes (Em aberto / Fechado / Faturado / Nada a faturar) para o painel de fechamento mensal */
R('GET','/api/faturamentos/mes',['admin'],c=>{const[ano,mes]=perOk(c),ym=ymOf(ano,mes);
 return db.prepare('SELECT * FROM clients ORDER BY fantasia').all().map(cl=>{const f=fatDoMes(cl.id,ym);if(!f&&!cl.ativo)return null;
  const pend=db.prepare("SELECT COUNT(*) n FROM atend WHERE client_id=? AND substr(data,1,7)=? AND status IN ('Pendente de validação','Em andamento')").get(cl.id,ym).n,
   reab=db.prepare("SELECT COUNT(*) n FROM faturamento_hist WHERE client_id=? AND ano=? AND mes=? AND evento='reaberto'").get(cl.id,ano,mes).n;
  if(f)return{client_id:cl.id,cliente:cl.fantasia,situacao:f.status,faturamento_id:f.id,mensalidade:f.mensalidade,despesas:f.despesas,reembolsos:f.reembolsos||0,total:f.total,atend:f.qtd_atend,psico:f.qtd_psico,social:f.qtd_social,nf:f.nf,faturado_em:f.faturado_em,pendentes:pend,reaberturas:reab};
  const p=faturaCalc(cl,ano,mes);return{client_id:cl.id,cliente:cl.fantasia,situacao:fatVazio(p)?'Nada a faturar':'Em aberto',faturamento_id:null,mensalidade:p.mensalidade,despesas:p.despesas,reembolsos:p.reembolsos,reemb_aguardando:p.reembolsos_aguardando,total:p.total,atend:p.atendimentos.total,psico:p.atendimentos.psicologico,social:p.atendimentos.social,nf:null,pendentes:pend,reaberturas:reab}}).filter(Boolean)});
R('GET','/api/faturamentos/historico',['admin'],c=>{const cl=getCl(c.q.get('client_id')),[ano,mes]=perOk(c);return db.prepare('SELECT h.*,u.nome usuario FROM faturamento_hist h LEFT JOIN users u ON u.id=h.user_id WHERE h.client_id=? AND h.ano=? AND h.mes=? ORDER BY h.id').all(cl.id,ano,mes)});
const fatOut=f=>({...f,itens:JSON.parse(f.itens||'[]')});
R('GET','/api/faturamentos',['admin'],()=>db.prepare('SELECT f.*,c.fantasia FROM faturamentos f JOIN clients c ON c.id=f.client_id ORDER BY f.ano DESC,f.mes DESC,c.fantasia').all().map(fatOut));
R('POST','/api/faturamentos/:id/faturar',['admin'],c=>{const r=db.prepare("UPDATE faturamentos SET status='Faturado',faturado_em=?,nf=? WHERE id=? AND status='Fechado'").run(now(),String(c.body.nf||'').slice(0,40),c.params.id);if(!r.changes)throw E(409,'Já faturado ou inexistente.');audit(c.u,'faturamento_faturado',c.params.id,c.ip);return{ok:1}});
/* Reabrir: desfaz o fechamento do cliente naquele mês (as despesas voltam a ficar em aberto e o mês pode ser fechado de novo).
   Fechamento já FATURADO só é reaberto com confirmação explícita e motivo; fica registrado no histórico e na auditoria. */
function reabrirFat(c,f,motivo,confirmar){const m=String(motivo||'').trim().slice(0,300);
 if(f.status==='Faturado'){if(confirmar!==true)throw E(423,'Fechamento já faturado'+(f.nf?' (NF '+f.nf+')':'')+': confirme a reabertura.');if(m.length<5)throw E(400,'Informe o motivo da reabertura (mínimo de 5 caracteres): este fechamento já foi faturado.')}
 db.exec('BEGIN');try{fatHist(c.u,f,'reaberto',m);db.prepare('UPDATE despesas SET fat_id=NULL WHERE fat_id=?').run(f.id);db.prepare('UPDATE reembolsos SET fat_id=NULL WHERE fat_id=?').run(f.id);db.prepare('DELETE FROM faturamentos WHERE id=?').run(f.id);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}
 audit(c.u,'faturamento_reaberto',f.id+':'+f.client_id+':'+ymOf(f.ano,f.mes)+':'+f.status,c.ip)}
const getFat=id=>{const f=db.prepare('SELECT * FROM faturamentos WHERE id=?').get(id);if(!f)throw E(404,'Fechamento não encontrado.');return f};
R('POST','/api/faturamentos/:id/cancelar',['admin'],c=>{const f=getFat(c.params.id);if(f.status!=='Fechado')throw E(423,'Fechamento já faturado: use "Reabrir" e informe o motivo.');reabrirFat(c,f,'',false);return{ok:1}});
R('POST','/api/faturamentos/:id/reabrir',['admin'],c=>{const f=getFat(c.params.id);reabrirFat(c,f,c.body.motivo,c.body.confirmar);return{ok:1,client_id:f.client_id,ano:f.ano,mes:f.mes}});
/* Reabrir vários de uma vez: sem client_ids = todos os fechados do mês. Os já faturados só entram com incluir_faturados e motivo. */
R('POST','/api/faturamentos/reabrir-lote',['admin'],c=>{const[ano,mes]=perOk(c),ids=Array.isArray(c.body.client_ids)?c.body.client_ids.map(Number):null,inc=c.body.incluir_faturados===true,m=String(c.body.motivo||'').trim();
 if(inc&&m.length<5)throw E(400,'Informe o motivo da reabertura (mínimo de 5 caracteres) para reabrir fechamentos já faturados.');const out={reabertos:[],ignorados:[]};
 for(const f of db.prepare('SELECT f.*,cl.fantasia FROM faturamentos f JOIN clients cl ON cl.id=f.client_id WHERE f.ano=? AND f.mes=? ORDER BY cl.fantasia').all(ano,mes)){if(ids&&!ids.includes(f.client_id))continue;
  if(f.status==='Faturado'&&!inc){out.ignorados.push({cliente:f.fantasia,motivo:'Já faturado'+(f.nf?' (NF '+f.nf+')':'')});continue}
  reabrirFat(c,f,m,true);out.reabertos.push({client_id:f.client_id,cliente:f.fantasia})}
 audit(c.u,'faturamento_lote_reaberto',ymOf(ano,mes)+':'+out.reabertos.length,c.ip);return out});
const fatDados=id=>{const f=db.prepare('SELECT f.*,c.fantasia,c.razao,c.cnpj FROM faturamentos f JOIN clients c ON c.id=f.client_id WHERE f.id=?').get(id);if(!f)throw E(404,'Fechamento não encontrado.');return fatOut(f)};
R('GET','/api/export/faturamento/:id.xlsx',['admin'],c=>{const f=fatDados(c.params.id),per=String(f.mes).padStart(2,'0')+'/'+f.ano;
 return FX(c,`faturamento-${f.ano}-${String(f.mes).padStart(2,'0')}.xlsx`,[{nome:'Resumo',cols:[{h:'Item',w:34},{h:'Valor',w:30}],rows:[['Cliente',f.fantasia],['Razão social',f.razao],['CNPJ',f.cnpj],['Período',per],['Mensalidade','R$ '+f.mensalidade.toFixed(2)],['Despesas variáveis','R$ '+f.despesas.toFixed(2)],['Total a faturar','R$ '+f.total.toFixed(2)],['Atendimentos realizados no mês',f.qtd_atend],['   Psicológicos',f.qtd_psico],['   Sociais',f.qtd_social],['   Outros',f.qtd_atend-f.qtd_psico-f.qtd_social],['Horas de atendimento',f.horas],['Situação',f.status+(f.nf?' · NF '+f.nf:'')]]},
  {nome:'Itens a faturar',cols:[{h:'Data',t:'d'},{h:'Descrição',w:60},{h:'Quantidade',t:'n'},{h:'Valor unitário',t:'m'},{h:'Valor',t:'m'}],rows:f.itens.map(i=>[i.data,i.descricao,i.qtd,i.unit,i.valor])}])});
R('GET','/api/export/faturamento/:id.pdf',['admin'],c=>{const f=fatDados(c.params.id),d=new X.Doc(),per=String(f.mes).padStart(2,'0')+'/'+f.ano,NAVY=[0.02,0.18,0.34],GR=[0.32,0.4,0.48];audit(c.u,'exportacao','faturamento-'+f.id+'.pdf',c.ip);
 d.band('Demonstrativo de faturamento',f.fantasia+'   |   '+per);
 {d.need(90);const w=(495-30)/4,y=d.y;[[fmtBRL(f.mensalidade),'Mensalidade',NAVY],[fmtBRL(f.despesas),'Despesas variáveis',NAVY],[fmtBRL(f.total),'Total a faturar',[0.004,0.667,0.635]],[String(f.qtd_atend),'Atendimentos no mês',NAVY]].forEach(([v,l,col],i)=>{const x0=50+i*(w+10);d.rect(x0,y-66,w,66,[0.95,0.97,0.99]);d.rect(x0,y-66,5,66,col);d.text(x0+14,y-32,16,v,true);d.text(x0+14,y-54,10,l,false,GR)});d.y=y-88}
 d.line(f.razao+'  -  CNPJ '+f.cnpj,12,false,50,1.5,GR);d.y-=4;
 d.h('Atendimentos realizados no mês',14);d.line('Total: '+f.qtd_atend+'   (psicológicos: '+f.qtd_psico+'; sociais: '+f.qtd_social+'; outros: '+(f.qtd_atend-f.qtd_psico-f.qtd_social)+')   -   '+String(f.horas).replace('.',',')+' h de atendimento',12);
 d.h('Itens a faturar',14);d.need(24);d.text(50,d.y,10,'Data',true,GR);d.text(114,d.y,10,'Descrição',true,GR);d.text(400,d.y,10,'Qtd',true,GR);d.text(517,d.y,10,'Valor',true,GR);d.y-=18;
 f.itens.forEach(i=>{d.need(20);const ds=String(i.descricao).length>50?String(i.descricao).slice(0,48)+'...':i.descricao,v=fmtBRL(i.valor);d.text(50,d.y,10.5,dtBR(i.data),false);d.text(114,d.y,10.5,ds,false);d.text(400,d.y,10.5,String(i.qtd).replace('.',','),false);d.text(545-v.length*5.6,d.y,10.5,v,false);d.y-=18});
 d.need(40);d.rect(50,d.y+10,495,1,[0.8,0.85,0.9]);d.y-=10;const t='Total: '+fmtBRL(f.total);d.text(545-t.length*7.4,d.y,14,t,true);d.y-=34;
 d.line('Os atendimentos considerados são os validados pela Acella no período. Despesas variáveis (km rodado, pedágios e outras) foram lançadas com descritivo e fazem parte do total acima.'+(f.obs?'\nObservação: '+f.obs:''),10.5,false,50,1.5,GR);
 return{file:{name:`faturamento-${f.ano}-${String(f.mes).padStart(2,'0')}.pdf`,mime:'application/pdf',buf:d.build('Acella - '+f.fantasia)}}});
/* ---------- importação de colaboradores e dependentes (Excel .xlsx ou CSV), sempre dentro de UMA empresa ---------- */
const sp=s=>String(s??'').trim().replace(/\s+/g,' ');
function impColab(cl,itens,upd,conf,c){const ex=new Map(db.prepare('SELECT * FROM colaboradores WHERE client_id=?').all(cl.id).map(k=>[k.cpf_hash,k])),vistos=new Set(),plano=[],erros=[];let ign=0;
 for(const it of itens){const cpf=IM.cpfCel(it.cpf),nome=sp(it.nome),nasc=IM.nascCel(it.nasc),cargo=sp(it.cargo).slice(0,80),err=m=>erros.push({linha:it.linha,nome,motivo:m});
  if(nome.length<3)err('Nome ausente ou muito curto');else if(!cpfOk(cpf))err('CPF inválido'+(it.cpf?' ('+maskCpf(cpf)+')':' (vazio)'));else if(nasc===null)err('Data de nascimento inválida ("'+it.nasc+'")');
  else{const h=cpfH(cpf);if(vistos.has(h)){err('CPF repetido na planilha');continue}vistos.add(h);const k=ex.get(h);
   if(!k)plano.push({op:'novo',nome,cpf,cargo,nasc,h});
   else{const mc=upd&&cargo&&cargo!==k.cargo,mn=upd&&nasc&&nasc!==dec(k.nasc_enc);if(mc||mn)plano.push({op:'upd',k,cargo:mc?cargo:k.cargo,nasc:mn?nasc:dec(k.nasc_enc)});else ign++}}}
 const novos=plano.filter(p=>p.op==='novo').length,atualizados=plano.length-novos;
 if(conf){tx(()=>{const ins=db.prepare('INSERT INTO colaboradores(client_id,nome_enc,cpf_enc,cpf_hash,cargo,criado,criado_por,nasc_enc) VALUES(?,?,?,?,?,?,?,?)'),up=db.prepare('UPDATE colaboradores SET cargo=?,nasc_enc=? WHERE id=?');
   for(const p of plano)p.op==='novo'?ins.run(cl.id,enc(p.nome),enc(p.cpf),p.h,p.cargo,now(),c.u.id,enc(p.nasc)):up.run(p.cargo,enc(p.nasc),p.k.id)});audit(c.u,'importacao_colaboradores',cl.id+':novos'+novos+':atualizados'+atualizados,c.ip)}
 return{novos,atualizados,ignorados:ign,erros_total:erros.length,erros:erros.slice(0,100),amostra:plano.slice(0,8).map(p=>p.op==='novo'?{acao:'Novo',nome:p.nome,cpf:maskCpf(p.cpf),detalhe:[p.cargo,p.nasc?dtBR(p.nasc):''].filter(Boolean).join(' · ')}:{acao:'Atualizar',nome:dec(p.k.nome_enc),cpf:maskCpf(dec(p.k.cpf_enc)),detalhe:[p.cargo,p.nasc?dtBR(p.nasc):''].filter(Boolean).join(' · ')})}}
function impDep(cl,itens,upd,conf,c){const ks=db.prepare('SELECT * FROM colaboradores WHERE client_id=?').all(cl.id),porCpf=new Map(ks.map(k=>[k.cpf_hash,k])),porNome=new Map(),ex=new Map(),nn=s=>norm(sp(s));
 for(const k of ks){const n=nn(dec(k.nome_enc));porNome.set(n,porNome.has(n)?null:k)}
 for(const d of db.prepare('SELECT d.* FROM dependentes d JOIN colaboradores k ON k.id=d.colab_id WHERE k.client_id=?').all(cl.id)){if(!ex.has(d.colab_id))ex.set(d.colab_id,[]);ex.get(d.colab_id).push({d,n:nn(dec(d.nome_enc)),nasc:depNasc(d)})}
 const vistos=new Set(),plano=[],erros=[];let ign=0;
 for(const it of itens){const nome=sp(it.nome),err=m=>erros.push({linha:it.linha,nome,motivo:m}),cpfT=IM.cpfCel(it.cpf_titular);let k=null;
  if(cpfT){if(!cpfOk(cpfT)){err('CPF do colaborador inválido');continue}k=porCpf.get(cpfH(cpfT))}
  else if(it.nome_titular){const n=nn(it.nome_titular);if(porNome.has(n)&&!porNome.get(n)){err('Mais de um colaborador com este nome: informe o CPF do colaborador');continue}k=porNome.get(n)}
  if(!k){err('Colaborador (titular) não encontrado nesta empresa'+(cpfT?' (CPF '+maskCpf(cpfT)+')':''));continue}
  if(nome.length<2){err('Nome do dependente ausente');continue}
  const cpfD=IM.cpfCel(it.cpf);if(cpfD&&!cpfOk(cpfD)){err('CPF do dependente inválido');continue}
  const nasc=IM.nascCel(it.nasc);if(nasc===null){err('Data de nascimento inválida ("'+it.nasc+'")');continue}
  const par=IM.parentesco(it.parentesco),n=nn(nome),hd=cpfD?cpfH(cpfD):null,key=k.id+'|'+(hd||n+'|'+nasc);
  if(vistos.has(key)){err('Dependente repetido na planilha');continue}vistos.add(key);
  const f=(ex.get(k.id)||[]).find(x=>(hd&&x.d.cpf_hash===hd)||(x.n===n&&(!nasc||!x.nasc||x.nasc===nasc)));
  if(!f)plano.push({op:'novo',k,nome,par,nasc,cpf:cpfD});
  else if(upd&&((it.parentesco&&par!==f.d.parentesco)||(nasc&&nasc!==f.nasc)||(cpfD&&hd!==f.d.cpf_hash)))plano.push({op:'upd',k,f,nome,par:it.parentesco?par:f.d.parentesco,nasc:nasc||f.nasc,cpf:cpfD,hd});
  else ign++}
 const novos=plano.filter(p=>p.op==='novo').length,atualizados=plano.length-novos;
 if(conf){tx(()=>{for(const p of plano){if(p.op==='novo')insDep({colab_id:p.k.id},{nome:p.nome,parentesco:p.par,nasc:p.nasc,cpf:p.cpf});
   else db.prepare('UPDATE dependentes SET parentesco=?,nasc=?,nasc_enc=?,cpf_enc=?,cpf_hash=? WHERE id=?').run(p.par,'',enc(p.nasc),p.cpf?enc(p.cpf):p.f.d.cpf_enc,p.cpf?p.hd:p.f.d.cpf_hash,p.f.d.id)}});audit(c.u,'importacao_dependentes',cl.id+':novos'+novos+':atualizados'+atualizados,c.ip)}
 return{novos,atualizados,ignorados:ign,erros_total:erros.length,erros:erros.slice(0,100),amostra:plano.slice(0,8).map(p=>({acao:p.op==='novo'?'Novo':'Atualizar',nome:p.nome+' ('+p.par+')',cpf:maskCpf(dec(p.k.cpf_enc)),detalhe:'titular: '+dec(p.k.nome_enc)+(p.nasc?' · nasc. '+dtBR(p.nasc):'')}))}}
const tx=fn=>{db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}};
R('POST','/api/importacao',PEOPLE,c=>{need(c,'tipo','client_id','arquivo');const b=c.body,tipo=b.tipo==='dependentes'?'dependentes':'colaboradores',cl=db.prepare('SELECT * FROM clients WHERE id=? AND ativo=1').get(b.client_id);if(!cl)throw E(400,'Selecione a empresa dos colaboradores.');
 const buf=Buffer.from(String(b.arquivo),'base64');if(!buf.length||buf.length>12e6)throw E(400,'Arquivo vazio ou maior que 12 MB.');
 let P;try{P=IM.analisar(buf,tipo)}catch(e){if(!e.user)console.error(e);throw E(400,e.user?e.message:'Não foi possível ler a planilha. Salve-a como .xlsx ou .csv e tente novamente.')}
 if(!P.itens.length)throw E(400,'A planilha não tem linhas de dados abaixo do cabeçalho.');if(P.itens.length>5000)throw E(400,'Máximo de 5.000 linhas por importação. Divida o arquivo.');
 const conf=b.confirmar===true,upd=b.atualizar===true,r=(tipo==='dependentes'?impDep:impColab)(cl,P.itens,upd,conf,c);
 return{tipo,empresa:cl.fantasia,aba:P.aba,colunas:P.colunas,total:P.itens.length,confirmado:conf,...r}});
const INSTR=[['1. Preencha uma linha por colaborador (ou por dependente) na primeira aba, sem alterar os títulos das colunas.'],['2. CPF: com ou sem pontos e traço. O sistema confere os dígitos verificadores.'],['3. Data de nascimento: no formato DD/MM/AAAA.'],['4. Na tela de importação escolha a EMPRESA: todos os registros do arquivo entram nessa empresa, sem se misturar com as demais.'],['5. Quem já existe (mesmo CPF na mesma empresa) é ignorado, ou atualizado se você marcar "Atualizar cadastros existentes".'],['6. Dependentes: informe o CPF do colaborador (titular) na mesma empresa. O colaborador precisa já estar cadastrado.'],['7. Salve como .xlsx (ou CSV) e envie. Arquivos .xls antigos precisam ser salvos novamente como .xlsx.']];
R('GET','/api/export/modelo-colaboradores.xlsx',PEOPLE,c=>FX(c,'modelo-colaboradores.xlsx',[{nome:'Colaboradores',cols:[{h:'Nome',w:34},{h:'CPF',w:18},{h:'Cargo',w:26},{h:'Data de nascimento',w:20}],rows:[]},{nome:'Instruções',cols:[{h:'Como preencher',w:110}],rows:INSTR}]));
R('GET','/api/export/modelo-dependentes.xlsx',PEOPLE,c=>FX(c,'modelo-dependentes.xlsx',[{nome:'Dependentes',cols:[{h:'CPF do colaborador',w:20},{h:'Nome do dependente',w:34},{h:'Parentesco',w:18},{h:'Data de nascimento',w:20},{h:'CPF do dependente',w:20}],rows:[]},{nome:'Instruções',cols:[{h:'Como preencher',w:110}],rows:INSTR}]));
/* ---------- servidor ---------- */
/* ---------- PLANO DE NEGÓCIOS (v9): premissas, custos da estrutura e evolução por fases ----------
   O plano é uma hipótese; a "evolução" compara mês a mês o PLANO (calculado pelas premissas) com o que o SISTEMA registrou
   (clientes ativos, fechamentos de clientes, honorários, DRE e custos da estrutura lançados em plano_custos). */
db.exec(`CREATE TABLE IF NOT EXISTS plano_custos(id INTEGER PRIMARY KEY,ano INTEGER,mes INTEGER,tipo TEXT DEFAULT 'despesa',categoria TEXT,descricao TEXT,valor REAL,criado TEXT,criado_por INTEGER);CREATE INDEX IF NOT EXISTS ix_plano_custos ON plano_custos(ano,mes)`);
const PLANO_PAD={versao:'v9 (resumo executivo)',inicio:'2027-01',
 planos:[{nome:'Essencial',preco:14.9,minimo:590,franquia:1,acoes:0,mix:30},{nome:'Equilíbrio',preco:21.9,minimo:790,franquia:2,acoes:1,mix:50},{nome:'Completo',preco:29.9,minimo:1090,franquia:3,acoes:2,mix:20}],
 func_contrato:60,ritmo:1.5,teto:90,uso:0.3,uso_alerta:0.6,psicologa_atend:75,
 clt:{salario:3500,custo_mensal:5405,equipamento:4000,mes:12,gatilho:1000},capacidade:{degrau1:200,degrau2:400},
 investimento:{inicial:16000,preop_meses:2,fixo_mensal:1400,capital:45000,pico_caixa:22673,mes_pico:2,mes_positivo:4,mes_recuperado:9},
 fator_r:0.285,folha_clt_fator_r:4200,
 anual:[{ano:1,contratos:18,receita:146376,resultado:40746,margem:27.8,retirada:80135},{ano:2,contratos:36,receita:423720,resultado:163702,margem:38.6,retirada:234062},{ano:3,contratos:54,receita:701064,resultado:285255,margem:40.7,retirada:434658},{ano:4,contratos:72,receita:978408,resultado:403170,margem:41.2,retirada:631616},{ano:5,contratos:90,receita:1255752,resultado:517892,margem:41.2,retirada:825382}],
 fases:[{id:0,nome:'Fase 0 · Pré-operação',de:-1,ate:0,equipe:'Sócia (estruturação)',foco:'Constituição, registros CRESS/CRP, contratos, credenciamento das psicólogas, LGPD, site e sistema.'},
  {id:1,nome:'Fase 1 · Degrau 1 – Validação',de:1,ate:12,equipe:'Sócia (assistente social) + psicólogas autônomas por demanda',foco:'Validar preço e uso com as primeiras propostas; chegar a ~1.000 funcionários (gatilho da assistente social CLT).'},
  {id:2,nome:'Fase 2 · Degrau 2 – Expansão',de:13,ate:36,equipe:'Sócia + assistente social CLT + psicólogas',foco:'Sustentar 1,5 contrato por mês; medir CAC, uso real e margem; de 18 a 54 contratos.'},
  {id:3,nome:'Fase 3 · Degrau 2 – Consolidação até o teto',de:37,ate:60,equipe:'Sócia + assistente social CLT + psicólogas',foco:'De 54 a 90 contratos (teto comercial no mês 60); retirada da sócia e margem no regime do teto.'}],
 marcos:[6,12,24,36,48,60]};
const getPlano=()=>{let o={};try{o=JSON.parse((db.prepare("SELECT v FROM settings WHERE k='plano_config'").get()||{v:'{}'}).v)}catch(e){}return{...PLANO_PAD,...o}};
const ymN=(n,ini)=>{const[a,m]=ini.split('-').map(Number),t=a*12+(m-1)+(n-1);return Math.floor(t/12)+'-'+String(t%12+1).padStart(2,'0')};
R('GET','/api/plano/config',['admin'],()=>({config:getPlano(),padrao:PLANO_PAD}));
R('PUT','/api/plano/config',['admin'],c=>{const o={};for(const k of Object.keys(PLANO_PAD)){if(!(k in c.body))continue;const a=c.body[k],b=PLANO_PAD[k];if(typeof a!==typeof b||Array.isArray(a)!==Array.isArray(b))throw E(400,'Valor inválido para '+k+'.');if(typeof a==='number'&&!(Number.isFinite(a)&&a>=0&&a<=1e9))throw E(400,'Número inválido em '+k+'.');o[k]=a}
 if(!Object.keys(o).length)throw E(400,'Nada a alterar.');db.prepare("INSERT INTO settings VALUES('plano_config',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(JSON.stringify({...JSON.parse((db.prepare("SELECT v FROM settings WHERE k='plano_config'").get()||{v:'{}'}).v),...o}));audit(c.u,'plano_config',Object.keys(o).join(','),c.ip);return{ok:1}});
const CAT_CUSTO=['Estrutura fixa','Assistente social CLT','Pró-labore da sócia','Outras despesas operacionais','Investimento inicial','Equipamento da CLT','Outros'];
R('GET','/api/plano/custos',['admin'],c=>{const ano=+c.q.get('ano')||0;return{categorias:CAT_CUSTO,itens:db.prepare('SELECT * FROM plano_custos '+(ano?'WHERE ano=? ':'')+'ORDER BY ano,mes,id').all(...(ano?[ano]:[]))}});
R('POST','/api/plano/custos',['admin'],c=>{need(c,'ano','mes','categoria','valor');const ano=+c.body.ano,mes=+c.body.mes;if(!(mes>=1&&mes<=12&&ano>=2000&&ano<=2100))throw E(400,'Período inválido.');
 const tipo=c.body.tipo==='investimento'?'investimento':'despesa',v=num(c.body.valor,1e9,2);const r=db.prepare('INSERT INTO plano_custos(ano,mes,tipo,categoria,descricao,valor,criado,criado_por) VALUES(?,?,?,?,?,?,?,?)').run(ano,mes,tipo,String(c.body.categoria).slice(0,60),String(c.body.descricao||'').slice(0,200),v,now(),c.u.id);audit(c.u,'plano_custo_criado',r.lastInsertRowid,c.ip);return{id:Number(r.lastInsertRowid)}});
R('DELETE','/api/plano/custos/:id',['admin'],c=>{const r=db.prepare('DELETE FROM plano_custos WHERE id=?').run(c.params.id);if(!r.changes)throw E(404,'Lançamento não encontrado.');audit(c.u,'plano_custo_excluido',c.params.id,c.ip);return{ok:1}});
function planoEvolucao(){const P=getPlano(),NM=P.meses||60,ini=P.inicio,plan=P.planos,
 ticket=R2(plan.reduce((s,x)=>s+x.mix/100*Math.max(x.minimo,x.preco*P.func_contrato),0)),
 faseDe=n=>(P.fases.find(f=>n>=f.de&&n<=f.ate)||{id:null}).id,
 y1=ymN(-1,ini),yN=ymN(60,ini),dre=dreCalc(y1,yN),dm=Object.fromEntries(dre.porMes.map(x=>[x.ano*100+x.mes,x])),
 fat=Object.fromEntries(db.prepare('SELECT ano*100+mes k,COUNT(*) n,SUM(status=\'Faturado\') fa,SUM(total) receita,SUM(mensalidade) mens FROM faturamentos GROUP BY k').all().map(x=>[x.k,x])),
 at=Object.fromEntries(db.prepare("SELECT substr(data,1,7) ym,COUNT(*) n,SUM(tipo='Psicológico') psi,SUM(tipo='Social') soc FROM atend WHERE status IN ('Aprovado','Fechado') GROUP BY ym").all().map(x=>[x.ym,x])),
 cust={},inv={};for(const x of db.prepare('SELECT ano,mes,tipo,categoria,SUM(valor) v FROM plano_custos GROUP BY ano,mes,tipo,categoria').all()){const k=x.ano*100+x.mes,t=x.tipo==='investimento'?inv:cust;(t[k]??={})[x.categoria]=R2(x.v)}
 const cl=db.prepare("SELECT inicio_contrato i,COUNT(*) n,SUM(funcionarios) f FROM clients WHERE ativo=1 AND inicio_contrato IS NOT NULL GROUP BY i ORDER BY i").all();
 const meses=[];let cAc=0,fAc=0,idx=0,cum=0,pico=0,mPico=null,pos=null,rec=null,temSim=false;
 for(let n=-1;n<=NM;n++){const ym=ymN(n,ini),k=+ym.replace('-',''),[ano,mes]=ym.split('-').map(Number);
  const pc=n<=0?0:Math.min(P.teto,Math.floor(P.ritmo*n+1e-9)),pr={contratos:pc,funcionarios:pc*P.func_contrato,mrr:R2(pc*ticket),receita:R2(pc*ticket),atend:R2(pc*P.func_contrato*P.uso/12),equipe:n<=0?'Estruturação':n<P.clt.mes?'Sócia + psicólogas':'Sócia + CLT + psicólogas',capacidade:n<=0?0:n<P.clt.mes?P.capacidade.degrau1:P.capacidade.degrau2};
  while(idx<cl.length&&cl[idx].i<=ym){cAc+=cl[idx].n;fAc+=cl[idx].f||0;idx++}
  const F=fat[k],D=dm[k],C=cust[k]||{},I=inv[k]||{},desp=R2(Object.values(C).reduce((s,v)=>s+v,0)),invm=R2(Object.values(I).reduce((s,v)=>s+v,0)),A=at[ym]||{n:0,psi:0,soc:0};
  let sim=null;
  if(F||n<=0&&(desp||invm)||n>0&&cAc>0&&A.n>0){const rec_=F?F.receita:0,imp=D?D.deducoes:0,hon=D?D.custo_prof:0,res=R2((D?D.resultado_liquido:0)-desp),pl=C['Pró-labore da sócia']||0,ret=R2(pl+Math.max(0,res));
   sim={fechado:!!F,faturado:F?F.fa===F.n:false,contratos:cAc,funcionarios:fAc,mrr:R2(F?F.mens:0),receita:R2(rec_),impostos:R2(imp),honorarios:R2(hon),despesas_estrutura:desp,clt:C['Assistente social CLT']||0,pro_labore:pl,
    atend:A.n,psico:A.psi,social:A.soc,uso_anual:fAc?R2(A.n*12/fAc):0,ocupacao:pr.capacidade?R2(A.n/pr.capacidade*100):0,resultado:res,retirada:ret,investimento:invm};
   if(n>0&&!F&&n>0)sim.fechado=false;
   temSim=true;cum=R2(cum+res-invm);if(-cum>pico){pico=-cum;mPico=n}if(pos==null&&n>0&&res>0)pos=n;if(rec==null&&n>0&&mPico!=null&&cum>=0&&n>mPico)rec=n;sim.caixa=R2(P.investimento.capital+cum);sim.caixa_acumulado=cum}
  meses.push({n,ym,ano,mes,fase:faseDe(n),plano:pr,sim})}
 const soma=(l,f)=>R2(l.reduce((s,x)=>s+(f(x)||0),0)),agr=(l,pa)=>{const u=l[l.length-1],sm=l.filter(x=>x.sim),su=sm.length?sm[sm.length-1]:null,ok=sm.filter(x=>x.sim.fechado||x.n<=0);
   const rp=soma(l,x=>x.plano.receita),rs=soma(ok,x=>x.sim.receita),res=soma(sm,x=>x.sim.resultado),ret=soma(sm,x=>x.sim.retirada);
   return{de:l[0].n,ate:u.n,ym_de:l[0].ym,ym_ate:u.ym,meses_com_dados:ok.length,plano:{contratos:u.plano.contratos,funcionarios:u.plano.funcionarios,mrr:u.plano.mrr,receita:rp,resultado:pa?pa.resultado:null,margem:pa?pa.margem:null,retirada:pa?pa.retirada:null,atend:soma(l,x=>x.plano.atend)},
    sim:sm.length?{contratos:su.sim.contratos,funcionarios:su.sim.funcionarios,mrr:su.sim.mrr,receita:rs,impostos:soma(ok,x=>x.sim.impostos),honorarios:soma(ok,x=>x.sim.honorarios),despesas_estrutura:soma(sm,x=>x.sim.despesas_estrutura),pro_labore:soma(sm,x=>x.sim.pro_labore),resultado:res,margem:rs>0?Math.round(res/rs*1000)/10:0,retirada:ret,atend:soma(sm,x=>x.sim.atend),investimento:soma(sm,x=>x.sim.investimento),completo:l.filter(x=>x.n>0).every(x=>x.sim&&x.sim.fechado)}:null}};
 const op=meses.filter(m=>m.n>=1),fases=P.fases.map(f=>{const l=meses.filter(m=>m.n>=f.de&&m.n<=f.ate),a=P.anual.filter(y=>y.ano*12-11>=Math.max(f.de,1)&&y.ano*12<=f.ate),pa=f.id===0?{resultado:-R2(P.investimento.fixo_mensal*P.investimento.preop_meses),margem:null,retirada:null}:a.length?{resultado:soma(a,x=>x.resultado),margem:Math.round(soma(a,x=>x.resultado)/soma(a,x=>x.receita)*1000)/10,retirada:soma(a,x=>x.retirada)}:null;return{...f,...agr(l,pa)}}),
  geral={id:'all',nome:'Visão geral dos 60 meses',de:-1,ate:NM,equipe:'Evolução completa, da pré-operação ao teto comercial',foco:'Do investimento inicial aos 90 contratos do mês 60.',...agr(meses,{resultado:R2(soma(P.anual,x=>x.resultado)-P.investimento.fixo_mensal*P.investimento.preop_meses),margem:Math.round(soma(P.anual,x=>x.resultado)/soma(P.anual,x=>x.receita)*1000)/10,retirada:soma(P.anual,x=>x.retirada)})},
  anos=P.anual.map(y=>({ano:y.ano,...agr(op.filter(m=>m.n>(y.ano-1)*12&&m.n<=y.ano*12),y)})),
  marcos=P.marcos.map(n=>{const m=meses.find(x=>x.n===n);return{n,ym:m.ym,plano:m.plano,sim:m.sim}});
 return{config:{versao:P.versao,inicio:P.inicio,ticket_medio:ticket,func_contrato:P.func_contrato,ritmo:P.ritmo,teto:P.teto,uso:P.uso,uso_alerta:P.uso_alerta,psicologa_atend:P.psicologa_atend,clt:P.clt,capital:P.investimento.capital,planos:plan,regime:getImp()},
  tem_simulacao:temSim,meses,fases,geral,anos,marcos,
  caixa:{pico_plano:P.investimento.pico_caixa,mes_pico_plano:P.investimento.mes_pico,mes_positivo_plano:P.investimento.mes_positivo,mes_recuperado_plano:P.investimento.mes_recuperado,pico_sim:R2(pico),mes_pico_sim:mPico,mes_positivo_sim:pos,mes_recuperado_sim:rec,capital:P.investimento.capital}}}
R('GET','/api/plano/evolucao',['admin'],()=>planoEvolucao());
R('GET','/api/export/plano.xlsx',['admin'],c=>{const d=planoEvolucao();
 return FX(c,'plano-evolucao.xlsx',[{nome:'Meses',cols:[{h:'Mês nº',t:'n'},{h:'Competência',w:12},{h:'Fase',t:'n'},{h:'Contratos (plano)',t:'n'},{h:'Contratos (sistema)',t:'n'},{h:'Funcionários (plano)',t:'n'},{h:'Funcionários (sistema)',t:'n'},{h:'Receita plano',t:'m'},{h:'Receita sistema',t:'m'},{h:'Impostos',t:'m'},{h:'Honorários',t:'m'},{h:'Custos da estrutura',t:'m'},{h:'Resultado líquido',t:'m'},{h:'Retirada da sócia',t:'m'},{h:'Atendimentos',t:'n'},{h:'Caixa',t:'m'}],
   rows:d.meses.map(m=>[m.n,m.ym,m.fase??'',m.plano.contratos,m.sim?m.sim.contratos:'',m.plano.funcionarios,m.sim?m.sim.funcionarios:'',m.plano.receita,m.sim?m.sim.receita:'',m.sim?m.sim.impostos:'',m.sim?m.sim.honorarios:'',m.sim?m.sim.despesas_estrutura:'',m.sim?m.sim.resultado:'',m.sim?m.sim.retirada:'',m.sim?m.sim.atend:'',m.sim?m.sim.caixa:''])},
  {nome:'Anos',cols:[{h:'Ano do plano',t:'n'},{h:'Contratos plano',t:'n'},{h:'Contratos sistema',t:'n'},{h:'Receita plano',t:'m'},{h:'Receita sistema',t:'m'},{h:'Resultado plano',t:'m'},{h:'Resultado sistema',t:'m'},{h:'Retirada plano',t:'m'},{h:'Retirada sistema',t:'m'}],
   rows:d.anos.map(y=>[y.ano,y.plano.contratos,y.sim?y.sim.contratos:'',y.plano.receita,y.sim?y.sim.receita:'',y.plano.resultado,y.sim?y.sim.resultado:'',y.plano.retirada,y.sim?y.sim.retirada:''])}])});

/* Atrás de proxy HTTPS (Caddy/Nginx/PaaS): defina ACELLA_TRUST_PROXY=1 para usar o IP real do visitante (último valor de X-Forwarded-For, acrescentado pelo proxy). */
const clientIp=req=>{if(process.env.ACELLA_TRUST_PROXY){const x=String(req.headers['x-forwarded-for']||'').split(',').pop().trim();if(x)return x}return req.socket.remoteAddress};
const MIME={'.html':'text/html;charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'};
const SITE=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
 const H={'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'same-origin','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self';style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;font-src https://fonts.gstatic.com;img-src 'self' data:;script-src 'self' 'unsafe-inline'"};
 const url=new URL(req.url,'http://x'),ip=clientIp(req),cookies=Object.fromEntries((req.headers.cookie||'').split(/;\s*/).filter(Boolean).map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)]}));
 if(!url.pathname.startsWith('/api/')){let f=path.resolve(SITE,'.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));
  if(!f.startsWith(SITE+path.sep)||/[\\/](server|node_modules|\.)/.test(f.slice(SITE.length))||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404,H);return res.end('Não encontrado')}
  res.writeHead(200,{...H,'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});return fs.createReadStream(f).pipe(res)}
 let raw='';req.on('data',d=>{raw+=d;if(raw.length>(url.pathname==='/api/importacao'?18e6:1e6))req.destroy()});
 req.on('end',()=>{const send=(s,o,ck)=>{res.writeHead(s,{...H,'Content-Type':'application/json',...(ck?{'Set-Cookie':ck}:{})});res.end(JSON.stringify(o))};
  try{const rt=routes.find(r=>r.m===req.method&&r.re.test(url.pathname));if(!rt)throw E(404,'Rota inexistente');
   const c={ip,fwd:req.headers['x-forwarded-for']||'',ua:req.headers['user-agent'],cookies,params:{...(rt.re.exec(url.pathname).groups||{})},q:url.searchParams,body:{}};
   if(raw){try{c.body=JSON.parse(raw)}catch(e){throw E(400,'JSON inválido')}}
   if(rt.roles){const tok=cookies.sid;c.tokHash=tok?sha(tok):'';const s=tok&&db.prepare('SELECT * FROM sessions WHERE tok=? AND exp>?').get(c.tokHash,Date.now());c.u=s&&db.prepare('SELECT * FROM users WHERE id=? AND ativo=1').get(s.user_id);
    if(!c.u)throw E(401,'Não autenticado.');if(req.method!=='GET'&&req.headers['x-requested-with']!=='acella')throw E(403,'Requisição inválida.');
    if(c.u.must_change&&!['/api/password','/api/me','/api/logout'].includes(url.pathname))throw E(403,'Troque a senha para continuar.');
    if(rt.roles!=='any'&&!rt.roles.includes(c.u.role)){audit(c.u,'acesso_negado',url.pathname,ip,0);throw E(403,'Sem permissão.')}}
   const out=rt.h(c);if(out&&out.file){res.writeHead(200,{...H,'Content-Type':out.file.mime,'Content-Disposition':`attachment; filename="${out.file.name}"`});return res.end(out.file.buf)}send(200,out,c.cookie)}catch(e){if(!e.status)console.error(e);send(e.status||500,{erro:e.status?e.message:'Erro interno'})}})});
/* ===== Exclusões (somente administrador) =====
   GET  /api/excluir/:ent/:id  -> prévia: o que será apagado e eventuais bloqueios
   POST /api/excluir/:ent/:id  -> {confirma:'EXCLUIR'} executa em transação e registra na auditoria.
   Regra de proteção: registros já incluídos em fechamento (de profissional ou de cliente) não são apagados por tabela:
   exclua o fechamento antes, assim nenhum valor pago/faturado some sem que o fechamento também seja desfeito. */
const N=(sql,...a)=>db.prepare(sql).get(...a).n,IDS=(sql,...a)=>db.prepare(sql).all(...a).map(r=>r.id),inl=a=>a.length?a.join(','):'NULL';
const xRelatos=(where,...a)=>{const r=IDS('SELECT id FROM relatos WHERE '+where,...a);if(r.length){db.exec('DELETE FROM relato_versoes WHERE relato_id IN ('+inl(r)+')');db.exec('DELETE FROM relatos WHERE id IN ('+inl(r)+')')}};
const xAtend=ids=>{if(!ids.length)return;const L=inl(ids);xRelatos('atend_id IN ('+L+')');
 /* o chamado ligado ao atendimento volta para a fila (ou, se interno, ao(à) profissional) */
 db.exec("UPDATE chamados SET status=CASE WHEN status IN ('Finalizado','Cancelado') THEN status WHEN criado_por IS NULL THEN 'Novo chamado' ELSE 'Encaminhado' END,prof_id=CASE WHEN status IN ('Finalizado','Cancelado') OR criado_por IS NOT NULL THEN prof_id ELSE NULL END,atend_id=NULL,pront_id=NULL WHERE atend_id IN ("+L+")");
 db.exec('DELETE FROM atend WHERE id IN ('+L+')')};
const xPront=ids=>{if(!ids.length)return;const L=inl(ids);xRelatos('pront_id IN ('+L+')');
 db.exec('DELETE FROM excecoes WHERE pront_id IN ('+L+')');db.exec('DELETE FROM prontuario_versoes WHERE pront_id IN ('+L+')');db.exec('DELETE FROM dependentes WHERE pront_id IN ('+L+')');
 db.exec('UPDATE atend SET pront_id=NULL,dep_id=NULL WHERE pront_id IN ('+L+')');db.exec('UPDATE chamados SET pront_id=NULL WHERE pront_id IN ('+L+')');db.exec('DELETE FROM prontuarios WHERE id IN ('+L+')')};
const xCamp=id=>{db.prepare('DELETE FROM responses WHERE campaign_id=?').run(id);db.prepare('DELETE FROM respondents WHERE campaign_id=?').run(id);db.prepare('DELETE FROM codigos WHERE campaign_id=?').run(id);db.prepare('DELETE FROM campaigns WHERE id=?').run(id)};
const AP=(...p)=>p.filter(x=>x[1]>0).map(x=>({r:x[0],n:x[1]}));
const AVISO_CLIN='Prontuários e relatos são registro clínico, com prazo legal de guarda: confirme que a exclusão é intencional.';
const PLAN={
 colaborador:id=>{const k=db.prepare('SELECT * FROM colaboradores WHERE id=?').get(id);if(!k)return null;const cl=db.prepare('SELECT fantasia FROM clients WHERE id=?').get(k.client_id)||{},
   pr=IDS('SELECT id FROM prontuarios WHERE colab_id=?',id),at=IDS('SELECT id FROM atend WHERE colab_id=? OR pront_id IN ('+inl(pr)+')',id),fech=N('SELECT COUNT(*) n FROM atend WHERE id IN ('+inl(at)+') AND fech_id IS NOT NULL'),
   rel=N('SELECT COUNT(*) n FROM relatos WHERE pront_id IN ('+inl(pr)+')'),dep=N('SELECT COUNT(*) n FROM dependentes WHERE colab_id=? OR pront_id IN ('+inl(pr)+')',id);
  return{rotulo:'colaborador',nome:dec(k.nome_enc)+' ('+(cl.fantasia||'')+')',audit:'cliente '+k.client_id,
   bloq:fech?[fech+' atendimento(s) deste colaborador já estão em fechamento de profissional. Exclua o fechamento antes.']:[],
   apaga:AP(['atendimentos',at.length],['prontuários',pr.length],['relatos',rel],['dependentes',dep]),aviso:pr.length?AVISO_CLIN:'',
   run:()=>{xAtend(at);xPront(pr);db.prepare('DELETE FROM dependentes WHERE colab_id=?').run(id);db.prepare('UPDATE chamados SET colab_id=NULL WHERE colab_id=?').run(id);db.prepare('DELETE FROM colaboradores WHERE id=?').run(id)}}},
 cliente:id=>{const k=db.prepare('SELECT * FROM clients WHERE id=?').get(id);if(!k)return null;
  const pr=IDS('SELECT id FROM prontuarios WHERE client_id=?',id),at=IDS('SELECT id FROM atend WHERE client_id=? OR pront_id IN ('+inl(pr)+')',id),camps=IDS('SELECT id FROM campaigns WHERE client_id=?',id),
   fat=N('SELECT COUNT(*) n FROM faturamentos WHERE client_id=?',id),atf=N('SELECT COUNT(*) n FROM atend WHERE id IN ('+inl(at)+') AND fech_id IS NOT NULL'),rbf=N('SELECT COUNT(*) n FROM reembolsos WHERE client_id=? AND (fech_id IS NOT NULL OR fat_id IS NOT NULL)',id),
   bq=[];if(fat)bq.push(fat+' fechamento(s) de faturamento deste cliente. Exclua-os antes, em Faturamento de clientes.');if(atf)bq.push(atf+' atendimento(s) deste cliente já estão em fechamento de profissional. Exclua esse fechamento antes.');if(rbf)bq.push(rbf+' reembolso(s) de km deste cliente já estão em fechamento. Exclua o fechamento antes.');
  return{rotulo:'cliente',nome:k.fantasia||k.razao,audit:k.cnpj,bloq:bq,
   apaga:AP(['colaboradores',N('SELECT COUNT(*) n FROM colaboradores WHERE client_id=?',id)],['atendimentos',at.length],['prontuários',pr.length],['relatos',N('SELECT COUNT(*) n FROM relatos WHERE pront_id IN ('+inl(pr)+')')],['chamados',N('SELECT COUNT(*) n FROM chamados WHERE client_id=?',id)],['despesas em aberto',N('SELECT COUNT(*) n FROM despesas WHERE client_id=?',id)],['reembolsos de km',N('SELECT COUNT(*) n FROM reembolsos WHERE client_id=?',id)],['pesquisas (campanhas)',camps.length],['respostas de pesquisa',N('SELECT COUNT(*) n FROM responses WHERE campaign_id IN ('+inl(camps)+')')],['acessos de usuário do cliente',N("SELECT COUNT(*) n FROM users WHERE client_id=? AND role='cliente'",id)]),aviso:pr.length?AVISO_CLIN:'',
   run:()=>{xAtend(at);xPront(pr);db.prepare('DELETE FROM chamados WHERE client_id=?').run(id);db.prepare('DELETE FROM despesas WHERE client_id=?').run(id);db.prepare('DELETE FROM reembolsos WHERE client_id=?').run(id);camps.forEach(xCamp);
    IDS("SELECT id FROM users WHERE client_id=? AND role='cliente'",id).forEach(u=>{db.prepare('DELETE FROM sessions WHERE user_id=?').run(u);db.prepare('DELETE FROM users WHERE id=?').run(u)});
    db.prepare('UPDATE forms SET client_id=NULL WHERE client_id=?').run(id);db.prepare('DELETE FROM dependentes WHERE colab_id IN (SELECT id FROM colaboradores WHERE client_id=?)').run(id);db.prepare('DELETE FROM colaboradores WHERE client_id=?').run(id);db.prepare('DELETE FROM faturamento_hist WHERE client_id=?').run(id);db.prepare('DELETE FROM clients WHERE id=?').run(id)}}},
 usuario:(id,c)=>{const u=db.prepare('SELECT * FROM users WHERE id=?').get(id);if(!u)return null;const at=IDS('SELECT id FROM atend WHERE prof_id=?',id),bq=[];
  if(u.id===c.u.id)bq.push('Você não pode excluir o próprio usuário.');
  if(u.role==='admin'&&u.ativo&&N("SELECT COUNT(*) n FROM users WHERE role='admin' AND ativo=1 AND id<>?",id)===0)bq.push('Este é o único administrador ativo: crie outro antes.');
  const fch=N('SELECT COUNT(*) n FROM fechamentos WHERE prof_id=?',id);if(fch)bq.push(fch+' fechamento(s) de pagamento deste profissional. Exclua-os antes, em Fechamento de profissionais.');
  const rb=N('SELECT COUNT(*) n FROM reembolsos WHERE prof_id=? AND (fech_id IS NOT NULL OR fat_id IS NOT NULL)',id);if(rb)bq.push(rb+' reembolso(s) de km deste profissional já estão em fechamento.');
  const rel=N('SELECT COUNT(*) n FROM relatos WHERE prof_id=?',id),pr=N('SELECT COUNT(*) n FROM prontuarios p WHERE p.prof_id=? AND NOT EXISTS(SELECT 1 FROM relatos r WHERE r.pront_id=p.id AND r.prof_id<>?)',id,id),fila=N("SELECT COUNT(*) n FROM chamados WHERE prof_id=? AND criado_por IS NULL AND status NOT IN ('Finalizado','Cancelado')",id);
  return{rotulo:'usuário',nome:u.nome+' ('+(ROLE_NOME[u.role]||u.role)+')',audit:u.role,bloq:bq,
   apaga:AP(['atendimentos',at.length],['relatos',rel],['prontuários sem relatos de outros profissionais',pr],['chamados criados por este usuário',N('SELECT COUNT(*) n FROM chamados WHERE criado_por=?',id)],['reembolsos de km',N('SELECT COUNT(*) n FROM reembolsos WHERE prof_id=?',id)]),
   efeitos:fila?[fila+' chamado(s) deste profissional voltam para a fila de Chamados abertos.']:[],aviso:(at.length||rel||pr)?AVISO_CLIN:'',
   run:()=>{xAtend(at);xRelatos('prof_id=?',id);
    for(const p of IDS('SELECT id FROM prontuarios WHERE prof_id=?',id)){const o=db.prepare('SELECT prof_id FROM relatos WHERE pront_id=? AND prof_id<>? ORDER BY id DESC').get(p,id);if(o)db.prepare('UPDATE prontuarios SET prof_id=? WHERE id=?').run(o.prof_id,p);else xPront([p])}
    db.prepare('DELETE FROM chamados WHERE criado_por=?').run(id);db.prepare("UPDATE chamados SET prof_id=NULL,status=CASE WHEN status IN ('Finalizado','Cancelado') THEN status ELSE 'Novo chamado' END,atend_id=NULL,pront_id=NULL WHERE prof_id=?").run(id);
    db.prepare('DELETE FROM reembolsos WHERE prof_id=?').run(id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);db.prepare('DELETE FROM users WHERE id=?').run(id)}}},
 atendimento:id=>{const a=db.prepare('SELECT a.*,u.nome prof FROM atend a LEFT JOIN users u ON u.id=a.prof_id WHERE a.id=?').get(id);if(!a)return null;
  return{rotulo:'atendimento',nome:'#'+a.id+' de '+(a.data||'')+' · '+(a.prof||''),audit:'prof '+a.prof_id,bloq:a.fech_id?['Atendimento já incluído em fechamento de profissional. Exclua o fechamento antes.']:[],
   apaga:AP(['relatos vinculados',N('SELECT COUNT(*) n FROM relatos WHERE atend_id=?',id)]),efeitos:N('SELECT COUNT(*) n FROM chamados WHERE atend_id=?',id)?['O chamado vinculado volta para a fila de Chamados abertos.']:[],aviso:N('SELECT COUNT(*) n FROM relatos WHERE atend_id=?',id)?AVISO_CLIN:'',run:()=>xAtend([id])}},
 chamado:id=>{const h=db.prepare('SELECT * FROM chamados WHERE id=?').get(id);if(!h)return null;const at=IDS('SELECT id FROM atend WHERE id=? OR chamado_id=?',h.atend_id||0,id),f=N('SELECT COUNT(*) n FROM atend WHERE id IN ('+inl(at)+') AND fech_id IS NOT NULL');
  return{rotulo:'chamado',nome:h.protocolo+' · '+h.tema,audit:h.protocolo,bloq:f?['O atendimento deste chamado já está em fechamento de profissional. Exclua o fechamento antes.']:[],
   apaga:AP(['atendimento vinculado',at.length],['relatos vinculados',N('SELECT COUNT(*) n FROM relatos WHERE atend_id IN ('+inl(at)+')')]),aviso:'',run:()=>{xAtend(at);db.prepare('DELETE FROM chamados WHERE id=?').run(id)}}},
 reembolso:id=>{const r=db.prepare('SELECT * FROM reembolsos WHERE id=?').get(id);if(!r)return null;
  return{rotulo:'reembolso de km',nome:(r.data||'')+' · '+r.km+' km · R$ '+Number(r.valor||0).toFixed(2).replace('.',','),audit:'prof '+r.prof_id,bloq:(r.fech_id||r.fat_id)?['Reembolso já incluído em fechamento. Exclua o fechamento antes.']:[],apaga:[],aviso:'',run:()=>db.prepare('DELETE FROM reembolsos WHERE id=?').run(id)}},
 despesa:id=>{const d=db.prepare('SELECT * FROM despesas WHERE id=?').get(id);if(!d)return null;
  return{rotulo:'despesa',nome:(d.data||'')+' · '+(d.descricao||d.tipo||'')+' · R$ '+Number(d.valor||0).toFixed(2).replace('.',','),audit:'cliente '+d.client_id,bloq:d.fat_id?['Despesa já incluída em fechamento de cliente. Exclua o fechamento antes.']:[],apaga:[],aviso:'',run:()=>db.prepare('DELETE FROM despesas WHERE id=?').run(id)}},
 fechamento_prof:id=>{const f=db.prepare('SELECT f.*,u.nome prof FROM fechamentos f LEFT JOIN users u ON u.id=f.prof_id WHERE f.id=?').get(id);if(!f)return null;
  const na=N('SELECT COUNT(*) n FROM atend WHERE fech_id=?',id),nr=N('SELECT COUNT(*) n FROM reembolsos WHERE fech_id=?',id),rf=N('SELECT COUNT(*) n FROM reembolsos WHERE fech_id=? AND fat_id IS NOT NULL',id);
  return{rotulo:'fechamento de profissional',nome:(f.prof||'')+' · '+String(f.mes).padStart(2,'0')+'/'+f.ano+' · R$ '+Number(f.liquido||0).toFixed(2).replace('.',','),audit:'prof '+f.prof_id+' '+f.ano+'-'+f.mes+(f.pago_em?' (pago)':''),
   bloq:rf?[rf+' reembolso(s) deste fechamento já foram repassados a clientes. Reabra o fechamento do cliente antes.']:[],apaga:[],
   efeitos:[na+' atendimento(s) voltam para “Aprovado” e '+nr+' reembolso(s) de km ficam livres para um novo fechamento.'],aviso:f.pago_em?'Este fechamento já está registrado como PAGO em '+String(f.pago_em).slice(0,10)+'.':'',
   run:()=>{db.prepare("UPDATE atend SET fech_id=NULL,status='Aprovado' WHERE fech_id=?").run(id);db.prepare('UPDATE reembolsos SET fech_id=NULL WHERE fech_id=?').run(id);db.prepare('DELETE FROM fechamentos WHERE id=?').run(id)}}},
 fechamento_cli:(id,c)=>{const f=db.prepare('SELECT f.*,cl.fantasia FROM faturamentos f LEFT JOIN clients cl ON cl.id=f.client_id WHERE f.id=?').get(id);if(!f)return null;
  return{rotulo:'fechamento de cliente',nome:(f.fantasia||'')+' · '+String(f.mes).padStart(2,'0')+'/'+f.ano+' · R$ '+Number(f.total||0).toFixed(2).replace('.',','),audit:'cliente '+f.client_id+' '+f.ano+'-'+f.mes+' '+f.status,bloq:[],apaga:[],
   efeitos:['Despesas e reembolsos de km deste fechamento ficam livres para um novo fechamento.'],aviso:f.status==='Faturado'?'Este fechamento já foi FATURADO'+(f.nf?' (NF '+f.nf+')':'')+': confirme que a nota fiscal foi tratada fora do sistema.':'',semTx:true,
   run:()=>reabrirFat(c,f,'Exclusão pelo administrador',true)}},
 campanha:id=>{const k=db.prepare('SELECT * FROM campaigns WHERE id=?').get(id);if(!k)return null;
  return{rotulo:'pesquisa (campanha)',nome:k.nome,audit:'cliente '+k.client_id,bloq:[],apaga:AP(['respostas',N('SELECT COUNT(*) n FROM responses WHERE campaign_id=?',id)],['códigos de acesso',N('SELECT COUNT(*) n FROM codigos WHERE campaign_id=?',id)]),aviso:'',run:()=>xCamp(id)}},
 formulario:id=>{const f=db.prepare('SELECT * FROM forms WHERE id=?').get(id);if(!f)return null;const nc=N('SELECT COUNT(*) n FROM campaigns WHERE form_id=?',id),bq=[];
  if(f.modelo)bq.push('Formulários-modelo do sistema não podem ser excluídos (duplique para criar o seu).');if(nc)bq.push(nc+' campanha(s) usam este formulário. Exclua-as antes.');
  return{rotulo:'formulário',nome:f.nome,audit:'form',bloq:bq,apaga:[],aviso:'',run:()=>db.prepare('DELETE FROM forms WHERE id=?').run(id)}}
};
const ROLE_NOME={admin:'Administrador',psicologo:'Psicólogo(a)',assistente_social:'Assistente social',cliente:'Cliente',outro:'Outro'};
const planExc=c=>{const f=PLAN[c.params.ent];if(!f)throw E(404,'Tipo de registro desconhecido.');const p=f(+c.params.id,c);if(!p)throw E(404,'Registro não encontrado (talvez já tenha sido excluído).');return p};
R('GET','/api/excluir/:ent/:id',['admin'],c=>{const p=planExc(c);return{rotulo:p.rotulo,nome:p.nome,bloqueios:p.bloq,apagara:p.apaga,efeitos:p.efeitos||[],aviso:p.aviso||''}});
R('POST','/api/excluir/:ent/:id',['admin'],c=>{const p=planExc(c);if(p.bloq.length)throw E(409,p.bloq.join(' '));if(c.body.confirma!=='EXCLUIR')throw E(400,'Digite EXCLUIR para confirmar.');
 if(p.semTx)p.run();else{db.exec('BEGIN');try{p.run();db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}}
 audit(c.u,'exclusao_'+c.params.ent,c.params.id+':'+(p.audit||''),c.ip);return{ok:1,apagados:p.apaga}});

if(require.main===module){const port=process.env.PORT||3000,host=process.env.ACELLA_HOST||'127.0.0.1';server.listen(port,host,()=>console.log('ACELLA em http://localhost:'+port+(host==='127.0.0.1'?'  (acessível somente neste computador)':'  (escutando em '+host+')')))}
module.exports={server};
