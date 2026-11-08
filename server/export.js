'use strict';
// Geração de XLSX e PDF sem dependências (Node >= 22.2)
const zlib=require('zlib');
function zip(files){const parts=[],cd=[];let off=0;
 for(const[n,b]of files){const nb=Buffer.from(n),d=zlib.deflateRawSync(b),crc=zlib.crc32(b),h=Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(0x0800,6);h.writeUInt16LE(8,8);h.writeUInt16LE(0x21,12);h.writeUInt32LE(crc,14);h.writeUInt32LE(d.length,18);h.writeUInt32LE(b.length,22);h.writeUInt16LE(nb.length,26);parts.push(h,nb,d);
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x0800,8);c.writeUInt16LE(8,10);c.writeUInt16LE(0x21,14);c.writeUInt32LE(crc,16);c.writeUInt32LE(d.length,20);c.writeUInt32LE(b.length,24);c.writeUInt16LE(nb.length,28);c.writeUInt32LE(off,42);cd.push(c,nb);off+=30+nb.length+d.length}
 const cdb=Buffer.concat(cd),e=Buffer.alloc(22);e.writeUInt32LE(0x06054b50,0);e.writeUInt16LE(files.length,8);e.writeUInt16LE(files.length,10);e.writeUInt32LE(cdb.length,12);e.writeUInt32LE(off,16);return Buffer.concat([...parts,cdb,e])}
const x=s=>String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const col=i=>{let s='';for(i++;i>0;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s};
const serial=d=>{const m=/^(\d{4})-(\d\d)-(\d\d)/.exec(d||'');return m?Math.round(Date.UTC(+m[1],+m[2]-1,+m[3])/864e5)+25569:null};
const ST={s:0,m:2,d:3,n:4};
/* sheets: [{nome, cols:[{h,w,t:'s'|'m'|'d'|'n'}], rows:[[...]]}] */
function xlsx(sheets){const names=sheets.map((s,i)=>x(s.nome.replace(/[\[\]\*\?:\/\\]/g,'').slice(0,31)||'Aba'+(i+1)));
 const sh=sheets.map(s=>{const rows=[s.cols.map((c,i)=>`<c r="${col(i)}1" t="inlineStr" s="1"><is><t>${x(c.h)}</t></is></c>`).join('')];
  s.rows.forEach((r,ri)=>rows.push(s.cols.map((c,i)=>{const v=r[i],ref=col(i)+(ri+2);if(v==null||v==='')return'';
   if(c.t==='d'){const n=serial(v);return n?`<c r="${ref}" s="3"><v>${n}</v></c>`:''}
   if(c.t==='m'||c.t==='n')return isFinite(+v)?`<c r="${ref}" s="${ST[c.t]}"><v>${+v}</v></c>`:'';
   return`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${x(v)}</t></is></c>`}).join('')));
  const last=col(s.cols.length-1)+(s.rows.length+1);
  return`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${s.cols.map((c,i)=>`<col min="${i+1}" max="${i+1}" width="${c.w||16}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.map((r,i)=>`<row r="${i+1}"${i===0?' ht="22" customHeight="1"':''}>${r}</row>`).join('')}</sheetData><autoFilter ref="A1:${last}"/></worksheet>`});
 const H='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
 const files=[['[Content_Types].xml',`${H}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sh.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
 ['_rels/.rels',`${H}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
 ['xl/workbook.xml',`${H}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n,i)=>`<sheet name="${n}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`],
 ['xl/_rels/workbook.xml.rels',`${H}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sh.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${sh.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
 ['xl/styles.xml',`${H}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;R$&quot;\\ #,##0.00"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF052E57"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
 ...sh.map((s,i)=>[`xl/worksheets/sheet${i+1}.xml`,s])].map(([n,s])=>[n,Buffer.from(s,'utf8')]);
 return zip(files)}
/* PDF A4 simples (Helvetica, WinAnsi) */
class Doc{constructor(){this.pages=[[]];this.y=790}
 get p(){return this.pages[this.pages.length-1]}
 need(h){if(this.y-h<60){this.pages.push([]);this.y=790}}
 clean(s){return String(s).replace(/[–—]/g,'-').replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/[•·]/g,'-').replace(/[^\n\x20-\xFF]/g,'?').replace(/[\\()]/g,'\\$&')}
 text(x0,y,size,s,b,rgb=[0.08,0.15,0.22]){this.p.push(`BT /F${b?2:1} ${size} Tf ${rgb.join(' ')} rg ${x0} ${y} Td (${this.clean(s)}) Tj ET`)}
 rect(x0,y,w,h,rgb){this.p.push(`${rgb.join(' ')} rg ${x0} ${y} ${w} ${h} re f`)}
 line(s,size=10.5,b=false,x0=50,gap=1.45,rgb){const max=Math.floor((495-(x0-50))/(size*0.53));String(s).split('\n').forEach(par=>{let cur='';const ws=par.split(' ');const flush=()=>{this.need(size*gap);this.text(x0,this.y,size,cur,b,rgb);this.y-=size*gap;cur=''};ws.forEach(w=>{if((cur+' '+w).trim().length>max&&cur)flush();cur=(cur+' '+w).trim()});flush()})}
 h(s,size=15){this.y-=10;this.need(size*2.4);this.text(50,this.y,size,s,true,[0.02,0.18,0.34]);this.y-=size*1.7}
 bar(label,v,max=5){this.need(28);const c=v<2.5?[0.18,0.71,0.45]:v<3.2?[0.95,0.76,0.19]:v<3.8?[0.93,0.54,0.17]:[0.85,0.22,0.17];this.text(50,this.y,12,label,false);this.rect(248,this.y-3,205,13,[0.89,0.95,0.98]);this.rect(248,this.y-3,205*Math.min(v,max)/max,13,c);this.text(466,this.y,12.5,v.toFixed(2).replace('.',','),true);this.y-=28}
 pageBreak(){this.pages.push([]);this.y=790}
 band(title,sub){this.p.push('0.02 0.18 0.34 rg 0 740 595 102 re f','0.004 0.667 0.635 rg 0 734 595 6 re f');this.text(50,800,28,title,true,[1,1,1]);this.text(50,764,13,sub,false,[0.85,0.93,0.98]);this.y=706}
 kpi4(items){this.need(90);const w=(495-10*(items.length-1))/items.length,y=this.y;items.forEach(([v,l,col],i)=>{const x0=50+i*(w+10);this.rect(x0,y-66,w,66,[0.95,0.97,0.99]);this.rect(x0,y-66,5,66,col);this.text(x0+16,y-33,23,v,true);this.text(x0+16,y-54,10.5,l,false,[0.32,0.4,0.48])});this.y=y-88}
 legend(){this.need(30);const it=[['Baixo (<2,5)',[0.18,0.71,0.45]],['Moderado (<3,2)',[0.95,0.76,0.19]],['Alto (<3,8)',[0.93,0.54,0.17]],['Crítico (3,8 ou mais)',[0.85,0.22,0.17]]];it.forEach(([t,c],i)=>{const x0=50+i*125;this.rect(x0,this.y-1,10,10,c);this.text(x0+16,this.y,10.5,t,false,[0.32,0.4,0.48])});this.y-=18}
 dot(rgb,s){this.need(24);this.rect(50,this.y-1,10,10,rgb);this.text(68,this.y,12.5,s,false);this.y-=24}
 count(label,n,mx){this.need(26);this.text(50,this.y,12.5,label,false);if(typeof n==='number'){this.rect(140,this.y-3,300*n/mx,13,[0.004,0.667,0.635])}this.text(typeof n==='number'?140+300*n/mx+8:140,this.y,12.5,String(n),true);this.y-=26}
 build(footer){const objs=[];const n=this.pages.length,N=(i)=>5+i*2;
  objs[1]='<< /Type /Catalog /Pages 2 0 R >>';objs[2]=`<< /Type /Pages /Kids [${this.pages.map((_,i)=>N(i)+1+' 0 R').join(' ')}] /Count ${n} >>`;
  objs[3]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';objs[4]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  this.pages.forEach((p,i)=>{const f=`BT /F1 9 Tf 0.4 0.4 0.4 rg 50 28 Td (${this.clean(footer+' - pagina '+(i+1)+'/'+n)}) Tj ET`,s=p.concat([f]).join('\n');objs[N(i)]=`<< /Length ${Buffer.byteLength(s,'latin1')} >>\nstream\n${s}\nendstream`;objs[N(i)+1]=`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${N(i)} 0 R >>`});
  let out='%PDF-1.4\n',off=[0];for(let i=1;i<objs.length;i++){off[i]=Buffer.byteLength(out,'latin1');out+=`${i} 0 obj\n${objs[i]}\nendobj\n`}
  const xr=Buffer.byteLength(out,'latin1');out+=`xref\n0 ${objs.length}\n0000000000 65535 f \n`+off.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xr}\n%%EOF`;return Buffer.from(out,'latin1')}}
module.exports={xlsx,Doc,zip};
