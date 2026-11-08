'use strict';
// Backup consistente do banco (não copia a chave). Uso: node --no-warnings server/backup.js [pasta-destino]
// Variáveis: ACELLA_DATA (pasta dos dados) · KEEP (quantas cópias manter, padrão 14)
const path=require('path'),fs=require('fs');const {DatabaseSync}=require('node:sqlite');
const data=process.env.ACELLA_DATA||path.join(__dirname,'data'),dest=path.resolve(process.argv[2]||path.join(data,'backups')),keep=+process.env.KEEP||14;
fs.mkdirSync(dest,{recursive:true,mode:0o700});
const d=new Date(),p=n=>String(n).padStart(2,'0'),nome=`acella-${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.db`,out=path.join(dest,nome);
const db=new DatabaseSync(path.join(data,'acella.db'));db.exec(`VACUUM INTO '${out.replace(/'/g,"''")}'`);db.close();fs.chmodSync(out,0o600);
fs.readdirSync(dest).filter(f=>/^acella-\d{8}-\d{4}\.db$/.test(f)).sort().reverse().slice(keep).forEach(f=>fs.unlinkSync(path.join(dest,f)));
console.log('Backup criado:',out,'(guarde a chave ACELLA_KEY separadamente!)');
