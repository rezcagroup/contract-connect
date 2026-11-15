// Contract Connect: shared sign-in, area and data code for every page after the landing page.
// build.py fills __SB_URL__ and __SB_KEY__ from site_config.json. The publishable key is meant to be public:
// what a user can read is decided by the database rules in supabase/schema.sql, not by this file.
(function(){
const SB_URL = "__SB_URL__", SB_KEY = "__SB_KEY__";
const CC = window.CC = {};
CC.configured = /^https:\/\//.test(SB_URL) && SB_KEY.length > 20;
CC.sb = CC.configured && window.supabase ? window.supabase.createClient(SB_URL, SB_KEY) : null;
const esc = s => String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
CC.esc = esc;
CC.STACK = '<a class="cc-mark stack" href="index.html" aria-label="Contract Connect home"><span class="c1">Contract</span><span class="c2">Connect</span><span class="tag">FIND\nBID\nWIN</span></a>';
CC.REGIONS = {wc:{name:'Westchester', page:'westchester.html', unit:'towns'}, nyc:{name:'New York City', page:'nyc.html', unit:'boroughs'}};

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

CC.profile = async () => {
  const {data, error} = await CC.sb.from('profiles').select('email,areas,has_access').maybeSingle();
  if(error) throw error;
  return data || {areas:[], has_access:true};
};
CC.saveAreas = async (user, areas) => {
  const {error} = await CC.sb.from('profiles').update({areas}).eq('id', user.id);
  if(error) throw error;
};
CC.meta = async key => {
  const {data, error} = await CC.sb.from('meta').select('payload').eq('key', key).maybeSingle();
  if(error) throw error;
  return data ? data.payload : null;
};
// Where to go after signing in: the first region the user picked something in, else the area picker.
CC.home = areas => (areas||[]).some(a=>a.startsWith('wc:')) ? 'westchester.html' : (areas||[]).some(a=>a.startsWith('nyc:')) ? 'nyc.html' : 'areas.html';

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

// The bar above every app page: brand, the two regions, My areas, Log out.
CC.accountBar = (current, profile) => {
  const bar = document.createElement('div');
  bar.className = 'cc-bar';
  const n = r => profile.areas.filter(a=>a.startsWith(r+':')).length;
  bar.innerHTML = `<div class="wrap cc-bar-in">
    <a class="cc-mark" href="${CC.home(profile.areas)}" aria-label="Contract Connect home"><span class="c1">Contract</span><span class="c2">Connect</span></a>
    <nav>${Object.entries(CC.REGIONS).map(([k,r])=>`<a href="${r.page}" class="${k===current?'on':''}">${r.name}<i>${n(k)}</i></a>`).join('')}
      <a href="areas.html" class="${current==='areas'?'on':''}">My areas</a>
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
  CC.accountBar(region, profile);
  const R = CC.REGIONS[region];
  const mine = profile.areas.filter(a=>a.startsWith(region+':')).map(a=>a.slice(region.length+1));
  if(!profile.has_access) return message('Your access is paused', '<p>Contact us to turn your account back on.</p>');
  if(!mine.length) return message(`No ${R.name} areas picked`, `<p>Turn on the ${R.unit} you work in to see projects here.</p><p><a class="cc-btn" href="areas.html">Pick ${R.unit}</a></p>`);
  const scope = document.getElementById('cc-scope');
  if(scope) scope.textContent += ` · your ${mine.length} ${mine.length===1?R.unit.replace(/s$/,''):R.unit}`;
  const main = document.querySelector('main');
  const loading = document.createElement('div');
  loading.className = 'cc-loading'; loading.textContent = 'Loading your projects…';
  main.prepend(loading);
  try {
    const rows = await all('projects', 'payload', q => q.eq('region', region).order('id'));
    const D = {areas: mine};
    if(region === 'wc'){
      D.RAW = []; D.EV = {}; D.ATT = {}; D.TEAM = {}; D.PERMITS = {}; D.CONTACTS = {};
      rows.forEach(({payload:p}) => {
        const id = p.r[0]; D.RAW.push(p.r);
        if(p.ev) D.EV[id] = p.ev; if(p.att) D.ATT[id] = p.att; if(p.team) D.TEAM[id] = p.team; if(p.permit) D.PERMITS[id] = p.permit;
      });
      (await all('area_info', 'area,payload', q => q.like('area', 'wc:%'))).forEach(r => D.CONTACTS[r.area.slice(3)] = r.payload);
    } else {
      D.NYC = Object.assign({pulled:'', since:'', altMinCost:500000}, await CC.meta('nyc'), {rows: rows.map(r=>r.payload)});
    }
    loading.remove();
    if(!rows.length) return message('No projects yet', `<p>There are no current filings in your ${R.unit}. Add more ${R.unit} or check back after tomorrow morning's update.</p><p><a class="cc-btn" href="areas.html">Change ${R.unit}</a></p>`);
    start(D);
  } catch(e){
    loading.remove();
    message('Could not load projects', `<p>${esc(e.message||e)}</p><p><a href="">Try again</a></p>`);
  }
};
})();
