const $=s=>document.querySelector(s);
const esc=s=>s.replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const LS={get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
let cur=null,M={bm:[],hl:[]},page=0,total=1,Vw=1,tab="c",libBks=[],db=null,mem={},tm=0,view="flow",opdf=null,oZ=1,oIO=null,curO=0,oq=Promise.resolve();
const FONTS={garamond:'"EB Garamond",Garamond,Georgia,serif',serif:'Literata,Georgia,serif',classic:'Georgia,"Times New Roman",serif',sans:'system-ui,-apple-system,"Segoe UI",sans-serif'};
let S=Object.assign({theme:null,mode:"page",font:"garamond",size:21,lh:1.5,w:32,just:true},LS.get("folio.s3",{}));
/* storage: meta store (light) + books store (text) */
const idb=()=>new Promise(res=>{try{const r=indexedDB.open("folio",4);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains("books"))d.createObjectStore("books",{keyPath:"id"});if(!d.objectStoreNames.contains("meta"))d.createObjectStore("meta",{keyPath:"id"});if(!d.objectStoreNames.contains("ocr"))d.createObjectStore("ocr",{keyPath:"key"});if(!d.objectStoreNames.contains("files"))d.createObjectStore("files",{keyPath:"id"})};r.onsuccess=()=>res(r.result);r.onerror=()=>res(null)}catch(e){res(null)}});
const tx=(s,m)=>db.transaction(s,m).objectStore(s);
const req=r=>new Promise(res=>{r.onsuccess=()=>res(r.result);r.onerror=()=>res(null)});
const metaOf=b=>({id:b.id,title:b.title,pages:b.pages,cover:b.cover,added:b.added,n:b.chapters.length,scan:!!b.scan&&!b.chapters.length});
async function metas(){
  if(!db)return Object.values(mem).map(metaOf);
  let m=(await req(tx("meta").getAll()))||[];
  if(!m.length){const bs=(await req(tx("books").getAll()))||[];m=bs.map(metaOf);m.forEach(x=>{try{tx("meta","readwrite").put(x)}catch(e){}})}
  return m;
}
const getBook=async id=>db?await req(tx("books").get(id)):mem[id];
function put(b){if(!db){mem[b.id]=b;return}try{const t=db.transaction(["books","meta"],"readwrite");t.objectStore("books").put(b);t.objectStore("meta").put(metaOf(b))}catch(e){}}
function del(id){delete mem[id];if(db)try{const t=db.transaction(["books","meta","files"],"readwrite");t.objectStore("books").delete(id);t.objectStore("meta").delete(id);t.objectStore("files").delete(id)}catch(e){}}
async function storage(){try{const e=await navigator.storage.estimate(),mb=e.usage/1048576;$("#sto").textContent="Library storage: "+(mb<10?mb.toFixed(1):Math.round(mb))+" MB used of about "+(e.quota/1073741824).toFixed(1)+" GB available on this device."}catch(x){}}
const saveM=()=>LS.set("folio.m."+cur.id,M);
/* settings */
function applyS(){
  const a=cur?curId():null,r=document.documentElement;
  const t=S.theme||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");
  r.dataset.theme=t;r.style.setProperty("--fs",S.size+"px");r.style.setProperty("--lh",S.lh);r.style.setProperty("--ff",FONTS[S.font]);
  document.querySelectorAll("[data-t]").forEach(b=>b.setAttribute("aria-pressed",b.dataset.t===t));
  document.querySelectorAll("[data-m]").forEach(b=>b.setAttribute("aria-pressed",b.dataset.m===S.mode));
  document.querySelectorAll("[data-vw]").forEach(b=>b.onclick=()=>setView(b.dataset.vw));
document.querySelectorAll("[data-f]").forEach(b=>b.setAttribute("aria-pressed",b.dataset.f===S.font));
  $("#jt").setAttribute("aria-pressed",S.just);
  LS.set("folio.s3",S);if(cur&&view==="flow")layout(a);
}
/* PDF -> chapters */
const med=a=>{a=[...a].sort((x,y)=>x-y);return a[a.length>>1]||0};
async function parse(buf,name,say){
  const pdf=await pdfjsLib.getDocument({data:buf}).promise;
  const N=pdf.numPages,pages=[];
  for(let i=1;i<=N;i++){
    const tc=await(await pdf.getPage(i)).getTextContent();
    const lines=[];let cur=null;
    for(const it of tc.items){
      if(!it.str)continue;
      const y=it.transform[5],h=Math.abs(it.transform[3])||it.height;
      if(cur&&Math.abs(y-cur.y)<Math.max(2,cur.h*.5)){cur.t+=it.str;cur.h=Math.max(cur.h,h)}
      else{cur={t:it.str,y,h};lines.push(cur)}
    }
    pages.push(lines.map(l=>({t:l.t.replace(/\s+/g," ").trim().replace(/\b([A-Za-z]{3,})\1\b/gi,(m,a)=>m.slice(0,a.length)===m.slice(a.length)?m:a),y:l.y,h:l.h})).filter(l=>l.t));
    if(i===30&&!pages.flat().length)break;if(i%8===0){say(i,N);await new Promise(r=>setTimeout(r))}
  }
  const flat=pages.flat();
  if(flat.reduce((n,l)=>n+l.t.length,0)<200)return{title:name,pages:N,cover:await coverOf(pdf),chapters:[],scan:true,added:Date.now()};
  const bodyH=med(flat.map(l=>l.h)),maxC=med(flat.map(l=>l.t.length))*1.15;
  /* drop running headers, footers and page numbers */
  const key=t=>t.replace(/\d+/g,"#"),cnt={},lim=Math.max(3,N*.3);
  pages.forEach(p=>[...p.slice(0,2),...p.slice(-2)].forEach(l=>cnt[key(l.t)]=(cnt[key(l.t)]||0)+1));
  pages.forEach(p=>p.forEach((l,i)=>{if((i<2||i>=p.length-2)&&(cnt[key(l.t)]>=lim||/^(\d{1,4}|[ivxlc]{1,6})$/i.test(l.t)))l.x=1}));
  /* rebuild paragraphs and headings */
  const blocks=[];let para=null,pb=null;
  pages.forEach(p=>{
    const ls=p.filter(l=>!l.x),gaps=[];
    for(let i=1;i<ls.length;i++)gaps.push(Math.abs(ls[i-1].y-ls[i].y));
    const g=med(gaps)||bodyH*1.3;
    ls.forEach((l,i)=>{
      if(l.h>bodyH*1.25&&l.t.length<90){
        if(pb&&Math.abs(pb.h-l.h)<.6)pb.t+=" "+l.t;else{pb={k:"h",t:l.t,h:l.h};blocks.push(pb)}
        para=null;return;
      }
      pb=null;
      const prev=i?ls[i-1]:null,brk=prev&&Math.abs(prev.y-l.y)>g*1.45,lm=l.t.match(/^(?:[•●▪◦·*]|-|\d{1,2}[.)])\s+/);
      if(lm){para={k:"li",o:/\d/.test(lm[0]),n:/\d/.test(lm[0])?parseInt(lm[0]):null,t:l.t.slice(lm[0].length)};blocks.push(para)}
      else if(para&&!brk){para.t=/[a-z]-$/.test(para.t)?para.t.slice(0,-1)+l.t:para.t+" "+l.t}
      else{para={k:"p",t:l.t};blocks.push(para)}
      if(/[.!?”"’')\]]$/.test(l.t)&&l.t.length<maxC*.62)para=null;
    });
  });
  /* group into chapters */
  const chs=assemble(blocks,bodyH);
  const cover=await coverOf(pdf);
  return{title:name,pages:N,cover,chapters:keep(chs,name),added:Date.now()};
}

const JUNK=/^(table of contents|contents|acknowledg\w*|also by|about the author|praise|copyright|dedication|title page|permissions|front matter|epigraph|other books|books by|by the same author)/i;
function fixLists(c){c.b=c.b.map((e,i,a)=>{const [k,t,o,n]=e,nx=a[i+1];return k==="li"&&o&&t.length<=70&&!/[.!?]$/.test(t)&&nx&&nx[0]==="p"?["h",(n!=null?n+". ":"")+t]:e})}
function keep(chs,name){const ok=chs.filter(x=>x.b.length);let o=ok.filter(x=>!x.fm&&!JUNK.test(x.t));o.forEach(fixLists);if(!o.length)o=ok.map(x=>({...x,fm:0,t:x.fm?name:x.t}));return o}
function assemble(blocks,bodyH){
  const re=/^(chapter|part|book|section|prologue|epilogue|introduction|preface|foreword|afterword|acknowledg)/i;
  const chs=[];let c=null;
  const fmc=()=>{if(!c){c={t:"Front matter",b:[],fm:1};chs.push(c)}};
  blocks.forEach(b=>{
    if(b.k==="h"&&b.t.split(/\s+/).length<=9&&!/[,;]$/.test(b.t)){
      const isC=re.test(b.t)||/^(\d{1,3}|[ivxlc]{1,6})[.:]?$/i.test(b.t)||b.h>bodyH*1.5;
      if(c&&!c.b.length)c.t=(c.t+" "+b.t).trim();
      else if(isC){c={t:b.t,b:[]};chs.push(c)}
      else{fmc();c.b.push(["h",b.t])}
    }else{fmc();c.b.push([b.k,b.t,b.o,b.n])}
  });
  chs.forEach(x=>{x.b=x.b.filter(([k,t])=>!(k==="p"&&(t.match(/\bchapter\b/gi)||[]).length>=5))});
  return chs;
}
async function coverOf(pdf){let cover="";
  try{const p1=await pdf.getPage(1),v0=p1.getViewport({scale:1}),vp=p1.getViewport({scale:300/v0.width}),cv=document.createElement("canvas");cv.width=vp.width;cv.height=vp.height;await p1.render({canvasContext:cv.getContext("2d"),viewport:vp}).promise;cover=cv.toDataURL("image/jpeg",.72)}catch(e){}
  return cover}
/* scanned books: OCR with Tesseract.js, resumable */
const loadScript=u=>new Promise((res,rej)=>{const e=document.createElement("script");e.src=u;e.onload=res;e.onerror=()=>rej(new Error("couldn’t load the text-recognition engine"));document.head.appendChild(e)});
const ocrGet=k=>db?req(tx("ocr").get(k)):Promise.resolve(null);
const ocrPut=(k,v)=>{if(db)try{tx("ocr","readwrite").put({key:k,...v})}catch(e){}};
const ocrDel=k=>{if(db)try{tx("ocr","readwrite").delete(k)}catch(e){}};
async function ocrBook(pdf,name,say,key,N){
  if(!window.Tesseract)await loadScript("https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js");
  const texts=((await ocrGet(key))||{}).texts||[];
  const nw=Math.min(3,Math.max(1,(navigator.hardwareConcurrency||4)>>1)),sch=Tesseract.createScheduler();
  let wl=null;try{wl=await navigator.wakeLock.request("screen")}catch(e){}
  say(texts.length,N,"Reading text from");
  try{
    for(let i=0;i<nw;i++)sch.addWorker(await Tesseract.createWorker("eng"));
    for(let s=texts.length;s<N;s+=nw*2){
      const ids=[];for(let n=s+1;n<=Math.min(N,s+nw*2);n++)ids.push(n);
      const out=await Promise.all(ids.map(async n=>{const pg=await pdf.getPage(n),v0=pg.getViewport({scale:1}),vp=pg.getViewport({scale:1100/v0.width}),c=document.createElement("canvas");c.width=vp.width;c.height=vp.height;await pg.render({canvasContext:c.getContext("2d"),viewport:vp}).promise;const r=await sch.addJob("recognize",c);c.width=c.height=1;return r.data.text||""}));
      texts.push(...out);ocrPut(key,{texts});say(texts.length,N,"Reading text from");
    }
  }finally{try{await sch.terminate()}catch(e){}try{wl&&wl.release()}catch(e){}}
  ocrDel(key);
  const bk=ocrToBook(texts,name,N);bk.cover=await coverOf(pdf);return bk;
}
function ocrToBook(texts,name,N){
  const pages=texts.map(t=>t.replace(/\r/g,"").split(/\n\s*\n/).map(p=>p.split("\n").map(l=>l.trim()).filter(Boolean)).filter(p=>p.length));
  const key=t=>t.replace(/\d+/g,"#"),cnt={},lim=Math.max(3,N*.25);
  pages.forEach(p=>{if(p.length)[p[0][0],p[p.length-1].slice(-1)[0]].forEach(x=>cnt[key(x)]=(cnt[key(x)]||0)+1)});
  const blocks=[];let para=null;
  pages.forEach(p=>p.forEach((ls,pi)=>{
    ls=ls.slice();
    if(pi===0&&(cnt[key(ls[0])]>=lim||/^\d{1,4}$/.test(ls[0])))ls.shift();
    if(pi===p.length-1&&ls.length&&(cnt[key(ls[ls.length-1])]>=lim||/^(\d{1,4}|[ivxlc]{1,6})$/i.test(ls[ls.length-1])))ls.pop();
    if(!ls.length)return;
    const t=ls.join(" ").replace(/([a-z])-\s+(?=[a-z])/g,"$1").replace(/\s+/g," "),caps=t===t.toUpperCase()&&/[A-Z]{3}/.test(t);
    if(t.length<=70&&!/[.,;:]$/.test(t)&&(caps||/^(chapter|part|book)\s+\w+/i.test(t)||/^(\d{1,3}|[ivxlc]{1,6})\.?$/i.test(t))){blocks.push({k:"h",t,h:caps&&pi===0?2:0});para=null;return}
    if(para&&pi===0&&!/[.!?”"’')]$/.test(para.t)&&/^[a-z]/.test(t))para.t+=" "+t;
    else{para={k:"p",t};blocks.push(para)}
  }));
  return{title:name,pages:N,cover:"",chapters:keep(assemble(blocks,1),name),added:Date.now()};
}
const imgCover=f=>new Promise((res,rej)=>{const u=URL.createObjectURL(f),im=new Image();im.onload=()=>{const w=300,h=Math.round(im.height*w/im.width),c=document.createElement("canvas");c.width=w;c.height=h;c.getContext("2d").drawImage(im,0,0,w,h);URL.revokeObjectURL(u);res(c.toDataURL("image/jpeg",.82))};im.onerror=()=>rej(new Error("bad cover"));im.src=u});
const pickCover=id=>{const i=document.createElement("input");i.type="file";i.accept="image/*";i.onchange=async()=>{const f=i.files[0];if(!f)return;const b=await getBook(id);if(b){try{b.cover=await imgCover(f);put(b);showLib()}catch(e){$("#st").textContent="Couldn’t use that image."}}};i.click()};
/* reader: render, highlights, paging */
const hl=(c,b)=>M.hl.filter(x=>x.c===c&&x.b===b).sort((a,z)=>a.s-z.s);
function mk(t,hs){let o="",p=0;hs.forEach(h=>{const s=Math.max(h.s,p);if(h.e>s){o+=esc(t.slice(p,s))+'<mark data-h="'+h.id+'">'+esc(t.slice(s,h.e))+"</mark>";p=h.e}});return o+esc(t.slice(p))}
function render(bk){
  let h="";
  bk.chapters.forEach((c,i)=>{
    const m=c.t.match(/^((?:chapter|part|book)\s+\w+)[.:\s–—-]+(.+)$/i);
    h+='<section id="c'+i+'"><header class="op"><svg class="orn" viewBox="0 0 120 14" aria-hidden="true"><path d="M4 7C26-3 40 17 60 7S94-3 116 7" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="60" cy="7" r="2" fill="currentColor"/></svg>'+(m?'<span class="lab">'+esc(m[1])+":</span>":"")+"<h2>"+esc(m?m[2]:c.t)+"</h2></header>";
    let first=true,list=null,exp=0;
    const close=()=>{if(list){h+="</"+list+">";list=null}};
    c.b.forEach(([k,t,o,n],j)=>{
      const id='id="b'+i+"_"+j+'"';
      if(k==="li"){const g=o?"ol":"ul",st=o&&n!=null;if(list!==g||(st&&n!==exp)){close();h+="<"+g+(st?' start="'+n+'"':"")+">";list=g}exp=(n||0)+1;h+="<li "+id+">"+mk(t,hl(i,j))+"</li>";return}
      close();
      if(k==="h")h+="<h3 "+id+">"+esc(t)+"</h3>";
      else{h+="<p "+id+(first&&t.length>=80?' class="f"':"")+">"+mk(t,hl(i,j))+"</p>";first=false}
    });
    close();h+="</section>";
  });
  $("#book").innerHTML=h;
}
function pageOf(el,last){const rs=el.getClientRects();if(!rs.length)return 0;const r=last?rs[rs.length-1]:rs[0],b=$("#book").getBoundingClientRect();return Math.max(0,Math.floor((r.left-b.left+2)/Vw))}
function curEl(){const els=document.querySelectorAll("#book [id^=b]"),top=$("#hb").getBoundingClientRect().bottom+4;for(const el of els){if(S.mode==="page"?pageOf(el,1)>=page:el.getBoundingClientRect().bottom>top)return el}return els[0]}
const curId=()=>{const e=cur&&curEl();return e?e.id:null};
const parseId=id=>id.slice(1).split("_").map(Number);
function upd(){
  if(!cur)return;if(view==="orig")return updO();
  const el=curEl(),id=el&&el.id,c=id?parseId(id)[0]:0;let f;
  if(S.mode==="page"){f=total>1?page/(total-1):0;$("#pn").value=page+1;$("#pt").textContent="/ "+total}
  else{const d=document.documentElement,h=innerHeight;f=Math.min(1,scrollY/Math.max(1,d.scrollHeight-h));const n=Math.max(1,Math.round(d.scrollHeight/h));$("#pn").value=Math.min(n,Math.floor(scrollY/h)+1);$("#pt").textContent="/ "+n}
  $("#bar").style.transform="scaleX("+f+")";
  $("#ttl").textContent=cur.chapters[c]?cur.chapters[c].t:cur.title;
  $("#bm").textContent=id&&M.bm.some(x=>"b"+x.c+"_"+x.b===id)?"★":"☆";
  LS.set("folio.p."+cur.id,f);if(id)LS.set("folio.pos."+cur.id,id);
}
function showPage(n){page=Math.max(0,Math.min(total-1,n));document.documentElement.style.setProperty("--tx",-page*Vw+"px");$("#view").dataset.pg=page+1;$("#view").dataset.run=cur.title;upd()}
function goTo(id){if(view==="orig"){if(id.startsWith("b-1_"))goO(parseId(id)[1]);return}const el=document.getElementById(id);if(!el)return;if(S.mode==="page")showPage(pageOf(el));else el.scrollIntoView()}
function layout(anchor){
  if(!cur)return;
  const r=document.documentElement,cs=getComputedStyle(r),pt=parseFloat(cs.paddingTop)||0,pb=parseFloat(cs.paddingBottom)||0,P=(k,v)=>r.style.setProperty(k,v);
  document.body.dataset.mode=S.mode;P("--ta",S.just?"justify":"left");P("--hy",S.just?"auto":"manual");
  if(S.mode==="page"){
    const m=26,vm=40,cw=Math.min(innerWidth-2*m,S.w*S.size),ph=innerHeight-pt-pb-$("#hb").offsetHeight-52-2*vm;
    Vw=cw+2*m;P("--vw",Vw+"px");P("--vh",ph+2*vm+"px");P("--cw",cw+"px");P("--gap",2*m+"px");P("--ph",ph+"px");
  }else P("--vw",Math.min(innerWidth,S.w*S.size+56)+"px");
  requestAnimationFrame(()=>{
    const els=document.querySelectorAll("#book [id^=b]");
    total=S.mode==="page"&&els.length?pageOf(els[els.length-1],1)+1:1;
    const a=anchor||LS.get("folio.pos."+cur.id,null),el=a&&document.getElementById(a);
    if(S.mode==="page")showPage(el?pageOf(el):0);
    else{if(el)el.scrollIntoView();else scrollTo(0,0);upd()}
  });
}
async function openBook(id){
  const bk=await getBook(id);if(!bk)return;
  cur=bk;M=LS.get("folio.m."+id,{bm:[],hl:[]});render(bk);closePanels();
  const f=await getFile(id);view=bk.chapters.length?(f?LS.get("folio.v."+id,"flow"):"flow"):"orig";
  $("#lib").hidden=true;$("#nav").hidden=false;$("#hb").dataset.v="read";$("#vn").textContent="";
  scrollTo(0,0);await enter();
}
async function enter(){
  $("#read").hidden=view==="orig";$("#orig").hidden=view!=="orig";$("#hlb").hidden=true;
  document.querySelectorAll("[data-vw]").forEach(b=>b.setAttribute("aria-pressed",b.dataset.vw===view));
  if(view==="orig"){delete document.body.dataset.mode;await showOrig()}
  else{if(opdf){opdf.destroy();opdf=null}scrollTo(0,0);applyS()}
}
async function setView(v){
  if(!cur||v===view)return;
  if(v==="flow"&&!cur.chapters.length){$("#vn").textContent="This scanned book isn’t converted to text yet. Use “Convert to text” on its library card.";return}
  if(v==="orig"&&!(await getFile(cur.id))){$("#vn").textContent="The original PDF wasn’t saved for this book. Add it again to read it as a PDF.";return}
  $("#vn").textContent="";view=v;LS.set("folio.v."+cur.id,v);closePanels();await enter();
}
const getFile=async id=>{if(!db)return null;const r=await req(tx("files").get(id));return r&&r.blob||null};
const putFile=(id,blob)=>{if(db)try{tx("files","readwrite").put({id,blob})}catch(e){}};
async function showOrig(){
  const box=$("#opages");
  try{
    if(!window.pdfjsLib)throw new Error("PDF engine not loaded");
    if(opdf){opdf.destroy();opdf=null}
    opdf=await pdfjsLib.getDocument({data:await(await getFile(cur.id)).arrayBuffer()}).promise;
    await origLayout();
  }catch(e){box.innerHTML='<p class="none2">Couldn’t open the original PDF ('+esc(String(e&&e.message||e))+").</p>"}
}
async function origLayout(){
  const p1=await opdf.getPage(1),v0=p1.getViewport({scale:1}),w=Math.min(innerWidth-16,900)*oZ,h=w*v0.height/v0.width,N=opdf.numPages,box=$("#opages");
  box.style.setProperty("--ow",w+"px");box.style.setProperty("--oh",h+"px");
  box.innerHTML=Array.from({length:N},(_,i)=>'<div class="pgo" data-p="'+i+'"><canvas></canvas></div>').join("");
  if(oIO)oIO.disconnect();
  oIO=new IntersectionObserver(es=>es.forEach(e=>{const d=e.target;if(e.isIntersecting)queueP(d);else{const c=d.firstChild;if(c&&c.width>1)c.width=c.height=1;d._r=0}}),{rootMargin:"150% 0px"});
  box.querySelectorAll(".pgo").forEach(d=>oIO.observe(d));
  const p=LS.get("folio.po."+cur.id,0);
  requestAnimationFrame(()=>{if(box.children[p])box.children[p].scrollIntoView();updO()});
}
const queueP=d=>{if(d._r)return;d._r=1;oq=oq.then(async()=>{if(!d.isConnected||!d._r||!opdf)return;const pg=await opdf.getPage(+d.dataset.p+1),dpr=Math.min(2,devicePixelRatio||1),vp=pg.getViewport({scale:d.clientWidth*dpr/pg.getViewport({scale:1}).width}),c=d.firstChild;c.width=vp.width;c.height=vp.height;await pg.render({canvasContext:c.getContext("2d"),viewport:vp}).promise}).catch(()=>{})};
const goO=n=>{const c=$("#opages").children[Math.max(0,Math.min(opdf.numPages-1,n))];if(c)c.scrollIntoView()};
function updO(){
  if(!cur||!opdf)return;
  const box=$("#opages"),N=opdf.numPages,k=box.children,st=k.length>1?k[1].offsetTop-k[0].offsetTop:k[0].offsetHeight;
  curO=Math.max(0,Math.min(N-1,Math.floor((scrollY+innerHeight*.35-box.offsetTop)/st)));
  $("#pn").value=curO+1;$("#pt").textContent="/ "+N;$("#bar").style.transform="scaleX("+(N>1?curO/(N-1):0)+")";
  $("#ttl").textContent=cur.title;$("#bm").textContent=M.bm.some(x=>x.c===-1&&x.b===curO)?"★":"☆";
  LS.set("folio.po."+cur.id,curO);LS.set("folio.p."+cur.id,N>1?curO/(N-1):0);
}
async function convertBook(id){
  const st=$("#st"),b=await getBook(id),f=await getFile(id);
  if(!b||!f){st.textContent="Add this PDF again to convert it (the original file wasn’t saved).";return}
  try{
    const pdf=await pdfjsLib.getDocument({data:await f.arrayBuffer()}).promise;
    const r=await ocrBook(pdf,b.title,(i,n)=>st.textContent="Reading text from page "+i+" of "+n+". Keep this tab open; progress is saved.",b.title+"|"+f.size,pdf.numPages);
    if(!r.chapters.length)throw new Error("no text found");
    b.chapters=r.chapters;b.scan=false;put(b);st.textContent="Done. “"+b.title+"” can now be read as a book.";
  }catch(e){st.textContent="Couldn’t convert "+b.title+" ("+(e&&e.message||e)+"). Tap Convert again to resume."}
  showLib();
}
async function showLib(){
  cur=null;closePanels();if(opdf){opdf.destroy();opdf=null}$("#orig").hidden=true;$("#read").hidden=true;$("#nav").hidden=true;$("#hlb").hidden=true;$("#lib").hidden=false;$("#hb").dataset.v="lib";delete document.body.dataset.mode;
  $("#ttl").textContent="Folio";$("#bar").style.transform="scaleX(0)";$("#bm").textContent="☆";scrollTo(0,0);
  libBks=await metas();drawLib();storage();
}
const spine=t=>{let h=0;for(const c of t)h=(h*31+c.charCodeAt(0))>>>0;return["#6E2A25","#23364A","#2C4A3A","#9A6B34","#4A2B45","#5B3A24"][h%6]};
const card=b=>'<li class="card" style="--sp:'+spine(b.title)+'"><button class="cv" data-id="'+b.id+'" aria-label="Open '+esc(b.title)+'">'+(b.cover?'<img alt="" loading="lazy" src="'+b.cover+'">':"<i>"+esc(b.title)+"</i>")+'</button><div class="ti">'+esc(b.title)+'</div><div class="pg"><b style="width:'+Math.round(LS.get("folio.p."+b.id,0)*100)+'%"></b></div>'+(b.scan?'<div class="tag">Scanned · opens as original</div>':"")+'<div class="acts">'+(b.scan?'<button data-conv="'+b.id+'">Convert to text</button>':"")+'<button data-cover="'+b.id+'">Cover</button><button class="rm" data-rm="'+b.id+'">Remove</button></div></li>';
function drawLib(){
  const q=$("#q").value.trim().toLowerCase(),t=$("#so").value==="t";
  const bs=libBks.filter(b=>b.title.toLowerCase().includes(q)).sort(t?(a,z)=>a.title.localeCompare(z.title):(a,z)=>z.added-a.added);
  $("#cnt").textContent=libBks.length?libBks.length+(libBks.length===1?" book":" books"):"";
  $("#shelf").innerHTML=bs.length?bs.map(card).join(""):'<li class="empty">'+(libBks.length?"No books match your search.":"Your shelf is empty. Add a PDF to start reading.")+"</li>";
}
async function addFiles(fl){
  const st=$("#st"),cf=$("#cv").files[0];let bad="";
  for(const f of fl){
    if(!/pdf/i.test(f.type+f.name))continue;
    if(!window.pdfjsLib){st.textContent="The PDF engine didn’t load. Check your connection and reload.";return}
    try{
      st.textContent="Reading "+f.name+"…";
      const bk=await parse(await f.arrayBuffer(),f.name.replace(/\.pdf$/i,""),(i,n,m)=>st.textContent=(m||"Reading")+" page "+i+" of "+n+(m?". Scanned book: keep this tab open. Progress is saved, so adding the same file again resumes.":"…"));
      if(cf){try{bk.cover=await imgCover(cf)}catch(e){}}
      bk.id=Date.now().toString(36);put(bk);putFile(bk.id,f);$("#cv").value="";$("#cvl").textContent="Add cover";st.textContent="";
      if(fl.length===1)return openBook(bk.id);
    }catch(e){bad="Couldn’t read "+f.name+" ("+(e&&e.message||e)+")."}
  }
  st.textContent=bad;showLib();
}
/* panel: contents / bookmarks / highlights */
function fillPanel(){
  const bm=M.bm.filter(x=>(x.c===-1)===(view==="orig")).sort((a,z)=>a.c-z.c||a.b-z.b),hs=M.hl.slice().sort((a,z)=>a.c-z.c||a.b-z.b||a.s-z.s);
  document.querySelectorAll("[data-tab]").forEach(b=>{const k=b.dataset.tab;b.setAttribute("aria-pressed",k===tab);b.textContent=k==="c"?"Contents":k==="b"?"Bookmarks"+(bm.length?" "+bm.length:""):"Highlights"+(hs.length?" "+hs.length:"")});
  const nm=c=>esc(cur.chapters[c]?cur.chapters[c].t:"");
  $("#pl").innerHTML=view==="orig"&&tab!=="b"?'<li class="none">'+(tab==="c"?"Contents are available in the reflowed view.":"Highlights are made in the reflowed view.")+"</li>":tab==="c"?cur.chapters.map((c,i)=>'<li><button data-g="c'+i+'">'+esc(c.t)+"</button></li>").join(""):
    tab==="b"?(bm.length?bm.map(x=>'<li class="it"><button data-g="b'+x.c+"_"+x.b+'"><small>'+nm(x.c)+"</small>"+esc(x.label)+'…</button><button class="x" data-xb="'+x.c+"_"+x.b+'" aria-label="Remove bookmark">✕</button></li>').join(""):'<li class="none">No bookmarks yet. Tap ☆ at the top to save your place.</li>'):
    (hs.length?hs.map(x=>'<li class="it"><button data-g="b'+x.c+"_"+x.b+'"><small>'+nm(x.c)+'</small><span class="hm">'+esc(x.text)+'</span></button><button class="x" data-xh="'+x.id+'" aria-label="Remove highlight">✕</button></li>').join(""):'<li class="none">Select text in the book, then tap Highlight to mark it. Marked passages collect here.</li>');
}
const panels=["#tp","#sp"],closePanels=()=>panels.forEach(x=>$(x).hidden=true);
const pan=id=>{const el=$(id),was=!el.hidden;closePanels();if(id==="#tp"&&!was&&cur)fillPanel();el.hidden=was};
function reHL(c,b){const el=document.getElementById("b"+c+"_"+b);if(el)el.innerHTML=mk(cur.chapters[c].b[b][1],hl(c,b))}
$("#hlbtn").onpointerdown=e=>e.preventDefault();
$("#hlbtn").onclick=()=>{
  const sel=getSelection();if(!cur||!sel.rangeCount||sel.isCollapsed)return;
  const r=sel.getRangeAt(0),hit=[];
  document.querySelectorAll("#book p[id^=b],#book li[id^=b]").forEach(el=>{
    if(!r.intersectsNode(el))return;
    const [c,b]=parseId(el.id),t=cur.chapters[c].b[b][1];let s=0,e=t.length;
    const q=document.createRange();
    if(el.contains(r.startContainer)){q.setStart(el,0);q.setEnd(r.startContainer,r.startOffset);s=q.toString().length}
    if(el.contains(r.endContainer)){q.setStart(el,0);q.setEnd(r.endContainer,r.endOffset);e=q.toString().length}
    if(e>s){
      const ov=M.hl.filter(x=>x.c===c&&x.b===b&&x.s<e&&x.e>s);ov.forEach(x=>{s=Math.min(s,x.s);e=Math.max(e,x.e)});
      M.hl=M.hl.filter(x=>!ov.includes(x));M.hl.push({id:Date.now().toString(36)+Math.random().toString(36).slice(2,5),c,b,s,e,text:t.slice(s,e)});hit.push([c,b]);
    }
  });
  sel.removeAllRanges();$("#hlb").hidden=true;saveM();hit.forEach(([c,b])=>reHL(c,b));
};
document.addEventListener("selectionchange",()=>{const s=getSelection();$("#hlb").hidden=!(cur&&s.rangeCount&&!s.isCollapsed&&$("#book").contains(s.anchorNode))});
$("#bm").onclick=()=>{
  if(!cur)return;
  if(view==="orig"){const ex=M.bm.find(x=>x.c===-1&&x.b===curO);if(ex)M.bm=M.bm.filter(x=>x!==ex);else M.bm.push({c:-1,b:curO,label:"Page "+(curO+1),ts:Date.now()});saveM();updO();return}const el=curEl();if(!el)return;const [c,b]=parseId(el.id),ex=M.bm.find(x=>x.c===c&&x.b===b);
  if(ex)M.bm=M.bm.filter(x=>x!==ex);else M.bm.push({c,b,label:cur.chapters[c].b[b][1].slice(0,90),ts:Date.now()});
  saveM();upd();
};
$("#pl").onclick=e=>{
  const g=e.target.closest("[data-g]"),xb=e.target.closest("[data-xb]"),xh=e.target.closest("[data-xh]");
  if(g){closePanels();goTo(g.dataset.g)}
  if(xb){const [c,b]=parseId("x"+xb.dataset.xb);M.bm=M.bm.filter(x=>!(x.c===c&&x.b===b));saveM();fillPanel();upd()}
  if(xh){const h=M.hl.find(x=>x.id===xh.dataset.xh);M.hl=M.hl.filter(x=>x!==h);saveM();if(h)reHL(h.c,h.b);fillPanel()}
};
document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{tab=b.dataset.tab;fillPanel()});
/* wiring */
$("#f").onchange=e=>{addFiles([...e.target.files]);e.target.value=""};
$("#cv").onchange=e=>{const f=e.target.files[0];$("#st").textContent=f?"Cover ready: "+f.name+". Now choose the PDF.":"";$("#cvl").textContent=f?"Cover ✓":"Add cover"};
$("#q").oninput=drawLib;$("#so").onchange=drawLib;
$("#back").onclick=showLib;$("#toc").onclick=()=>pan("#tp");$("#aa").onclick=()=>pan("#sp");
$("#shelf").onclick=e=>{
  const o=e.target.closest(".cv"),r=e.target.closest(".rm"),cv=e.target.closest("[data-cover]"),cn=e.target.closest("[data-conv]");
  if(o)openBook(o.dataset.id);
  if(cn)convertBook(cn.dataset.conv);
  if(cv)pickCover(cv.dataset.cover);
  if(r){if(r.dataset.arm){del(r.dataset.rm);LS.set("folio.p."+r.dataset.rm,0);showLib()}else{r.dataset.arm=1;r.textContent="Tap again"}}
};
$("#prv").onclick=()=>view==="orig"?goO(curO-1):S.mode==="page"?showPage(page-1):scrollBy(0,-innerHeight*.9);
$("#nxt").onclick=()=>view==="orig"?goO(curO+1):S.mode==="page"?showPage(page+1):scrollBy(0,innerHeight*.9);
$("#pn").onchange=e=>{const n=Math.max(1,+e.target.value||1);if(view==="orig")goO(n-1);else S.mode==="page"?showPage(n-1):scrollTo(0,(n-1)*innerHeight)};
$("#zo").onclick=()=>{if(view==="orig"){updO();oZ=Math.max(.6,oZ-.15);origLayout();return}S.size=Math.max(14,S.size-1);$("#fs").value=S.size;applyS()};
$("#zi").onclick=()=>{if(view==="orig"){updO();oZ=Math.min(2.5,oZ+.15);origLayout();return}S.size=Math.min(30,S.size+1);$("#fs").value=S.size;applyS()};
$("#view").addEventListener("click",e=>{if(S.mode!=="page"||!getSelection().isCollapsed)return;const x=e.clientX/innerWidth;if(x<.3)showPage(page-1);else if(x>.7)showPage(page+1)});
let tx0=0,ty0=0;
$("#view").addEventListener("touchstart",e=>{tx0=e.touches[0].clientX;ty0=e.touches[0].clientY},{passive:true});
$("#view").addEventListener("touchend",e=>{if(S.mode!=="page"||!getSelection().isCollapsed)return;const dx=e.changedTouches[0].clientX-tx0,dy=e.changedTouches[0].clientY-ty0;if(Math.abs(dx)>60&&Math.abs(dy)<50)showPage(page+(dx<0?1:-1))},{passive:true});
addEventListener("keydown",e=>{if(!cur||view!=="flow"||/INPUT|SELECT/.test(e.target.tagName))return;if(["ArrowRight","PageDown"," "].includes(e.key)&&S.mode==="page"){e.preventDefault();showPage(page+1)}if(["ArrowLeft","PageUp"].includes(e.key)&&S.mode==="page")showPage(page-1)});
addEventListener("scroll",()=>{if(cur&&view==="orig"){clearTimeout(tm);tm=setTimeout(updO,100)}else if(cur&&S.mode==="scroll"){clearTimeout(tm);tm=setTimeout(upd,120)}},{passive:true});
addEventListener("resize",()=>{clearTimeout(tm);tm=setTimeout(()=>cur&&layout(curId()),200)});
document.addEventListener("click",e=>{if(!e.target.closest(".pn,#toc,#aa"))closePanels()});
addEventListener("dragover",e=>e.preventDefault());
addEventListener("drop",e=>{e.preventDefault();addFiles([...e.dataTransfer.files])});
document.querySelectorAll("[data-t]").forEach(b=>b.onclick=()=>{S.theme=b.dataset.t;applyS()});
document.querySelectorAll("[data-m]").forEach(b=>b.onclick=()=>{S.mode=b.dataset.m;applyS()});
document.querySelectorAll("[data-f]").forEach(b=>b.onclick=()=>{S.font=b.dataset.f;applyS()});
$("#jt").onclick=()=>{S.just=!S.just;applyS()};
[["#fs","size"],["#ls","lh"],["#mw","w"]].forEach(([id,k])=>{$(id).value=S[k];$(id).oninput=e=>{S[k]=+e.target.value;applyS()}});
if(window.pdfjsLib)pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
applyS();
$("#st").textContent=window.pdfjsLib?"Ready. Choose a PDF to begin.":"The PDF engine didn’t load. Check your connection and reload.";
addEventListener("error",e=>{$("#st").textContent="Error: "+e.message});
try{navigator.storage&&navigator.storage.persist&&navigator.storage.persist()}catch(e){}
idb().then(d=>{db=d;showLib()});
