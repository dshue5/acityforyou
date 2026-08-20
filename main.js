/* Quiz engine — matching, calibration, rendering. */
const NQ=FAMILIES.length;

let step=0, sum=AXES.map(()=>0), started=false, mobileSelected=null;
const app=document.getElementById("app");
/* Touch devices tap-select then confirm via a Submit button instead of
   advancing on first tap — a bare tap-to-advance is too easy to fire by
   accident while scrolling/steadying the phone. Desktop keeps the
   original single-click-advances flow. */
const isTouch=matchMedia("(hover: none) and (pointer: coarse)").matches;

/* Purely a display-axis scale for the "Where you landed" dots (see
   result()) — every authored CITIES value tops out at ±3, so at the old
   SCALE=9 even a city sitting at the true max never reached past ~67% on
   the bar, reading as "meh, balanced" instead of extreme. Doesn't touch
   matching/ranking math (ranked() clamps to ±3 independent of this). */
const SCALE=4;
const fmt=n=>(n>0?"+":"")+n;
function shuffle(arr){for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}return arr;}
/* Question order reshuffles every playthrough, but the keys question
   always closes the quiz — pull it out, shuffle the rest, put it back last. */
function shuffleQuestions(){
  const keysIdx=FAMILIES.findIndex(f=>f.img==="art/keys.png");
  if(keysIdx===-1){shuffle(FAMILIES);return;}
  const keysQ=FAMILIES.splice(keysIdx,1)[0];
  shuffle(FAMILIES);
  FAMILIES.push(keysQ);
}
/* Every sourced photo/composite ships on a flat white studio background
   (no real alpha) — this strips it at render time so options read as
   objects floating in the page's own whitespace instead of sitting in
   white boxes. Flood-fills from the four canvas edges over near-white
   pixels only (not a global threshold), so it can't eat interior whites
   like album-cover text or matcha foam that never touch the border. */
const __bgCache=new Map();
function stripWhiteBg(src,crop){
  const key=src+(crop?"|crop":"");
  if(__bgCache.has(key)) return __bgCache.get(key);
  const p=new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>{
      const MAX=900,scale=Math.min(1,MAX/Math.max(img.naturalWidth,img.naturalHeight));
      const w=Math.round(img.naturalWidth*scale),h=Math.round(img.naturalHeight*scale);
      const canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;
      const ctx=canvas.getContext("2d");ctx.drawImage(img,0,0,w,h);
      const data=ctx.getImageData(0,0,w,h),px=data.data;
      const THRESH=235;
      const isWhite=i=>px[i]>=THRESH&&px[i+1]>=THRESH&&px[i+2]>=THRESH;
      const visited=new Uint8Array(w*h),stack=[];
      for(let x=0;x<w;x++){stack.push(x,0,x,h-1);}
      for(let y=0;y<h;y++){stack.push(0,y,w-1,y);}
      while(stack.length){
        const y=stack.pop(),x=stack.pop();
        if(x<0||y<0||x>=w||y>=h)continue;
        const vi=y*w+x;
        if(visited[vi])continue;
        const i=vi*4;
        if(!isWhite(i))continue;
        visited[vi]=1;px[i+3]=0;
        stack.push(x+1,y,x-1,y,x,y+1,x,y-1);
      }
      ctx.putImageData(data,0,0);
      /* Source exports are often a square canvas with the item sitting in
         a fraction of it (a ring or perfume bottle on a 2000x2000 sheet).
         Once the background's transparent, crop to the opaque content's
         own bounding box (plus a small margin) so the item fills its card
         instead of floating small in a mostly-empty square. Opt-in only
         (see FAMILIES[].snug) — categories like drinks are already
         consistently framed and shouldn't have each bottle re-cropped to
         its own bounding box, which would skew their sizes relative to
         each other. */
      let out=canvas;
      if(crop){
        let minX=w,minY=h,maxX=-1,maxY=-1;
        for(let y=0;y<h;y++)for(let x=0;x<w;x++){
          if(px[(y*w+x)*4+3]>10){
            if(x<minX)minX=x; if(x>maxX)maxX=x;
            if(y<minY)minY=y; if(y>maxY)maxY=y;
          }
        }
        if(maxX>minX&&maxY>minY){
          const pad=Math.round(Math.max(maxX-minX,maxY-minY)*0.04);
          const cx0=Math.max(0,minX-pad),cy0=Math.max(0,minY-pad);
          const cx1=Math.min(w,maxX+1+pad),cy1=Math.min(h,maxY+1+pad);
          const cw=cx1-cx0,ch=cy1-cy0;
          out=document.createElement("canvas");out.width=cw;out.height=ch;
          out.getContext("2d").drawImage(canvas,cx0,cy0,cw,ch,0,0,cw,ch);
        }
      }
      out.toBlob(blob=>resolve(URL.createObjectURL(blob)),"image/png");
    };
    img.onerror=()=>resolve(src);
    img.src=src;
  });
  __bgCache.set(key,p);
  return p;
}
function applyBgStrip(){
  document.querySelectorAll("img[data-strip]").forEach(async el=>{
    el.src=await stripWhiteBg(el.getAttribute("data-strip"),el.dataset.crop==="1");
  });
}
/* Every quiz-art asset (hotspot composites + photo-row options) gets its
   background-strip kicked off up front, at page load, instead of the
   first time its question is rendered. Without this, navigating into a
   fresh question showed the raw white-background image for a beat before
   it silently swapped to the stripped version — visible as a flash where
   the hotspot seams/edges briefly showed. stripWhiteBg's own cache means
   this costs nothing later: by the time a question is reached its art is
   already processed and applyBgStrip() just resolves instantly. */
function preloadAllArt(){
  const srcs=new Map();
  FAMILIES.forEach(f=>{
    if(f.img)srcs.set(f.img,false);
    f.opts.forEach(o=>{if(o.img)srcs.set(o.img,!!f.snug);});
  });
  srcs.forEach((crop,src)=>stripWhiteBg(src,crop));
}
preloadAllArt();
/* Splits question HTML into words, each wrapped for a staggered cascade-in
   (see .q .w in style.css). Safe here because every <em> in data.js wraps
   a single whole word with no internal spaces. */
function wordsHTML(html){return html.split(" ").map((w,i)=>`<span class="w" style="--i:${i}">${w}</span>`).join(" ");}
/* On touch, a tap only highlights the option (see mobileSelect); the
   answer isn't locked in until mobileSubmit fires via the Submit button.
   On desktop, a click still chooses immediately as before. */
function optClick(i){return isTouch?`mobileSelect(${i},this)`:`choose(${i})`;}
window.mobileSelect=(i,el)=>{
  mobileSelected=i;
  el.parentElement.querySelectorAll(".selected").forEach(x=>x.classList.remove("selected"));
  el.classList.add("selected");
  const btn=document.getElementById("mobileSubmit");
  if(btn)btn.disabled=false;
};
window.mobileSubmit=()=>{if(mobileSelected!=null)choose(mobileSelected);};
function deltaHTML(v){return AXES.filter(a=>v[a]).map(a=>{const n=v[a];return `<span>${DISP[a][0]} <span class="${n>0?'up':'dn'}">${fmt(n)}</span></span>`;}).join("");}
/* Bespoke per-question art: one shared photo, each answer is a clip-path
   hotspot cut to that item's silhouette (hand-placed % points in data.js,
   see FAMILIES[].opts[].hot). Hovering/focusing a hotspot highlights only
   that item; the source image is never split into separate files. */
function renderArt(f){
  const hots=f.opts.map((o,i)=>`
    <button class="keyhot" style="clip-path:polygon(${o.hot})" onclick="${optClick(i)}" aria-label="${o.lab}">
      <img data-strip="${f.img}" src="${f.img}" alt="" draggable="false">
    </button>`).join("");
  return `<div class="art-wrap">
     <img class="art-base" data-strip="${f.img}" src="${f.img}" alt="" draggable="false">
     ${hots}
   </div>`;
}
function renderIntro(){
  app.innerHTML=`<div class="intro" id="intro">
     <div class="intro-photo"><img id="introImg" alt=""></div>
     <h1 class="intro-title">${wordsHTML("A City For <em>You.</em>")}</h1>
     <button class="intro-start" id="start">Click to begin</button>
   </div>`;
  document.getElementById("start").onclick=()=>{
    document.getElementById("intro").classList.add("fade-out");
    shuffleQuestions();
    setTimeout(()=>{started=true;render();},450);
  };
}
function render(){
  if(!started){renderIntro();return;}
  const f=FAMILIES[step];
  const isPhotoRow=!f.img&&f.opts.every(o=>o.img);
  if(isPhotoRow&&!f.fixedOrder)shuffle(f.opts);
  mobileSelected=null;
  const answers=f.img?renderArt(f):isPhotoRow
    ?`<div class="opts photo-row${f.opts.length>=6?' dense':''}${f.snug?' snug':''}">${f.opts.map((o,i)=>`<button class="card-float" onclick="${optClick(i)}" aria-label="${o.lab}"><img class="card-photo" data-strip="${o.img}" data-crop="${f.snug?1:0}"${o.scale?` style="zoom:${o.scale}"`:""} src="${o.img}" alt="" draggable="false"><span class="deltas">${deltaHTML(o.v)}</span></button>`).join("")}</div>`
    :`<div class="opts ${f.cols||''}">${f.opts.map((o,i)=>`<button class="card" onclick="${optClick(i)}"><span class="idx">0${i+1}</span>${G[o.k]}<span class="lab">${o.lab}</span><span class="deltas">${deltaHTML(o.v)}</span></button>`).join("")}</div>`;
  const submitBtn=isTouch?`<button class="mobile-submit" id="mobileSubmit" onclick="mobileSubmit()" disabled>Submit</button>`:"";
  app.innerHTML=`<div class="stage">
     <div class="prog"><span>STEP <b>${String(step+1).padStart(2,'0')}</b> / ${NQ}</span><div class="bar"><i style="width:${step/NQ*100}%"></i></div></div>
     <h2 class="q">${wordsHTML(f.q)}</h2>
     ${answers}
     ${submitBtn}
   </div>`;
  applyBgStrip();
}
/* Advance to the next question (or results) with a beat of drama: the
   current stage fades/lifts out, THEN the next one is built — its own
   entrance animation (.stage) and the word cascade (.q .w) play on
   insert automatically, no extra JS needed. */
const ADVANCE_MS=340;
function advance(next){
  const cur=app.querySelector(".stage");
  if(cur){cur.classList.add("leaving");setTimeout(next,ADVANCE_MS);}
  else next();
}
window.choose=i=>{
  const o=FAMILIES[step].opts[i];
  AXES.forEach((a,ax)=>sum[ax]+=(o.v[a]||0));
  advance(()=>{step++;step<NQ?render():result();});
};

function ranked(){
  const u=sum.map(x=>Math.max(-3,Math.min(3,x)));
  return Object.entries(CITIES).map(([c,cv])=>{
    const sq=cv.reduce((s,x,i)=>s+(x-u[i])**2,0);
    return [c, sq-(BIAS[c]||0)];
  }).sort((a,b)=>a[1]-b[1]);
}
function blend(r,temp=6){
  const e=r.map(([c,s])=>[c,Math.exp(-s/temp)]);
  const Z=e.reduce((a,x)=>a+x[1],0);
  return e.map(([c,v])=>[c,v/Z]);
}
function bandLabel(a,val){
  const x=Math.abs(val);
  if(x<=1) return "Balanced";
  const side = val<0?DISP[a][1]:DISP[a][2];
  return (x>=5?"Very ":"")+side;
}

/* City photos live in /Cities as "<PascalCaseNoSpaces>.webp" (e.g.
   "Rio de Janeiro" -> "RioDeJaneiro.webp", accents stripped so
   "Reykjavík" -> "Reykjavik.webp"). Not every city has a photo yet —
   onerror hides the slot cleanly instead of showing a broken image. */
function cityFile(name){
  const clean=name.normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  return clean.split(/[\s-]+/).map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join("");
}
/* The top-5 "Top matches" list is clickable — you can browse into any
   of your other close matches and see THEIR photo/bio in place, without
   redoing the quiz. __resultState holds what result() computed so
   showCityDetail() (triggered by clicking a row) can reuse it. */
let __resultState=null;

function cityNameHTML(name){
  const parts=name.split(" ");
  return parts.length>1?parts[0]+' <span>'+parts.slice(1).join(" ")+'</span>':'<span>'+name+'</span>';
}
/* Every city photo is force-cropped to a centered square (see .city-photo
   in style.css: fixed aspect-ratio + object-fit:cover) so mismatched
   source dimensions never matter. Unlike the quiz's other art (drinks,
   vinyls, keys...), these are real photography, not studio product shots
   on a genuine white backdrop — running them through the white-bg strip
   flood-fills any sky/fog/snow touching the frame edge into transparency,
   which just reads as a broken white patch. City photos are shown as-is,
   no data-strip. */
function cityDetailHTML(name,isWinner,winTie,pct){
  const tieHTML=isWinner?winTie:`${Math.round(pct*100)}% match — one of your top five.`;
  const src=`Cities/${cityFile(name)}.webp`;
  return `<div class="verdict">${isWinner?"You plot nearest to":"Also close —"}</div>
     <h2 class="city">${cityNameHTML(name)}</h2>
     <div class="city-photo"><img id="cityPhotoImg" src="${src}" alt="${name}" onerror="this.closest('.city-photo').style.display='none'"></div>
     <p class="bio">${BIO[name]}</p>
     <p class="tie">${tieHTML}</p>`;
}
/* Since every photo renders at the same fixed square size (the crop makes
   source dimensions irrelevant), switching cities just needs a clean
   crossfade rather than size-matching gymnastics. */
function animateCityPhoto(name){
  const img=document.getElementById("cityPhotoImg");
  if(!img)return;
  const wrap=img.closest(".city-photo");
  const src=`Cities/${cityFile(name)}.webp`;
  const temp=new Image();
  temp.onload=()=>{
    wrap.style.display="";
    img.animate(
      [{opacity:0,transform:"scale(1.04)"},{opacity:1,transform:"scale(1)"}],
      {duration:380,easing:"cubic-bezier(.22,1,.36,1)"}
    );
    img.src=src;img.alt=name;
  };
  temp.onerror=()=>{wrap.style.display="none";};
  temp.src=src;
}
/* "Where you landed" plots two dots per axis: your answers (fixed for
   the session) and whichever city is currently on screen (CITIES[name],
   already authored on the same -3..3 scale the matching math itself
   uses). Only the city dots ever move — updating just their `left` style
   in place (rather than rebuilding the row) lets the existing CSS
   transition glide them to their new position when you click a
   different top-5 city, instead of popping. */
function updateScoreCityDots(name){
  const legend=document.getElementById("scoreLegendCity");
  if(legend)legend.textContent=name;
  const dots=document.querySelectorAll("#scoreRows .sdot.citymark");
  CITIES[name].forEach((cval,i)=>{
    const cpos=(Math.max(-SCALE,Math.min(SCALE,cval))+SCALE)/(2*SCALE)*100;
    if(dots[i])dots[i].style.left=cpos+"%";
  });
}
window.showCityDetail=name=>{
  if(!__resultState||name===__resultState.current)return;
  const{win,winTie,pctByCity,top5}=__resultState;
  __resultState.current=name;
  document.querySelectorAll(".brow,.epill").forEach(el=>el.classList.toggle("active",el.dataset.city===name));
  const isWinner=name===win,inTop5=top5.has(name);
  document.querySelector("#cityDetail .verdict").textContent=isWinner?"You plot nearest to":inTop5?"Also close —":"Exploring —";
  document.querySelector("#cityDetail .city").innerHTML=cityNameHTML(name);
  document.querySelector("#cityDetail .bio").textContent=BIO[name];
  /* Outside the top 5 the blend probability rounds to 0% (long tail of
     a 33-city softmax) — showing that reads as broken, so it's dropped
     in favor of plain framing instead. */
  const tieText=isWinner?winTie:inTop5?`${Math.round(pctByCity[name]*100)}% match — one of your top five.`:"Not one of your closest matches, but worth a look.";
  document.querySelector("#cityDetail .tie").innerHTML=tieText;
  animateCityPhoto(name);
  updateScoreCityDots(name);
};
window.toggleExplore=()=>{
  const grid=document.getElementById("exploreGrid"),btn=document.getElementById("exploreToggle");
  const open=grid.hasAttribute("hidden");
  if(open)grid.removeAttribute("hidden");else grid.setAttribute("hidden","");
  btn.classList.toggle("open",open);
  btn.querySelector(".et-label").textContent=open?"Hide all cities":"Explore all cities";
};
function result(){
  const r=ranked(), b=blend(r), win=r[0][0], gap=r[1][1]-r[0][1];
  const winTie=gap<1.2?`A near-tie with <b>${r[1][0]}</b> — you sit right on the border.`:`Your closest match by a clear margin.`;
  const top=b.slice(0,5), max=top[0][1];
  const pctByCity=Object.fromEntries(b.map(([c,p])=>[c,p]));
  const top5=new Set(top.map(([c])=>c));
  __resultState={win,winTie,pctByCity,top5,current:win};
  const rows=top.map(([c,p],i)=>`<button class="brow${c===win?' active':''}" data-city="${c}" onclick="showCityDetail('${c}')" aria-label="View ${c}"><span class="bn">${c}</span><span class="bt"><span class="bf" data-w="${(p/max*100).toFixed(0)}" data-col="${i===0?'var(--coral)':'var(--ultra)'}" style="width:0"></span></span><span class="bp">${(p*100).toFixed(0)}%</span><span class="barrow" aria-hidden="true">&#8594;</span></button>`).join("");
  const allNames=Object.keys(CITIES).sort();
  const explorePills=allNames.map(c=>`<button class="epill${c===win?' active':''}" data-city="${c}" onclick="showCityDetail('${c}')" aria-label="View ${c}">${c}</button>`).join("");
  const srows=AXES.map((a,i)=>{
    const val=sum[i], pos=(Math.max(-SCALE,Math.min(SCALE,val))+SCALE)/(2*SCALE)*100;
    const cval=CITIES[win][i], cpos=(Math.max(-SCALE,Math.min(SCALE,cval))+SCALE)/(2*SCALE)*100;
    return `<div class="srow"><div class="shead"><span class="nm">${DISP[a][0]}</span><span class="bd">${bandLabel(a,val)}</span></div>
      <div class="stk"><div class="sdot citymark" style="left:${cpos}%"></div><div class="sdot you" style="left:${pos}%"></div></div>
      <div class="spoles"><span>${DISP[a][1]}</span><span>${DISP[a][2]}</span></div></div>`;
  }).join("");
  app.innerHTML=`<div class="result"><div class="stage stage-result">
     <div id="cityDetail">${cityDetailHTML(win,true,winTie,pctByCity[win])}</div>
     <div class="result-panels">
       <div class="blend-col"><h4>Top matches</h4><p class="blend-hint">Tap a city to see how it fits</p><div class="blend">${rows}</div></div>
       <div class="scores"><h4>Where you landed</h4>
         <div class="score-legend"><span class="lg you">You</span><span class="lg legend-city" id="scoreLegendCity">${win}</span></div>
         <div id="scoreRows">${srows}</div>
       </div>
     </div>
     <div class="explore-col">
       <button class="explore-toggle" id="exploreToggle" onclick="toggleExplore()"><span class="et-label">Explore all cities</span><span class="et-arrow" aria-hidden="true">&#8594;</span></button>
       <div class="explore-grid" id="exploreGrid" hidden>${explorePills}</div>
     </div>
     <button class="again" onclick="reset()">Re-map me</button>
   </div></div>`;
  requestAnimationFrame(()=>document.querySelectorAll(".bf").forEach(el=>{el.style.background=el.dataset.col;el.style.width=el.dataset.w+"%";}));
}
window.reset=()=>{advance(()=>{step=0;sum=AXES.map(()=>0);shuffleQuestions();render();});};
render();

/* Opening loading screen — probes for whichever Cities/*.webp files
   actually exist (the library grows over time, so not all 33 are
   guaranteed present), then steps through a handful of them at a slow,
   constant pace before the last one slides into the .intro-photo square
   above the title (see renderIntro) instead of just fading away. */
(function runLoader(){
  const overlay=document.getElementById("loadOverlay");
  const imgEl=document.getElementById("loadImg");
  const bar=document.getElementById("loadBar");
  const barWrap=document.getElementById("loadBarWrap");
  if(!overlay||!imgEl||!bar)return;
  const STEP_MS=750,STEPS=4;
  /* FLIP: measure #loadImg where it's actually sitting (centered, fixed
     size), measure #introImg's real target slot (already laid out in the
     hidden intro underneath), then animate #loadImg's own box between
     those two rects while the overlay's background fades away — so the
     photo itself appears to travel from the loader into the page rather
     than the loader just disappearing and a second photo popping in. */
  function finish(){
    const introImg=document.getElementById("introImg");
    if(!introImg||!imgEl.src){
      overlay.style.transition="opacity 420ms ease";
      overlay.style.opacity="0";
      setTimeout(()=>{overlay.style.display="none";},420);
      return;
    }
    const startRect=imgEl.getBoundingClientRect();
    introImg.src=imgEl.src;
    const landRect=introImg.getBoundingClientRect();
    if(barWrap){barWrap.style.transition="opacity 200ms ease";barWrap.style.opacity="0";}
    imgEl.style.position="fixed";imgEl.style.margin="0";
    imgEl.style.left=startRect.left+"px";imgEl.style.top=startRect.top+"px";
    imgEl.style.width=startRect.width+"px";imgEl.style.height=startRect.height+"px";
    overlay.style.transition="background-color 550ms ease";
    requestAnimationFrame(()=>{
      overlay.style.background="transparent";
      imgEl.style.transition=
        "left 620ms cubic-bezier(.22,1,.36,1), top 620ms cubic-bezier(.22,1,.36,1),"+
        "width 620ms cubic-bezier(.22,1,.36,1), height 620ms cubic-bezier(.22,1,.36,1)";
      imgEl.style.left=landRect.left+"px";imgEl.style.top=landRect.top+"px";
      imgEl.style.width=landRect.width+"px";imgEl.style.height=landRect.height+"px";
    });
    setTimeout(()=>{overlay.style.display="none";},650);
  }
  const pool=[];
  const names=Object.keys(CITIES);
  let remaining=names.length;
  function probeDone(){
    if(--remaining>0)return;
    if(!pool.length){finish();return;}
    shuffle(pool);
    let idx=0;
    function step(n){
      imgEl.src=pool[idx++%pool.length];
      if(n<STEPS-1)setTimeout(()=>step(n+1),STEP_MS);
    }
    /* step() must not depend on requestAnimationFrame — rAF only fires
       while the tab is actually visible/rendering, so on a backgrounded
       or occluded tab it can stall indefinitely, leaving the photo frozen
       on whatever it last showed while the independent finish() timeout
       below still fires on schedule. Run the shuffle via its own
       setTimeout chain (throttled but never skipped in a background tab)
       and keep rAF only for the purely cosmetic bar-width kickoff. */
    step(0);
    requestAnimationFrame(()=>{
      bar.style.transition=`width ${STEP_MS*STEPS}ms linear`;
      bar.style.width="100%";
    });
    setTimeout(finish,STEP_MS*STEPS);
  }
  let shown=false;
  names.forEach(name=>{
    const src=`Cities/${cityFile(name)}.webp`;
    const probe=new Image();
    probe.onload=()=>{
      pool.push(src);
      /* Show the first confirmed-loaded photo immediately instead of
         leaving the image slot blank while the remaining ~30 probes are
         still in flight — it's already decoded (that's why onload fired),
         so this paints instantly with no flash. Until then, #loadImg's
         own "pending" pulse (see style.css) covers the network gap
         instead of a blank white square. */
      if(!shown){shown=true;imgEl.classList.remove("pending");imgEl.src=src;}
      probeDone();
    };
    probe.onerror=probeDone;
    probe.src=src;
  });
})();

/* Shift+R — a full-screen loop of every quiz object falling like rain,
   for recording a promo thumbnail. Purely a marketing/dev tool, no link
   from the UI; toggles on/off, built once then reused. */
(function initRain(){
  const overlay=document.getElementById("rainOverlay");
  if(!overlay)return;
  let on=false,built=false;
  async function build(){
    built=true;
    const seen=new Set();
    FAMILIES.forEach(f=>{
      f.opts.forEach(o=>{if(o.img)seen.add(o.img);});
    });
    /* Always crop here, regardless of each question's own "snug" flag —
       that flag exists to keep e.g. the drinks row visually consistent
       in the quiz, which doesn't matter for rain. Without it, drinks
       render from their full padded square and look tiny. */
    const items=[...seen];
    const urls=await Promise.all(items.map(src=>stripWhiteBg(src,true)));
    /* One sprite per unique image (not a random pick per sprite) so the
       same object can never be visible twice at once — each item falls
       on its own independent loop. Vehicles and paintings are the big
       set pieces, vinyls a step below that, and everything else (drinks,
       souvenirs, tarot, scents, sun/moon) stays modest so it doesn't
       compete with them. */
    const sizeRange=src=>
      src.startsWith("art/transport/")?[380,460]:
      src.startsWith("art/art/")?[230,290]:
      src.startsWith("art/vinyls/")?[280,340]:
      [55,75];
    urls.forEach((url,i)=>{
      const el=document.createElement("img");
      el.src=url;el.alt="";el.className="rain-drop";
      const [lo,hi]=sizeRange(items[i]);
      const size=lo+Math.random()*(hi-lo);
      el.style.width=size+"px";
      el.style.left=(25+Math.random()*50)+"%";
      const dur=7+Math.random()*7;
      el.style.animationDuration=dur+"s";
      el.style.animationDelay=(-Math.random()*dur)+"s";
      el.style.setProperty("--rot",(Math.random()*540-270)+"deg");
      overlay.appendChild(el);
    });
  }
  async function toggle(){
    on=!on;
    if(on&&!built)await build();
    overlay.classList.toggle("on",on);
  }
  window.addEventListener("keydown",e=>{
    if(e.shiftKey&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&(e.key==="R"||e.key==="r"))toggle();
  });
})();
