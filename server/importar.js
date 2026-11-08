'use strict';
// Leitura de planilhas (.xlsx e .csv) e mapeamento de colunas, sem dependências (Node >= 22).
// Usado pela importação de colaboradores e dependentes.
const zlib=require('zlib');
const USER=m=>Object.assign(new Error(m),{user:true});

/* ---------- utilidades compartilhadas com o servidor ---------- */
const digits=x=>String(x??'').replace(/\D/g,'');
const cpfOk=d=>{d=digits(d);if(d.length!==11||/^(\d)\1+$/.test(d))return false;const f=n=>{let t=0;for(let i=0;i<n;i++)t+=+d[i]*(n+1-i);const r=t*10%11;return r===10?0:r};return f(9)===+d[9]&&f(10)===+d[10]};
const norm=x=>String(x??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const serialISO=n=>new Date(Date.UTC(1899,11,30)+Math.floor(n)*864e5).toISOString().slice(0,10);
/* Data de nascimento: aceita AAAA-MM-DD e DD/MM/AAAA. '' = vazio, null = inválida. */
function parseNasc(v){if(v==null||String(v).trim()==='')return'';const s=String(v).trim();let y,m,d,x;
 if((x=/^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))){y=+x[1];m=+x[2];d=+x[3]}
 else if((x=/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/.exec(s))){d=+x[1];m=+x[2];y=+x[3]}
 else return null;
 const dt=new Date(Date.UTC(y,m-1,d));if(dt.getUTCFullYear()!==y||dt.getUTCMonth()!==m-1||dt.getUTCDate()!==d||y<1900||dt>new Date())return null;
 return y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0')}
/* Valor de célula do Excel: se vier como número de série (5 dígitos) sem formato de data, converte. */
const nascCel=v=>{v=String(v??'').trim();if(/^\d{5}$/.test(v)&&+v>=10000&&+v<60000)return parseNasc(serialISO(+v));return parseNasc(v)};
/* CPF vindo do Excel como número perde zeros à esquerda: completa para 11 dígitos. */
const cpfCel=v=>{const d=digits(v);return d.length>=9&&d.length<11?d.padStart(11,'0'):d};
function parentesco(v){const t=norm(v).trim();if(!t)return'outro';
 if(/^(filh|entead)/.test(t))return'filho(a)';if(/conjuge|espos|marid|companheir/.test(t))return'cônjuge/companheiro(a)';
 if(/^(pai|mae|padrast|madrast)/.test(t))return'pai/mãe';if(/^irma/.test(t))return'irmão(ã)';return'outro'}

/* ---------- ZIP / XLSX ---------- */
function unzip(buf){const files=new Map();let e=-1;
 for(let i=buf.length-22;i>=Math.max(0,buf.length-65557);i--)if(buf.readUInt32LE(i)===0x06054b50){e=i;break}
 if(e<0)throw USER('O arquivo não é uma planilha .xlsx válida.');
 const n=buf.readUInt16LE(e+10);let p=buf.readUInt32LE(e+16),total=0;
 for(let i=0;i<n;i++){if(p+46>buf.length||buf.readUInt32LE(p)!==0x02014b50)break;
  const method=buf.readUInt16LE(p+10),csize=buf.readUInt32LE(p+20),usize=buf.readUInt32LE(p+24),nl=buf.readUInt16LE(p+28),el=buf.readUInt16LE(p+30),cl=buf.readUInt16LE(p+32),lo=buf.readUInt32LE(p+42),name=buf.toString('utf8',p+46,p+46+nl);p+=46+nl+el+cl;
  if(!/^xl\/(workbook\.xml|styles\.xml|sharedStrings\.xml|_rels\/workbook\.xml\.rels|worksheets\/[^/]+\.xml)$/.test(name))continue;
  if(usize>60e6||(total+=usize)>120e6)throw USER('Planilha grande demais para importar. Divida em arquivos menores.');
  const ln=buf.readUInt16LE(lo+26),le=buf.readUInt16LE(lo+28),ds=lo+30+ln+le,raw=buf.subarray(ds,ds+csize);
  files.set(name,method===0?raw:zlib.inflateRawSync(raw,{maxOutputLength:60e6}))}
 return files}
const dx=s=>s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(m,g)=>{g=g.toLowerCase();if(g[0]==='#'){const n=g[1]==='x'?parseInt(g.slice(2),16):+g.slice(1);return n>0&&n<0x110000?String.fromCodePoint(n):''}return{amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[g]});
const attrs=s=>{const o={};s.replace(/([\w:.-]+)\s*=\s*"([^"]*)"/g,(m,k,v)=>{o[k]=dx(v)});return o};
const colIdx=l=>{let n=0;for(const ch of l)n=n*26+ch.charCodeAt(0)-64;return n-1};
const ehData=(id,f)=>{if((id>=14&&id<=22)||(id>=27&&id<=36)||(id>=45&&id<=47)||(id>=50&&id<=58))return true;if(!f)return false;const g=f.replace(/"[^"]*"|\[[^\]]*\]|\\./g,'');return /[dmyhs]/i.test(g)&&!/general/i.test(g)};
function estilosData(x){const fm={},set=new Set();x.replace(/<numFmt\b([^>]*?)\/?>/g,(m,a)=>{const o=attrs(a);fm[o.numFmtId]=o.formatCode||''});
 const cx=/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(x);if(!cx)return set;let i=0;
 cx[1].replace(/<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g,(m,a)=>{const id=+attrs(a).numFmtId||0;if(ehData(id,fm[id]))set.add(i);i++});return set}
const numTxt=raw=>{const n=+raw;return Number.isFinite(n)&&Number.isInteger(n)&&Math.abs(n)<1e21?BigInt(n).toString():raw};
function lerAba(x,ss,dateXf){const rows=[];
 x.replace(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g,(m,a,body)=>{const ri=(+attrs(a).r||rows.length+1)-1;if(ri>=50000||!body)return;const cells=[];let seq=0;
  body.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,(mm,ca,cb)=>{const o=attrs(ca);let ci=seq;if(o.r){const mt=/^([A-Z]+)/.exec(o.r);if(mt)ci=colIdx(mt[1])}seq=ci+1;if(ci>=80||cb==null)return;
   let v='';
   if(o.t==='inlineStr'){cb.replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g,(a1,b1)=>{v+=dx(b1)})}
   else{const mv=/<v>([\s\S]*?)<\/v>/.exec(cb);if(!mv)return;const raw=dx(mv[1]);
    if(o.t==='s')v=ss[+raw]??'';else if(o.t==='str')v=raw;else if(o.t==='e')v='';else if(o.t==='b')v=raw==='1'?'VERDADEIRO':'FALSO';
    else v=dateXf.has(+o.s)&&Number.isFinite(+raw)&&+raw>=1?serialISO(+raw):numTxt(raw)}
   cells[ci]=String(v).trim()});
  for(let i=0;i<cells.length;i++)if(cells[i]===undefined)cells[i]='';rows[ri]=cells});
 for(let i=0;i<rows.length;i++)if(!rows[i])rows[i]=[];return rows}
function abrirXlsx(buf){const F=unzip(buf);if(!F.has('xl/workbook.xml'))throw USER('Planilha inválida: não encontrei o conteúdo do Excel.');
 const txt=n=>F.has(n)?F.get(n).toString('utf8'):'',rels={},abas=[],ss=[];
 txt('xl/_rels/workbook.xml.rels').replace(/<Relationship\b([^>]*?)\/?>/g,(m,a)=>{const o=attrs(a);if(o.Id)rels[o.Id]=o.Target});
 txt('xl/workbook.xml').replace(/<sheet\b([^>]*?)\/?>/g,(m,a)=>{const o=attrs(a),t=rels[o['r:id']];if(t)abas.push({nome:o.name||'',arq:t.startsWith('/')?t.slice(1):t.startsWith('xl/')?t:'xl/'+t})});
 txt('xl/sharedStrings.xml').replace(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\s*\/>/g,(m,b)=>{b=(b||'').replace(/<rPh\b[\s\S]*?<\/rPh>/g,'');let t='';b.replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g,(x,y)=>{t+=dx(y)});ss.push(t)});
 const dateXf=estilosData(txt('xl/styles.xml'));
 return abas.map(a=>({nome:a.nome,linhas:()=>lerAba(txt(a.arq),ss,dateXf)}))}

/* ---------- CSV ---------- */
function lerCsv(buf){let t;try{t=new TextDecoder('utf-8',{fatal:true}).decode(buf)}catch(e){t=new TextDecoder('windows-1252').decode(buf)}
 t=t.replace(/^\uFEFF/,'');const first=t.split(/\r?\n/,1)[0]||'',cnt=c=>first.split(c).length-1,d=[';',',','\t'].sort((a,b)=>cnt(b)-cnt(a))[0];
 const rows=[];let row=[],cur='',q=false;
 for(let i=0;i<t.length;i++){const ch=t[i];
  if(q){if(ch==='"'){if(t[i+1]==='"'){cur+='"';i++}else q=false}else cur+=ch}
  else if(ch==='"')q=true;else if(ch===d){row.push(cur.trim());cur=''}
  else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&t[i+1]==='\n')i++;row.push(cur.trim());cur='';rows.push(row);row=[];if(rows.length>=50000)break}
  else cur+=ch}
 if(cur!==''||row.length){row.push(cur.trim());rows.push(row)}return rows}

/* ---------- mapeamento de colunas ---------- */
const HDR=s=>norm(s).replace(/[^a-z0-9]+/g,' ').trim();
function achaCab(linhas,fn){for(let i=0;i<Math.min(linhas.length,20);i++){const cab=(linhas[i]||[]).map(HDR);if(cab.filter(Boolean).length<2)continue;const m=fn(cab);if(m)return{i,m}}return null}
const vazia=L=>!L||L.every(x=>String(x??'').trim()==='');
const nomeCol=(linhas,i,idx)=>idx!=null&&idx>=0?String(linhas[i][idx]||''):'';
function mapColab(linhas){
 const r=achaCab(linhas,cab=>{const cpf=cab.findIndex(h=>/\bcpf\b/.test(h));if(cpf<0)return null;
  const nome=cab.findIndex((h,i)=>i!==cpf&&/\bnome\b|^colaborador$|^funcionario$|^empregado$/.test(h));if(nome<0)return null;
  const ach=re=>cab.findIndex((h,i)=>i!==cpf&&i!==nome&&re.test(h));return{cpf,nome,cargo:ach(/cargo|funcao|ocupacao/),nasc:ach(/nasc|aniversario/)}});
 if(!r)return null;const{i,m}=r,itens=[];
 for(let k=i+1;k<linhas.length;k++){const L=linhas[k];if(vazia(L))continue;itens.push({linha:k+1,nome:L[m.nome]||'',cpf:L[m.cpf]||'',cargo:m.cargo>=0?L[m.cargo]||'':'',nasc:m.nasc>=0?L[m.nasc]||'':''})}
 return{colunas:{Nome:nomeCol(linhas,i,m.nome),CPF:nomeCol(linhas,i,m.cpf),Cargo:nomeCol(linhas,i,m.cargo),Nascimento:nomeCol(linhas,i,m.nasc)},itens}}
function mapDep(linhas){
 const r=achaCab(linhas,cab=>{const cpfs=cab.map((h,i)=>/\bcpf\b/.test(h)?i:-1).filter(i=>i>=0);
  let ct=cpfs.find(i=>/colab|titular|funcion|empreg|responsavel/.test(cab[i])),cd=cpfs.find(i=>/depend|filho|parente/.test(cab[i]));const rest=cpfs.filter(i=>i!==ct&&i!==cd);
  if(ct==null&&cd==null){if(rest.length>=2){ct=rest[0];cd=rest[1]}else if(rest.length===1)ct=rest[0]}else if(ct==null&&rest.length)ct=rest[0];else if(cd==null&&rest.length)cd=rest[0];
  const used=new Set([ct,cd].filter(x=>x!=null));
  const nt=cab.findIndex((h,i)=>!used.has(i)&&/colab|titular|funcion|empreg/.test(h)&&/nome|^colaborador$|^titular$|^funcionario$|^empregado$/.test(h));if(nt>=0)used.add(nt);
  let nd=cab.findIndex((h,i)=>!used.has(i)&&/nome.*depend|depend.*nome|^dependente$/.test(h));if(nd<0)nd=cab.findIndex((h,i)=>!used.has(i)&&/\bnome\b/.test(h));
  if(nd<0||(ct==null&&nt<0))return null;used.add(nd);
  const pa=cab.findIndex((h,i)=>!used.has(i)&&/parent|grau|relacao/.test(h));
  const ns=cab.map((h,i)=>/nasc|aniversario/.test(h)&&!used.has(i)?i:-1).filter(i=>i>=0),na=ns.find(i=>/depend/.test(cab[i]))??ns[ns.length-1]??-1;
  return{ct:ct??-1,cd:cd??-1,nt,nd,pa,na}});
 if(!r)return null;const{i,m}=r,itens=[],g=(L,x)=>x>=0?L[x]||'':'';
 for(let k=i+1;k<linhas.length;k++){const L=linhas[k];if(vazia(L))continue;
  itens.push({linha:k+1,cpf_titular:g(L,m.ct),nome_titular:g(L,m.nt),nome:g(L,m.nd),parentesco:g(L,m.pa),nasc:g(L,m.na),cpf:g(L,m.cd)})}
 return{colunas:{'CPF do colaborador':nomeCol(linhas,i,m.ct),'Nome do colaborador':nomeCol(linhas,i,m.nt),'Nome do dependente':nomeCol(linhas,i,m.nd),Parentesco:nomeCol(linhas,i,m.pa),Nascimento:nomeCol(linhas,i,m.na),'CPF do dependente':nomeCol(linhas,i,m.cd)},itens}}

/* Lê o arquivo e devolve {aba, colunas, itens}. Erros de usuário têm .user=true */
function analisar(buf,tipo){
 let abas;
 if(buf[0]===0x50&&buf[1]===0x4b)abas=abrirXlsx(buf);
 else if(buf[0]===0xD0&&buf[1]===0xCF)throw USER('Este é um arquivo .xls antigo. No Excel use "Salvar como" → "Pasta de Trabalho do Excel (.xlsx)" (ou CSV) e envie de novo.');
 else abas=[{nome:'CSV',linhas:()=>lerCsv(buf)}];
 if(!abas.length)throw USER('A planilha não tem abas.');
 const pref=tipo==='dependentes'?/depend/i:/colab|funcion|empreg|cadastro/i,ord=[...abas.filter(a=>pref.test(a.nome)),...abas.filter(a=>!pref.test(a.nome))],map=tipo==='dependentes'?mapDep:mapColab;
 for(const a of ord){const r=map(a.linhas());if(r)return{aba:a.nome,...r}}
 throw USER(tipo==='dependentes'
  ?'Não encontrei as colunas obrigatórias. Para dependentes são necessárias: CPF (ou nome) do colaborador e Nome do dependente. Baixe o modelo para conferir.'
  :'Não encontrei as colunas "Nome" e "CPF" na primeira linha da planilha. Baixe o modelo para conferir.')}

module.exports={digits,cpfOk,norm,parseNasc,nascCel,cpfCel,parentesco,analisar,lerCsv,abrirXlsx};
