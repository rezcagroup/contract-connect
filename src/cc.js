// Contract Connect: shared sign-in, area and data code for every page after the landing page.
// build.py fills __SB_URL__ and __SB_KEY__ from site_config.json. The publishable key is meant to be public:
// what a user can read is decided by the database rules in supabase/schema.sql, not by this file.
(function(){
const SB_URL = "__SB_URL__", SB_KEY = "__SB_KEY__";
const CC = window.CC = {};
CC.configured = /^https:\/\//.test(SB_URL) && SB_KEY.length > 20;
// keepalive lets a save that starts as the user leaves the page still finish.
CC.sb = CC.configured && window.supabase ? window.supabase.createClient(SB_URL, SB_KEY, {global:{fetch:(u,o={})=>fetch(u, o.method==='PATCH' ? {...o, keepalive:true} : o)}}) : null;
const esc = s => String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
CC.esc = esc;
CC.STACK = '<a class="cc-mark stack" href="index.html" aria-label="Contract Connect home"><img class="cc-ic" src="assets/icon.png" alt=""><span class="c1">Contract</span><span class="c2">Connect</span><span class="cc-tag">FIND\nBID\nWIN</span></a>';
CC.REGIONS = {wc:{name:'Westchester', short:'Westchester', page:'westchester.html', unit:'towns'}, nyc:{name:'New York City', short:'NYC', page:'nyc.html', unit:'boroughs'},
  bids:{name:'Public bids', short:'Bids', page:'bids.html', unit:'sources'}};

function notReady(){
  document.body.className = 'cc-page';
  document.body.innerHTML = `<div class="cc-center"><div class="cc-card">${CC.STACK}<h1>Almost ready</h1>
    <p>Accounts aren't switched on yet. Add the Supabase project URL and publishable key to <code>site_config.json</code> and rebuild.</p>
    <p><a href="index.html">← Back to the home page</a></p></div></div>`;
}
CC.notReady = notReady;

CC.session = async () => { if(!CC.sb) return null; const {data} = await CC.sb.auth.getSession(); return data.session; };

// Send signed-out visitors to the log-in page, then bring them back here.
CC.requireUser = async () => {
  if(!CC.sb){ notReady(); throw new Error('not configured'); }
  const s = await CC.session();
  if(!s){ location.replace('login.html?next=' + encodeURIComponent(location.pathname.split('/').pop() + location.hash)); throw new Error('signed out'); }
  return s.user;
};

// The trades a user can sell. Keys match TRADES in both apps.
CC.TRADES = {gc:'General contractor', frame:'Framing & carpentry', concrete:'Concrete', site:'Site work', hvac:'HVAC', elec:'Electrical', plumb:'Plumbing', roof:'Roofing', windows:'Windows & doors', paint:'Painting'};

CC.profile = async () => {
  const {data, error} = await CC.sb.from('profiles').select('*').maybeSingle();
  if(error) throw error;
  const p = data || {areas:[], has_access:true};
  p.trades = (p.trades||[]).filter(k=>CC.TRADES[k]);
  return p;
};
// Save profile fields. If the trades column hasn't been added yet (supabase/schema.sql), save the rest without it.
CC.saveProfile = async (user, fields) => {
  let {error} = await CC.sb.from('profiles').update(fields).eq('id', user.id);
  if(error && 'trades' in fields && /trades/.test(error.message||'')){
    const {trades, ...rest} = fields;
    ({error} = Object.keys(rest).length ? await CC.sb.from('profiles').update(rest).eq('id', user.id) : {error:null});
  }
  if(error) throw error;
};
CC.saveAreas = (user, areas, trades) => CC.saveProfile(user, trades ? {areas, trades} : {areas});
// Called by the apps' trade picker. Both apps' local settings update at once; the account is saved after a short pause
// (several clicks in a row make one save), or right away if the user leaves the page first.
CC.saveTrades = trades => {
  for(const key of ['wcl-assume','nyc-assume']){ try{ const a=JSON.parse(localStorage.getItem(key)||'null')||{}; a.trades=trades; delete a.trade; localStorage.setItem(key, JSON.stringify(a)); }catch(e){} }
  CC._pending = trades; clearTimeout(CC._tt); CC._tt = setTimeout(CC.flushTrades, 300);
};
CC.flushTrades = () => {
  clearTimeout(CC._tt); const t = CC._pending; CC._pending = null;
  if(t && CC.user) CC.saveProfile(CC.user, {trades:t}).catch(()=>{});
};
addEventListener('pagehide', () => CC.flushTrades());
document.addEventListener('visibilitychange', () => { if(document.visibilityState==='hidden') CC.flushTrades(); });

// "Selling: Concrete + HVAC ▾" with a checklist of trades. onChange gets the new list (never empty, in the order picked).
CC.tradePicker = (el, TRADES, selected, onChange) => {
  let cur = [...selected];
  el.innerHTML = `<span class="lbl">Selling</span><div class="cc-tp">
    <button type="button" class="cc-tp-btn" aria-haspopup="true" aria-expanded="false"><span class="cc-tp-val"></span><i aria-hidden="true">▾</i></button>
    <div class="cc-tp-menu hide" role="group" aria-label="Trades you sell">
      ${Object.entries(TRADES).map(([k,t])=>`<label><input type="checkbox" value="${k}"><span>${esc(t.n)}</span></label>`).join('')}
      <div class="cc-tp-foot">Pick every trade you sell. Estimates add them up.</div></div></div>`;
  const btn = el.querySelector('.cc-tp-btn'), menu = el.querySelector('.cc-tp-menu'), boxes = [...menu.querySelectorAll('input')];
  const sync = () => { el.querySelector('.cc-tp-val').textContent = cur.map(k=>TRADES[k].n).join(' + '); boxes.forEach(b=>b.checked=cur.includes(b.value)); };
  const open = on => { menu.classList.toggle('hide', !on); btn.setAttribute('aria-expanded', on); };
  btn.onclick = e => { e.stopPropagation(); open(menu.classList.contains('hide')); };
  menu.onclick = e => e.stopPropagation();
  boxes.forEach(b => b.onchange = () => {
    const next = b.checked ? [...cur, b.value] : cur.filter(k=>k!==b.value);
    if(!next.length){ b.checked = true; el.querySelector('.cc-tp-foot').textContent = 'Keep at least one trade.'; return; }
    cur = next; sync(); onChange([...cur]);
  });
  if(!CC._tpDoc){ CC._tpDoc = true; document.addEventListener('click', () => document.querySelectorAll('.cc-tp-menu').forEach(m=>{m.classList.add('hide'); m.previousElementSibling.setAttribute('aria-expanded', false);})); 
    document.addEventListener('keydown', e => { if(e.key==='Escape') document.querySelectorAll('.cc-tp-menu').forEach(m=>m.classList.add('hide')); }); }
  sync();
};
CC.meta = async key => {
  const {data, error} = await CC.sb.from('meta').select('payload').eq('key', key).maybeSingle();
  if(error) throw error;
  return data ? data.payload : null;
};
// Where to go after signing in: the first region the user picked something in, else the area picker.
CC.home = areas => (areas||[]).some(a=>a.startsWith('wc:')) ? 'westchester.html' : (areas||[]).some(a=>a.startsWith('nyc:')) ? 'nyc.html' : (areas||[]).some(a=>a.startsWith('bids:')) ? 'bids.html' : 'areas.html';

// All rows the database lets this user see, 1000 at a time.
async function all(table, cols, filter){
  const out = [];
  for(let from = 0; ; from += 1000){
    let q = CC.sb.from(table).select(cols).range(from, from + 999);
    if(filter) q = filter(q);
    const {data, error} = await q;
    if(error) throw error;
    out.push(...data);
    if(data.length < 1000) return out;
  }
}

CC.signOut = async () => { await CC.sb.auth.signOut(); location.href = 'index.html'; };

// The bar above every app page: brand, the two regions, Trades & areas, Log out. Phones get the icon and short labels.
CC.accountBar = (current, profile) => {
  const bar = document.createElement('div');
  bar.className = 'cc-bar';
  const n = r => profile.areas.filter(a=>a.startsWith(r+':')).length;
  bar.innerHTML = `<div class="wrap cc-bar-in">
    <a class="cc-mark" href="${CC.home(profile.areas)}" aria-label="Contract Connect home"><img class="cc-ic" src="assets/icon.png" alt=""><span class="c1">Contract</span><span class="c2">Connect</span></a>
    <nav>${Object.entries(CC.REGIONS).map(([k,r])=>`<a href="${r.page}" class="${k===current?'on':''}"><span class="lg">${r.name}</span><span class="sm">${r.short}</span><i>${n(k)}</i></a>`).join('')}
      <a href="areas.html" class="${current==='areas'?'on':''}"><span class="lg">Trades &amp; areas</span><span class="sm">Areas</span></a>
      <button type="button" id="cc-out">Log out</button></nav></div>`;
  document.body.prepend(bar);
  bar.querySelector('#cc-out').onclick = CC.signOut;
};

function message(title, html){
  const main = document.querySelector('main') || document.body;
  main.innerHTML = `<div class="cc-empty"><h2>${title}</h2>${html}</div>`;
  document.querySelectorAll('header.top nav, #tradebar, #ticker').forEach(e=>e.remove());
}

// Start an app page: check the sign-in and the user's areas, load only their rows, then run the app.
CC.boot = async (region, start) => {
  let user, profile;
  try { user = await CC.requireUser(); profile = await CC.profile(); }
  catch(e){ if(e.message!=='not configured' && e.message!=='signed out') message('Something went wrong', `<p>${esc(e.message)}</p>`); return; }
  CC.user = user;
  CC.accountBar(region, profile);
  const R = CC.REGIONS[region];
  const mine = profile.areas.filter(a=>a.startsWith(region+':')).map(a=>a.slice(region.length+1));
  if(!profile.has_access) return message('Your access is paused', '<p>Contact us to turn your account back on.</p>');
  if(!mine.length) return message(`No ${R.name} areas picked`, `<p>Turn on the ${R.unit} you work in to see projects here.</p><p><a class="cc-btn" href="areas.html">Pick ${R.unit}</a></p>`);
  const scope = document.getElementById('cc-scope');
  if(scope) scope.textContent += ` · your ${mine.length} ${mine.length===1?R.unit.replace(/s$/,''):R.unit}`;
  const main = document.querySelector('main');
  const loading = document.createElement('div');
  loading.className = 'cc-loading'; loading.textContent = region === 'bids' ? 'Loading open bids…' : 'Loading your projects…';
  main.prepend(loading);
  try {
    const rows = await all('projects', 'payload', q => q.eq('region', region).order('id'));
    const D = {areas: mine, trades: profile.trades};
    if(region === 'wc'){
      D.RAW = []; D.EV = {}; D.ATT = {}; D.TEAM = {}; D.PERMITS = {}; D.CONTACTS = {};
      rows.forEach(({payload:p}) => {
        const id = p.r[0]; D.RAW.push(p.r);
        if(p.ev) D.EV[id] = p.ev; if(p.att) D.ATT[id] = p.att; if(p.team) D.TEAM[id] = p.team; if(p.permit) D.PERMITS[id] = p.permit;
      });
      (await all('area_info', 'area,payload', q => q.like('area', 'wc:%'))).forEach(r => D.CONTACTS[r.area.slice(3)] = r.payload);
    } else if(region === 'bids'){
      D.BIDS = Object.assign({pulled:'', source:''}, await CC.meta('bids'), {rows: rows.map(r=>r.payload)});
    } else {
      D.NYC = Object.assign({pulled:'', since:'', altMinCost:500000}, await CC.meta('nyc'), {rows: rows.map(r=>r.payload)});
    }
    loading.remove();
    if(!rows.length && region === 'bids') return message('No open bids right now', `<p>There are no open construction bids from your sources. Check back after tomorrow morning's update.</p><p><a class="cc-btn" href="areas.html">Change sources</a></p>`);
    if(!rows.length) return message('No projects yet', `<p>There are no current filings in your ${R.unit}. Add more ${R.unit} or check back after tomorrow morning's update.</p><p><a class="cc-btn" href="areas.html">Change ${R.unit}</a></p>`);
    start(D);
  } catch(e){
    loading.remove();
    message('Could not load projects', `<p>${esc(e.message||e)}</p><p><a href="">Try again</a></p>`);
  }
};
})();
