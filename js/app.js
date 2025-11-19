// ===== Volta Mini Menejer - Sürekli Hareketli 2D Maç Simülasyonu =====
// Yeni: requestAnimationFrame oyun döngüsü + sabit zamanlı mantık güncellemesi.

// ---- Local Storage Keys ----
const LS_KEYS = {
  roster: 'vmm_clubRoster',
  formation: 'vmm_formation',
  lineup: 'vmm_lineup'
};

// ---- Rollerin Ağırlıkları ----
const ROLES = {
  WG: {label:'WG', weights:{speed:0.6, attack:0.4}},
  ST: {label:'ST', weights:{attack:0.6, physical:0.4}},
  DM: {label:'DM', weights:{defense:0.6, passing:0.4}},
  AM: {label:'AM', weights:{attack:0.5, passing:0.5}},
  CB: {label:'CB', weights:{defense:0.6, physical:0.4}},
  FB: {label:'FB', weights:{speed:0.5, defense:0.5}},
};

// ---- Dizilişler ----
const FORMATIONS = {
  '1-2-1': [
    {id:'S1',role:'CB',x:18,y:50},
    {id:'S2',role:'DM',x:35,y:40},
    {id:'S3',role:'AM',x:55,y:60},
    {id:'S4',role:'WG',x:65,y:30},
    {id:'S5',role:'ST',x:80,y:50},
  ],
  '2-1-1': [
    {id:'S1',role:'CB',x:18,y:35},
    {id:'S2',role:'FB',x:18,y:65},
    {id:'S3',role:'AM',x:45,y:50},
    {id:'S4',role:'WG',x:65,y:35},
    {id:'S5',role:'ST',x:80,y:55},
  ],
  '1-1-2': [
    {id:'S1',role:'CB',x:18,y:50},
    {id:'S2',role:'DM',x:35,y:50},
    {id:'S3',role:'WG',x:55,y:30},
    {id:'S4',role:'WG',x:55,y:70},
    {id:'S5',role:'ST',x:80,y:50},
  ],
};

// ---- Global State ----
const State = {
  players: [],
  clubRoster: new Set(),
  formation: '1-2-1',
  lineup: {},
  opponent: { name:'Sokak Yıldızları', lineup:[] },

  match: {
    running:false,
    paused:false,
    minute:0,
    maxMinute:50,
    logicalTickMs:800, // dakika artışı için
    speed:2,
    smooth:true,
    score:{home:0,away:0},
    possession:'home',
    ball:{
      x:450,y:270,vx:0,vy:0,
      carrier:null,
      target:null,
      travelSteps:0,
      onArrive:null
    },
    homeDynamic:[],
    awayDynamic:[],
    // Game loop zamanlayıcı
    lastTimestamp:0,
    accum:0,
    logicStep:1000/12, // 12 Hz mantık güncellemesi
    minuteAccum:0
  }
};

// ---- DOM Helpers ----
const $ = s=>document.querySelector(s);
const $$ = s=>document.querySelectorAll(s);

// ---- Başlat ----
init();
async function init(){
  await loadPlayers();
  loadFromStorageOrInit();
  bindUI();
  renderAll();
  setupCanvas();
  renderMatchFrame();
}

// ---- Oyuncuları Yükle ----
async function loadPlayers(){
  const res = await fetch('./db/players.json');
  const data = await res.json();
  State.players = data.map(p=>({
    ...p,
    attack:+p.attack, defense:+p.defense, speed:+p.speed,
    physical:+p.physical, passing:+p.passing
  }));
}

// ---- Storage Yükle ----
function loadFromStorageOrInit(){
  const r = localStorage.getItem(LS_KEYS.roster);
  if (r){
    State.clubRoster = new Set(JSON.parse(r));
  } else {
    const ids = State.players.map(p=>p.id);
    shuffle(ids);
    State.clubRoster = new Set(ids.slice(0,10));
    saveRoster();
  }
  const f = localStorage.getItem(LS_KEYS.formation);
  if (f && FORMATIONS[f]) State.formation = f; else saveFormation();

  const l = localStorage.getItem(LS_KEYS.lineup);
  if (l){
    try { State.lineup = JSON.parse(l); } catch { State.lineup={}; }
  } else {
    State.lineup={}; saveLineup();
  }
  buildOpponent();
}
function saveRoster(){ localStorage.setItem(LS_KEYS.roster, JSON.stringify([...State.clubRoster])); }
function saveFormation(){ localStorage.setItem(LS_KEYS.formation, State.formation); }
function saveLineup(){ localStorage.setItem(LS_KEYS.lineup, JSON.stringify(State.lineup)); }

// ---- UI Bind ----
function bindUI(){
  document.addEventListener('click', e=>{
    if (e.target.matches('.nav-btn')){
      setActivePage(e.target.getAttribute('data-target'));
    }
  });
  $('#goNextMatch').addEventListener('click', ()=>setActivePage('#mac'));
  $('#formation').value = State.formation;
  $('#formation').addEventListener('change', e=>{
    State.formation = e.target.value;
    saveFormation();
    const valid = new Set(FORMATIONS[State.formation].map(s=>s.id));
    for (const k of Object.keys(State.lineup)) if (!valid.has(k)) delete State.lineup[k];
    saveLineup();
    renderTactics();
  });
  $('#startMatch').addEventListener('click', startMatch);
  $('#pauseMatch').addEventListener('click', pauseMatch);
  $('#resetMatch').addEventListener('click', ()=>resetMatch(false,true));
  $('#speed').addEventListener('change', e=>{
    State.match.speed = +e.target.value;
  });
  $('#smoothSim').addEventListener('change', e=>{
    State.match.smooth = e.target.checked;
  });
}

function setActivePage(sel){
  $$('.page').forEach(p=>p.classList.remove('active'));
  const el = document.querySelector(sel);
  if (el) el.classList.add('active');
}

// ---- Render All ----
function renderAll(){
  renderTactics();
  renderTransfer();
  renderMatchSidebars();
}

// ===== Taktik =====
function renderTactics(){
  renderSquadList();
  renderPitchSlots();
}
function renderSquadList(){
  const list = $('#squadList');
  list.innerHTML='';
  const used = new Set(Object.values(State.lineup));
  const players = State.players.filter(p=>State.clubRoster.has(p.id) && !used.has(p.id));
  for (const p of players){
    const card = document.createElement('div');
    card.className='player-card';
    card.draggable=true;
    card.dataset.playerId=p.id;
    card.addEventListener('dragstart', onDragStart);
    card.innerHTML=`
      <div class="info">
        <div class="name">${p.name}</div>
        <div class="pos">Tercih: ${p.pref}</div>
        <div class="atts">Atak ${p.attack} · Def ${p.defense} · Hız ${p.speed} · Fizik ${p.physical} · Pas ${p.passing}</div>
      </div>
      <div class="actions"><span class="btn" title="Sürükle">↔</span></div>
    `;
    list.appendChild(card);
  }
}
function renderPitchSlots(){
  const pitch = $('#pitch');
  pitch.innerHTML='';
  for (const slot of FORMATIONS[State.formation]){
    const dz = document.createElement('div');
    dz.className='dropzone';
    dz.style.left = `calc(${slot.x}% - 47px)`;
    dz.style.top  = `calc(${slot.y}% - 47px)`;
    dz.dataset.slotId=slot.id;
    dz.dataset.role=slot.role;
    dz.addEventListener('dragover', e=>e.preventDefault());
    dz.addEventListener('drop', onDropPlayer);
    const pid = State.lineup[slot.id];
    if (pid){
      const p = State.players.find(x=>x.id===pid);
      dz.classList.add('filled');
      dz.innerHTML=`
        <button class="drop-remove" title="Kaldır">×</button>
        <div style="text-align:center">
          <div>${ROLES[slot.role].label}</div>
          <div style="font-size:12px">${p.name}</div>
        </div>`;
      dz.querySelector('.drop-remove').addEventListener('click', ()=>{
        delete State.lineup[slot.id];
        saveLineup(); renderTactics();
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
  saveLineup();
  renderTactics();
}

// ===== Transfer =====
function renderTransfer(){
  const clubBox = $('#clubRoster');
  const faBox = $('#freeAgents');
  clubBox.innerHTML=''; faBox.innerHTML='';

  const club = State.players.filter(p=>State.clubRoster.has(p.id));
  const free = State.players.filter(p=>!State.clubRoster.has(p.id));

  for (const p of club){
    clubBox.appendChild(playerCard(p, [
      button('Serbest', 'btn btn-danger', ()=>{
        for (const k of Object.keys(State.lineup)) if (State.lineup[k]===p.id) delete State.lineup[k];
        State.clubRoster.delete(p.id);
        saveRoster(); saveLineup(); renderAll();
      })
    ]));
  }
  for (const p of free){
    faBox.appendChild(playerCard(p, [
      button('Sözleşme', 'btn btn-ok', ()=>{
        State.clubRoster.add(p.id);
        saveRoster(); renderAll();
      })
    ]));
  }
}
function playerCard(p, actions=[]){
  const el = document.createElement('div');
  el.className='player-card';
  el.innerHTML=`
    <div class="info">
      <div class="name">${p.name}</div>
      <div class="pos">Tercih: ${p.pref}</div>
      <div class="atts">Atak ${p.attack} · Def ${p.defense} · Hız ${p.speed} · Fizik ${p.physical} · Pas ${p.passing}</div>
    </div>
    <div class="actions"></div>`;
  const act = el.querySelector('.actions');
  actions.forEach(a=>act.appendChild(a));
  return el;
}
function button(text, cls, onClick){
  const b = document.createElement('button');
  b.className=cls;
  b.textContent=text;
  b.addEventListener('click', onClick);
  return b;
}

// ===== Rakip =====
function buildOpponent(){
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
}

// ===== Maç Canvas =====
const canvas = $('#pitchCanvas');
const ctx = canvas.getContext('2d');

function setupCanvas(){ drawPitch(); }
function drawPitch(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#0a4d2a';
  ctx.fillRect(0,0,canvas.width,canvas.height);

  ctx.strokeStyle='rgba(255,255,255,0.6)';
  ctx.lineWidth=2;
  ctx.beginPath();
  ctx.moveTo(canvas.width/2,0);
  ctx.lineTo(canvas.width/2,canvas.height);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(canvas.width/2, canvas.height/2, 60, 0, Math.PI*2);
  ctx.stroke();

  // Kaleler
  ctx.strokeStyle='rgba(255,255,255,0.85)';
  ctx.strokeRect(6, canvas.height*0.25, 10, canvas.height*0.5);
  ctx.strokeRect(canvas.width-16, canvas.height*0.25, 10, canvas.height*0.5);
}

function renderMatchFrame(){
  drawPitch();
  // Oyuncular
  for (const pl of State.match.homeDynamic){
    drawPlayer(pl.x, pl.y, '#60a5fa', pl.playerRef?.name, pl.role, pl===State.match.ball.carrier);
  }
  for (const pl of State.match.awayDynamic){
    drawPlayer(pl.x, pl.y, '#f87171', pl.playerRef?.name, pl.role, pl===State.match.ball.carrier);
  }
  drawBall(State.match.ball.x, State.match.ball.y);
}

function drawPlayer(x,y,color,name,role,isCarrier){
  ctx.fillStyle=color;
  ctx.beginPath(); ctx.arc(x,y,14,0,Math.PI*2); ctx.fill();

  if (isCarrier){
    ctx.strokeStyle='#fff';
    ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(x,y,18,0,Math.PI*2); ctx.stroke();
  }

  ctx.fillStyle='#000';
  ctx.beginPath(); ctx.arc(x,y,10,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#fff';
  ctx.font='10px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(role, x, y);

  if (name){
    ctx.fillStyle='rgba(255,255,255,0.9)';
    ctx.font='11px sans-serif';
    ctx.fillText(name.split(' ')[0], x, y-20);
  }
}

function drawBall(x,y){
  ctx.fillStyle='#fff';
  ctx.beginPath(); ctx.arc(x,y,6,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle='#000'; ctx.lineWidth=1; ctx.stroke();
}

// ===== Lineup Resolve =====
function getHomeLineupResolved(){
  return FORMATIONS[State.formation].map(s=>{
    const pid = State.lineup[s.id];
    const player = State.players.find(p=>p.id===pid);
    return {role:s.role, player, slotId:s.id};
  });
}

function ensureLineupReady(){
  return FORMATIONS[State.formation].every(s=>State.lineup[s.id]);
}

// ===== Dynamic Oyuncu Başlatma =====
function initDynamicPlayers(){
  State.match.homeDynamic=[];
  State.match.awayDynamic=[];
  const homeSlots = FORMATIONS[State.formation];
  const awaySlots = mirrorSlots(homeSlots);
  const homeLine = getHomeLineupResolved();
  const awayLine = State.opponent.lineup;

  for (let i=0;i<homeSlots.length;i++){
    const s=homeSlots[i];
    const base=slotToCanvas(s.x,s.y);
    State.match.homeDynamic.push({
      role:s.role, slotId:s.id, playerRef:homeLine[i].player,
      x:base.x,y:base.y, fx:base.x,fy:base.y, tx:base.x,ty:base.y,
      speedBonus:homeLine[i].player? homeLine[i].player.speed/100 : 0
    });
  }
  for (let i=0;i<awaySlots.length;i++){
    const s=awaySlots[i];
    const base=slotToCanvas(s.x,s.y);
    State.match.awayDynamic.push({
      role:s.role, slotId:s.id, playerRef:awayLine[i].player,
      x:base.x,y:base.y, fx:base.x,fy:base.y, tx:base.x,ty:base.y,
      speedBonus:awayLine[i].player? awayLine[i].player.speed/100 : 0
    });
  }
}

function slotToCanvas(px,py){
  return { x:(px/100)*canvas.width, y:(py/100)*canvas.height };
}
function mirrorSlots(slots){
  return slots.map((s,i)=>({id:'A'+(i+1),role:s.role,x:100-s.x,y:s.y}));
}

// ===== Maç Başlat / Kontroller =====
function startMatch(){
  if (!ensureLineupReady()){
    alert('5 oyuncu sahaya yerleştirilmelidir.');
    return;
  }
  buildOpponent();
  resetMatch(true,true);
  State.match.running=true;
  State.match.paused=false;
  logEvent('Maç başladı!');
  // Game loop başlat
  State.match.lastTimestamp = performance.now();
  requestAnimationFrame(gameLoop);
}

function pauseMatch(){
  if (!State.match.running) return;
  State.match.paused = !State.match.paused;
  logEvent(State.match.paused ? 'Maç duraklatıldı.' : 'Maç devam ediyor.');
  if (!State.match.paused){
    State.match.lastTimestamp = performance.now();
    requestAnimationFrame(gameLoop);
  }
}

function resetMatch(keepLineups=false, fullReset=false){
  State.match.running=false;
  State.match.paused=false;
  State.match.minute=0;
  State.match.score={home:0,away:0};
  State.match.possession=Math.random()<0.5?'home':'away';
  State.match.ball.x=canvas.width/2;
  State.match.ball.y=canvas.height/2;
  State.match.ball.vx=0; State.match.ball.vy=0;
  State.match.ball.carrier=null;
  State.match.ball.target=null;
  State.match.ball.onArrive=null;

  State.match.accum=0;
  State.match.minuteAccum=0;

  if (fullReset){
    initDynamicPlayers();
    assignInitialCarrier();
  }

  $('#score').textContent='0 - 0';
  $('#matchMinute').textContent="0'";
  $('#possession').textContent='Topa sahip: -';
  $('#xgInfo').textContent='Atak gücü: -';
  $('#carrierInfo').textContent='Top taşıyan: -';
  $('#matchLog').innerHTML='';
  renderMatchSidebars();
  renderMatchFrame();
}

function assignInitialCarrier(){
  const arr = State.match.possession==='home'? State.match.homeDynamic : State.match.awayDynamic;
  const prefOrder = ['AM','DM','ST','WG','FB','CB'];
  let cand = arr.find(p=>p.playerRef && prefOrder.includes(p.role));
  if (!cand) cand = arr.find(p=>p.playerRef);
  if (cand){
    State.match.ball.carrier=cand;
    State.match.ball.x=cand.x;
    State.match.ball.y=cand.y;
    updateCarrierInfo();
  }
}

// ===== Game Loop =====
function gameLoop(ts){
  if (!State.match.running || State.match.paused) return;
  const dt = ts - State.match.lastTimestamp;
  State.match.lastTimestamp = ts;
  State.match.accum += dt * State.match.speed;
  State.match.minuteAccum += dt * State.match.speed;

  // Mantık güncellemelerini sabit aralıkla çalıştır
  while (State.match.accum >= State.match.logicStep){
    logicStep(State.match.logicStep);
    State.match.accum -= State.match.logicStep;
  }

  // Dakika artışı (gösterge)
  const minuteMs = State.match.logicalTickMs / State.match.speed;
  while (State.match.minuteAccum >= minuteMs){
    State.match.minute++;
    $('#matchMinute').textContent = `${State.match.minute}'`;
    State.match.minuteAccum -= minuteMs;
    if (State.match.minute >= State.match.maxMinute){
      logEvent(`Maç bitti! Skor: ${State.match.score.home} - ${State.match.score.away}`);
      State.match.running=false;
    }
  }

  renderMatchFrame();
  updateDebug();

  if (State.match.running) requestAnimationFrame(gameLoop);
}

function logicStep(stepMs){
  // stepMs ~ 83ms (12Hz)
  if (Math.random() < 0.55 * (stepMs/1000)){
    decideEvents();
  }
  updateTargets();
  movePlayersContinuous(stepMs);
  updateBall(stepMs);
  resolveTackles();
}

// ===== Olay Kararları =====
function decideEvents(){
  const attacker = State.match.possession;
  $('#possession').textContent = `Topa sahip: ${attacker==='home'?'Biz':'Rakip'}`;
  if (!State.match.ball.carrier){
    assignLooseBallCarrier();
  }
  if (!State.match.ball.carrier) return;

  const {atk,def} = computeTeamsPower(attacker);
  const diff = atk - def;
  const shotProb = clamp(0.10 + diff*0.0015 + Math.random()*0.04, 0.05, 0.33);
  const passProb = clamp(0.50 - shotProb + Math.random()*0.1, 0.20, 0.55);
  const r = Math.random();
  let action='hold';
  if (r < shotProb) action='shot';
  else if (r < shotProb + passProb) action='pass';

  $('#xgInfo').textContent = `Atak farkı: ${diff.toFixed(1)}`;
  if (action==='shot') attemptShot(attacker, diff);
  else if (action==='pass') attemptPass(attacker);
}

function assignLooseBallCarrier(){
  const all = [...State.match.homeDynamic, ...State.match.awayDynamic].filter(p=>p.playerRef);
  let best=null, bestD=1e9;
  for (const p of all){
    const d = dist(p.x,p.y, State.match.ball.x, State.match.ball.y);
    if (d<bestD){bestD=d;best=p;}
  }
  if (best){
    State.match.ball.carrier=best;
    State.match.possession = State.match.homeDynamic.includes(best)? 'home':'away';
    updateCarrierInfo();
  }
}

function attemptPass(team){
  const arr = team==='home'? State.match.homeDynamic : State.match.awayDynamic;
  const oppArr = team==='home'? State.match.awayDynamic : State.match.homeDynamic;
  const carrier = State.match.ball.carrier;
  if (!carrier) return;
  const candidates = arr.filter(p=>p!==carrier && p.playerRef);
  if (!candidates.length) return;
  // Uygun hedef (orta mesafe)
  candidates.sort((a,b)=>{
    const da = Math.abs(dist(carrier.x,carrier.y,a.x,a.y)-140);
    const db = Math.abs(dist(carrier.x,carrier.y,b.x,b.y)-140);
    return da - db;
  });
  const target = candidates[0];
  // Pas hattı kesilme kontrolü
  const intercept = oppArr.some(o=>{
    const d = pointLineDistance(o.x,o.y, carrier.x,carrier.y, target.x,target.y);
    return d < 26;
  }) && Math.random()<0.35;

  if (intercept){
    logEvent('Pas kesildi!');
    // Topu en yakın savunmacıya ver
    let best=null, bestD=1e9;
    for (const o of oppArr){
      const d = dist(o.x,o.y, carrier.x,carrier.y);
      if (d<bestD){bestD=d; best=o;}
    }
    if (best){
      State.match.ball.carrier=best;
      State.match.possession = team==='home'? 'away':'home';
      updateCarrierInfo();
    }
  } else {
    logEvent('Pas denemesi');
    State.match.ball.carrier=null;
    State.match.ball.target={x:target.x,y:target.y,type:'pass'};
    State.match.ball.travelSteps=16;
    State.match.ball.onArrive=()=>{
      State.match.ball.carrier=target;
      State.match.possession=team;
      updateCarrierInfo();
    };
  }
}

function attemptShot(team, diff){
  const carrier = State.match.ball.carrier;
  if (!carrier) return;
  const xg = clamp(0.08 + diff*0.003 + randn()*0.02, 0.04, 0.55);
  const goal = Math.random() < xg;
  logEvent(`Şut! xG ${xg.toFixed(2)} ${goal?'(Gol)':''}`);
  const gx = team==='home'? canvas.width - 12 : 12;
  const gy = canvas.height/2 + (Math.random()*120 - 60);

  State.match.ball.carrier=null;
  State.match.ball.target={x:gx,y:gy,type:'shot',goal,xg};
  State.match.ball.travelSteps=22;
  State.match.ball.onArrive=()=>{
    if (goal){
      if (team==='home') State.match.score.home++; else State.match.score.away++;
      $('#score').textContent = `${State.match.score.home} - ${State.match.score.away}`;
    }
    // Orta sahaya dön
    State.match.ball.x=canvas.width/2;
    State.match.ball.y=canvas.height/2;
    State.match.ball.target=null;
    State.match.ball.carrier=null;
    assignLooseBallCarrier();
  };
}

// ===== Güç Hesabı =====
function computeTeamsPower(attacker){
  const home = getHomeLineupResolved().filter(x=>x.player);
  const away = State.opponent.lineup.filter(x=>x.player);
  const atkRoles=['ST','WG','AM'];
  const defRoles=['CB','FB','DM'];
  const sum = (arr, roles)=>arr.filter(x=>roles.includes(x.role)).reduce((a,c)=>a+effectiveRating(c.player,c.role),0);
  let atk, def;
  if (attacker==='home'){ atk = sum(home,atkRoles); def=sum(away,defRoles); }
  else { atk = sum(away,atkRoles); def=sum(home,defRoles); }
  atk += randn()*3; def += randn()*3;
  return {atk,def};
}
function effectiveRating(player, role){
  if (!player) return 0;
  const w = ROLES[role].weights;
  let s=0;
  for (const k of Object.keys(w)) s += (player[k]||0)*w[k];
  if (player.pref===role) s *= 1.05;
  return s;
}

// ===== Hedefler ve Hareket =====
function updateTargets(){
  const atkSide = State.match.possession;
  applyTargets(State.match.homeDynamic, atkSide==='home');
  applyTargets(State.match.awayDynamic, atkSide==='away');
}

function applyTargets(arr, isAttacking){
  for (const p of arr){
    const baseSpeed = 1.4 + p.speedBonus;
    p.maxSpeed = baseSpeed * (isAttacking ? 1.15 : 1.0);

    let offX=0, offY=0;
    if (isAttacking){
      if (p.role==='ST') offX=40;
      else if (p.role==='AM') offX=25;
      else if (p.role==='WG') offX=25;
      else if (p.role==='DM') offX=10;
      else if (p.role==='FB') offX=8;
      else if (p.role==='CB') offX=0;
    } else {
      if (p.role==='CB') offX=-25;
      else if (p.role==='FB') offX=-18;
      else if (p.role==='DM') offX=-15;
      else offX=-8;
    }
    offY += (Math.random()*4 -2);

    const targetX = clamp(p.fx + offX, 30, canvas.width-30);
    const targetY = clamp(p.fy + offY, 30, canvas.height-30);

    // Top taşıyan ise minik jitter
    if (State.match.ball.carrier===p && !State.match.ball.target){
      p.tx = clamp(p.x + (Math.random()*18-9), 20, canvas.width-20);
      p.ty = clamp(p.y + (Math.random()*18-9), 20, canvas.height-20);
    } else {
      p.tx = targetX;
      p.ty = targetY;
    }
  }
}

function movePlayersContinuous(stepMs){
  const dt = stepMs/1000;
  const all = [...State.match.homeDynamic, ...State.match.awayDynamic];
  for (const p of all){
    const dx = p.tx - p.x;
    const dy = p.ty - p.y;
    const d = Math.hypot(dx,dy);
    if (d > 0.5){
      const v = p.maxSpeed;
      const move = Math.min(v*dt*60/12, d); // ölçekleme
      p.x += (dx/d)*move;
      p.y += (dy/d)*move;
    }
  }
  // Top taşıyan varsa topu takip ettir
  if (State.match.ball.carrier && !State.match.ball.target){
    State.match.ball.x = State.match.ball.carrier.x;
    State.match.ball.y = State.match.ball.carrier.y;
  }
}

function updateBall(stepMs){
  const ball = State.match.ball;
  if (ball.target){
    const dx = ball.target.x - ball.x;
    const dy = ball.target.y - ball.y;
    const d = Math.hypot(dx,dy);
    if (d > 0.1){
      const speed = (ball.target.type==='shot'? 28 : 22);
      const move = Math.min(speed, d);
      ball.x += (dx/d)*move;
      ball.y += (dy/d)*move;
      ball.travelSteps--;
      if (ball.travelSteps<=0 || d<14){
        const cb = ball.onArrive;
        ball.target=null;
        ball.onArrive=null;
        if (cb) cb();
      }
    } else {
      const cb = ball.onArrive;
      ball.target=null;
      ball.onArrive=null;
      if (cb) cb();
    }
  }
}

// ===== Tackle / Top Kapma =====
function resolveTackles(){
  const carrier = State.match.ball.carrier;
  if (!carrier) return;
  const team = State.match.homeDynamic.includes(carrier)? 'home':'away';
  const opponents = team==='home'? State.match.awayDynamic : State.match.homeDynamic;

  for (const o of opponents){
    if (!o.playerRef) continue;
    const d = dist(o.x,o.y, carrier.x,carrier.y);
    if (d < 22){
      const defPower = (o.playerRef.defense*0.6 + o.playerRef.physical*0.4);
      const attPower = (carrier.playerRef.attack*0.6 + carrier.playerRef.speed*0.4);
      const tackleProb = clamp(0.25 + (defPower - attPower)*0.002, 0.10, 0.65);
      if (Math.random()<tackleProb){
        logEvent('Top kapma başarılı!');
        State.match.ball.carrier=o;
        State.match.possession = team==='home'? 'away':'home';
        updateCarrierInfo();
        break;
      }
    }
  }
}

// ===== Yardımcılar =====
function dist(x1,y1,x2,y2){ return Math.hypot(x1-x2,y1-y2); }
function clamp(v,a,b){ return Math.max(a, Math.min(b,v)); }
function shuffle(a){ for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a; }
function randn(){ return (Math.random()+Math.random()+Math.random()+Math.random()-2); }
function pointLineDistance(px,py,x1,y1,x2,y2){
  const A=px-x1, B=py-y1, C=x2-x1, D=y2-y1;
  const dot=A*C + B*D;
  const lenSq=C*C + D*D;
  let param = lenSq ? dot/lenSq : -1;
  let xx,yy;
  if (param<0){xx=x1;yy=y1;}
  else if (param>1){xx=x2;yy=y2;}
  else {xx=x1 + param*C; yy=y1 + param*D;}
  return Math.hypot(px-xx, py-yy);
}

// ===== Log / Sidebar / Debug =====
function logEvent(text){
  const log = $('#matchLog');
  const line = document.createElement('div');
  line.textContent = `${State.match.minute}' ${text}`;
  log.prepend(line);
}
function renderMatchSidebars(){
  $('#homeName').textContent='Biz';
  $('#awayName').textContent=State.opponent.name;
  const my = getHomeLineupResolved();
  const their = State.opponent.lineup;
  const ulH = $('#homeLineupList'); const ulA = $('#awayLineupList');
  ulH.innerHTML=''; ulA.innerHTML='';
  for (const r of my){
    const li=document.createElement('li');
    li.textContent = `${r.role} - ${r.player? r.player.name : '—'}`;
    ulH.appendChild(li);
  }
  for (const r of their){
    const li=document.createElement('li');
    li.textContent = `${r.role} - ${r.player? r.player.name : '—'}`;
    ulA.appendChild(li);
  }
}
function updateCarrierInfo(){
  $('#carrierInfo').textContent = 'Top taşıyan: ' + (State.match.ball.carrier?.playerRef?.name || '-');
}
function updateDebug(){
  const dbg = $('#debugInfo');
  if (!dbg) return;
  const b = State.match.ball;
  dbg.textContent =
    `Possession: ${State.match.possession}
Ball: (${b.x.toFixed(1)}, ${b.y.toFixed(1)}) ${b.carrier?'[Taşıyan]':''} ${b.target?'[Uçuyor]':''}
Home: ${State.match.homeDynamic.map(p=>p.playerRef? p.playerRef.name.split(' ')[0] : '—').join(', ')}
Away: ${State.match.awayDynamic.map(p=>p.playerRef? p.playerRef.name.split(' ')[0] : '—').join(', ')}`;
}

// ===== İlk çizim =====
renderMatchFrame();