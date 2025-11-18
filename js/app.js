// Volta Mini Menejer - Basit Prototip
// Not: Oyuncular db/players.json'dan fetch ile yüklenir.
// localStorage anahtarları:
const LS_KEYS = {
  roster: 'vmm_clubRoster',
  formation: 'vmm_formation',
  lineup: 'vmm_lineup'
};

// Roller ve ağırlıklar
const ROLES = {
  WG: {label: 'WG', weights: {speed: 0.6, attack: 0.4}},         // Kanat
  ST: {label: 'ST', weights: {attack: 0.6, physical: 0.4}},      // Forvet
  DM: {label: 'DM', weights: {defense: 0.6, passing: 0.4}},      // Ön Libero
  AM: {label: 'AM', weights: {attack: 0.5, passing: 0.5}},       // Ofansif Orta
  CB: {label: 'CB', weights: {defense: 0.6, physical: 0.4}},     // Stoper
  FB: {label: 'FB', weights: {speed: 0.5, defense: 0.5}},        // Bek
};

// Dizilişler: 5 oyunculuk slot ve sahadaki pozisyonları (taktik ekranı için)
const FORMATIONS = {
  // Her slot: {id, role, x, y}  x,y: % (0-100) pitch üzerinde (sol -> sağ, üst -> alt)
  '1-2-1': [
    { id: 'S1', role: 'CB', x: 18, y: 50 },
    { id: 'S2', role: 'DM', x: 35, y: 40 },
    { id: 'S3', role: 'AM', x: 55, y: 60 },
    { id: 'S4', role: 'WG', x: 65, y: 30 },
    { id: 'S5', role: 'ST', x: 80, y: 50 },
  ],
  '2-1-1': [
    { id: 'S1', role: 'CB', x: 18, y: 35 },
    { id: 'S2', role: 'FB', x: 18, y: 65 },
    { id: 'S3', role: 'AM', x: 45, y: 50 },
    { id: 'S4', role: 'WG', x: 65, y: 35 },
    { id: 'S5', role: 'ST', x: 80, y: 55 },
  ],
  '1-1-2': [
    { id: 'S1', role: 'CB', x: 18, y: 50 },
    { id: 'S2', role: 'DM', x: 35, y: 50 },
    { id: 'S3', role: 'WG', x: 55, y: 30 },
    { id: 'S4', role: 'WG', x: 55, y: 70 },
    { id: 'S5', role: 'ST', x: 80, y: 50 },
  ]
};

// Global durum
const State = {
  players: [],
  clubRoster: new Set(),  // playerId set
  formation: '1-2-1',
  lineup: {}, // {slotId: playerId}
  opponent: { name: 'Sokak Yıldızları', lineup: [] },

  match: {
    running: false,
    paused: false,
    minute: 0,
    maxMinute: 50,     // 5v5 için kısa maç
    tickMsBase: 800,
    intervalId: null,
    speed: 2,
    score: { home: 0, away: 0 },
    possession: 'home', // 'home' or 'away'
    ball: { x: 450, y: 270, vx: 0, vy: 0 },
  }
};

// DOM
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

// Nav & pages
document.addEventListener('click', (e) => {
  if (e.target.matches('.nav-btn')) {
    const target = e.target.getAttribute('data-target');
    setActivePage(target);
  }
});
$('#goNextMatch').addEventListener('click', () => setActivePage('#mac'));

function setActivePage(sel){
  $$('.page').forEach(p => p.classList.remove('active'));
  const el = document.querySelector(sel);
  if (el) el.classList.add('active');
}

// Load
init();

async function init(){
  await loadPlayers();
  loadFromStorageOrInit();
  bindUI();
  renderAll();
  setupCanvas();
}

async function loadPlayers(){
  const res = await fetch('./db/players.json');
  const data = await res.json();
  // normalize
  State.players = data.map(p => ({
    ...p,
    // ensure numbers
    attack: +p.attack, defense: +p.defense, speed: +p.speed, physical: +p.physical, passing: +p.passing
  }));
}

function loadFromStorageOrInit(){
  // club roster
  const savedRoster = localStorage.getItem(LS_KEYS.roster);
  if (savedRoster){
    State.clubRoster = new Set(JSON.parse(savedRoster));
  } else {
    // İlk kurulum: rastgele 10 oyuncuyu kulübe al
    const ids = State.players.map(p => p.id);
    shuffle(ids);
    const initial = ids.slice(0, 10);
    State.clubRoster = new Set(initial);
    saveRoster();
  }

  // formation
  const savedFormation = localStorage.getItem(LS_KEYS.formation);
  if (savedFormation && FORMATIONS[savedFormation]){
    State.formation = savedFormation;
  } else {
    saveFormation();
  }

  // lineup
  const savedLineup = localStorage.getItem(LS_KEYS.lineup);
  if (savedLineup){
    try {
      State.lineup = JSON.parse(savedLineup);
    } catch {
      State.lineup = {};
    }
  } else {
    State.lineup = {};
    saveLineup();
  }

  // build opponent from non-club players (veya kopya)
  buildOpponent();
}

function saveRoster(){ localStorage.setItem(LS_KEYS.roster, JSON.stringify([...State.clubRoster])); }
function saveFormation(){ localStorage.setItem(LS_KEYS.formation, State.formation); }
function saveLineup(){ localStorage.setItem(LS_KEYS.lineup, JSON.stringify(State.lineup)); }

function bindUI(){
  // formation change
  $('#formation').value = State.formation;
  $('#formation').addEventListener('change', (e) => {
    State.formation = e.target.value;
    saveFormation();
    // Mevcut slotlar değiştiyse olmayan slotları temizle
    const validSlots = new Set(FORMATIONS[State.formation].map(s => s.id));
    for (const k of Object.keys(State.lineup)){
      if (!validSlots.has(k)) delete State.lineup[k];
    }
    saveLineup();
    renderTactics();
  });

  // match controls
  $('#startMatch').addEventListener('click', startMatch);
  $('#pauseMatch').addEventListener('click', pauseMatch);
  $('#resetMatch').addEventListener('click', resetMatch);
  $('#speed').addEventListener('change', e => {
    State.match.speed = +e.target.value;
    if (State.match.running && !State.match.paused){
      restartInterval();
    }
  });
}

function renderAll(){
  renderTactics();
  renderTransfer();
  renderMatchSidebars();
}

// ===== Taktik Ekranı =====
function renderTactics(){
  renderSquadList();
  renderPitchSlots();
}

function renderSquadList(){
  const list = $('#squadList');
  list.innerHTML = '';

  const usedPlayers = new Set(Object.values(State.lineup));
  const clubPlayers = State.players.filter(p => State.clubRoster.has(p.id) && !usedPlayers.has(p.id));

  for (const p of clubPlayers){
    const el = document.createElement('div');
    el.className = 'player-card';
    el.draggable = true;
    el.dataset.playerId = p.id;
    el.addEventListener('dragstart', onDragStart);

    el.innerHTML = `
      <div class="info">
        <div class="name">${p.name}</div>
        <div class="pos">Tercih: ${p.pref}</div>
        <div class="atts">Atak ${p.attack} · Def ${p.defense} · Hız ${p.speed} · Fizik ${p.physical} · Pas ${p.passing}</div>
      </div>
      <div class="actions">
        <span class="btn" title="Sürükle ve sahaya bırak">↔</span>
      </div>
    `;
    list.appendChild(el);
  }
}

function renderPitchSlots(){
  const pitch = $('#pitch');
  pitch.innerHTML = '';
  const slots = FORMATIONS[State.formation];

  for (const slot of slots){
    const dz = document.createElement('div');
    dz.className = 'dropzone';
    dz.style.left = `calc(${slot.x}% - 47px)`;
    dz.style.top = `calc(${slot.y}% - 47px)`;
    dz.dataset.slotId = slot.id;
    dz.dataset.role = slot.role;
    dz.addEventListener('dragover', e => e.preventDefault());
    dz.addEventListener('drop', onDropPlayer);

    const assignedId = State.lineup[slot.id];
    if (assignedId){
      const p = State.players.find(x => x.id === assignedId);
      dz.classList.add('filled');
      dz.innerHTML = `
        <button class="drop-remove" title="Kaldır">×</button>
        <div style="text-align:center">
          <div>${ROLES[slot.role].label}</div>
          <div style="font-size:12px">${p.name}</div>
        </div>
      `;
      dz.querySelector('.drop-remove').addEventListener('click', () => {
        delete State.lineup[slot.id];
        saveLineup();
        renderTactics();
      });
    } else {
      dz.textContent = ROLES[slot.role].label;
    }
    pitch.appendChild(dz);
  }
}

function onDragStart(e){
  const pid = e.currentTarget.dataset.playerId;
  e.dataTransfer.setData('text/playerId', pid);
}
function onDropPlayer(e){
  e.preventDefault();
  const playerId = e.dataTransfer.getData('text/playerId');
  if (!playerId) return;
  // Oyuncu kulüpte mi?
  const pid = Number(playerId);
  if (!State.clubRoster.has(pid)) return;

  // Aynı oyuncu başka slottaysa önce kaldır
  for (const k of Object.keys(State.lineup)){
    if (State.lineup[k] === pid) delete State.lineup[k];
  }

  // Bırakılan slota ata
  const slotId = e.currentTarget.dataset.slotId;
  State.lineup[slotId] = pid;
  saveLineup();
  renderTactics();
}

// ===== Transfer Ekranı =====
function renderTransfer(){
  const clubBox = $('#clubRoster');
  const faBox = $('#freeAgents');
  clubBox.innerHTML = '';
  faBox.innerHTML = '';

  const clubPlayers = State.players.filter(p => State.clubRoster.has(p.id));
  const freePlayers = State.players.filter(p => !State.clubRoster.has(p.id));

  for (const p of clubPlayers){
    const card = playerCard(p, [
      button('Serbest Bırak', 'btn btn-danger', () => {
        // Eğer kadroda pozisyona yerleştirilmişse çıkar
        for (const k of Object.keys(State.lineup)){
          if (State.lineup[k] === p.id) delete State.lineup[k];
        }
        State.clubRoster.delete(p.id);
        saveRoster(); saveLineup();
        renderAll();
      })
    ]);
    clubBox.appendChild(card);
  }

  for (const p of freePlayers){
    const card = playerCard(p, [
      button('Sözleşme İmzala', 'btn btn-ok', () => {
        State.clubRoster.add(p.id);
        saveRoster();
        renderAll();
      })
    ]);
    faBox.appendChild(card);
  }
}

function playerCard(p, actions = []){
  const el = document.createElement('div');
  el.className = 'player-card';
  el.innerHTML = `
    <div class="info">
      <div class="name">${p.name}</div>
      <div class="pos">Tercih: ${p.pref}</div>
      <div class="atts">Atak ${p.attack} · Def ${p.defense} · Hız ${p.speed} · Fizik ${p.physical} · Pas ${p.passing}</div>
    </div>
    <div class="actions"></div>
  `;
  const act = el.querySelector('.actions');
  actions.forEach(a => act.appendChild(a));
  return el;
}
function button(text, cls, onClick){
  const b = document.createElement('button');
  b.className = cls + ' btn-sm';
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

// ===== Rakip Oluşturma =====
function buildOpponent(){
  const notClub = State.players.filter(p => !State.clubRoster.has(p.id));
  let pool = [...notClub];
  if (pool.length < 5){
    // yedek olarak kulüpte olmayan kopyalar
    pool = [...State.players];
  }
  shuffle(pool);

  // Basitçe aynı dizilişi kullan
  const pattern = FORMATIONS[State.formation].map(s => s.role);
  const lineup = [];
  for (const role of pattern){
    // role'e uygun birini bul, yoksa herhangi biri
    let idx = pool.findIndex(p => p.pref === role);
    if (idx === -1) idx = 0;
    lineup.push({ role, player: pool[idx] });
    pool.splice(idx, 1);
  }
  State.opponent.lineup = lineup;
}

// ===== Maç Motoru =====
const canvas = $('#pitchCanvas');
const ctx = canvas.getContext('2d');

// Sahadaki konumlar (canvas için) - ev ve deplasman yerleşimi
function getCanvasPositions(){
  const homeSlots = FORMATIONS[State.formation];
  const awaySlots = mirrorSlots(homeSlots);
  // Slot -> Koordinat
  const toXY = s => ({
    slotId: s.id,
    role: s.role,
    x: Math.round((s.x / 100) * canvas.width),
    y: Math.round((s.y / 100) * canvas.height)
  });
  return {
    home: homeSlots.map(toXY),
    away: awaySlots.map(toXY),
  };
}
function mirrorSlots(slots){
  // X'i ters çevirip rolü koru (rakip sağdan oynuyor)
  return slots.map((s, i) => ({
    id: 'A'+(i+1),
    role: s.role,
    x: 100 - s.x,
    y: s.y
  }));
}

function setupCanvas(){
  drawPitch();
}

function drawPitch(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  // Zemin
  ctx.fillStyle = '#0a4d2a';
  ctx.fillRect(0,0,canvas.width,canvas.height);

  // Orta çizgi ve orta yuvarlak
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(canvas.width/2,0);
  ctx.lineTo(canvas.width/2,canvas.height);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(canvas.width/2, canvas.height/2, 60, 0, Math.PI*2);
  ctx.stroke();

  // Kale çizgileri (sol/sağ)
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.strokeRect(6, canvas.height*0.25, 10, canvas.height*0.5);
  ctx.strokeRect(canvas.width-16, canvas.height*0.25, 10, canvas.height*0.5);
}

function renderMatchFrame(){
  drawPitch();

  const { home, away } = getCanvasPositions();

  // Kadroları çek
  const homeLine = getHomeLineupResolved();
  const awayLine = State.opponent.lineup;

  // Oyuncuları çiz (daire)
  for (let i=0;i<home.length;i++){
    const pos = home[i];
    const p = homeLine[i]?.player;
    drawPlayer(pos.x, pos.y, '#60a5fa', p?.name || '—', ROLES[pos.role].label);
  }
  for (let i=0;i<away.length;i++){
    const pos = away[i];
    const p = awayLine[i]?.player;
    drawPlayer(pos.x, pos.y, '#f87171', p?.name || '—', ROLES[pos.role].label);
  }

  // Top
  drawBall(State.match.ball.x, State.match.ball.y);
}

function drawPlayer(x,y,color,name,role){
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x,y,14,0,Math.PI*2);
  ctx.fill();

  // Role badge
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(x, y, 10, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(role, x, y);

  // Name
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(name, x, y-20);
}

function drawBall(x,y){
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(x,y,6,0,Math.PI*2);
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function getHomeLineupResolved(){
  // sıralamayı aktif formasyondaki slot sırasına göre yap
  const slots = FORMATIONS[State.formation];
  return slots.map(s => {
    const pid = State.lineup[s.id];
    const player = State.players.find(p => p.id === pid);
    return { role: s.role, player, slotId: s.id };
  });
}

function ensureLineupReady(){
  const slots = FORMATIONS[State.formation];
  for (const s of slots){
    const pid = State.lineup[s.id];
    if (!pid) return false;
  }
  return true;
}

function startMatch(){
  if (State.match.running && !State.match.paused) return;
  if (!ensureLineupReady()){
    alert('Lütfen 5 kişilik kadroyu sahaya yerleştir.');
    return;
  }
  // Rakibi güncelle (aynı dizilişi kullansın)
  buildOpponent();
  resetMatch(true);
  State.match.running = true;
  State.match.paused = false;
  logEvent('Maç başladı!');
  restartInterval();
}

function restartInterval(){
  if (State.match.intervalId) clearInterval(State.match.intervalId);
  const t = Math.max(80, State.match.tickMsBase / State.match.speed);
  State.match.intervalId = setInterval(tickMatch, t);
}

function pauseMatch(){
  if (!State.match.running) return;
  State.match.paused = !State.match.paused;
  if (State.match.paused){
    if (State.match.intervalId) clearInterval(State.match.intervalId);
    logEvent('Maç duraklatıldı.');
  } else {
    logEvent('Devam!');
    restartInterval();
  }
}

function resetMatch(keepLineups=false){
  if (State.match.intervalId) clearInterval(State.match.intervalId);
  State.match.running = false;
  State.match.paused = false;
  State.match.minute = 0;
  State.match.score = { home: 0, away: 0 };
  State.match.possession = Math.random()<0.5?'home':'away';
  const { home, away } = getCanvasPositions();
  State.match.ball = { x: canvas.width/2, y: canvas.height/2, vx:0, vy:0 };
  $('#score').textContent = '0 - 0';
  $('#matchMinute').textContent = "0'";
  $('#possession').textContent = 'Topa sahip: -';
  $('#xgInfo').textContent = 'Atak gücü: -';
  $('#matchLog').innerHTML = '';
  renderMatchSidebars();
  renderMatchFrame();
}

function logEvent(text){
  const log = $('#matchLog');
  const line = document.createElement('div');
  line.textContent = `${State.match.minute}' ${text}`;
  log.prepend(line);
}

function renderMatchSidebars(){
  $('#homeName').textContent = 'Biz';
  $('#awayName').textContent = State.opponent.name;

  const my = getHomeLineupResolved();
  const their = State.opponent.lineup;

  const ulH = $('#homeLineupList');
  const ulA = $('#awayLineupList');
  ulH.innerHTML = '';
  ulA.innerHTML = '';

  for (let i=0;i<my.length;i++){
    const r = my[i];
    const name = r.player ? r.player.name : '—';
    const li = document.createElement('li');
    li.textContent = `${r.role} - ${name}`;
    ulH.appendChild(li);
  }
  for (let i=0;i<their.length;i++){
    const r = their[i];
    const li = document.createElement('li');
    li.textContent = `${r.role} - ${r.player?.name ?? '—'}`;
    ulA.appendChild(li);
  }
}

// Etkinlik/Şut/Gol basit simülasyonu
function tickMatch(){
  if (State.match.paused) return;

  State.match.minute++;
  if (State.match.minute > State.match.maxMinute){
    if (State.match.intervalId) clearInterval(State.match.intervalId);
    State.match.running = false;
    logEvent(`Maç bitti! Skor: ${State.match.score.home} - ${State.match.score.away}`);
    return;
  }

  // Gösterge
  $('#matchMinute').textContent = `${State.match.minute}'`;

  // Oyun akışı: her dakikada olay olma ihtimali
  const eventChance = 0.6; // 5v5 hızlı
  if (Math.random() < eventChance){
    // Hangi takım hücum?
    const attacker = decidePossession();
    State.match.possession = attacker;
    $('#possession').textContent = `Topa sahip: ${attacker==='home'?'Biz':'Rakip'}`;

    // Hücum gücü ve savunma gücü
    const { atk, def } = computeTeamsPower(attacker);
    const diff = atk - def; // pozitifse avantaj
    const baseShotProb = clamp(0.12 + diff*0.002, 0.06, 0.45);
    const shot = Math.random() < baseShotProb;

    // xG
    let xg = 0;
    let goal = false;
    if (shot){
      xg = clamp(0.08 + diff*0.003 + randn()*0.02, 0.03, 0.6);
      goal = Math.random() < xg;
    }
    $('#xgInfo').textContent = `Atak gücü farkı: ${diff.toFixed(1)} · xG:${xg?xg.toFixed(2):'-'}`;

    // Animasyon: topu merkezden kaleye hareket ettir
    animateAttack(attacker, !!goal);

    if (shot){
      if (goal){
        if (attacker === 'home') State.match.score.home++;
        else State.match.score.away++;
        $('#score').textContent = `${State.match.score.home} - ${State.match.score.away}`;
        logEvent(`${attacker==='home'?'Bizden':'Rakipten'} gol! (xG ${xg.toFixed(2)})`);
        // Orta sahadan başla
        State.match.ball.x = canvas.width/2;
        State.match.ball.y = canvas.height/2;
        State.match.possession = attacker==='home'?'away':'home';
      } else {
        logEvent(`${attacker==='home'?'Biz':'Rakip'} şut çekti! (xG ${xg.toFixed(2)})`);
      }
    } else {
      // top kaybı vs
      if (Math.random() < 0.5) {
        State.match.possession = attacker==='home'?'away':'home';
      }
    }
  }

  renderMatchFrame();
}

function decidePossession(){
  // Orta alan hakimiyeti: AM+DM+WG ağırlıklı
  const my = getHomeLineupResolved().filter(x => !!x.player);
  const their = State.opponent.lineup;

  const midRoles = ['AM','DM','WG'];

  const myMid = my.filter(x => midRoles.includes(x.role))
    .reduce((a,cur)=>a + effectiveRating(cur.player, cur.role), 0);
  const thMid = their.filter(x => midRoles.includes(x.role))
    .reduce((a,cur)=>a + effectiveRating(cur.player, cur.role), 0);

  const total = myMid + thMid + 1e-6;
  const probHome = myMid / total;
  return Math.random() < probHome ? 'home' : 'away';
}

function computeTeamsPower(attacker){
  const my = getHomeLineupResolved().filter(x => !!x.player);
  const their = State.opponent.lineup;

  const atkRoles = ['ST','WG','AM'];
  const defRoles = ['CB','FB','DM'];

  const sumEffect = (arr, roles) =>
    arr.filter(x => roles.includes(x.role))
       .reduce((a,cur)=>a + effectiveRating(cur.player, cur.role), 0);

  let atk, def;
  if (attacker === 'home'){
    atk = sumEffect(my, atkRoles);
    def = sumEffect(their, defRoles);
  } else {
    atk = sumEffect(their, atkRoles);
    def = sumEffect(my, defRoles);
  }

  // ufak şans faktörü
  atk += randn()*3;
  def += randn()*3;

  return { atk, def };
}

function effectiveRating(player, role){
  if (!player) return 0;
  const w = ROLES[role].weights;
  let score = 0;
  for (const k of Object.keys(w)){
    score += (player[k]||0) * w[k];
  }
  // Tercih edilen rolde oynuyorsa küçük bonus
  if (player.pref === role) score *= 1.05;
  return score;
}

// Basit animasyon: topu hücum eden kaleye doğru kaydır
function animateAttack(attacker, goal){
  const targetX = attacker==='home' ? canvas.width-12 : 12;
  const targetY = canvas.height/2 + (Math.random()*120 - 60);
  const steps = 10;
  const dx = (targetX - State.match.ball.x)/steps;
  const dy = (targetY - State.match.ball.y)/steps;

  let c = 0;
  const id = setInterval(()=>{
    State.match.ball.x += dx;
    State.match.ball.y += dy;
    renderMatchFrame();
    c++;
    if (c>=steps){
      clearInterval(id);
      if (!goal){
        // top auta/kaleciye gitti, rastgele sektir
        State.match.ball.x = canvas.width/2 + (Math.random()*80 - 40);
        State.match.ball.y = canvas.height/2 + (Math.random()*80 - 40);
      } else {
        // gol olunca top orta sahaya
        State.match.ball.x = canvas.width/2;
        State.match.ball.y = canvas.height/2;
      }
      renderMatchFrame();
    }
  }, Math.max(20, 180/State.match.speed));
}

// ===== Util =====
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function shuffle(a){ for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
// Normal dağılım benzeri küçük gürültü
function randn(){ return (Math.random()+Math.random()+Math.random()+Math.random()-2); }

// ========== İlkleme sonunda ilk çizim ==========
renderMatchFrame();