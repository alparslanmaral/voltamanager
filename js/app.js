// ===== Volta Mini Menejer - Daha Aktif Oyun, Rastgele Rakip Taktiği, Güçlü Pres (FIXED) =====
// Optional chaining assignment düzeltmeleri: obj?.prop = ... yerine güvenli atama helper'ları.

// --- LocalStorage Keys ---
const LS_KEYS = { roster:'vmm_clubRoster', formation:'vmm_formation', lineup:'vmm_lineup', tactic:'vmm_tactic' };

// --- Yardımcı DOM Fonksiyonları (FIX) ---
const $ = s=>document.querySelector(s);
function setText(sel, value){ const el=$(sel); if (el) el.textContent=value; }
function setHTML(sel, value){ const el=$(sel); if (el) el.innerHTML=value; }

// --- Roller & Ağırlıklar ---
const ROLES = {
  WG:{label:'WG',weights:{speed:0.6,attack:0.4}, roam:120},
  ST:{label:'ST',weights:{attack:0.6,physical:0.4}, roam:100},
  DM:{label:'DM',weights:{defense:0.6,passing:0.4}, roam:90},
  AM:{label:'AM',weights:{attack:0.5,passing:0.5}, roam:105},
  CB:{label:'CB',weights:{defense:0.6,physical:0.4}, roam:70},
  FB:{label:'FB',weights:{speed:0.5,defense:0.5}, roam:85},
};

// --- Dizilişler ---
const FORMATIONS = {
  '1-2-1':[
    {id:'S1',role:'CB',x:18,y:50},
    {id:'S2',role:'DM',x:35,y:40},
    {id:'S3',role:'AM',x:55,y:60},
    {id:'S4',role:'WG',x:65,y:30},
    {id:'S5',role:'ST',x:80,y:50},
  ],
  '2-1-1':[
    {id:'S1',role:'CB',x:18,y:35},
    {id:'S2',role:'FB',x:18,y:65},
    {id:'S3',role:'AM',x:45,y:50},
    {id:'S4',role:'WG',x:65,y:35},
    {id:'S5',role:'ST',x:80,y:55},
  ],
  '1-1-2':[
    {id:'S1',role:'CB',x:18,y:50},
    {id:'S2',role:'DM',x:35,y:50},
    {id:'S3',role:'WG',x:55,y:30},
    {id:'S4',role:'WG',x:55,y:70},
    {id:'S5',role:'ST',x:80,y:50},
  ]
};

// --- Taktikler ---
const TACTICS = {
  tiki_taka:{ name:'Tiki Taka', key:'passing', desc:'Kısa pas, üçgenler, yakın oyun.',
    passBias:0.9, wingBias:0.35, pressIntensity:0.5, lineHeight:0.18, counterTrigger:0.25, defenseDepth:0.45, riskFactor:0.35, tempoFactor:1.25, busFactor:0.0 },
  wings:{ name:'Kanat Oyunu', key:'speed', desc:'Kanatlar genişler, çizgiye iner, orta.',
    passBias:0.6, wingBias:0.95, pressIntensity:0.55, lineHeight:0.28, counterTrigger:0.35, defenseDepth:0.5, riskFactor:0.45, tempoFactor:1.2, busFactor:0.0 },
  counter:{ name:'Kontra Atak', key:'attack', desc:'Derinde karşıla, topu kapınca hızlı çık.',
    passBias:0.5, wingBias:0.6, pressIntensity:0.4, lineHeight:0.0, counterTrigger:0.9, defenseDepth:0.7, riskFactor:0.55, tempoFactor:1.35, busFactor:0.0 },
  gegen:{ name:'Gegen Press', key:'physical', desc:'Önde yoğun pres, hızlı top kazan.',
    passBias:0.55, wingBias:0.55, pressIntensity:0.95, lineHeight:0.38, counterTrigger:0.55, defenseDepth:0.35, riskFactor:0.75, tempoFactor:1.5, busFactor:0.0 },
  park:{ name:'Otobüsü Park Et', key:'defense', desc:'Derin blok, düşük risk, düşük tempo.',
    passBias:0.45, wingBias:0.3, pressIntensity:0.2, lineHeight:-0.18, counterTrigger:0.3, defenseDepth:0.95, riskFactor:0.2, tempoFactor:0.9, busFactor:0.5 },
};

// --- State ---
const State = {
  players:[],
  clubRoster:new Set(),
  formation:'1-2-1',
  lineup:{},
  tactic:'tiki_taka',
  opponent:{ name:'Sokak Yıldızları', lineup:[], tactic:'tiki_taka', dynamicTacticChangeTimer:0 },
  match:{
    running:false, paused:false, minute:0, maxMinute:90,
    logicalTickMs:700, speed:2, smooth:true,
    score:{home:0,away:0}, possession:'home',
    ball:{ x:450,y:270,vx:0,vy:0,carrier:null,target:null,travelSteps:0,onArrive:null },
    homeDynamic:[], awayDynamic:[],
    lastTimestamp:0, accum:0, logicStep:1000/30, minuteAccum:0,
    interchangeCooldown:0,
    counterStateTimer:0,
    staminaDecayBase:0.22
  }
};

// --- INIT ---
init();
async function init(){
  await loadPlayers();
  loadFromStorage();
  bindUI();
  renderAll();
  setupCanvas();
  renderMatchFrame();
  updateTacticFitUI();
}

async function loadPlayers(){
  const res = await fetch('./db/players.json');
  const data = await res.json();
  State.players = data.map(p=>({...p, attack:+p.attack, defense:+p.defense, speed:+p.speed, physical:+p.physical, passing:+p.passing}));
}

function loadFromStorage(){
  const r = localStorage.getItem(LS_KEYS.roster);
  if (r){ State.clubRoster = new Set(JSON.parse(r)); } else {
    const ids = State.players.map(p=>p.id); shuffle(ids); State.clubRoster = new Set(ids.slice(0,10)); saveRoster();
  }
  const f = localStorage.getItem(LS_KEYS.formation);
  if (f && FORMATIONS[f]) State.formation=f; else saveFormation();
  const l = localStorage.getItem(LS_KEYS.lineup);
  if (l){ try{ State.lineup=JSON.parse(l);}catch{ State.lineup={}; } } else { State.lineup={}; saveLineup(); }
  const t = localStorage.getItem(LS_KEYS.tactic);
  if (t && TACTICS[t]) State.tactic=t; else saveTactic();
  buildOpponent(true);
}

function saveRoster(){ localStorage.setItem(LS_KEYS.roster, JSON.stringify([...State.clubRoster])); }
function saveFormation(){ localStorage.setItem(LS_KEYS.formation, State.formation); }
function saveLineup(){ localStorage.setItem(LS_KEYS.lineup, JSON.stringify(State.lineup)); }
function saveTactic(){ localStorage.setItem(LS_KEYS.tactic, State.tactic); }

// --- Opponent ---
function buildOpponent(onInit=false){
  let pool = State.players.filter(p=>!State.clubRoster.has(p.id));
  if (pool.length<5) pool = [...State.players];
  shuffle(pool);
  const pattern = FORMATIONS[State.formation].map(s=>s.role);
  const lineup=[];
  for (const role of pattern){
    let idx = pool.findIndex(p=>p.pref===role);
    if (idx===-1) idx=0;
    lineup.push({role, player:pool[idx]});
    pool.splice(idx,1);
  }
  State.opponent.lineup=lineup;
  const keys = Object.keys(TACTICS);
  State.opponent.tactic = keys[Math.floor(Math.random()*keys.length)];
  State.opponent.dynamicTacticChangeTimer = 0;
  if (!onInit) logEvent(`Rakip taktiği: ${TACTICS[State.opponent.tactic].name}`);
}

// --- UI ---
function bindUI(){
  document.addEventListener('click', e=>{
    if (e.target.matches('.nav-btn')) setActivePage(e.target.getAttribute('data-target'));
  });
  $('#goNextMatch')?.addEventListener('click', ()=>setActivePage('#mac'));

  const formationSel = $('#formation');
  if (formationSel){
    formationSel.value = State.formation;
    formationSel.addEventListener('change', e=>{
      State.formation=e.target.value; saveFormation();
      const valid = new Set(FORMATIONS[State.formation].map(s=>s.id));
      for (const k of Object.keys(State.lineup)) if (!valid.has(k)) delete State.lineup[k];
      saveLineup(); renderTactics(); updateTacticFitUI();
    });
  }
  const tacticSel = $('#tacticSelect');
  if (tacticSel){
    tacticSel.value = State.tactic;
    tacticSel.addEventListener('change', e=>{
      State.tactic = e.target.value; saveTactic(); updateTacticFitUI();
    });
  }

  $('#startMatch')?.addEventListener('click', startMatch);
  $('#pauseMatch')?.addEventListener('click', pauseMatch);
  $('#resetMatch')?.addEventListener('click', ()=>resetMatch(false,true));
  $('#speed')?.addEventListener('change', e=> State.match.speed = +e.target.value);
  $('#smoothSim')?.addEventListener('change', e=> State.match.smooth = e.target.checked);
}

function setActivePage(sel){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  const el = document.querySelector(sel);
  if (el) el.classList.add('active');
}

function renderAll(){ renderTactics(); renderTransfer(); renderMatchSidebars(); }

// --- Taktik ekranı ---
function renderTactics(){ renderSquadList(); renderPitchSlots(); }
function renderSquadList(){
  const list = $('#squadList'); if (!list) return;
  list.innerHTML='';
  const used = new Set(Object.values(State.lineup));
  const players = State.players.filter(p=>State.clubRoster.has(p.id) && !used.has(p.id));
  for (const p of players){
    const card = document.createElement('div');
    card.className='player-card'; card.draggable=true; card.dataset.playerId=p.id;
    card.addEventListener('dragstart', onDragStart);
    card.innerHTML=`
      <div class="info">
        <div class="name">${p.name}</div>
        <div class="pos">Tercih: ${p.pref}</div>
        <div class="atts">Atk ${p.attack} · Def ${p.defense} · Hız ${p.speed} · Fiz ${p.physical} · Pas ${p.passing}</div>
      </div>
      <div class="actions"><span class="btn">↔</span></div>`;
    list.appendChild(card);
  }
}
function renderPitchSlots(){
  const pitch = $('#pitch'); if (!pitch) return;
  pitch.innerHTML='';
  for (const slot of FORMATIONS[State.formation]){
    const dz = document.createElement('div');
    dz.className='dropzone';
    dz.style.left = `calc(${slot.x}% - 47px)`;
    dz.style.top  = `calc(${slot.y}% - 47px)`;
    dz.dataset.slotId=slot.id; dz.dataset.role=slot.role;
    dz.addEventListener('dragover', e=>e.preventDefault());
    dz.addEventListener('drop', onDropPlayer);
    const pid = State.lineup[slot.id];
    if (pid){
      const p = State.players.find(x=>x.id===pid);
      dz.classList.add('filled');
      dz.innerHTML=`
        <button class="drop-remove">×</button>
        <div style="text-align:center">
          <div>${ROLES[slot.role].label}</div>
          <div style="font-size:12px">${p.name}</div>
        </div>`;
      dz.querySelector('.drop-remove').addEventListener('click', ()=>{
        delete State.lineup[slot.id]; saveLineup(); renderTactics(); updateTacticFitUI();
      });
    } else {
      dz.textContent = ROLES[slot.role].label;
    }
    pitch.appendChild(dz);
  }
}
function onDragStart(e){ e.dataTransfer.setData('text/playerId', e.currentTarget.dataset.playerId); }
function onDropPlayer(e){
  e.preventDefault();
  const pid = +e.dataTransfer.getData('text/playerId');
  if (!pid || !State.clubRoster.has(pid)) return;
  for (const k of Object.keys(State.lineup)) if (State.lineup[k]===pid) delete State.lineup[k];
  State.lineup[e.currentTarget.dataset.slotId]=pid;
  saveLineup(); renderTactics(); updateTacticFitUI();
}

// --- Taktik uygunluğu ---
function updateTacticFitUI(){
  const tac = TACTICS[State.tactic];
  const lineup = getHomeLineupResolved();
  const score = evaluateTacticForLineup(lineup, State.tactic);
  const pct = Math.round(score*100);
  setText('#tacticFitPercent', pct? pct+'%' : '-');
  const bar = $('#tacticFitBarFill'); if (bar) bar.style.width = pct + '%';
  const attr = tac.key;
  let sum=0,cnt=0;
  for (const s of lineup){ if (s.player){ sum += s.player[attr]; cnt++; } }
  const avg = cnt? (sum/cnt).toFixed(1) : '-';
  setText('#tacticFitDetails',
    `Taktik: ${tac.name}
Ana Özellik: ${attr} (Ortalama: ${avg})
Tanım: ${tac.desc}`);
}
function evaluateTacticForLineup(lineup, tacticKey){
  const tactical = TACTICS[tacticKey]; const attr = tactical.key;
  let sum=0,cnt=0, roleBonus=0;
  for (const sl of lineup){ if (sl.player){ sum += sl.player[attr]||0; cnt++; if (sl.player.pref===sl.role) roleBonus+=1; } }
  if (!cnt) return 0;
  return clamp((sum/cnt + roleBonus)/101, 0, 1);
}

// --- Transfer ---
function renderTransfer(){
  const clubBox = $('#clubRoster'), faBox = $('#freeAgents');
  if (!clubBox || !faBox) return;
  clubBox.innerHTML=''; faBox.innerHTML='';
  const club = State.players.filter(p=>State.clubRoster.has(p.id));
  const free = State.players.filter(p=>!State.clubRoster.has(p.id));
  for (const p of club){
    clubBox.appendChild(playerCard(p, [
      button('Serbest', 'btn btn-danger', ()=>{
        for (const k of Object.keys(State.lineup)) if (State.lineup[k]===p.id) delete State.lineup[k];
        State.clubRoster.delete(p.id);
        saveRoster(); saveLineup(); renderAll(); updateTacticFitUI();
      })
    ]));
  }
  for (const p of free){
    faBox.appendChild(playerCard(p, [
      button('Sözleşme', 'btn btn-ok', ()=>{
        State.clubRoster.add(p.id);
        saveRoster(); renderAll(); updateTacticFitUI();
      })
    ]));
  }
}
function playerCard(p, actions=[]){
  const el=document.createElement('div');
  el.className='player-card';
  el.innerHTML=`
    <div class="info">
      <div class="name">${p.name}</div>
      <div class="pos">Tercih: ${p.pref}</div>
      <div class="atts">Atk ${p.attack} · Def ${p.defense} · Hız ${p.speed} · Fiz ${p.physical} · Pas ${p.passing}</div>
    </div>
    <div class="actions"></div>`;
  const act=el.querySelector('.actions'); actions.forEach(a=>act.appendChild(a));
  return el;
}
function button(text, cls, onClick){ const b=document.createElement('button'); b.className=cls; b.textContent=text; b.addEventListener('click', onClick); return b; }

// --- Lineup resolve ---
function getHomeLineupResolved(){
  return FORMATIONS[State.formation].map(s=>{
    const pid = State.lineup[s.id];
    const player = State.players.find(p=>p.id===pid);
    return {role:s.role, player, slotId:s.id};
  });
}
function ensureLineupReady(){ return FORMATIONS[State.formation].every(s=>State.lineup[s.id]); }

// --- Opponent dynamic tactic adjust ---
function maybeOpponentTacticAdjust(){
  if (State.match.minute < 12) return;
  State.opponent.dynamicTacticChangeTimer -= (State.match.logicStep/1000);
  if (State.opponent.dynamicTacticChangeTimer > 0) return;
  const losing = State.match.score.away < State.match.score.home;
  const leading = State.match.score.away > State.match.score.home;
  const keys = losing? ['gegen','wings','counter'] : leading? ['park','tiki_taka'] : Object.keys(TACTICS);
  const pick = keys[Math.floor(Math.random()*keys.length)];
  if (pick !== State.opponent.tactic){
    State.opponent.tactic = pick;
    logEvent(`Rakip taktiği değişti: ${TACTICS[pick].name}`);
  }
  State.opponent.dynamicTacticChangeTimer = 25 + Math.random()*25;
}

// --- Dynamic setup ---
function initDynamicPlayers(){
  State.match.homeDynamic=[]; State.match.awayDynamic=[];
  const homeSlots = FORMATIONS[State.formation];
  const awaySlots = mirrorSlots(homeSlots);
  const homeLine = getHomeLineupResolved();
  const awayLine = State.opponent.lineup;

  for (let i=0;i<homeSlots.length;i++){
    const s = homeSlots[i]; const base = slotToCanvas(s.x*0.7, s.y);
    State.match.homeDynamic.push({
      role:s.role, slotId:s.id, playerRef:homeLine[i].player,
      fx:base.x, fy:base.y, x:base.x, y:base.y, tx:base.x, ty:base.y,
      speedBonus:homeLine[i].player? homeLine[i].player.speed/100 : 0,
      roamRadius:ROLES[s.role].roam, stamina:100, ai:{targetTTL:0, runTimer:0, mark:null}
    });
  }
  for (let i=0;i<awaySlots.length;i++){
    const s = awaySlots[i]; const base = slotToCanvas((s.x*0.3)+70, s.y);
    State.match.awayDynamic.push({
      role:s.role, slotId:s.id, playerRef:awayLine[i].player,
      fx:base.x, fy:base.y, x:base.x, y:base.y, tx:base.x, ty:base.y,
      speedBonus:awayLine[i].player? awayLine[i].player.speed/100 : 0,
      roamRadius:ROLES[s.role].roam, stamina:100, ai:{targetTTL:0, runTimer:0, mark:null}
    });
  }
}

function slotToCanvas(px,py){ return {x:(px/100)*canvas.width, y:(py/100)*canvas.height}; }
function mirrorSlots(slots){ return slots.map((s,i)=>({id:'A'+(i+1), role:s.role, x:100-s.x, y:s.y})); }

// --- Match controls ---
function startMatch(){
  if (!ensureLineupReady()){ alert('5 oyuncuyu sahaya yerleştir.'); return; }
  buildOpponent(); // rastgele rakip taktiği
  resetMatch(true,true);
  State.match.running=true; State.match.paused=false;
  logEvent('Maç başladı (Kickoff bizde)');
  State.match.lastTimestamp=performance.now();
  requestAnimationFrame(gameLoop);
}
function pauseMatch(){
  if (!State.match.running) return;
  State.match.paused=!State.match.paused;
  logEvent(State.match.paused?'Maç duraklatıldı.':'Maç devam.');
  if (!State.match.paused){ State.match.lastTimestamp=performance.now(); requestAnimationFrame(gameLoop); }
}
function resetMatch(_, full=false){
  State.match.running=false; State.match.paused=false; State.match.minute=0;
  State.match.score={home:0,away:0}; State.match.possession='home';
  Object.assign(State.match.ball,{x:canvas.width*0.30,y:canvas.height/2,vx:0,vy:0,carrier:null,target:null,onArrive:null,travelSteps:0});
  State.match.accum=0; State.match.minuteAccum=0; State.match.interchangeCooldown=0; State.match.counterStateTimer=0;
  if (full){ initDynamicPlayers(); assignKickoff('home'); }
  setText('#score','0 - 0'); setText('#matchMinute',"0'"); setText('#possession','Topa sahip: Biz');
  setText('#xgInfo','Atak gücü: -'); setText('#carrierInfo','Top taşıyan: -'); setHTML('#matchLog','');
  renderMatchSidebars(); renderMatchFrame(); updateTacticLabels();
}

function assignKickoff(team){
  State.match.possession = team;
  const arr = team==='home'? State.match.homeDynamic : State.match.awayDynamic;
  const order = ['DM','AM','ST','WG','FB','CB'];
  let cand = arr.find(p=>p.playerRef && order.includes(p.role)); if (!cand) cand = arr.find(p=>p.playerRef);
  const x = team==='home' ? canvas.width*0.30 : canvas.width*0.70;
  const y = canvas.height/2;
  State.match.ball.x=x; State.match.ball.y=y; State.match.ball.carrier=null; State.match.ball.target=null;
  if (cand){ State.match.ball.carrier=cand; State.match.ball.x=cand.x; State.match.ball.y=cand.y; updateCarrierInfo(); }
}

// --- Game loop ---
function gameLoop(ts){
  if (!State.match.running || State.match.paused) return;
  const dt = ts - State.match.lastTimestamp;
  State.match.lastTimestamp = ts;
  State.match.accum += dt * State.match.speed;
  State.match.minuteAccum += dt * State.match.speed;

  while (State.match.accum >= State.match.logicStep){
    logicStep(State.match.logicStep);
    State.match.accum -= State.match.logicStep;
  }
  const minuteMs = State.match.logicalTickMs / State.match.speed;
  while (State.match.minuteAccum >= minuteMs){
    State.match.minute++; setText('#matchMinute', `${State.match.minute}'`);
    State.match.minuteAccum -= minuteMs;
    if (State.match.minute>=State.match.maxMinute){
      logEvent(`Maç bitti! Skor: ${State.match.score.home} - ${State.match.score.away}`);
      State.match.running=false;
    } else { maybeOpponentTacticAdjust(); }
  }
  renderMatchFrame(); updateDebug();
  if (State.match.running) requestAnimationFrame(gameLoop);
}

function logicStep(stepMs){
  const stepSec = stepMs/1000;
  State.match.interchangeCooldown -= stepSec;
  if (State.match.interchangeCooldown <= 0){
    attemptInterchange();
    State.match.interchangeCooldown = 6 + Math.random()*5;
  }

  const homeTac = TACTICS[State.tactic]; const awayTac = TACTICS[State.opponent.tactic];
  const tempoAvg = (homeTac.tempoFactor + awayTac.tempoFactor)/2;
  const eventProb = 0.55 * (stepMs/1000) * tempoAvg;
  if (Math.random()<eventProb) decideEvents();

  updateTargets();
  updatePressing();
  antiClump(State.match.homeDynamic);
  antiClump(State.match.awayDynamic);
  movePlayers(stepSec);
  updateBall(stepSec);
  resolveTackles();
  staminaTick(stepSec);
}

// --- Interchange ---
function attemptInterchange(){
  const mutate = arr=>{
    const am = arr.find(p=>p.role==='AM'); const wgs = arr.filter(p=>p.role==='WG');
    if (am && wgs.length){
      const w = wgs[Math.floor(Math.random()*wgs.length)];
      const tx=am.fx, ty=am.fy;
      am.fx=w.fx+(Math.random()*24-12); am.fy=w.fy+(Math.random()*24-12);
      w.fx=tx+(Math.random()*24-12); w.fy=ty+(Math.random()*24-12);
    }
    const dm = arr.find(p=>p.role==='DM'); const cb = arr.find(p=>p.role==='CB');
    if (dm && cb && Math.random()<0.5){ dm.fx = dm.fx*0.7 + cb.fx*0.3; dm.fy = dm.fy*0.7 + cb.fy*0.3 + (Math.random()*16-8); }
  };
  mutate(State.match.homeDynamic); mutate(State.match.awayDynamic);
}

// --- Pressing & Marking ---
function updatePressing(){
  const carrier = State.match.ball.carrier; if (!carrier) return;
  const carrierTeamHome = State.match.homeDynamic.includes(carrier);
  const defTac = carrierTeamHome? TACTICS[State.opponent.tactic] : TACTICS[State.tactic];
  if (defTac.pressIntensity < 0.25) return;
  const defArr = carrierTeamHome? State.match.awayDynamic : State.match.homeDynamic;

  const sorted = [...defArr].filter(p=>p.playerRef)
    .sort((a,b)=> dist(a.x,a.y, carrier.x,carrier.y)-dist(b.x,b.y, carrier.x,carrier.y));
  const pressers = sorted.slice(0,3);
  for (const d of pressers){
    const maxDist = 160 + defTac.pressIntensity*140;
    if (dist(d.x,d.y, carrier.x,carrier.y) < maxDist){
      d.tx = carrier.x + (Math.random()*18 -9);
      d.ty = carrier.y + (Math.random()*18 -9);
      if (d.ai) d.ai.mark=null;
    }
  }
  const others = sorted.slice(3);
  for (const m of others){
    if (!m.ai) m.ai={};
    const goalX = State.match.homeDynamic.includes(carrier)? canvas.width-8 : 8;
    const goalY = canvas.height/2;
    const mx = (carrier.x*0.65 + goalX*0.35) + (Math.random()*20 -10);
    const my = (carrier.y*0.65 + goalY*0.35) + (Math.random()*20 -10);
    m.tx = clamp(mx,20,canvas.width-20);
    m.ty = clamp(my,20,canvas.height-20);
    m.ai.mark={x:m.tx,y:m.ty};
  }
}

// --- Events ---
function decideEvents(){
  const attacker = State.match.possession;
  setText('#possession', `Topa sahip: ${attacker==='home'?'Biz':'Rakip'}`);
  if (!State.match.ball.carrier) assignLooseBallCarrier();
  if (!State.match.ball.carrier) return;

  const homeTac = TACTICS[State.tactic]; const awayTac = TACTICS[State.opponent.tactic];
  const tac = attacker==='home'? homeTac : awayTac; const oppTac = attacker==='home'? awayTac : homeTac;

  const {atk,def} = computeTeamsPower(attacker);
  const diff = atk - def;
  const minuteFactor = State.match.minute/State.match.maxMinute;

  let shotProb = clamp(0.09 + diff*0.0016 + minuteFactor*0.22 + tac.riskFactor*0.15, 0.05, 0.55);
  shotProb *= (1 - oppTac.busFactor*0.35);
  let passProb = clamp(tac.passBias*0.65 + (1 - shotProb)*0.45, 0.28, 0.8);

  const pressure = underPressure(State.match.ball.carrier, attacker);
  if (pressure){ shotProb*=0.75; passProb=clamp(passProb+0.18,0.28,0.9); }

  if (attacker==='home' && State.match.counterStateTimer>0 && homeTac===TACTICS['counter']) shotProb=clamp(shotProb+0.12, 0.05, 0.65);
  if (attacker==='away' && State.match.counterStateTimer>0 && awayTac===TACTICS['counter']) shotProb=clamp(shotProb+0.12, 0.05, 0.65);

  let action='hold'; const r=Math.random();
  if (r < shotProb) action='shot';
  else if (r < shotProb + passProb) action='pass';
  else {
    if (tac.wingBias>0.75 && canAttemptCross(attacker)) action='cross';
    else if (tac.passBias>0.8 && Math.random()<0.5) action='through';
    else if (tac.counterTrigger>0.75 && Math.random()<0.55) action='space_pass';
  }

  setText('#xgInfo', `Atak farkı: ${diff.toFixed(1)} · Baskı:${pressure?'Evet':'Hayır'}`);
  updateTacticLabels();

  if (action==='shot') attemptShot(attacker, diff);
  else if (action==='pass') attemptSmartPass(attacker);
  else if (action==='cross') attemptCross(attacker);
  else if (action==='through') attemptThroughBall(attacker);
  else if (action==='space_pass') attemptSpacePass(attacker);
}

function underPressure(carrier, team){
  const oppArr = team==='home'? State.match.awayDynamic : State.match.homeDynamic;
  let closest=Infinity; for (const o of oppArr){ if (!o.playerRef) continue; const d=dist(o.x,o.y,carrier.x,carrier.y); if (d<closest) closest=d; }
  return closest < 26;
}

function assignLooseBallCarrier(){
  const all = [...State.match.homeDynamic, ...State.match.awayDynamic].filter(p=>p.playerRef);
  all.sort((a,b)=> dist(a.x,a.y, State.match.ball.x,State.match.ball.y) - dist(b.x,b.y, State.match.ball.x,State.match.ball.y));
  const candidates = all.slice(0,3); const priority = ['AM','DM','ST','WG','FB','CB'];
  candidates.sort((a,b)=> priority.indexOf(a.role) - priority.indexOf(b.role));
  const chosen = candidates[0];
  if (chosen){
    State.match.ball.carrier=chosen;
    State.match.possession = State.match.homeDynamic.includes(chosen)? 'home':'away';
    updateCarrierInfo();
    const tac = State.match.possession==='home'? TACTICS[State.tactic] : TACTICS[State.opponent.tactic];
    if (tac.counterTrigger>0.75){
      const progress = State.match.possession==='home'? chosen.x/canvas.width : (canvas.width-chosen.x)/canvas.width;
      if (progress < 0.4){ State.match.counterStateTimer=3.2; logEvent('Kontra fırsatı!'); }
    }
  }
}

// --- Passing family (smart/cross/through/space) ---
function attemptSmartPass(team){
  const arr = team==='home'? State.match.homeDynamic : State.match.awayDynamic;
  const opp = team==='home'? State.match.awayDynamic : State.match.homeDynamic;
  const carrier = State.match.ball.carrier; if (!carrier) return;
  const candidates = arr.filter(p=>p!==carrier && p.playerRef); if (!candidates.length) return;
  const goalX = team==='home'? canvas.width : 0; const goalY = canvas.height/2;

  const scored = candidates.map(p=>{
    const dC = dist(carrier.x,carrier.y,p.x,p.y);
    const progress = team==='home'? (p.x/canvas.width) : ((canvas.width-p.x)/canvas.width);
    const a1 = Math.atan2(goalY-carrier.y, goalX-carrier.x);
    const a2 = Math.atan2(goalY-p.y, goalX-p.x);
    const aDiff = Math.abs(a1-a2);
    const pressure = Math.min(...opp.map(o=>dist(o.x,o.y,p.x,p.y)));
    const space = pressure>40? 0.2 : -0.2;
    return { p, score: progress*1.2 + (1-aDiff/Math.PI)*0.6 + space + (p.playerRef.passing/100)*0.9 - (dC<32? (32-dC)*0.02 : 0) };
  });
  scored.sort((a,b)=>b.score-a.score);
  const target = scored[0].p;

  const intercept = opp.some(o=> pointLineDistance(o.x,o.y, carrier.x,carrier.y, target.x,target.y) < 24 ) && Math.random()<0.30;
  if (intercept){
    logEvent('Pas kesildi!');
    let best=null, bestD=1e9; for (const o of opp){ const d=dist(o.x,o.y, carrier.x,carrier.y); if (d<bestD){bestD=d; best=o;} }
    if (best){ State.match.ball.carrier=best; State.match.possession = team==='home'?'away':'home'; updateCarrierInfo(); }
  } else {
    logEvent('Pas');
    State.match.ball.carrier=null;
    const dPass = dist(carrier.x,carrier.y, target.x,target.y);
    const passSpeed = Math.min(30, 18 + dPass/35);
    State.match.ball.target={x:target.x,y:target.y,type:'pass',speed:passSpeed};
    State.match.ball.travelSteps = Math.ceil(dPass/passSpeed)+5;
    State.match.ball.onArrive=()=>{ State.match.ball.carrier=target; State.match.possession=team; updateCarrierInfo(); if (target.ai) target.ai.runTimer=0.8+Math.random()*0.8; };
  }
}

function canAttemptCross(team){
  const arr = team==='home'? State.match.homeDynamic : State.match.awayDynamic;
  return arr.some(p=> p.role==='WG' && ((team==='home'? p.x : (canvas.width - p.x))/canvas.width) > 0.6 && Math.abs(p.y - canvas.height/2) < canvas.height*0.35 );
}
function attemptCross(team){
  const arr = team==='home'? State.match.homeDynamic : State.match.awayDynamic;
  const carrier = State.match.ball.carrier; if (!carrier) return;
  const winger = arr.find(p=>p===carrier && p.role==='WG'); if (!winger){ attemptSmartPass(team); return; }
  const targets = arr.filter(p=> p.playerRef && (p.role==='ST' || p.role==='AM')); if (!targets.length){ attemptSmartPass(team); return; }
  const target = targets[Math.floor(Math.random()*targets.length)];
  logEvent('Orta!');
  State.match.ball.carrier=null;
  const apexX=target.x, apexY=target.y + (Math.random()*36 -18);
  const dPass = dist(carrier.x,carrier.y,apexX,apexY);
  State.match.ball.target={x:apexX,y:apexY,type:'cross'}; State.match.ball.travelSteps=Math.ceil(dPass/26)+4;
  State.match.ball.onArrive=()=>{
    const opp = team==='home'? State.match.awayDynamic : State.match.homeDynamic;
    const closeDef = opp.filter(o=>dist(o.x,o.y,target.x,target.y)<30).length;
    let headerScore = ((target.playerRef.attack||50)*0.55 + (target.playerRef.physical||50)*0.45)/100;
    headerScore *= (closeDef>0)? 0.7 : 1.1;
    const goal = Math.random() < headerScore*0.38;
    finishAttack(team, goal, 'Orta sonrası');
  };
}

function attemptThroughBall(team){
  const arr = team==='home'? State.match.homeDynamic : State.match.awayDynamic;
  const carrier = State.match.ball.carrier; if (!carrier) return;
  const runners = arr.filter(p=>p!==carrier && p.playerRef && ['ST','WG','AM'].includes(p.role));
  if (!runners.length){ attemptSmartPass(team); return; }
  runners.sort((a,b)=>{
    const progA = team==='home'? (a.x/canvas.width) : ((canvas.width-a.x)/canvas.width);
    const progB = team==='home'? (b.x/canvas.width) : ((canvas.width-b.x)/canvas.width);
    return progB - progA;
  });
  const target = runners[0];
  logEvent('Ara pası!');
  State.match.ball.carrier=null;
  const lead = team==='home'? 46 : -46;
  const passX = clamp(target.x + lead, 20, canvas.width-20);
  const passY = clamp(target.y + (Math.random()*26 -13), 20, canvas.height-20);
  const dPass = dist(carrier.x,carrier.y, passX, passY);
  State.match.ball.target={x:passX,y:passY,type:'through'}; State.match.ball.travelSteps=Math.ceil(dPass/28)+5;
  State.match.ball.onArrive=()=>{
    const dRunner = dist(target.x,target.y, passX, passY);
    if (dRunner < 60){ State.match.ball.carrier=target; State.match.possession=team; updateCarrierInfo(); if (Math.random()<0.35) attemptShot(team,0); }
    else assignLooseBallCarrier();
  };
}

function attemptSpacePass(team){
  const arr = team==='home'? State.match.homeDynamic : State.match.awayDynamic;
  const carrier = State.match.ball.carrier; if (!carrier) return;
  const runners = arr.filter(p=>p!==carrier && p.playerRef && ['ST','AM','WG'].includes(p.role));
  if (!runners.length){ attemptSmartPass(team); return; }
  const target = runners[Math.floor(Math.random()*runners.length)];
  logEvent('Boşluğa uzun top!');
  State.match.ball.carrier=null;
  const dir = team==='home'? 1 : -1;
  const passX = clamp(target.x + dir*(90 + Math.random()*50), 20, canvas.width-20);
  const passY = clamp(target.y + (Math.random()*60 -30), 20, canvas.height-20);
  const dPass = dist(carrier.x,carrier.y, passX, passY);
  State.match.ball.target={x:passX,y:passY,type:'space'}; State.match.ball.travelSteps=Math.ceil(dPass/32)+5;
  State.match.ball.onArrive=()=>{
    const dRunner = dist(target.x,target.y, passX, passY);
    if (dRunner < 75){ State.match.ball.carrier=target; State.match.possession=team; updateCarrierInfo(); State.match.counterStateTimer=3.0; }
    else assignLooseBallCarrier();
  };
}

// --- Attack finish / kickoff after goal ---
function finishAttack(team, goal, label){
  if (goal){
    if (team==='home') State.match.score.home++; else State.match.score.away++;
    setText('#score', `${State.match.score.home} - ${State.match.score.away}`);
    logEvent(`${label} gol!`);
  } else { logEvent(`${label} sonuçsuz.`); }
  const nextTeam = team==='home' ? 'away' : 'home';
  State.match.ball.target=null; State.match.ball.carrier=null;
  assignKickoff(nextTeam);
}

// --- Shot ---
function attemptShot(team, diff){
  const carrier = State.match.ball.carrier; if (!carrier) return;
  const tac = team==='home'? TACTICS[State.tactic] : TACTICS[State.opponent.tactic];
  const oppTac = team==='home'? TACTICS[State.opponent.tactic] : TACTICS[State.tactic];
  const attackStat = carrier.playerRef? carrier.playerRef.attack : 60;
  const progress = team==='home'? carrier.x / canvas.width : (canvas.width - carrier.x)/canvas.width;
  let xg = 0.11 + diff*0.003 + (attackStat/200) + progress*0.2 + tac.riskFactor*0.12 + randn()*0.02;
  xg *= (1 - oppTac.busFactor*0.5);
  xg = clamp(xg, 0.06, 0.72);
  const goalAttempt = Math.random() < xg;

  logEvent(`Şut! xG ${xg.toFixed(2)} ${goalAttempt?'(Gol denemesi)':''}`);
  const gx = team==='home'? canvas.width - 12 : 12;
  const gy = canvas.height/2 + (Math.random()*120 - 60);
  State.match.ball.carrier=null; State.match.ball.target={x:gx,y:gy,type:'shot',goal:goalAttempt,xg};
  State.match.ball.travelSteps=25;
  State.match.ball.onArrive=()=>{
    const defenders = team==='home'? State.match.awayDynamic : State.match.homeDynamic;
    const blocked = defenders.some(d=> pointLineDistance(d.x,d.y, carrier.x,carrier.y, gx,gy)<22 ) && Math.random()<0.30 + tac.riskFactor*0.1;
    if (blocked){
      logEvent('Şut bloklandı!');
      State.match.ball.x = carrier.x + (Math.random()*80 -40);
      State.match.ball.y = carrier.y + (Math.random()*60 -30);
      State.match.ball.target=null; assignLooseBallCarrier(); return;
    }
    finishAttack(team, goalAttempt, 'Şut');
  };
}

// --- Power calc ---
function computeTeamsPower(attacker){
  const home = getHomeLineupResolved().filter(x=>x.player);
  const away = State.opponent.lineup.filter(x=>x.player);
  const atkRoles=['ST','WG','AM']; const defRoles=['CB','FB','DM'];
  const sum=(arr,roles)=>arr.filter(x=>roles.includes(x.role)).reduce((a,c)=>a+effectiveRating(c.player,c.role),0);
  let atk,def;
  if (attacker==='home'){ atk=sum(home,atkRoles); def=sum(away,defRoles); }
  else { atk=sum(away,atkRoles); def=sum(home,defRoles); }
  atk += randn()*3; def += randn()*3; return {atk,def};
}
function effectiveRating(player, role){
  if (!player) return 0; const w=ROLES[role].weights; let s=0; for (const k of Object.keys(w)) s+=(player[k]||0)*w[k];
  if (player.pref===role) s*=1.05; return s;
}

// --- Targets & movement ---
function updateTargets(){
  const homeTac = TACTICS[State.tactic]; const awayTac = TACTICS[State.opponent.tactic];
  const atkSide = State.match.possession;
  applyTargets(State.match.homeDynamic, atkSide==='home', homeTac);
  applyTargets(State.match.awayDynamic, atkSide==='away', awayTac);
}

function applyTargets(arr, attacking, tactic){
  const counterBoost = State.match.counterStateTimer>0 && tactic===TACTICS['counter'] ? 1.0 : 0.0;
  for (const p of arr){
    if (!p.ai) p.ai = {targetTTL:0, runTimer:0, mark:null};
    p.ai.targetTTL -= State.match.logicStep/1000;
    if (p.ai.targetTTL > 0) continue;

    const anchorX=p.fx; const anchorY=p.fy; const baseRoam = p.roamRadius||80;
    const roamRadius = baseRoam*(1 + tactic.wingBias*0.2 + counterBoost*0.35);
    let advance = (tactic.lineHeight*120);
    if (attacking){
      advance += (p.role==='ST'?42: p.role==='AM'?28: p.role==='WG'?24: p.role==='DM'?12: p.role==='FB'?10: 0);
    } else {
      advance -= (p.role==='CB'?30: p.role==='FB'?22: p.role==='DM'?18: 10);
    }

    if (p.ai.runTimer>0){
      p.ai.runTimer -= State.match.logicStep/1000;
      const dir = State.match.homeDynamic.includes(p)? 1 : -1;
      p.tx = clamp(p.x + dir*(30 + Math.random()*30), 20, canvas.width-20);
      p.ty = clamp(p.y + (Math.random()*20 -10), 20, canvas.height-20);
      p.ai.targetTTL = 0.25 + Math.random()*0.25;
      continue;
    }

    const tight = tactic.passBias; const wide = tactic.wingBias;
    const roamAngle = Math.random()*Math.PI*2;
    const roamDist = Math.random()*(roamRadius*(0.4 + wide*0.25 - tight*0.15));
    let rx = Math.cos(roamAngle)*roamDist; let ry = Math.sin(roamAngle)*roamDist;
    if (p.role==='WG') rx *= (1 + wide*0.5);

    let targetX = anchorX + advance + rx;
    let targetY = anchorY + ry;
    targetX = clamp(targetX, 20, canvas.width-20);
    targetY = clamp(targetY, 20, canvas.height-20);

    if (State.match.ball.carrier===p && !State.match.ball.target){
      targetX = clamp(p.x + (Math.random()*22 -11), 20, canvas.width-20);
      targetY = clamp(p.y + (Math.random()*22 -11), 20, canvas.height-20);
    }
    p.tx=targetX; p.ty=targetY;
    p.ai.targetTTL = 0.35 + Math.random()*0.5;
  }
}

function antiClump(arr){
  for (let i=0;i<arr.length;i++){
    for (let j=i+1;j<arr.length;j++){
      const a=arr[i], b=arr[j]; const dx=a.x-b.x, dy=a.y-b.y; const d=Math.hypot(dx,dy);
      if (d<32 && d>0){
        const push=(32-d)*0.18; a.x+=(dx/d)*push; a.y+=(dy/d)*push; b.x-=(dx/d)*push; b.y-=(dy/d)*push;
      }
    }
  }
}

function movePlayers(stepSec){
  const all=[...State.match.homeDynamic, ...State.match.awayDynamic];
  for (const p of all){
    const dx=p.tx-p.x, dy=p.ty-p.y; const d=Math.hypot(dx,dy);
    if (d>0.2){
      const staminaFactor = 0.5 + (p.stamina||100)/100*0.5;
      const base = 120 + (p.speedBonus||0)*70;
      const v = base * staminaFactor;
      const move = Math.min(v*stepSec, d);
      p.x += (dx/d)*move; p.y += (dy/d)*move;
    }
  }
  if (State.match.ball.carrier && !State.match.ball.target){
    State.match.ball.x=State.match.ball.carrier.x;
    State.match.ball.y=State.match.ball.carrier.y;
  }
}

function updateBall(stepSec){
  const ball=State.match.ball;
  if (!ball.target) return;
  const dx=ball.target.x-ball.x, dy=ball.target.y-ball.y; const d=Math.hypot(dx,dy);
  if (d>0.1){
    let speed=24;
    switch(ball.target.type){ case 'shot': speed=36; break; case 'pass': speed=ball.target.speed||26; break; case 'cross': speed=28; break; case 'through': speed=30; break; case 'space': speed=32; break; }
    const mv=Math.min(speed*stepSec, d);
    ball.x += (dx/d)*mv; ball.y += (dy/d)*mv;
    ball.travelSteps--;
    if (ball.travelSteps<=0 || d<12){ const cb=ball.onArrive; ball.target=null; ball.onArrive=null; if (cb) cb(); }
  } else { const cb=ball.onArrive; ball.target=null; ball.onArrive=null; if (cb) cb(); }
}

// --- Tackles ---
function resolveTackles(){
  const carrier=State.match.ball.carrier; if (!carrier) return;
  const team = State.match.homeDynamic.includes(carrier)? 'home':'away';
  const opp = team==='home'? State.match.awayDynamic : State.match.homeDynamic;
  const oppTac = team==='home'? TACTICS[State.opponent.tactic] : TACTICS[State.tactic];

  for (const o of opp){
    if (!o.playerRef) continue;
    const d = dist(o.x,o.y, carrier.x,carrier.y);
    if (d<23){
      const pressFactor = oppTac.pressIntensity;
      const defPower = (o.playerRef.defense*0.4 + o.playerRef.physical*0.6);
      const attSecure = (carrier.playerRef.passing*0.5 + carrier.playerRef.speed*0.3);
      let tackleProb = clamp(0.2 + pressFactor*0.42 + (defPower - attSecure)*0.002, 0.08, 0.8);
      if (oppTac===TACTICS['gegen']) tackleProb = clamp(tackleProb + 0.12, 0, 0.88);
      if (Math.random()<tackleProb){
        logEvent('Pres ile top kapıldı!');
        State.match.ball.carrier=o; State.match.possession = team==='home'? 'away':'home'; updateCarrierInfo();
        const newTac = State.match.possession==='home'? TACTICS[State.tactic] : TACTICS[State.opponent.tactic];
        if (newTac.counterTrigger>0.75){ State.match.counterStateTimer=3.0; logEvent('Hızlı kontra!'); }
        break;
      }
    }
  }
}

// --- Stamina ---
function staminaTick(stepSec){
  const homeTac = TACTICS[State.tactic]; const awayTac = TACTICS[State.opponent.tactic];
  applyStaminaDecay(State.match.homeDynamic, homeTac, stepSec);
  applyStaminaDecay(State.match.awayDynamic, awayTac, stepSec);
  if (State.match.counterStateTimer>0){
    State.match.counterStateTimer -= stepSec;
    const burst = 3*stepSec;
    for (const p of [...State.match.homeDynamic, ...State.match.awayDynamic])
      p.stamina = Math.max(0, (p.stamina||100) - burst*10);
  }
}
function applyStaminaDecay(arr, tactic, stepSec){
  for (const p of arr){
    let dec = State.match.staminaDecayBase * tactic.tempoFactor;
    dec += tactic.pressIntensity * 0.18;
    if (State.match.ball.carrier && !arr.includes(State.match.ball.carrier)){
      const d = dist(p.x,p.y, State.match.ball.x,State.match.ball.y);
      if (d<130) dec += 0.06;
    }
    p.stamina = Math.max(0, (p.stamina||100) - dec*stepSec*100);
  }
}

// --- Utils ---
function dist(x1,y1,x2,y2){ return Math.hypot(x1-x2,y1-y2); }
function clamp(v,a,b){ return Math.max(a, Math.min(b,v)); }
function shuffle(a){ for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a; }
function randn(){ return (Math.random()+Math.random()+Math.random()+Math.random()-2); }
function pointLineDistance(px,py,x1,y1,x2,y2){
  const A=px-x1,B=py-y1,C=x2-x1,D=y2-y1; const dot=A*C+B*D; const lenSq=C*C+D*D; let param=lenSq? dot/lenSq : -1; let xx,yy;
  if (param<0){xx=x1;yy=y1;} else if (param>1){xx=x2;yy=y2;} else {xx=x1+param*C; yy=y1+param*D;}
  return Math.hypot(px-xx, py-yy);
}

// --- Log / UI ---
function logEvent(t){
  const log=$('#matchLog'); if (!log) return;
  const line=document.createElement('div'); line.textContent=`${State.match.minute}' ${t}`; log.prepend(line);
}
function renderMatchSidebars(){
  setText('#homeName','Biz'); setText('#awayName',State.opponent.name);
  const my=getHomeLineupResolved(); const their=State.opponent.lineup;
  const ulH=$('#homeLineupList'), ulA=$('#awayLineupList'); if (!ulH||!ulA) return;
  ulH.innerHTML=''; ulA.innerHTML='';
  for (const r of my){ const li=document.createElement('li'); li.textContent=`${r.role} - ${r.player? r.player.name : '—'}`; ulH.appendChild(li); }
  for (const r of their){ const li=document.createElement('li'); li.textContent=`${r.role} - ${r.player? r.player.name : '—'}`; ulA.appendChild(li); }
}
function updateCarrierInfo(){ setText('#carrierInfo', 'Top taşıyan: ' + (State.match.ball.carrier?.playerRef?.name || '-')); }
function updateTacticLabels(){ setText('#tacticInfo', `Taktikler: ${TACTICS[State.tactic].name} / ${TACTICS[State.opponent.tactic].name}`); }
function updateDebug(){
  const dbg=$('#debugInfo'); if (!dbg) return;
  const b=State.match.ball;
  dbg.textContent = `Dakika:${State.match.minute} | Skor:${State.match.score.home}-${State.match.score.away}
Taktikler: ${TACTICS[State.tactic].name} / ${TACTICS[State.opponent.tactic].name}
Counter:${State.match.counterStateTimer.toFixed(2)} | Ball:(${b.x.toFixed(1)},${b.y.toFixed(1)}) ${b.carrier?'[Taşıyan]':''} ${b.target?'[Hareket]':''}`;
}

// --- Canvas ---
const canvas = $('#pitchCanvas'); const ctx = canvas.getContext('2d');
function setupCanvas(){ drawPitch(); }
function drawPitch(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#0a4d2a'; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.strokeStyle='rgba(255,255,255,0.6)'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(canvas.width/2,0); ctx.lineTo(canvas.width/2,canvas.height); ctx.stroke();
  ctx.beginPath(); ctx.arc(canvas.width/2, canvas.height/2, 60, 0, Math.PI*2); ctx.stroke();
  ctx.strokeStyle='rgba(255,255,255,0.85)';
  ctx.strokeRect(6, canvas.height*0.25, 10, canvas.height*0.5);
  ctx.strokeRect(canvas.width-16, canvas.height*0.25, 10, canvas.height*0.5);
}
function renderMatchFrame(){
  drawPitch();
  for (const pl of State.match.homeDynamic) drawPlayer(pl);
  for (const pl of State.match.awayDynamic) drawPlayer(pl);
  drawBall(State.match.ball.x,State.match.ball.y);
}
function drawPlayer(pl){
  const {x,y,playerRef,role}=pl;
  const isHome = State.match.homeDynamic.includes(pl);
  const color = isHome? '#60a5fa' : '#f87171';
  ctx.fillStyle=color; ctx.beginPath(); ctx.arc(x,y,14,0,Math.PI*2); ctx.fill();
  if (State.match.ball.carrier===pl){ ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(x,y,18,0,Math.PI*2); ctx.stroke(); }
  if (playerRef){
    const frac = Math.max(0,(pl.stamina||100)/100);
    ctx.fillStyle='rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.arc(x,y,12,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='rgba(34,211,138,0.75)';
    ctx.beginPath(); ctx.moveTo(x,y);
    ctx.arc(x,y,12,-Math.PI/2, -Math.PI/2 + frac*Math.PI*2, false);
    ctx.lineTo(x,y); ctx.fill();
  }
  ctx.fillStyle='#000'; ctx.beginPath(); ctx.arc(x,y,10,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#fff'; ctx.font='10px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(role,x,y);
  if (playerRef){ ctx.fillStyle='rgba(255,255,255,0.9)'; ctx.font='11px sans-serif'; ctx.fillText(playerRef.name.split(' ')[0], x, y-20); }
}
function drawBall(x,y){ ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(x,y,6,0,Math.PI*2); ctx.fill(); ctx.strokeStyle='#000'; ctx.lineWidth=1; ctx.stroke(); }

// İlk çizim
renderMatchFrame();