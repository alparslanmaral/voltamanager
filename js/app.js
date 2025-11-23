// ===== Volta Mini Menejer - Anti-Top Yığılması / Akıllı Chase / Genişletilmiş Taktiksel AI =====
// Bu sürüm: oyuncuların hepsi topa koşmuyor; sınırlı chaser seçimi, taktiksel şekil, separation, support üçgenleri,
// top çevresi sıkışmasını azaltan kaçış vektörleri, stamina bazlı chase maliyeti.

// ------------------------ Config & Constants ------------------------
const LS_KEYS = { roster:'vmm_clubRoster', formation:'vmm_formation', lineup:'vmm_lineup', tactic:'vmm_tactic' };
const $ = s=>document.querySelector(s);
function setText(sel,val){const el=$(sel); if(el) el.textContent=val;}
function setHTML(sel,val){const el=$(sel); if(el) el.innerHTML=val;}

// Roller, temel ağırlıklar ve rol bazlı chase isteği (0..1)
const ROLES = {
  WG:{label:'WG',weights:{speed:0.6,attack:0.4}, roam:120, chaseWeight:0.55, spacing:42},
  ST:{label:'ST',weights:{attack:0.6,physical:0.4}, roam:100, chaseWeight:0.75, spacing:45},
  DM:{label:'DM',weights:{defense:0.6,passing:0.4}, roam:90,  chaseWeight:0.50, spacing:40},
  AM:{label:'AM',weights:{attack:0.5,passing:0.5}, roam:105, chaseWeight:0.70, spacing:44},
  CB:{label:'CB',weights:{defense:0.6,physical:0.4}, roam:70,  chaseWeight:0.35, spacing:38},
  FB:{label:'FB',weights:{speed:0.5,defense:0.5}, roam:85,  chaseWeight:0.45, spacing:40},
};

// Dizilişler
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

// Taktikler
const TACTICS = {
  tiki_taka:{ name:'Tiki Taka', key:'passing', desc:'Kısa pas, üçgenler, yakın ama dengeli kompakt oyun.',
    passBias:0.9, wingBias:0.35, pressIntensity:0.5, lineHeight:0.18, counterTrigger:0.25, defenseDepth:0.45, riskFactor:0.35, tempoFactor:1.25, busFactor:0.0,
    chaseTightness:0.65, supportCompression:0.75 },
  wings:{ name:'Kanat Oyunu', key:'speed', desc:'Kanatlar genişler, çizgiye iniş ve ortalar.',
    passBias:0.6, wingBias:0.95, pressIntensity:0.55, lineHeight:0.28, counterTrigger:0.35, defenseDepth:0.5, riskFactor:0.45, tempoFactor:1.2, busFactor:0.0,
    chaseTightness:0.55, supportCompression:0.55 },
  counter:{ name:'Kontra Atak', key:'attack', desc:'Derinde karşıla, topu kapınca hızlı vertikal çık.',
    passBias:0.5, wingBias:0.6, pressIntensity:0.4, lineHeight:0.0, counterTrigger:0.9, defenseDepth:0.7, riskFactor:0.55, tempoFactor:1.35, busFactor:0.0,
    chaseTightness:0.50, supportCompression:0.50 },
  gegen:{ name:'Gegen Press', key:'physical', desc:'Önde yoğun pres, hızlı top kazanma (riskli).',
    passBias:0.55, wingBias:0.55, pressIntensity:0.95, lineHeight:0.38, counterTrigger:0.55, defenseDepth:0.35, riskFactor:0.75, tempoFactor:1.5, busFactor:0.0,
    chaseTightness:0.80, supportCompression:0.60 },
  park:{ name:'Otobüsü Park Et', key:'defense', desc:'Derin blok, düşük risk, şut xG düşürme.',
    passBias:0.45, wingBias:0.3, pressIntensity:0.2, lineHeight:-0.18, counterTrigger:0.3, defenseDepth:0.95, riskFactor:0.2, tempoFactor:0.9, busFactor:0.5,
    chaseTightness:0.45, supportCompression:0.85 },
};

// Global State
const State = {
  players:[],
  clubRoster:new Set(),
  formation:'1-2-1',
  lineup:{},
  tactic:'tiki_taka',
  opponent:{ name:'Sokak Yıldızları', lineup:[], tactic:'tiki_taka', dynamicTacticChangeTimer:0 },
  match:{
    running:false, paused:false, minute:0, maxMinute:90,
    logicalTickMs:650, speed:2, smooth:true,
    score:{home:0,away:0}, possession:'home',
    ball:{ x:450,y:270,vx:0,vy:0,carrier:null,target:null,travelSteps:0,onArrive:null },
    homeDynamic:[], awayDynamic:[],
    lastTimestamp:0, accum:0, logicStep:1000/30, minuteAccum:0,
    interchangeCooldown:0,
    counterStateTimer:0,
    staminaDecayBase:0.23,
    chaseState:{ home:{primary:[],support:[]}, away:{primary:[],support:[]} }
  }
};

// ------------------------ Initialization ------------------------
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
  State.players = data.map(p=>({...p,
    attack:+p.attack, defense:+p.defense, speed:+p.speed,
    physical:+p.physical, passing:+p.passing
  }));
}

function loadFromStorage(){
  const r = localStorage.getItem(LS_KEYS.roster);
  if (r){ State.clubRoster = new Set(JSON.parse(r)); } else {
    const ids = State.players.map(p=>p.id); shuffle(ids);
    State.clubRoster = new Set(ids.slice(0,10));
    saveRoster();
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

// ------------------------ Opponent Setup ------------------------
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
  State.opponent.dynamicTacticChangeTimer=0;
  if (!onInit) logEvent(`Rakip taktiği: ${TACTICS[State.opponent.tactic].name}`);
}

// ------------------------ UI Binding ------------------------
function bindUI(){
  document.addEventListener('click', e=>{
    if (e.target.matches('.nav-btn')) setActivePage(e.target.getAttribute('data-target'));
  });
  $('#goNextMatch')?.addEventListener('click', ()=>setActivePage('#mac'));

  const formationSel = $('#formation');
  if (formationSel){
    formationSel.value=State.formation;
    formationSel.addEventListener('change', e=>{
      State.formation=e.target.value; saveFormation();
      const valid = new Set(FORMATIONS[State.formation].map(s=>s.id));
      for (const k of Object.keys(State.lineup)) if(!valid.has(k)) delete State.lineup[k];
      saveLineup(); renderTactics(); updateTacticFitUI();
    });
  }
  const tacticSel = $('#tacticSelect');
  if (tacticSel){
    tacticSel.value=State.tactic;
    tacticSel.addEventListener('change', e=>{
      State.tactic=e.target.value; saveTactic(); updateTacticFitUI();
    });
  }

  $('#startMatch')?.addEventListener('click', startMatch);
  $('#pauseMatch')?.addEventListener('click', pauseMatch);
  $('#resetMatch')?.addEventListener('click', ()=>resetMatch(false,true));
  $('#speed')?.addEventListener('change', e=> State.match.speed=+e.target.value);
  $('#smoothSim')?.addEventListener('change', e=> State.match.smooth=e.target.checked);
}

function setActivePage(sel){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  const el=document.querySelector(sel); if(el) el.classList.add('active');
}

// ------------------------ Render Root ------------------------
function renderAll(){ renderTactics(); renderTransfer(); renderMatchSidebars(); }

// ------------------------ Tactic Screen ------------------------
function renderTactics(){ renderSquadList(); renderPitchSlots(); }
function renderSquadList(){
  const list=$('#squadList'); if(!list) return;
  list.innerHTML='';
  const used=new Set(Object.values(State.lineup));
  const players=State.players.filter(p=>State.clubRoster.has(p.id)&&!used.has(p.id));
  for(const p of players){
    const card=document.createElement('div');
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
  const pitch=$('#pitch'); if(!pitch) return;
  pitch.innerHTML='';
  for(const slot of FORMATIONS[State.formation]){
    const dz=document.createElement('div');
    dz.className='dropzone';
    dz.style.left=`calc(${slot.x}% - 47px)`;
    dz.style.top =`calc(${slot.y}% - 47px)`;
    dz.dataset.slotId=slot.id; dz.dataset.role=slot.role;
    dz.addEventListener('dragover', e=>e.preventDefault());
    dz.addEventListener('drop', onDropPlayer);
    const pid=State.lineup[slot.id];
    if(pid){
      const p=State.players.find(x=>x.id===pid);
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
    } else dz.textContent=ROLES[slot.role].label;
    pitch.appendChild(dz);
  }
}
function onDragStart(e){ e.dataTransfer.setData('text/playerId', e.currentTarget.dataset.playerId); }
function onDropPlayer(e){
  e.preventDefault();
  const pid=+e.dataTransfer.getData('text/playerId');
  if(!pid||!State.clubRoster.has(pid)) return;
  for(const k of Object.keys(State.lineup)) if(State.lineup[k]===pid) delete State.lineup[k];
  State.lineup[e.currentTarget.dataset.slotId]=pid;
  saveLineup(); renderTactics(); updateTacticFitUI();
}

// ------------------------ Tactic Fit UI ------------------------
function updateTacticFitUI(){
  const tac=TACTICS[State.tactic]; const lineup=getHomeLineupResolved();
  const score=evaluateTacticForLineup(lineup,State.tactic);
  const pct=Math.round(score*100);
  setText('#tacticFitPercent', pct?pct+'%':'-');
  const bar=$('#tacticFitBarFill'); if(bar) bar.style.width=pct+'%';
  const attr=tac.key; let sum=0,cnt=0;
  for(const sl of lineup){ if(sl.player){ sum += sl.player[attr]; cnt++; } }
  const avg=cnt?(sum/cnt).toFixed(1):'-';
  setText('#tacticFitDetails', `Taktik: ${tac.name}
Ana Özellik: ${attr} (Ortalama: ${avg})
Tanım: ${tac.desc}`);
}
function evaluateTacticForLineup(lineup,key){
  const t=TACTICS[key]; const attr=t.key; let sum=0,cnt=0,b=0;
  for(const s of lineup){
    if(s.player){ sum+=s.player[attr]||0; cnt++; if(s.player.pref===s.role) b+=1; }
  }
  if(!cnt) return 0;
  return clamp((sum/cnt + b)/101,0,1);
}

// ------------------------ Transfer ------------------------
function renderTransfer(){
  const clubBox=$('#clubRoster'), faBox=$('#freeAgents');
  if(!clubBox||!faBox) return;
  clubBox.innerHTML=''; faBox.innerHTML='';
  const club=State.players.filter(p=>State.clubRoster.has(p.id));
  const free=State.players.filter(p=>!State.clubRoster.has(p.id));
  for(const p of club){
    clubBox.appendChild(playerCard(p,[
      button('Serbest','btn btn-danger',()=>{
        for(const k of Object.keys(State.lineup)) if(State.lineup[k]===p.id) delete State.lineup[k];
        State.clubRoster.delete(p.id); saveRoster(); saveLineup(); renderAll(); updateTacticFitUI();
      })
    ]));
  }
  for(const p of free){
    faBox.appendChild(playerCard(p,[
      button('Sözleşme','btn btn-ok',()=>{
        State.clubRoster.add(p.id); saveRoster(); renderAll(); updateTacticFitUI();
      })
    ]));
  }
}
function playerCard(p,actions=[]){
  const el=document.createElement('div'); el.className='player-card';
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
function button(text,cls,fn){const b=document.createElement('button'); b.className=cls; b.textContent=text; b.addEventListener('click',fn); return b;}

// ------------------------ Lineup Resolve ------------------------
function getHomeLineupResolved(){
  return FORMATIONS[State.formation].map(s=>{
    const pid=State.lineup[s.id];
    const player=State.players.find(p=>p.id===pid);
    return {role:s.role, player, slotId:s.id};
  });
}
function ensureLineupReady(){return FORMATIONS[State.formation].every(s=>State.lineup[s.id]);}

// ------------------------ Dynamic Opponent Tactic Adjust ------------------------
function maybeOpponentTacticAdjust(){
  if(State.match.minute<12) return;
  State.opponent.dynamicTacticChangeTimer -= (State.match.logicStep/1000);
  if(State.opponent.dynamicTacticChangeTimer>0) return;
  const losing=State.match.score.away<State.match.score.home;
  const leading=State.match.score.away>State.match.score.home;
  const keys = losing?['gegen','wings','counter'] : leading?['park','tiki_taka'] : Object.keys(TACTICS);
  const pick=keys[Math.floor(Math.random()*keys.length)];
  if(pick!==State.opponent.tactic){
    State.opponent.tactic=pick;
    logEvent(`Rakip taktiği değişti: ${TACTICS[pick].name}`);
  }
  State.opponent.dynamicTacticChangeTimer=25+Math.random()*25;
}

// ------------------------ Dynamic Player Setup ------------------------
function initDynamicPlayers(){
  State.match.homeDynamic=[]; State.match.awayDynamic=[];
  const homeSlots=FORMATIONS[State.formation];
  const awaySlots=mirrorSlots(homeSlots);
  const homeLine=getHomeLineupResolved();
  const awayLine=State.opponent.lineup;

  for(let i=0;i<homeSlots.length;i++){
    const s=homeSlots[i]; const base=slotToCanvas(s.x*0.7,s.y);
    State.match.homeDynamic.push(makeDynPlayer(s.role,s.id,base,homeLine[i].player));
  }
  for(let i=0;i<awaySlots.length;i++){
    const s=awaySlots[i]; const base=slotToCanvas((s.x*0.3)+70,s.y);
    State.match.awayDynamic.push(makeDynPlayer(s.role,s.id,base,awayLine[i].player));
  }
}
function makeDynPlayer(role,slotId,base,player){
  return {
    role, slotId, playerRef:player,
    fx:base.x, fy:base.y, x:base.x, y:base.y,
    tx:base.x, ty:base.y,
    speedBonus:player? player.speed/100:0,
    roamRadius:ROLES[role].roam,
    stamina:100,
    ai:{
      targetTTL:0, runTimer:0, mark:null,
      chase:false, support:false, supportArc:null,
      runnerIntent:false
    }
  };
}
function slotToCanvas(px,py){return {x:(px/100)*canvas.width,y:(py/100)*canvas.height};}
function mirrorSlots(slots){return slots.map((s,i)=>({id:'A'+(i+1),role:s.role,x:100-s.x,y:s.y}));}

// ------------------------ Match Controls ------------------------
function startMatch(){
  if(!ensureLineupReady()){ alert('5 oyuncu yerleştir.'); return; }
  buildOpponent();
  resetMatch(true,true);
  State.match.running=true; State.match.paused=false;
  logEvent('Maç başladı (Kickoff bizde)');
  State.match.lastTimestamp=performance.now();
  requestAnimationFrame(gameLoop);
}
function pauseMatch(){
  if(!State.match.running) return;
  State.match.paused=!State.match.paused;
  logEvent(State.match.paused?'Maç duraklatıldı.':'Maç devam.');
  if(!State.match.paused){
    State.match.lastTimestamp=performance.now();
    requestAnimationFrame(gameLoop);
  }
}
function resetMatch(_,full=false){
  State.match.running=false; State.match.paused=false;
  State.match.minute=0; State.match.score={home:0,away:0}; State.match.possession='home';
  Object.assign(State.match.ball,{x:canvas.width*0.30,y:canvas.height/2,vx:0,vy:0,carrier:null,target:null,onArrive:null,travelSteps:0});
  State.match.accum=0; State.match.minuteAccum=0; State.match.interchangeCooldown=0; State.match.counterStateTimer=0;
  State.match.chaseState={ home:{primary:[],support:[]}, away:{primary:[],support:[]} };
  if(full){ initDynamicPlayers(); assignKickoff('home'); }
  setText('#score','0 - 0'); setText('#matchMinute',"0'");
  setText('#possession','Topa sahip: Biz'); setText('#xgInfo','Atak gücü: -');
  setText('#carrierInfo','Top taşıyan: -'); setHTML('#matchLog','');
  renderMatchSidebars(); renderMatchFrame(); updateTacticLabels();
}
function assignKickoff(team){
  State.match.possession=team;
  const arr=team==='home'? State.match.homeDynamic:State.match.awayDynamic;
  const order=['DM','AM','ST','WG','FB','CB'];
  let cand=arr.find(p=>p.playerRef && order.includes(p.role));
  if(!cand) cand=arr.find(p=>p.playerRef);
  const x=team==='home'? canvas.width*0.30: canvas.width*0.70;
  const y=canvas.height/2;
  State.match.ball.x=x; State.match.ball.y=y;
  State.match.ball.carrier=null; State.match.ball.target=null;
  if(cand){ State.match.ball.carrier=cand; State.match.ball.x=cand.x; State.match.ball.y=cand.y; updateCarrierInfo(); }
}
function updateTacticLabels(){
  setText('#tacticInfo', `Taktikler: ${TACTICS[State.tactic].name} / ${TACTICS[State.opponent.tactic].name}`);
}

// ------------------------ Game Loop ------------------------
function gameLoop(ts){
  if(!State.match.running||State.match.paused) return;
  const dt=ts-State.match.lastTimestamp;
  State.match.lastTimestamp=ts;
  State.match.accum += dt*State.match.speed;
  State.match.minuteAccum += dt*State.match.speed;

  while(State.match.accum >= State.match.logicStep){
    logicStep(State.match.logicStep);
    State.match.accum -= State.match.logicStep;
  }
  const minuteMs = State.match.logicalTickMs / State.match.speed;
  while(State.match.minuteAccum >= minuteMs){
    State.match.minute++;
    setText('#matchMinute', `${State.match.minute}'`);
    State.match.minuteAccum -= minuteMs;
    if(State.match.minute>=State.match.maxMinute){
      logEvent(`Maç bitti! Skor: ${State.match.score.home} - ${State.match.score.away}`);
      State.match.running=false;
    } else maybeOpponentTacticAdjust();
  }
  renderMatchFrame(); updateDebug();
  if(State.match.running) requestAnimationFrame(gameLoop);
}

function logicStep(stepMs){
  const stepSec=stepMs/1000;
  State.match.interchangeCooldown -= stepSec;
  if(State.match.interchangeCooldown<=0){
    attemptInterchange();
    State.match.interchangeCooldown = 6+Math.random()*5;
  }

  // Tempo / Event
  const homeTac=TACTICS[State.tactic], awayTac=TACTICS[State.opponent.tactic];
  const tempoAvg=(homeTac.tempoFactor+awayTac.tempoFactor)/2;
  const eventProb=0.55*(stepMs/1000)*tempoAvg;
  if(Math.random()<eventProb) decideEvents();

  // 1) Chase selection (AZALT topa koşan)
  selectBallChasers();

  // 2) Taktik şekil
  updateTacticalTargets();

  // 3) Pres & Marking
  updatePressingAndMarking();

  // 4) Support arcs (pas üçgenleri)
  updateSupportArcs();

  // 5) Separation & spacing
  applySeparation(State.match.homeDynamic);
  applySeparation(State.match.awayDynamic);
  avoidBallCrowding();

  // 6) Movement & ball
  movePlayers(stepSec);
  updateBall(stepSec);

  // 7) Tackles (chase dahil)
  resolveTackles();

  // 8) Stamina
  staminaTick(stepSec);
}

// ------------------------ Interchange ------------------------
function attemptInterchange(){
  const mut = arr=>{
    const am=arr.find(p=>p.role==='AM');
    const wgs=arr.filter(p=>p.role==='WG');
    if(am&&wgs.length){
      const w=wgs[Math.floor(Math.random()*wgs.length)];
      const tx=am.fx, ty=am.fy;
      am.fx=w.fx+(Math.random()*24-12); am.fy=w.fy+(Math.random()*24-12);
      w.fx=tx+(Math.random()*24-12); w.fy=ty+(Math.random()*24-12);
    }
    const dm=arr.find(p=>p.role==='DM'); const cb=arr.find(p=>p.role==='CB');
    if(dm&&cb&&Math.random()<0.5){
      dm.fx=dm.fx*0.7+cb.fx*0.3; dm.fy=dm.fy*0.7+cb.fy*0.3+(Math.random()*16-8);
    }
  };
  mut(State.match.homeDynamic); mut(State.match.awayDynamic);
}

// ------------------------ Ball Chaser Selection ------------------------
function selectBallChasers(){
  const ball=State.match.ball;
  const carrier=ball.carrier;
  // reset chase flags
  ['homeDynamic','awayDynamic'].forEach(group=>{
    for(const p of State.match[group]){
      p.ai.chase=false; p.ai.support=false;
    }
  });
  if(carrier){
    // Takım topu taşıyor -> rakip chaser seçecek
    const carrierTeamHome = State.match.homeDynamic.includes(carrier);
    const defArr = carrierTeamHome? State.match.awayDynamic : State.match.homeDynamic;
    const tac = carrierTeamHome? TACTICS[State.opponent.tactic] : TACTICS[State.tactic];
    const maxPrimary = (tac.pressIntensity>0.8)? 2+(State.match.counterStateTimer>0?1:0) : 2;
    const sorted = defArr.filter(p=>p.playerRef).map(p=>{
      const d=dist(p.x,p.y, carrier.x,carrier.y);
      const roleW=ROLES[p.role].chaseWeight;
      // Taktiksel mod: park'ta chaseWeight düşür, gegen'de yükselt
      let mod=1;
      if(tac===TACTICS['park']) mod*=0.7;
      if(tac===TACTICS['gegen']) mod*=1.2;
      return {p,score:(roleW*mod)/(d+1)};
    }).sort((a,b)=>b.score-a.score);
    const primary=sorted.slice(0,maxPrimary);
    primary.forEach(o=>o.p.ai.chase=true);
    // Support shadow: sıradaki 1
    const support = sorted.slice(maxPrimary,maxPrimary+1);
    support.forEach(o=>o.p.ai.support=true);
    State.match.chaseState[carrierTeamHome?'away':'home']={primary:primary.map(o=>o.p),support:support.map(o=>o.p)};
  } else {
    // Top serbest -> her iki taraftan sınırlı chaser
    const all=[...State.match.homeDynamic,...State.match.awayDynamic].filter(p=>p.playerRef);
    all.sort((a,b)=> dist(a.x,a.y,ball.x,ball.y)-dist(b.x,b.y,ball.x,ball.y));
    // İlk 4 aday -> iki takım limitli
    let homeCount=0, awayCount=0, homeLimit=2, awayLimit=2;
    for(const p of all){
      const isHome = State.match.homeDynamic.includes(p);
      if(isHome && homeCount<homeLimit){ p.ai.chase=true; homeCount++; }
      else if(!isHome && awayCount<awayLimit){ p.ai.chase=true; awayCount++; }
      else p.ai.chase=false;
    }
  }
}

// ------------------------ Tactical Target Generation ------------------------
function updateTacticalTargets(){
  const homeTac=TACTICS[State.tactic], awayTac=TACTICS[State.opponent.tactic];
  const counterBoostHome = State.match.counterStateTimer>0 && homeTac===TACTICS['counter'];
  const counterBoostAway = State.match.counterStateTimer>0 && awayTac===TACTICS['counter'];

  const applyShape = (arr, isAttacking, tac, counterBoost)=>{
    for(const p of arr){
      if(!p.ai) continue;
      // chaser ise hedef top (veya taşıyan)
      const b=State.match.ball;
      if(p.ai.chase){
        const targetX = b.carrier? b.carrier.x : b.x;
        const targetY = b.carrier? b.carrier.y : b.y;
        p.tx = targetX + (Math.random()*14 -7);
        p.ty = targetY + (Math.random()*14 -7);
        p.ai.targetTTL = 0.18 + Math.random()*0.15;
        continue;
      }
      // support (yakın ama topa değil açılma)
      if(p.ai.support){
        p.tx = p.x + (Math.random()*30 -15);
        p.ty = p.y + (Math.random()*30 -15);
        p.ai.targetTTL = 0.25 + Math.random()*0.2;
        continue;
      }

      const anchorX=p.fx; const anchorY=p.fy;
      let advance = tac.lineHeight*120;
      if(isAttacking){
        advance += (p.role==='ST'?45: p.role==='AM'?30: p.role==='WG'?26: p.role==='DM'?14: p.role==='FB'?12:0);
        if(counterBoost && ['ST','AM','WG'].includes(p.role)) advance += 30; // kontra ekstra ileri
      } else {
        advance -= (p.role==='CB'?32: p.role==='FB'?24: p.role==='DM'?20: 12);
      }

      // Roam
      const baseRoam = p.roamRadius;
      const roamRadius = baseRoam*(0.35 + tac.wingBias*0.25 + (counterBoost?0.3:0) - tac.passBias*0.15);
      const angle=Math.random()*Math.PI*2;
      const distRoam = Math.random()*roamRadius;
      let rx=Math.cos(angle)*distRoam;
      let ry=Math.sin(angle)*distRoam;
      if(p.role==='WG') rx *= (1 + tac.wingBias*0.5);
      if(p.role==='CB') rx *= 0.5; // stoper daha sınırlı

      let targetX = anchorX + advance + rx;
      let targetY = anchorY + ry;
      targetX = clamp(targetX,20,canvas.width-20);
      targetY = clamp(targetY,20,canvas.height-20);

      // Carrier ise jitter
      if(State.match.ball.carrier===p && !State.match.ball.target){
        targetX = clamp(p.x + (Math.random()*24 -12),20,canvas.width-20);
        targetY = clamp(p.y + (Math.random()*24 -12),20,canvas.height-20);
      }

      p.tx=targetX; p.ty=targetY;
      p.ai.targetTTL = 0.35 + Math.random()*0.4;
    }
  };

  const attackingSide = State.match.possession;
  applyShape(State.match.homeDynamic, attackingSide==='home', homeTac, counterBoostHome);
  applyShape(State.match.awayDynamic, attackingSide==='away', awayTac, counterBoostAway);
}

// ------------------------ Pressing & Marking ------------------------
function updatePressingAndMarking(){
  const b=State.match.ball; const carrier=b.carrier;
  if(!carrier) return;
  const carrierTeamHome = State.match.homeDynamic.includes(carrier);
  const defArr = carrierTeamHome? State.match.awayDynamic : State.match.homeDynamic;
  const defTac = carrierTeamHome? TACTICS[State.opponent.tactic] : TACTICS[State.tactic];

  if(defTac.pressIntensity<0.25){
    // Park / düşük pres -> marking daha derin
    for(const d of defArr){
      if(d.ai.chase) continue;
      const goalX = carrierTeamHome? canvas.width-8 : 8;
      const goalY = canvas.height/2;
      const mx = (carrier.x*0.55 + goalX*0.45) + (Math.random()*24 -12);
      const my = (carrier.y*0.55 + goalY*0.45) + (Math.random()*24 -12);
      d.tx = clamp(mx,20,canvas.width-20);
      d.ty = clamp(my,20,canvas.height-20);
    }
  } else {
    // Yüksek pres: chase seçildi zaten; chase olmayanlar pas açılarını kapatır
    for(const d of defArr){
      if(d.ai.chase || d.ai.support) continue;
      // Pas istasyonu olabilecek yakın arkadaşlara göre konumlan
      const carrierTeam = carrierTeamHome? State.match.homeDynamic : State.match.awayDynamic;
      // En kısa iki potansiyel pas istasyonu
      const options = carrierTeam.filter(p=>p!==carrier && p.playerRef)
        .map(p=>({p,distance:dist(p.x,p.y,carrier.x,carrier.y)}))
        .sort((a,b)=>a.distance-b.distance).slice(0,2);
      if(options.length){
        const midX = options.reduce((acc,o)=>acc+o.p.x, carrier.x)/(options.length+1);
        const midY = options.reduce((acc,o)=>acc+o.p.y, carrier.y)/(options.length+1);
        // Pas üçgeninin içine girip açı daralt
        d.tx = clamp(midX + (Math.random()*18 -9),20,canvas.width-20);
        d.ty = clamp(midY + (Math.random()*18 -9),20,canvas.height-20);
      }
    }
  }
}

// ------------------------ Support Arcs ------------------------
function updateSupportArcs(){
  const ball=State.match.ball; const carrier=ball.carrier;
  if(!carrier) return;
  const teamArr = State.match.homeDynamic.includes(carrier)? State.match.homeDynamic : State.match.awayDynamic;
  // Already chasing ones excluded
  const viable = teamArr.filter(p=>p!==carrier && p.playerRef && !p.ai.chase);
  // Score by passing attribute & spacing
  const scored = viable.map(p=>{
    const d=dist(p.x,p.y, carrier.x,carrier.y);
    const passAttr = p.playerRef.passing||50;
    const angleCarrierGoal = Math.atan2((canvas.height/2)-carrier.y,(canvas.width/2)-carrier.x);
    const angleCP = Math.atan2(p.y-carrier.y,p.x-carrier.x);
    const angleDiff=Math.abs(angleCarrierGoal-angleCP);
    return {p,score:(passAttr/100)*1.0 + (1-angleDiff/Math.PI)*0.4 - (d<30?0.3:0)};
  }).sort((a,b)=>b.score-a.score).slice(0,2);

  for(const o of scored){
    o.p.ai.support=true;
    // Support arc: carrier + goal yönünde hafif açı
    const dirX = (canvas.width/2 - carrier.x);
    const dirY = (canvas.height/2 - carrier.y);
    const baseLen = 60 + Math.random()*30;
    const norm = Math.hypot(dirX,dirY)||1;
    const arcX = carrier.x + (dirX/norm)*baseLen + (Math.random()*30 -15);
    const arcY = carrier.y + (dirY/norm)*baseLen + (Math.random()*30 -15);
    o.p.tx = clamp(arcX,20,canvas.width-20);
    o.p.ty = clamp(arcY,20,canvas.height-20);
  }
}

// ------------------------ Separation & Crowd Avoidance ------------------------
function applySeparation(arr){
  for(let i=0;i<arr.length;i++){
    const a=arr[i];
    for(let j=i+1;j<arr.length;j++){
      const b=arr[j];
      const dx=a.x-b.x, dy=a.y-b.y;
      const d=Math.hypot(dx,dy);
      const minDist = (ROLES[a.role].spacing + ROLES[b.role].spacing)*0.5;
      if(d<minDist && d>0){
        const push=(minDist-d)*0.35;
        a.x += (dx/d)*push; a.y += (dy/d)*push;
        b.x -= (dx/d)*push; b.y -= (dy/d)*push;
      }
    }
  }
}

function avoidBallCrowding(){
  const b=State.match.ball;
  const all=[...State.match.homeDynamic,...State.match.awayDynamic];
  const close=all.filter(p=>dist(p.x,p.y,b.x,b.y)<32);
  if(close.length>3){
    for(const p of close){
      if(p.ai.chase) continue; // chaser kalabilir
      // hafif geri/yan kaçış
      const dirAngle = Math.atan2(p.y-b.y,p.x-b.x)+ (Math.random()*Math.PI/3 - Math.PI/6);
      const escape=24;
      p.tx = clamp(p.x + Math.cos(dirAngle)*escape,20,canvas.width-20);
      p.ty = clamp(p.y + Math.sin(dirAngle)*escape,20,canvas.height-20);
      p.ai.targetTTL = 0.2 + Math.random()*0.2;
    }
  }
}

// ------------------------ Events & Decisions ------------------------
function decideEvents(){
  const attacker=State.match.possession;
  setText('#possession',`Topa sahip: ${attacker==='home'?'Biz':'Rakip'}`);
  if(!State.match.ball.carrier) assignLooseBallCarrier();
  if(!State.match.ball.carrier) return;

  const homeTac=TACTICS[State.tactic], awayTac=TACTICS[State.opponent.tactic];
  const tac=attacker==='home'? homeTac:awayTac;
  const oppTac=attacker==='home'? awayTac:homeTac;
  const {atk,def}=computeTeamsPower(attacker);
  const diff=atk-def;
  const minuteFactor=State.match.minute/State.match.maxMinute;

  let shotProb=clamp(0.09 + diff*0.0016 + minuteFactor*0.22 + tac.riskFactor*0.15,0.05,0.55);
  shotProb *= (1 - oppTac.busFactor*0.35);
  let passProb=clamp(tac.passBias*0.65 + (1 - shotProb)*0.45,0.28,0.8);

  const pressure=underPressure(State.match.ball.carrier,attacker);
  if(pressure){ shotProb*=0.75; passProb=clamp(passProb+0.18,0.28,0.9); }

  if(attacker==='home'&&State.match.counterStateTimer>0 && homeTac===TACTICS['counter']) shotProb=clamp(shotProb+0.12,0.05,0.65);
  if(attacker==='away'&&State.match.counterStateTimer>0 && awayTac===TACTICS['counter']) shotProb=clamp(shotProb+0.12,0.05,0.65);

  let action='hold'; const r=Math.random();
  if(r<shotProb) action='shot';
  else if(r<shotProb + passProb) action='pass';
  else {
    if(tac.wingBias>0.75 && canAttemptCross(attacker)) action='cross';
    else if(tac.passBias>0.8 && Math.random()<0.5) action='through';
    else if(tac.counterTrigger>0.75 && Math.random()<0.55) action='space_pass';
  }

  setText('#xgInfo', `Atak farkı: ${diff.toFixed(1)} · Baskı:${pressure?'Evet':'Hayır'}`);
  updateTacticLabels();

  if(action==='shot') attemptShot(attacker,diff);
  else if(action==='pass') attemptSmartPass(attacker);
  else if(action==='cross') attemptCross(attacker);
  else if(action==='through') attemptThroughBall(attacker);
  else if(action==='space_pass') attemptSpacePass(attacker);
}

function underPressure(carrier,team){
  const oppArr=team==='home'? State.match.awayDynamic:State.match.homeDynamic;
  let closest=Infinity;
  for(const o of oppArr){ if(!o.playerRef) continue; const d=dist(o.x,o.y,carrier.x,carrier.y); if(d<closest) closest=d; }
  return closest<26;
}

function assignLooseBallCarrier(){
  const ball=State.match.ball;
  const all=[...State.match.homeDynamic,...State.match.awayDynamic].filter(p=>p.playerRef);
  all.sort((a,b)=>dist(a.x,a.y,ball.x,ball.y)-dist(b.x,b.y,ball.x,ball.y));
  const candidates=all.slice(0,5);
  // Role öncelik + mesafe
  const priority=['AM','DM','ST','WG','FB','CB'];
  candidates.sort((a,b)=>priority.indexOf(a.role)-priority.indexOf(b.role));
  const chosen=candidates[0];
  if(chosen){
    ball.carrier=chosen;
    State.match.possession = State.match.homeDynamic.includes(chosen)?'home':'away';
    updateCarrierInfo();
    const tac = State.match.possession==='home'? TACTICS[State.tactic]: TACTICS[State.opponent.tactic];
    if(tac.counterTrigger>0.75){
      const progress = State.match.possession==='home'? chosen.x/canvas.width : (canvas.width-chosen.x)/canvas.width;
      if(progress<0.4){ State.match.counterStateTimer=3.2; logEvent('Kontra fırsatı!'); }
    }
  }
}

// ------------------------ Pass Variants ------------------------
function attemptSmartPass(team){
  const arr = team==='home'? State.match.homeDynamic:State.match.awayDynamic;
  const opp = team==='home'? State.match.awayDynamic:State.match.homeDynamic;
  const carrier=State.match.ball.carrier; if(!carrier) return;
  const candidates=arr.filter(p=>p!==carrier && p.playerRef && !p.ai.chase);
  if(!candidates.length) return;

  const goalX=team==='home'? canvas.width:0, goalY=canvas.height/2;
  const scored=candidates.map(p=>{
    const d=dist(carrier.x,carrier.y,p.x,p.y);
    const progress=team==='home'? (p.x/canvas.width):((canvas.width-p.x)/canvas.width);
    const a1=Math.atan2(goalY-carrier.y,goalX-carrier.x);
    const a2=Math.atan2(goalY-p.y,goalX-p.x);
    const aDiff=Math.abs(a1-a2);
    const passAttr=p.playerRef.passing||50;
    const spacingPenalty=d<34?(34-d)*0.02:0;
    return {p,score:progress*1.1 + (1-aDiff/Math.PI)*0.55 + (passAttr/100)*0.9 - spacingPenalty};
  }).sort((a,b)=>b.score-a.score);

  const target=scored[0].p;
  const intercept = opp.some(o=>pointLineDistance(o.x,o.y,carrier.x,carrier.y,target.x,target.y)<24)&&Math.random()<0.28;

  if(intercept){
    logEvent('Pas kesildi!');
    let best=null,bestD=1e9;
    for(const o of opp){ if(!o.playerRef) continue; const d=dist(o.x,o.y,carrier.x,carrier.y); if(d<bestD){bestD=d;best=o;} }
    if(best){ State.match.ball.carrier=best; State.match.possession = team==='home'?'away':'home'; updateCarrierInfo(); }
  } else {
    logEvent('Pas');
    State.match.ball.carrier=null;
    const dPass=dist(carrier.x,carrier.y,target.x,target.y);
    const passSpeed=Math.min(30,18 + dPass/35);
    State.match.ball.target={x:target.x,y:target.y,type:'pass',speed:passSpeed};
    State.match.ball.travelSteps=Math.ceil(dPass/passSpeed)+5;
    State.match.ball.onArrive=()=>{
      State.match.ball.carrier=target;
      State.match.possession=team;
      updateCarrierInfo();
      if(target.ai) target.ai.runTimer=0.8+Math.random()*0.8;
    };
  }
}

function canAttemptCross(team){
  const arr=team==='home'? State.match.homeDynamic:State.match.awayDynamic;
  return arr.some(p=>p.role==='WG' && ((team==='home'? p.x : (canvas.width-p.x))/canvas.width)>0.6 && Math.abs(p.y - canvas.height/2) < canvas.height*0.35);
}
function attemptCross(team){
  const arr=team==='home'? State.match.homeDynamic:State.match.awayDynamic;
  const carrier=State.match.ball.carrier; if(!carrier) return;
  const winger=arr.find(p=>p===carrier && p.role==='WG'); if(!winger){ attemptSmartPass(team); return; }
  const targets=arr.filter(p=>p.playerRef && (p.role==='ST'||p.role==='AM'));
  if(!targets.length){ attemptSmartPass(team); return; }
  const target=targets[Math.floor(Math.random()*targets.length)];
  logEvent('Orta!');
  State.match.ball.carrier=null;
  const apexX=target.x, apexY=target.y+(Math.random()*36-18);
  const dPass=dist(carrier.x,carrier.y,apexX,apexY);
  State.match.ball.target={x:apexX,y:apexY,type:'cross'};
  State.match.ball.travelSteps=Math.ceil(dPass/26)+4;
  State.match.ball.onArrive=()=>{
    const opp=team==='home'? State.match.awayDynamic:State.match.homeDynamic;
    const closeDef=opp.filter(o=>dist(o.x,o.y,target.x,target.y)<30).length;
    let headerScore=((target.playerRef.attack||50)*0.55+(target.playerRef.physical||50)*0.45)/100;
    headerScore *= closeDef>0?0.7:1.1;
    const goal=Math.random()<headerScore*0.38;
    finishAttack(team,goal,'Orta sonrası');
  };
}

function attemptThroughBall(team){
  const arr=team==='home'? State.match.homeDynamic:State.match.awayDynamic;
  const carrier=State.match.ball.carrier; if(!carrier) return;
  const runners=arr.filter(p=>p!==carrier && p.playerRef && ['ST','WG','AM'].includes(p.role));
  if(!runners.length){ attemptSmartPass(team); return; }
  runners.sort((a,b)=>{
    const progA=team==='home'? (a.x/canvas.width):((canvas.width-a.x)/canvas.width);
    const progB=team==='home'? (b.x/canvas.width):((canvas.width-b.x)/canvas.width);
    return progB-progA;
  });
  const target=runners[0];
  logEvent('Ara pası!');
  State.match.ball.carrier=null;
  const lead=team==='home'?46:-46;
  const passX=clamp(target.x+lead,20,canvas.width-20);
  const passY=clamp(target.y+(Math.random()*26-13),20,canvas.height-20);
  const dPass=dist(carrier.x,carrier.y,passX,passY);
  State.match.ball.target={x:passX,y:passY,type:'through'};
  State.match.ball.travelSteps=Math.ceil(dPass/28)+5;
  State.match.ball.onArrive=()=>{
    const dRunner=dist(target.x,target.y,passX,passY);
    if(dRunner<60){ State.match.ball.carrier=target; State.match.possession=team; updateCarrierInfo(); if(Math.random()<0.35) attemptShot(team,0); }
    else assignLooseBallCarrier();
  };
}

function attemptSpacePass(team){
  const arr=team==='home'? State.match.homeDynamic:State.match.awayDynamic;
  const carrier=State.match.ball.carrier; if(!carrier) return;
  const runners=arr.filter(p=>p!==carrier && p.playerRef && ['ST','AM','WG'].includes(p.role));
  if(!runners.length){ attemptSmartPass(team); return; }
  const target=runners[Math.floor(Math.random()*runners.length)];
  logEvent('Boşluğa uzun top!');
  State.match.ball.carrier=null;
  const dir=team==='home'?1:-1;
  const passX=clamp(target.x+dir*(90+Math.random()*50),20,canvas.width-20);
  const passY=clamp(target.y+(Math.random()*60-30),20,canvas.height-20);
  const dPass=dist(carrier.x,carrier.y,passX,passY);
  State.match.ball.target={x:passX,y:passY,type:'space'};
  State.match.ball.travelSteps=Math.ceil(dPass/32)+5;
  State.match.ball.onArrive=()=>{
    const dRunner=dist(target.x,target.y,passX,passY);
    if(dRunner<75){ State.match.ball.carrier=target; State.match.possession=team; updateCarrierInfo(); State.match.counterStateTimer=3.0; }
    else assignLooseBallCarrier();
  };
}

// ------------------------ Finish Attack / Kickoff ------------------------
function finishAttack(team,goal,label){
  if(goal){
    if(team==='home') State.match.score.home++;
    else State.match.score.away++;
    setText('#score', `${State.match.score.home} - ${State.match.score.away}`);
    logEvent(`${label} gol!`);
  } else logEvent(`${label} sonuçsuz.`);
  const next=team==='home'?'away':'home';
  State.match.ball.target=null; State.match.ball.carrier=null;
  assignKickoff(next);
}

// ------------------------ Shot ------------------------
function attemptShot(team,diff){
  const carrier=State.match.ball.carrier; if(!carrier) return;
  const tac=team==='home'? TACTICS[State.tactic]:TACTICS[State.opponent.tactic];
  const oppTac=team==='home'? TACTICS[State.opponent.tactic]:TACTICS[State.tactic];
  const attackStat=carrier.playerRef?carrier.playerRef.attack:60;
  const progress=team==='home'? carrier.x/canvas.width : (canvas.width-carrier.x)/canvas.width;
  let xg=0.11 + diff*0.003 + (attackStat/200) + progress*0.2 + tac.riskFactor*0.12 + randn()*0.02;
  xg *= (1 - oppTac.busFactor*0.5);
  xg=clamp(xg,0.06,0.72);
  const goalAttempt=Math.random()<xg;
  logEvent(`Şut! xG ${xg.toFixed(2)} ${goalAttempt?'(Gol denemesi)':''}`);

  const gx=team==='home'? canvas.width-12:12;
  const gy=canvas.height/2 + (Math.random()*120-60);
  State.match.ball.carrier=null;
  State.match.ball.target={x:gx,y:gy,type:'shot',goal:goalAttempt,xg};
  State.match.ball.travelSteps=25;
  State.match.ball.onArrive=()=>{
    const defenders=team==='home'? State.match.awayDynamic:State.match.homeDynamic;
    const blocked=defenders.some(d=>pointLineDistance(d.x,d.y,carrier.x,carrier.y,gx,gy)<22)&&Math.random()<0.30 + tac.riskFactor*0.1;
    if(blocked){
      logEvent('Şut bloklandı!');
      State.match.ball.x = carrier.x + (Math.random()*80 -40);
      State.match.ball.y = carrier.y + (Math.random()*60 -30);
      State.match.ball.target=null; assignLooseBallCarrier(); return;
    }
    finishAttack(team,goalAttempt,'Şut');
  };
}

// ------------------------ Power Calculations ------------------------
function computeTeamsPower(attacker){
  const home=getHomeLineupResolved().filter(x=>x.player);
  const away=State.opponent.lineup.filter(x=>x.player);
  const atkRoles=['ST','WG','AM'], defRoles=['CB','FB','DM'];
  const sum=(arr,roles)=>arr.filter(x=>roles.includes(x.role))
    .reduce((a,c)=>a+effectiveRating(c.player,c.role),0);
  let atk,def;
  if(attacker==='home'){ atk=sum(home,atkRoles); def=sum(away,defRoles); }
  else { atk=sum(away,atkRoles); def=sum(home,defRoles); }
  atk+=randn()*3; def+=randn()*3;
  return {atk,def};
}
function effectiveRating(player,role){
  if(!player) return 0;
  const w=ROLES[role].weights; let s=0;
  for(const k of Object.keys(w)) s+=(player[k]||0)*w[k];
  if(player.pref===role) s*=1.05;
  return s;
}

// ------------------------ Movement & Ball ------------------------
function movePlayers(stepSec){
  const all=[...State.match.homeDynamic,...State.match.awayDynamic];
  for(const p of all){
    const dx=p.tx-p.x, dy=p.ty-p.y; const d=Math.hypot(dx,dy);
    if(d>0.2){
      const staminaFactor=0.55 + (p.stamina||100)/100*0.45;
      const base=130 + (p.speedBonus||0)*75;
      const v=base*staminaFactor;
      const move=Math.min(v*stepSec,d);
      p.x += (dx/d)*move; p.y += (dy/d)*move;
    }
  }
  if(State.match.ball.carrier && !State.match.ball.target){
    State.match.ball.x=State.match.ball.carrier.x;
    State.match.ball.y=State.match.ball.carrier.y;
  }
}

function updateBall(stepSec){
  const ball=State.match.ball;
  if(!ball.target) return;
  const dx=ball.target.x-ball.x, dy=ball.target.y-ball.y, d=Math.hypot(dx,dy);
  if(d>0.1){
    let speed=24;
    switch(ball.target.type){
      case 'shot': speed=38; break;
      case 'pass': speed=ball.target.speed||28; break;
      case 'cross': speed=30; break;
      case 'through': speed=32; break;
      case 'space': speed=34; break;
    }
    const mv=Math.min(speed*stepSec,d);
    ball.x += (dx/d)*mv; ball.y += (dy/d)*mv;
    ball.travelSteps--;
    if(ball.travelSteps<=0 || d<12){
      const cb=ball.onArrive; ball.target=null; ball.onArrive=null;
      if(cb) cb();
    }
  } else {
    const cb=ball.onArrive; ball.target=null; ball.onArrive=null; if(cb) cb();
  }
}

// ------------------------ Tackles / Steals ------------------------
function resolveTackles(){
  const carrier=State.match.ball.carrier; if(!carrier) return;
  const team=State.match.homeDynamic.includes(carrier)?'home':'away';
  const opp=team==='home'? State.match.awayDynamic:State.match.homeDynamic;
  const oppTac=team==='home'? TACTICS[State.opponent.tactic]: TACTICS[State.tactic];

  for(const o of opp){
    if(!o.playerRef) continue;
    const d=dist(o.x,o.y,carrier.x,carrier.y);
    if(d<23){
      const pressFactor=oppTac.pressIntensity;
      const defPower=(o.playerRef.defense*0.4 + o.playerRef.physical*0.6);
      const attSecure=(carrier.playerRef.passing*0.5 + carrier.playerRef.speed*0.3);
      let tackleProb=clamp(0.2 + pressFactor*0.42 + (defPower - attSecure)*0.002,0.08,0.8);
      if(oppTac===TACTICS['gegen']) tackleProb=clamp(tackleProb+0.12,0,0.88);
      if(Math.random()<tackleProb){
        logEvent('Pres ile top kapıldı!');
        State.match.ball.carrier=o;
        State.match.possession = team==='home'? 'away':'home';
        updateCarrierInfo();
        const newTac = State.match.possession==='home'? TACTICS[State.tactic]: TACTICS[State.opponent.tactic];
        if(newTac.counterTrigger>0.75){ State.match.counterStateTimer=3.0; logEvent('Hızlı kontra!'); }
        break;
      }
    }
  }
}

// ------------------------ Stamina ------------------------
function staminaTick(stepSec){
  const homeTac=TACTICS[State.tactic], awayTac=TACTICS[State.opponent.tactic];
  applyStaminaDecay(State.match.homeDynamic,homeTac,stepSec);
  applyStaminaDecay(State.match.awayDynamic,awayTac,stepSec);
  if(State.match.counterStateTimer>0){
    State.match.counterStateTimer -= stepSec;
    const burst=3*stepSec;
    for(const p of [...State.match.homeDynamic,...State.match.awayDynamic])
      p.stamina=Math.max(0,(p.stamina||100)-burst*10);
  }
}
function applyStaminaDecay(arr,tac,stepSec){
  for(const p of arr){
    let dec=State.match.staminaDecayBase * tac.tempoFactor;
    dec += tac.pressIntensity * 0.18;
    if(p.ai.chase) dec += 0.25; // chase maliyeti
    if(State.match.ball.carrier && !arr.includes(State.match.ball.carrier)){
      const d=dist(p.x,p.y,State.match.ball.x,State.match.ball.y);
      if(d<130) dec += 0.06;
    }
    p.stamina=Math.max(0,(p.stamina||100)-dec*stepSec*100);
  }
}

// ------------------------ Utils ------------------------
function dist(x1,y1,x2,y2){ return Math.hypot(x1-x2,y1-y2); }
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a;}
function randn(){ return (Math.random()+Math.random()+Math.random()+Math.random()-2); }
function pointLineDistance(px,py,x1,y1,x2,y2){
  const A=px-x1,B=py-y1,C=x2-x1,D=y2-y1;
  const dot=A*C+B*D; const lenSq=C*C+D*D;
  let param=lenSq? dot/lenSq : -1;
  let xx,yy;
  if(param<0){xx=x1;yy=y1;}
  else if(param>1){xx=x2;yy=y2;}
  else {xx=x1+param*C; yy=y1+param*D;}
  return Math.hypot(px-xx,py-yy);
}

// ------------------------ Logging & Sidebars ------------------------
function logEvent(t){
  const log=$('#matchLog'); if(!log) return;
  const line=document.createElement('div');
  line.textContent=`${State.match.minute}' ${t}`;
  log.prepend(line);
}
function renderMatchSidebars(){
  setText('#homeName','Biz'); setText('#awayName',State.opponent.name);
  const my=getHomeLineupResolved(); const their=State.opponent.lineup;
  const ulH=$('#homeLineupList'), ulA=$('#awayLineupList');
  if(!ulH||!ulA) return;
  ulH.innerHTML=''; ulA.innerHTML='';
  for(const r of my){ const li=document.createElement('li'); li.textContent=`${r.role} - ${r.player? r.player.name : '—'}`; ulH.appendChild(li); }
  for(const r of their){ const li=document.createElement('li'); li.textContent=`${r.role} - ${r.player? r.player.name : '—'}`; ulA.appendChild(li); }
}
function updateCarrierInfo(){ setText('#carrierInfo','Top taşıyan: '+(State.match.ball.carrier?.playerRef?.name||'-')); }
function updateDebug(){
  const dbg=$('#debugInfo'); if(!dbg) return;
  const b=State.match.ball;
  dbg.textContent=`Dakika:${State.match.minute} | Skor:${State.match.score.home}-${State.match.score.away}
Taktikler: ${TACTICS[State.tactic].name} / ${TACTICS[State.opponent.tactic].name}
Counter:${State.match.counterStateTimer.toFixed(2)} | Ball:(${b.x.toFixed(1)},${b.y.toFixed(1)}) ${b.carrier?'[Taşıyan]':''} ${b.target?'[Hareket]':''}`;
}

// ------------------------ Canvas ------------------------
const canvas=$('#pitchCanvas'); const ctx=canvas.getContext('2d');
function setupCanvas(){ drawPitch(); }
function drawPitch(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#0a4d2a'; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.strokeStyle='rgba(255,255,255,0.6)'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(canvas.width/2,0); ctx.lineTo(canvas.width/2,canvas.height); ctx.stroke();
  ctx.beginPath(); ctx.arc(canvas.width/2, canvas.height/2, 60, 0, Math.PI*2); ctx.stroke();
  ctx.strokeStyle='rgba(255,255,255,0.85)';
  ctx.strokeRect(6,canvas.height*0.25,10,canvas.height*0.5);
  ctx.strokeRect(canvas.width-16,canvas.height*0.25,10,canvas.height*0.5);
}
function renderMatchFrame(){
  drawPitch();
  for(const pl of State.match.homeDynamic) drawPlayer(pl);
  for(const pl of State.match.awayDynamic) drawPlayer(pl);
  drawBall(State.match.ball.x,State.match.ball.y);
}
function drawPlayer(pl){
  const {x,y,playerRef,role}=pl;
  const isHome=State.match.homeDynamic.includes(pl);
  const color=isHome?'#60a5fa':'#f87171';
  ctx.fillStyle=color; ctx.beginPath(); ctx.arc(x,y,14,0,Math.PI*2); ctx.fill();
  if(State.match.ball.carrier===pl){ ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(x,y,18,0,Math.PI*2); ctx.stroke(); }
  if(playerRef){
    const frac=Math.max(0,(pl.stamina||100)/100);
    ctx.fillStyle='rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.arc(x,y,12,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='rgba(34,211,138,0.75)';
    ctx.beginPath(); ctx.moveTo(x,y);
    ctx.arc(x,y,12,-Math.PI/2,-Math.PI/2+frac*Math.PI*2,false);
    ctx.lineTo(x,y); ctx.fill();
  }
  ctx.fillStyle='#000'; ctx.beginPath(); ctx.arc(x,y,10,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#fff'; ctx.font='10px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(role,x,y);
  if(playerRef){ ctx.fillStyle='rgba(255,255,255,0.9)'; ctx.font='11px sans-serif'; ctx.fillText(playerRef.name.split(' ')[0], x, y-20); }
}
function drawBall(x,y){
  ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(x,y,6,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle='#000'; ctx.lineWidth=1; ctx.stroke();
}

// İlk çizim
renderMatchFrame();