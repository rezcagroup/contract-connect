const SRC = D.BIDS;
const NOW = new Date(), TODAY = Date.UTC(NOW.getFullYear(), NOW.getMonth(), NOW.getDate());
const $ = s => document.querySelector(s);
const esc = CC.esc;
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
// Same trade keys as the other pages. re = words in a bid's title or scope that suggest the trade; gc sees every bid.
const TRADES = {
  gc:{n:'General contractor'},
  frame:{n:'Framing & carpentry', re:/carpent|framing|drywall|millwork|cabinet|partition|\bwood\b|ceiling/i},
  concrete:{n:'Concrete', re:/concrete|foundation|\bslab|sidewalk|curb|masonry|paving|pavement|retaining wall/i},
  site:{n:'Site work', re:/excavat|demolition|\bsewer|water main|utilit|grading|roadway|street|drainage|storm|trench|bridge|outfall|reconstruction of/i},
  hvac:{n:'HVAC', re:/hvac|heating|ventilat|air.?condition|boiler|chiller|mechanical|refrigerat|cooling|exhaust/i},
  elec:{n:'Electrical', re:/electric|lighting|generator|switchgear|power|fire alarm|low voltage|transformer/i},
  plumb:{n:'Plumbing', re:/plumb|sprinkler|standpipe|piping|water supply|sanitary|\bgas\b|backflow|fixture/i},
  roof:{n:'Roofing', re:/roof|waterproof|flashing|parapet/i},
  windows:{n:'Windows & doors', re:/window|\bdoors?\b|storefront|glazing|glass|overhead|roll.?up/i},
  paint:{n:'Painting', re:/paint|coating|plaster|abatement|wall finish/i}
};
const A = {trades:['gc'], show:'mine', agency:'', kind:'', due:'', q:''};
if(D.trades && D.trades.length){ const t = D.trades.filter(k=>TRADES[k]); if(t.length) A.trades = t; }

const daysLeft = due => { const [y,m,d] = due.slice(0,10).split('-').map(Number); return Math.round((Date.UTC(y,m-1,d) - TODAY) / 864e5); };
const fdate = iso => { if(!iso) return ''; const [y,m,d] = iso.slice(0,10).split('-').map(Number); return d + ' ' + MON[m-1] + ' ' + y; };
const ftime = iso => { const m = /T(\d\d):(\d\d)/.exec(iso || ''); if(!m) return ''; const h = +m[1]; return ((h % 12) || 12) + (m[2] === '00' ? '' : ':' + m[2]) + (h < 12 ? ' AM' : ' PM'); };
const ago = iso => { if(!iso) return Infinity; const [y,m,d] = iso.split('-').map(Number); return Math.round((TODAY - Date.UTC(y,m-1,d)) / 864e5); };

// A bid whose due date passed since the last morning update is hidden (a failed pull must not leave expired bids on the page).
const ALL = SRC.rows.filter(b => !b.due || daysLeft(b.due) >= 0);
const text = b => b.title + ' ' + b.desc;
const matches = b => A.trades.includes('gc') || A.trades.some(k => TRADES[k].re && TRADES[k].re.test(text(b)));
const tradeLabel = () => A.trades.map(k => TRADES[k].n).join(' + ');

function visible(){
  const q = A.q.trim().toLowerCase();
  return ALL.filter(b =>
    (A.show === 'all' || matches(b)) && (!A.agency || b.agency === A.agency) && (!A.kind || b.kind === A.kind) &&
    (!A.due || (b.due && daysLeft(b.due) <= +A.due)) &&
    (!q || (b.title + ' ' + b.agency + ' ' + b.pin + ' ' + b.desc).toLowerCase().includes(q)));
}

function dueCell(b){
  if(!b.due) return '<span class="pill p-wait">To be announced</span>';
  const n = daysLeft(b.due);
  const cls = n <= 3 ? 'p-obj' : n <= 7 ? 'p-rev' : 'p-go';
  return `<b>${esc(fdate(b.due))}</b><div class="sub">${esc(ftime(b.due))}</div><span class="pill ${cls}">${n === 0 ? 'Today' : n === 1 ? '1 day' : n + ' days'}</span>`;
}

function detail(b){
  const c = b.contact || {};
  const who = [c.name && esc(c.name), c.phone && `<a href="tel:${esc(c.phone.replace(/\D/g,''))}">${esc(c.phone)}</a>`, c.email && `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`].filter(Boolean).join(' · ');
  const passport = /PASSPort/i.test(b.desc + ' ' + b.extra) && b.pin ? `<p class="sub">Submitted through PASSPort: search PIN <b>${esc(b.pin)}</b> on the <a href="https://www.nyc.gov/site/mocs/passport/about-passport.page" target="_blank" rel="noopener">PASSPort public portal</a>.</p>` : '';
  return `<div class="pad">
    ${b.desc ? `<p style="white-space:pre-line;margin-top:0">${esc(b.desc)}</p>` : ''}
    ${b.extra ? `<p class="sub" style="white-space:pre-line">${esc(b.extra)}</p>` : ''}
    <p class="sub">${b.pin ? `PIN <b>${esc(b.pin)}</b> · ` : ''}${esc(b.method)}${b.filed ? ' · posted ' + esc(fdate(b.filed)) : ''}</p>
    ${who ? `<p><b>Contact:</b> ${who}</p>` : '<p class="sub">The agency lists no contact. Use the notice or PASSPort.</p>'}
    ${b.address ? `<p class="sub">Request documents at: ${esc(b.address)}</p>` : ''}
    ${passport}
    <p><a class="cc-btn" href="${esc(b.link)}" target="_blank" rel="noopener">Open the full notice →</a></p></div>`;
}

let open = '';
function render(){
  const rows = visible();
  $('#b-count').textContent = `${rows.length} of ${ALL.length} open bids`;
  $('#bidtable').innerHTML = rows.length ? `<thead><tr><th>Due</th><th>Bid</th><th>Agency</th><th>Method</th></tr></thead><tbody>${rows.map(b => `
    <tr class="row" data-id="${esc(b.id)}"><td>${dueCell(b)}</td>
      <td><div class="addr">${esc(b.title)}</div><div class="sub">${esc(b.kind)}${b.pin ? ' · PIN ' + esc(b.pin) : ''}${ago(b.filed) <= 7 ? ' · <span class="pill p-go">New</span>' : ''}</div></td>
      <td>${esc(b.agency)}</td><td class="sub">${esc(b.method)}</td></tr>
    ${open === b.id ? `<tr><td colspan="4" style="padding:0">${detail(b)}</td></tr>` : ''}`).join('')}</tbody>`
    : `<tbody><tr><td class="sub" style="padding:24px">No bids match.${A.show === 'mine' ? ' This filter uses keywords for your trades; try "All construction bids".' : ''}</td></tr></tbody>`;
  document.querySelectorAll('#bidtable tr.row').forEach(tr => tr.onclick = () => { open = open === tr.dataset.id ? '' : tr.dataset.id; render(); });
}

function tiles(){
  const soon = ALL.filter(b => b.due && daysLeft(b.due) <= 7).length, m = ALL.filter(matches).length;
  const t = (l, v, s) => `<div class="panel tile"><div class="eyebrow">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  $('#tiles').innerHTML = t('Open bids', ALL.length, 'construction and related services') + t('Due in 7 days', soon, 'closing soon') +
    t('Match your trades', A.trades.includes('gc') ? ALL.length : m, esc(tradeLabel())) + t('Agencies', new Set(ALL.map(b => b.agency)).size, 'posting these bids');
}

function refresh(){ tiles(); render(); }
CC.tradePicker($('#tradebar'), TRADES, A.trades, t => { A.trades = t; refresh(); CC.saveTrades(t); });
const stale = SRC.pulled && ago(SRC.pulled) > 3;
$('#b-eyebrow').textContent = SRC.pulled ? 'Updated ' + fdate(SRC.pulled) : '';
if(stale) $('#ticker').innerHTML = `<div class="cc-msg err">This data is ${ago(SRC.pulled)} days old. The morning update may have failed; check the notice for the current due date.</div>`;
const agencies = [...new Set(ALL.map(b => b.agency))].sort();
$('#b-agency').innerHTML += agencies.map(a => `<option>${esc(a)}</option>`).join('');
const bind = (id, key, ev = 'onchange') => { $(id)[ev] = e => { A[key] = e.target.value; refresh(); }; };
bind('#b-show', 'show'); bind('#b-agency', 'agency'); bind('#b-kind', 'kind'); bind('#b-due', 'due'); bind('#b-q', 'q', 'oninput');
refresh();
