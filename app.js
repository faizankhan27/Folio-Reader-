const $=s=>document.querySelector(s);
const esc=s=>s.replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const LS={get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
let S=Object.assign({theme:null,size:20,lh:1.7,w:34},LS.get("folio.s",{}));
function applyS(){
  const r=document.documentElement;
  const t=S.theme||"sepia";
  r.dataset.theme=t;r.style.setProperty("--fs",S.size+"px");r.style.setProperty("--lh",S.lh);r.style.setProperty("--w",S.w+"em");
  document.querySelectorAll("[data-t]").forEach(b=>b.setAttribute("aria-pressed",b.dataset.t===t));
  LS.set("folio.s",S);
}

/* storage: IndexedDB with in-memory fallback */
let db=null,mem={};
const idb=()=>new Promise(res=>{try{const r=indexedDB.open("folio",1);r.onupgradeneeded=()=>r.result.createObjectStore("books",{keyPath:"id"});r.onsuccess=()=>res(r.result);r.onerror=()=>res(null)}catch(e){res(null)}});
const all=()=>new Promise(res=>{if(!db)return res(Object.values(mem));try{const q=db.transaction("books").objectStore("books").getAll();q.onsuccess=()=>res(q.result);q.onerror=()=>res(Object.values(mem))}catch(e){res(Object.values(mem))}});
const put=b=>{mem[b.id]=b;try{db&&db.transaction("books","readwrite").objectStore("books").put(b)}catch(e){}};
const del=id=>{delete mem[id];try{db&&db.transaction("books","readwrite").objectStore("books").delete(id)}catch(e){}};

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
    pages.push(lines.map(l=>({t:l.t.replace(/\s+/g," ").trim(),y:l.y,h:l.h})).filter(l=>l.t));
    if(i%8===0){say(i,N);await new Promise(r=>setTimeout(r))}
  }
  const flat=pages.flat();
  if(flat.reduce((n,l)=>n+l.t.length,0)<200)throw new Error("no text");
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
      const prev=i?ls[i-1]:null,brk=prev&&Math.abs(prev.y-l.y)>g*1.45;
      if(para&&!brk){para.t=/[a-z]-$/.test(para.t)?para.t.slice(0,-1)+l.t:para.t+" "+l.t}
      else{para={k:"p",t:l.t};blocks.push(para)}
      if(/[.!?”"’')\]]$/.test(l.t)&&l.t.length<maxC*.62)para=null;
    });
  });
  /* group into chapters */
  const re=/^(chapter|part|book|section|prologue|epilogue|introduction|preface|foreword|afterword|acknowledg)/i;
  const chs=[];let c=null;
  blocks.forEach(b=>{
    if(b.k==="h"){
      const isC=re.test(b.t)||/^(\d{1,3}|[ivxlc]{1,6})[.:]?$/i.test(b.t)||b.h>bodyH*1.5;
      if(c&&!c.b.length){c.t=(c.t+" "+b.t).trim()}
      else if(isC){c={t:b.t,b:[]};chs.push(c)}
      else{if(!c){c={t:name,b:[]};chs.push(c)}c.b.push(["h",b.t])}
    }else{
      if(!c){c={t:name,b:[]};chs.push(c)}
      c.b.push(["p",b.t]);
    }
  });
  return{title:name,pages:N,chapters:chs.filter(x=>x.b.length),added:Date.now()};
}

/* reader */
let cur=null,secs=[],tick=false;
function render(bk){
  let h="";
  bk.chapters.forEach((c,i)=>{
    const m=c.t.match(/^((?:chapter|part|book)\s+\w+)[.:\s–—-]+(.+)$/i);
    h+='<section id="c'+i+'"><header class="op">'+(m?'<span class="lab">'+esc(m[1])+'</span>':"")+"<h2>"+esc(m?m[2]:c.t)+'</h2><i class="orn">❦</i></header>';
    let first=true;
    c.b.forEach(([k,t])=>{if(k==="h")h+="<h3>"+esc(t)+"</h3>";else{h+="<p"+(first?' class="f"':"")+">"+esc(t)+"</p>";first=false}});
    h+="</section>";
  });
  $("#book").innerHTML=h;
  secs=[...document.querySelectorAll("#book section")];
  $("#tl").innerHTML=bk.chapters.map((c,i)=>'<li><button data-i="'+i+'">'+esc(c.t)+"</button></li>").join("");
}
function onScroll(){
  if(!cur||tick)return;tick=true;
  requestAnimationFrame(()=>{
    tick=false;
    const d=document.documentElement,f=Math.min(1,scrollY/Math.max(1,d.scrollHeight-innerHeight));
    $("#bar").style.transform="scaleX("+f+")";
    let k=0;secs.forEach((s,i)=>{if(s.getBoundingClientRect().top<innerHeight*.35)k=i});
    $("#ttl").textContent=cur.chapters[k].t;
    document.querySelectorAll("#tl button").forEach((b,i)=>i===k?b.setAttribute("aria-current","true"):b.removeAttribute("aria-current"));
    LS.set("folio.p."+cur.id,f);
  });
}
async function openBook(id){
  const bk=(await all()).find(b=>b.id===id);if(!bk)return;
  cur=bk;render(bk);closePanels();
  $("#lib").hidden=true;$("#read").hidden=false;$("#hb").dataset.v="read";
  const f=LS.get("folio.p."+id,0);
  requestAnimationFrame(()=>{scrollTo(0,f*(document.documentElement.scrollHeight-innerHeight));onScroll()});
}
const spine=t=>{let h=0;for(const c of t)h=(h*31+c.charCodeAt(0))>>>0;return["#6E2A25","#23364A","#2C4A3A","#9A6B34","#4A2B45","#5B3A24"][h%6]};
async function showLib(){
  cur=null;closePanels();$("#read").hidden=true;$("#lib").hidden=false;$("#hb").dataset.v="lib";
  $("#ttl").textContent="Folio";$("#bar").style.transform="scaleX(0)";scrollTo(0,0);
  const bs=(await all()).sort((a,b)=>b.added-a.added);
  $("#shelf").innerHTML=bs.length?bs.map(b=>'<li style="--sp:'+spine(b.title)+'"><button class="bk" data-id="'+b.id+'"><b>'+esc(b.title)+"</b><span>"+b.chapters.length+" chapters · "+b.pages+" pages · "+Math.round(LS.get("folio.p."+b.id,0)*100)+'% read</span></button><button class="rm" data-rm="'+b.id+'">Remove</button></li>').join(""):'<li class="empty">Your shelf is empty. Add a PDF to start reading.</li>';
}
async function addFiles(fl){
  const st=$("#st");
  for(const f of fl){
    if(!/pdf/i.test(f.type+f.name))continue;
    if(!window.pdfjsLib){st.textContent="The PDF engine didn’t load. Check your connection and reload.";return}
    try{
      st.textContent="Reading "+f.name+"…";
      const bk=await parse(await f.arrayBuffer(),f.name.replace(/\.pdf$/i,""),(i,n)=>st.textContent="Reading page "+i+" of "+n+"…");
      bk.id=Date.now().toString(36);put(bk);st.textContent="";
      if(fl.length===1)return openBook(bk.id);
    }catch(e){st.textContent="Couldn’t read "+f.name+" ("+(e&&e.message||e)+"). Scanned PDFs with no selectable text aren’t supported yet."}
  }
  st.textContent="";showLib();
}

/* wiring */
const panels=["#tp","#sp"];
const closePanels=()=>panels.forEach(x=>$(x).hidden=true);
const pan=id=>{const el=$(id),was=!el.hidden;closePanels();el.hidden=was};
$("#f").onchange=e=>{addFiles([...e.target.files]);e.target.value=""};
$("#back").onclick=showLib;
$("#toc").onclick=()=>pan("#tp");
$("#aa").onclick=()=>pan("#sp");
$("#tl").onclick=e=>{const b=e.target.closest("button");if(!b)return;closePanels();document.getElementById("c"+b.dataset.i).scrollIntoView()};
$("#shelf").onclick=e=>{
  const o=e.target.closest(".bk"),r=e.target.closest(".rm");
  if(o)openBook(o.dataset.id);
  if(r){if(r.dataset.arm){del(r.dataset.rm);LS.set("folio.p."+r.dataset.rm,0);showLib()}else{r.dataset.arm=1;r.textContent="Tap again to remove"}}
};
document.addEventListener("click",e=>{if(!e.target.closest(".pn,#toc,#aa"))closePanels()});
addEventListener("scroll",onScroll,{passive:true});
addEventListener("dragover",e=>e.preventDefault());
addEventListener("drop",e=>{e.preventDefault();addFiles([...e.dataTransfer.files])});
document.querySelectorAll("[data-t]").forEach(b=>b.onclick=()=>{S.theme=b.dataset.t;applyS()});
[["#fs","size"],["#ls","lh"],["#mw","w"]].forEach(([id,k])=>{$(id).value=S[k];$(id).oninput=e=>{S[k]=+e.target.value;applyS()}});
if(window.pdfjsLib)pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
applyS();
$("#st").textContent=window.pdfjsLib?"Ready. Choose a PDF to begin.":"The PDF engine didn’t load. Check your connection and reload.";
addEventListener("error",e=>{$("#st").textContent="Error: "+e.message});
idb().then(d=>{db=d;showLib()});
