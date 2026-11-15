// Contract Connect outline map, shared by the Westchester and NYC apps.
// Draws town / borough outlines (data/shapes.json, via build.py as window.CC_SHAPES), lights up the user's own areas,
// and puts one circle per project, sized by the estimated value for the selected trades.
//   const m = new CCMap(boxElement, {shapes, mine: ['Yonkers', ...], onOpen: id => ..., hint: element});
//   m.setItems([{id, lat, lng, v, hot, title, sub, val}]);   // v = dollars for sizing, hot = on the call list
//   m.fitArea('Brooklyn') / m.fitMine()
(function(){
const COL = {water:'#12171e', land:'#191f27', landMine:'#283445', edge:'#262e39', edgeMine:'#5d7189', edgeHover:'#c3ccd8',
  label:'#6f7b8b', labelMine:'#e3e8ee', hot:'rgba(245,166,35,.86)', hotEdge:'#141a22', cold:'rgba(120,144,170,.42)', coldEdge:'rgba(18,23,30,.7)'};
const esc = s => String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const MONO = '"IBM Plex Mono",ui-monospace,monospace';

class CCMap {
  constructor(box, opt){
    this.box = box; box.ccmap = this; this.opt = opt; this.items = []; this.hover = null; this.hoverArea = null; this.pinned = null;
    this.mine = new Set(opt.mine||[]);
    box.classList.add('ccmap');
    box.innerHTML = `<canvas aria-label="Map of projects; circle size shows estimated value"></canvas>
      <div class="ccmap-ctl"><button type="button" data-z="1" aria-label="Zoom in">+</button><button type="button" data-z="-1" aria-label="Zoom out">−</button><button type="button" data-z="0" aria-label="Back to my areas" title="Back to my areas">⤢</button></div>
      <div class="ccmap-card hide" role="status"></div><div class="ccmap-toast hide"></div>`;
    this.cv = box.querySelector('canvas'); this.card = box.querySelector('.ccmap-card'); this.toast = box.querySelector('.ccmap-toast');
    // Projection: longitude scaled by cos(latitude) so shapes keep their proportions.
    const all = Object.values(opt.shapes).flat(2).flat();
    const lat0 = all.reduce((a,p)=>a+p[1],0)/all.length; this.k = Math.cos(lat0*Math.PI/180);
    this.areas = Object.entries(opt.shapes).map(([name, polys]) => {
      const path = new Path2D(); let bx=[1e9,1e9,-1e9,-1e9], best=null, bestA=-1;
      polys.forEach(rings => rings.forEach((ring, ri) => {
        ring.forEach(([lng,lat],i) => { const x=lng*this.k, y=-lat; i?path.lineTo(x,y):path.moveTo(x,y);
          bx=[Math.min(bx[0],x),Math.min(bx[1],y),Math.max(bx[2],x),Math.max(bx[3],y)]; });
        path.closePath();
        if(ri===0){ const a=Math.abs(ring.reduce((s,p,i)=>{const q=ring[(i+1)%ring.length];return s+p[0]*q[1]-q[0]*p[1]},0)); if(a>bestA){bestA=a;best=ring;} }
      }));
      // Label at the middle of the biggest piece (average of its points is close enough for these shapes).
      const lp = best ? [best.reduce((s,p)=>s+p[0],0)/best.length*this.k, -best.reduce((s,p)=>s+p[1],0)/best.length] : [(bx[0]+bx[2])/2,(bx[1]+bx[3])/2];
      return {name, path, bbox:bx, lp, mine:this.mine.has(name)};
    });
    this.view = {s:1, tx:0, ty:0};
    // On touch screens the hint under the map explains the touch gestures instead of mouse and keyboard ones.
    if(opt.hint && matchMedia('(pointer: coarse)').matches) opt.hint.textContent = 'Circle size is the estimate for your trades. Tap a circle for details; tap a '+(opt.unit||'town')+' to zoom in. Use two fingers to move or zoom the map.';
    this.bind();
    new ResizeObserver(() => { if(this.box.offsetParent!==null){ if(!this.fitted) this.fitMine(); else this.draw(); } }).observe(box);
  }

  // ---- view
  size(){ return [this.cv.clientWidth, this.cv.clientHeight]; }
  fitBox(b, pad=30){
    const [W,H] = this.size(); if(!W||!H) return;
    const s = Math.min((W-2*pad)/((b[2]-b[0])||0.01), (H-2*pad)/((b[3]-b[1])||0.01));
    this.view = {s, tx: W/2-(b[0]+b[2])/2*s, ty: H/2-(b[1]+b[3])/2*s};
    this.fitted = true; this.draw();
  }
  union(list){ return list.reduce((b,a)=>[Math.min(b[0],a.bbox[0]),Math.min(b[1],a.bbox[1]),Math.max(b[2],a.bbox[2]),Math.max(b[3],a.bbox[3])],[1e9,1e9,-1e9,-1e9]); }
  fitMine(){ const m=this.areas.filter(a=>a.mine); this.home = this.union(m.length?m:this.areas); this.fitBox(this.home); }
  fitArea(name){ const a=this.areas.find(a=>a.name===name); a ? this.fitBox(a.bbox, 40) : this.fitMine(); }
  zoomAt(f, cx, cy){
    const v=this.view, s=Math.max(this.minS(), Math.min(v.s*f, this.minS()*60));
    const r=s/v.s; this.view={s, tx:cx-(cx-v.tx)*r, ty:cy-(cy-v.ty)*r}; this.draw();
  }
  minS(){ const [W,H]=this.size(), b=this.union(this.areas); return Math.min(W/(b[2]-b[0]), H/(b[3]-b[1]))*0.6; }
  toScreen(lng,lat){ return [lng*this.k*this.view.s+this.view.tx, -lat*this.view.s+this.view.ty]; }

  // ---- data
  setItems(items){
    // Big circles first so small ones stay on top and clickable; filtered-out ones under the call list.
    this.items = items.filter(i=>i.lat&&i.lng).sort((a,b)=>(a.hot-b.hot)||(b.v-a.v));
    const vs = this.items.filter(i=>i.v>0).map(i=>i.v).sort((a,b)=>a-b);
    this.vref = vs.length ? vs[Math.floor(vs.length*0.95)] : 1e6;  // the 95th-percentile job gets a full-size circle
    this.pinned = null; this.hideCard(); this.draw();
  }
  radius(v){
    const z = Math.min(2.2, Math.max(1, Math.sqrt(this.view.s/(this.home?this.fitS():this.view.s))));
    return Math.max(2.6, Math.min(15, 2.2+11*Math.sqrt(Math.max(v,0)/this.vref))) * z;
  }
  fitS(){ const [W,H]=this.size(), b=this.home; return Math.min((W-60)/(b[2]-b[0]), (H-60)/(b[3]-b[1])); }

  // ---- drawing
  draw(){
    if(this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.paint(); });
  }
  paint(){
    const cv=this.cv, [W,H]=this.size(); if(!W) return;
    const dpr=window.devicePixelRatio||1; if(cv.width!==W*dpr||cv.height!==H*dpr){cv.width=W*dpr;cv.height=H*dpr;}
    const g=cv.getContext('2d'), v=this.view;
    g.setTransform(dpr,0,0,dpr,0,0); g.fillStyle=COL.water; g.fillRect(0,0,W,H);
    g.setTransform(dpr*v.s,0,0,dpr*v.s,dpr*v.tx,dpr*v.ty);
    g.lineJoin='round';
    for(const pass of [0,1]) this.areas.forEach(a => {
      if((pass===1)!==(a.mine||a===this.hoverArea)) return;
      g.fillStyle = a.mine ? COL.landMine : COL.land; g.fill(a.path, 'evenodd');
      g.strokeStyle = a===this.hoverArea ? COL.edgeHover : a.mine ? COL.edgeMine : COL.edge;
      g.lineWidth = (a===this.hoverArea?1.6:1)/v.s; g.stroke(a.path);
    });
    g.setTransform(dpr,0,0,dpr,0,0);
    // Circles
    this.drawn = [];
    for(const it of this.items){
      const [x,y]=this.toScreen(it.lng,it.lat), r=this.radius(it.v);
      if(x<-r||y<-r||x>W+r||y>H+r) continue;
      g.beginPath(); g.arc(x,y,r,0,Math.PI*2);
      g.fillStyle = it.hot ? COL.hot : COL.cold; g.fill();
      g.lineWidth = it===this.hover||it===this.pinned ? 2.2 : 1; g.strokeStyle = it===this.hover||it===this.pinned ? '#fff' : it.hot ? COL.hotEdge : COL.coldEdge; g.stroke();
      this.drawn.push({it,x,y,r});
    }
    // Area names: the user's areas always, others once zoomed in; skip any that would overlap.
    const boxes=[]; g.textAlign='center'; g.textBaseline='middle';
    const zoomed = this.home && v.s > this.fitS()*1.6;
    [...this.areas].sort((a,b)=>b.mine-a.mine).forEach(a => {
      if(!a.mine && !zoomed && this.areas.length>6) return;
      const x=a.lp[0]*v.s+v.tx, y=a.lp[1]*v.s+v.ty; if(x<0||y<0||x>W||y>H) return;
      g.font = `${a.mine?600:500} 11px ${MONO}`;
      const w=g.measureText(a.name).width+8, b=[x-w/2,y-8,x+w/2,y+8];
      if(boxes.some(o=>b[0]<o[2]&&b[2]>o[0]&&b[1]<o[3]&&b[3]>o[1])) return; boxes.push(b);
      g.lineWidth=3; g.strokeStyle='rgba(20,26,34,.85)'; g.strokeText(a.name,x,y);
      g.fillStyle = a.mine ? COL.labelMine : COL.label; g.fillText(a.name,x,y);
    });
    this.legend(g,W,H);
  }
  legend(g,W,H){
    // Three tidy amounts (1, 2 or 5 times a power of ten) spanning small to full-size circles.
    const nice=x=>{const p=Math.pow(10,Math.floor(Math.log10(x))),m=x/p;return (m<1.5?1:m<3.5?2:m<7.5?5:10)*p};
    const steps=[...new Set([this.vref/12,this.vref/3,this.vref].map(nice))];
    const f=x=>x>=1e6?'$'+(x/1e6).toFixed(x%1e6?1:0)+'M':'$'+Math.round(x/1e3)+'K';
    g.font=`500 10px ${MONO}`; g.textBaseline='middle'; g.textAlign='left';
    const rs=steps.map(s=>this.radius(s)), rmax=Math.max(...rs);
    const w=Math.max(g.measureText('CIRCLE SIZE = EST. VALUE').width, steps.reduce((a,s,i)=>a+2*rs[i]+g.measureText(f(s)).width+18,0))+16;
    const h=2*rmax+30, top=H-h-6;
    g.fillStyle='rgba(14,18,24,.86)'; g.fillRect(6,top,w,h);
    g.fillStyle=COL.label; g.fillText('CIRCLE SIZE = EST. VALUE',14,top+12);
    let x=14; const y=top+20+rmax;
    steps.forEach((s,i)=>{ const r=rs[i]; g.beginPath(); g.arc(x+r,y,r,0,Math.PI*2); g.fillStyle=COL.hot; g.fill(); g.strokeStyle=COL.hotEdge; g.lineWidth=1; g.stroke();
      g.fillStyle=COL.labelMine; g.fillText(f(s),x+2*r+5,y); x+=2*r+g.measureText(f(s)).width+18; });
  }

  // ---- interaction
  hitItem(x,y){ let best=null, bd=1e9;
    for(let i=this.drawn.length-1;i>=0;i--){ const d=this.drawn[i], dist=Math.hypot(d.x-x,d.y-y);
      if(dist<=d.r+3 && dist-d.r<bd){ bd=dist-d.r; best=d.it; if(dist<d.r) break; } }
    return best; }
  hitArea(x,y){ const g=this.cv.getContext('2d'), v=this.view, px=(x-v.tx)/v.s, py=(y-v.ty)/v.s;
    g.setTransform(1,0,0,1,0,0); return this.areas.find(a=>px>=a.bbox[0]&&px<=a.bbox[2]&&py>=a.bbox[1]&&py<=a.bbox[3]&&g.isPointInPath(a.path,px,py,'evenodd'))||null; }
  pos(e){ const r=this.cv.getBoundingClientRect(); return [e.clientX-r.left, e.clientY-r.top]; }
  showCard(it, x, y, touch){
    const c=this.card;
    c.innerHTML=`<b>${esc(it.title)}</b><span>${esc(it.sub)}</span><em>${esc(it.val)}</em>${touch?'<button type="button">Open project →</button>':''}`;
    c.classList.remove('hide'); c.classList.toggle('touch', !!touch);
    const [W,H]=this.size(), cw=c.offsetWidth, ch=c.offsetHeight;
    c.style.left=Math.max(6,Math.min(W-cw-6, x+14))+'px'; c.style.top=Math.max(6, y-ch-14 < 6 ? y+16 : y-ch-14)+'px';
    if(touch) c.querySelector('button').onclick=()=>this.opt.onOpen(it.id);
  }
  hideCard(){ this.card.classList.add('hide'); }
  say(t){ this.toast.textContent=t; this.toast.classList.remove('hide'); clearTimeout(this.tt); this.tt=setTimeout(()=>this.toast.classList.add('hide'),1400); }
  bind(){
    const cv=this.cv;
    this.box.querySelectorAll('.ccmap-ctl button').forEach(b=>b.onclick=()=>{
      const z=+b.dataset.z, [W,H]=this.size(); z ? this.zoomAt(z>0?1.6:1/1.6, W/2, H/2) : this.fitMine(); });
    // Mouse: drag to move, click a circle to open it, click an area to zoom to it, Ctrl/Cmd + wheel (or trackpad pinch) to zoom.
    let drag=null;
    cv.addEventListener('mousedown', e=>{ drag={x:e.clientX,y:e.clientY,tx:this.view.tx,ty:this.view.ty,moved:false}; });
    window.addEventListener('mousemove', e=>{
      if(drag){ const dx=e.clientX-drag.x, dy=e.clientY-drag.y; if(Math.abs(dx)+Math.abs(dy)>3) drag.moved=true;
        if(drag.moved){ this.view.tx=drag.tx+dx; this.view.ty=drag.ty+dy; this.hideCard(); this.draw(); cv.style.cursor='grabbing'; } return; }
      if(e.target!==cv) return;
      const [x,y]=this.pos(e), it=this.hitItem(x,y), ar=it?null:this.hitArea(x,y);
      if(it!==this.hover||ar!==this.hoverArea){ this.hover=it; this.hoverArea=ar; this.draw(); }
      cv.style.cursor = it||ar ? 'pointer' : 'grab';
      it ? this.showCard(it,x,y,false) : this.hideCard();
    });
    window.addEventListener('mouseup', e=>{
      if(!drag) return; const moved=drag.moved; drag=null; cv.style.cursor='grab';
      if(moved||e.target!==cv) return;
      const [x,y]=this.pos(e), it=this.hitItem(x,y);
      if(it) return this.opt.onOpen(it.id);
      const ar=this.hitArea(x,y); if(ar) this.fitBox(ar.bbox,40);
    });
    cv.addEventListener('mouseleave', ()=>{ if(this.hover||this.hoverArea){ this.hover=this.hoverArea=null; this.draw(); } this.hideCard(); });
    cv.addEventListener('dblclick', e=>{ const [x,y]=this.pos(e); this.zoomAt(2,x,y); });
    cv.addEventListener('wheel', e=>{
      if(!(e.ctrlKey||e.metaKey)){ this.say(/Mac/.test(navigator.platform)?'Hold ⌘ and scroll to zoom':'Hold Ctrl and scroll to zoom'); return; }
      e.preventDefault(); const [x,y]=this.pos(e); this.zoomAt(Math.exp(-e.deltaY*0.01),x,y);
    }, {passive:false});
    // Touch: one finger scrolls the page and taps; two fingers move and zoom the map.
    let t=null;
    const mid=ts=>{const r=cv.getBoundingClientRect();return [(ts[0].clientX+ts[1].clientX)/2-r.left,(ts[0].clientY+ts[1].clientY)/2-r.top]};
    const dist=ts=>Math.hypot(ts[0].clientX-ts[1].clientX, ts[0].clientY-ts[1].clientY);
    cv.addEventListener('touchstart', e=>{
      if(e.touches.length===2){ t={m:mid(e.touches), d:dist(e.touches), v:{...this.view}}; this.hideCard(); }
      else if(e.touches.length===1){ t=null; this.tap={x:e.touches[0].clientX,y:e.touches[0].clientY,at:Date.now()}; }
    }, {passive:true});
    cv.addEventListener('touchmove', e=>{
      if(e.touches.length!==2||!t) { if(e.touches.length===1) this.say('Use two fingers to move the map'); return; }
      e.preventDefault();
      const m=mid(e.touches), f=dist(e.touches)/t.d, s=Math.max(this.minS(),Math.min(t.v.s*f,this.minS()*60)), r=s/t.v.s;
      this.view={s, tx:m[0]-(t.m[0]-t.v.tx)*r, ty:m[1]-(t.m[1]-t.v.ty)*r}; this.draw();
    }, {passive:false});
    cv.addEventListener('touchend', e=>{
      if(e.touches.length) return; const tp=this.tap; this.tap=null;
      if(t){ t=null; return; }
      if(!tp||Date.now()-tp.at>400) return;
      const ct=e.changedTouches[0]; if(Math.hypot(ct.clientX-tp.x,ct.clientY-tp.y)>10) return;
      e.preventDefault();
      const [x,y]=this.pos(ct), it=this.hitItem(x,y);
      if(it){ this.pinned=it; this.showCard(it,x,y,true); this.draw(); return; }
      this.pinned=null; this.hideCard(); const ar=this.hitArea(x,y); if(ar) this.fitBox(ar.bbox,40); else this.draw();
    });
  }
}
window.CCMap = CCMap;
})();
