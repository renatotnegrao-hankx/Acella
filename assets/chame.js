(()=>{
/* Aberto com dois cliques no arquivo (file://)? Se o sistema estiver ligado neste computador, segue sozinho para http://localhost:3000. */
if(location.protocol==='file:'){fetch('http://localhost:3000/api/public/temas',{mode:'no-cors'}).then(()=>location.replace('http://localhost:3000/'+(location.pathname.split('/').pop()||'index.html')+location.search+location.hash)).catch(()=>{})}
/* Botão "CHAME AQUI!": o colaborador escolhe o serviço e o pedido vira um chamado para a equipe da Acella. */
const BASE=[ /* usado só se o servidor não responder; o catálogo oficial vem de /api/public/temas */
 {grupo:'Apoio psicológico',tipo:'psicologico',temas:['Ajuda psicológica','Ansiedade e estresse','Dificuldades emocionais','Luto e perdas','Conflitos no ambiente de trabalho','Relacionamento interpessoal','Problemas familiares','Questões pessoais']},
 {grupo:'Serviço social',tipo:'social',temas:['Orientação social','Dificuldades financeiras e endividamento']},
 {grupo:'Outros assuntos',tipo:'indefinido',temas:['Assédio ou constrangimento','Outros assuntos']}];
const DICA={psicologico:'Atendimento com psicólogo(a)',social:'Atendimento com assistente social',indefinido:'Triagem pela equipe'};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const st=document.createElement('style');
st.textContent=`#chm{position:fixed;right:18px;bottom:18px;z-index:90;background:#ffc807;color:#031f3d;border:0;border-radius:18px;padding:12px 18px;font:700 1rem Outfit,sans-serif;cursor:pointer;box-shadow:0 10px 30px rgba(3,31,61,.3);text-align:left;line-height:1.2}#chm small{display:block;font-weight:500;font-size:.78rem}
#chd{border:0;border-radius:18px;padding:0;width:min(600px,95vw);max-height:92vh;font-family:Outfit,sans-serif;overflow:auto}#chd::backdrop{background:rgba(3,31,61,.55)}#chd form,#chd .ok{padding:22px}#chd h2{margin:0 0 4px;color:#052e57;font-size:1.4rem}
#chd h3{margin:16px 0 2px;font-size:.95rem;color:#052e57;display:flex;align-items:center;gap:8px;flex-wrap:wrap}#chd h3 small{font-weight:500;font-size:.75rem;background:#e3f3fb;color:#07508a;border-radius:99px;padding:2px 9px}
#chd .t{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0 4px}#chd .t label{position:relative;border:1.5px solid #d9e5ef;border-radius:12px;padding:10px;font-size:.86rem;cursor:pointer;line-height:1.25;display:block}
#chd .t label:has(input:checked){background:#e3f3fb;border-color:#01aaa2;font-weight:600}#chd .t input{position:absolute;opacity:0;pointer-events:none}#chd .t label:has(input:focus-visible){outline:3px solid #ffc807}
#chd .f{display:block;font-size:.88rem;font-weight:500;color:#052e57;margin-top:10px}#chd .f em{font-style:normal;font-weight:400;color:#52667a}
#chd select,#chd textarea,#chd input[type=text]{width:100%;box-sizing:border-box;border:1.5px solid #d9e5ef;border-radius:10px;padding:9px;font:inherit;margin:4px 0 2px}
#chd .two{display:grid;grid-template-columns:1fr 1fr;gap:10px}#chd button.go{width:100%;margin-top:12px;background:#052e57;color:#fff;border:0;border-radius:12px;padding:13px;font:600 1rem Outfit,sans-serif;cursor:pointer}#chd button.go:disabled{opacity:.6;cursor:wait}
#chd .s{font-size:.8rem;color:#52667a;margin:8px 0 0}#chd .x{float:right;background:none;border:0;font-size:1.5rem;cursor:pointer}#chd .emerg{background:#fff6dd;border-radius:10px;padding:9px 11px;font-size:.8rem;color:#5b4a00;margin-top:12px}#chd .err{color:#b3261e;font-size:.85rem;margin:8px 0 0;min-height:1em}
@media(max-width:560px){#chd .t,#chd .two{grid-template-columns:1fr}}`;
document.head.appendChild(st);
const b=document.createElement('button');b.id='chm';b.type='button';b.innerHTML='CHAME AQUI!<small>Em que posso ajudar?</small>';document.body.appendChild(b);
const d=document.createElement('dialog');d.id='chd';document.body.appendChild(d);
let CAT=null;
async function catalogo(){if(CAT)return CAT;try{const r=await fetch('/api/public/temas');if(!r.ok)throw 0;CAT=(await r.json()).catalogo}catch(e){CAT=BASE}return CAT}
const semServidor=()=>location.protocol==='file:'
 ?'Esta página foi aberta direto do arquivo e o sistema não está ligado neste computador. Inicie-o (dois cliques em "iniciar-windows.bat" ou "./iniciar.sh"), mantenha a janela preta aberta e atualize esta página: ela abrirá sozinha em http://localhost:3000.'
 :'Não foi possível falar com o sistema agora. Confirme se ele está iniciado e tente novamente em instantes.';
function form(cat,msg='',v={}){
 d.innerHTML=`<form novalidate><button type="button" class="x" aria-label="Fechar">×</button><h2>Em que posso ajudar?</h2>
<p class="s">Escolha o serviço que você procura. Seu pedido é tratado com sigilo por profissionais da Acella.</p>
${cat.map(g=>`<h3>${esc(g.grupo)}${DICA[g.tipo]?`<small>${esc(DICA[g.tipo])}</small>`:''}</h3><div class="t">${g.temas.map(x=>`<label><input type="radio" name="tema" value="${esc(x)}"${v.tema===x?' checked':''}>${esc(x)}</label>`).join('')}</div>`).join('')}
<label class="f">Quer contar brevemente o motivo? <em>(opcional)</em><textarea name="descricao" maxlength="1500" rows="3">${esc(v.descricao||'')}</textarea></label>
<div class="two"><label class="f">Seu nome <em>(opcional)</em><input type="text" name="nome" maxlength="150" autocomplete="name" value="${esc(v.nome||'')}"></label>
<label class="f">Empresa onde trabalha <em>(opcional)</em><input type="text" name="empresa" maxlength="120" value="${esc(v.empresa||'')}"></label></div>
<div class="two"><label class="f">Telefone ou e-mail para retorno <em>(sem ele não conseguimos retornar)</em><input type="text" name="contato" maxlength="150" value="${esc(v.contato||'')}"></label>
<label class="f">Seu CPF <em>(opcional: agiliza o atendimento)</em><input type="text" name="cpf" maxlength="14" inputmode="numeric" autocomplete="off" placeholder="000.000.000-00" value="${esc(v.cpf||'')}"></label></div>
<p class="s">Usamos estas informações apenas para o seu acolhimento. O CPF serve só para localizar o seu cadastro na empresa e não é guardado neste pedido. Não informe dados que não queira compartilhar.</p>
<p class="emerg">Em caso de risco à vida ligue <strong>192</strong> (SAMU), <strong>190</strong> (Polícia) ou <strong>188</strong> (CVV, apoio emocional). Violência contra a mulher: <strong>180</strong>.</p>
<p class="err" role="alert">${esc(msg)}</p><button class="go">Solicitar atendimento</button></form>`;
 d.querySelector('.x').onclick=()=>d.close();
 d.querySelector('form').onsubmit=async e=>{e.preventDefault();const f=e.target,o=Object.fromEntries(new FormData(f)),btn=f.querySelector('.go'),er=f.querySelector('.err');
  if(!o.tema){er.textContent='Escolha um dos serviços acima para continuar.';return}
  if(location.protocol==='file:'){er.textContent=semServidor();return}
  btn.disabled=true;er.textContent='';
  try{const r=await fetch('/api/public/chamados',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(o)}),j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.erro||'Não foi possível enviar agora. Tente novamente.');
   d.innerHTML=`<div class="ok"><h2>Recebemos o seu pedido</h2><p>Seu protocolo é <b style="font-size:1.2rem">${esc(j.protocolo)}</b>.<br>Guarde este número. Nossa equipe fará a triagem e entrará em contato${o.contato?'':' (como você não deixou contato, informe o protocolo ao RH ou à Acella para acompanharmos)'}.</p><button class="go" onclick="this.closest('dialog').close()">Fechar</button></div>`}
  catch(x){form(cat,x instanceof TypeError?semServidor():x.message,o)}}}
/* No site estático (acella.com.br, GitHub Pages) não há servidor: o botão leva à mesma página no portal, que abre o formulário. */
const ESTATICO=/^(www\.)?acella\.com\.br$/.test(location.hostname);
b.onclick=async()=>{if(ESTATICO){location.href='https://portal.acella.com.br'+location.pathname+'#chame';return}form(await catalogo());d.showModal()};
if(!ESTATICO&&location.hash==='#chame'){history.replaceState(null,'',location.pathname+location.search);b.onclick()}
})();
