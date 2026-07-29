const socket = io();
const $ = id => document.getElementById(id);
let mode = "home", code = "", hostToken = "", playerToken = "", playerId = "", state = null;
let timerLoop = null;
let catalog = [];
let activeRole = "ALL";
let selectedPlayer = null;
const params = new URLSearchParams(location.search);

function show(id) {
  document.querySelectorAll(".screen").forEach(x => x.classList.remove("active"));
  $(id).classList.add("active");
  mode = id;
}
function toast(text) {
  $("toast").textContent = text;
  $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 1600);
}
function vibrate(pattern=35){ if(navigator.vibrate) navigator.vibrate(pattern); }
function sound(kind){
  try{
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.connect(g);g.connect(ctx.destination);
    o.frequency.value=kind==="sold"?880:kind==="start"?520:680;
    g.gain.setValueAtTime(.13,ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.16);
    o.start();o.stop(ctx.currentTime+.16);
  }catch{}
}
function formatStatus(s){
  return ({waiting:"ATTESA",ready:"PRONTA",open:"APERTA",paused:"PAUSA",sold:"ASSEGNATA"})[s]||s;
}
function countdown(){
  if(!state || !state.endAt) return "—";
  return Math.max(0,(state.endAt-Date.now())/1000).toFixed(1);
}
function startTimer(){
  clearInterval(timerLoop);
  timerLoop=setInterval(()=>{
    const val=countdown();
    if(mode==="host") $("hostTimer").textContent=val;
    if(mode==="player") $("playerTimer").textContent=val;
  },80);
}
function renderHistory(el, history){
  el.innerHTML = history.length ? [...history].reverse().map(h =>
    `<div class="history-entry"><span>${escapeHtml(h.text)}</span><small>${new Date(h.at).toLocaleTimeString("it-IT",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</small></div>`
  ).join("") : `<p style="color:#778397">Nessun rilancio.</p>`;
}
function escapeHtml(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}


function normalizeRole(value){const v=String(value||"").trim().toUpperCase();if(["P","POR","PORTIERE","PORTIERI"].includes(v))return"P";if(["D","DIF","DIFENSORE","DIFENSORI"].includes(v))return"D";if(["C","CEN","CENTROCAMPISTA","CENTROCAMPISTI"].includes(v))return"C";if(["A","ATT","ATTACCANTE","ATTACCANTI"].includes(v))return"A";return v.slice(0,1)}
function roleName(role){return({P:"Portiere",D:"Difensore",C:"Centrocampista",A:"Attaccante"})[role]||role}
function selectCatalogPlayer(p){selectedPlayer=p;$("itemInput").value=p.name;$("selectedName").textContent=p.name;$("selectedMeta").textContent=`${p.team} • ${roleName(p.role)}`;renderCatalog()}
function renderCatalog(){const q=($("playerSearch")?.value||"").trim().toLowerCase();const filtered=catalog.filter(p=>(activeRole==="ALL"||p.role===activeRole)&&(!q||p.name.toLowerCase().includes(q)||p.team.toLowerCase().includes(q)));$("playersCatalog").innerHTML=filtered.length?filtered.map(p=>`<div class="catalog-card ${selectedPlayer?.id===p.id?"selected":""}" data-player-id="${escapeHtml(p.id)}"><div class="role-icon">${p.role}</div><div><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.team)} <span class="role-pill">${p.role}</span></small></div></div>`).join(""):`<div class="empty-catalog">Nessun calciatore trovato.</div>`;document.querySelectorAll("[data-player-id]").forEach(el=>el.onclick=()=>selectCatalogPlayer(catalog.find(p=>p.id===el.dataset.playerId)));$("listStatus").textContent=catalog.length?`${catalog.length} calciatori caricati`:"Nessun calciatore caricato."}
function parseCSV(text){const lines=text.replace(/^\uFEFF/,"").split(/\r?\n/).filter(x=>x.trim());if(lines.length<2)throw new Error("Il CSV è vuoto.");const sep=((lines[0].match(/;/g)||[]).length>(lines[0].match(/,/g)||[]).length)?";":",";const split=line=>{const out=[];let cur="",quote=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(quote&&line[i+1]==='"'){cur+='"';i++}else quote=!quote}else if(c===sep&&!quote){out.push(cur.trim());cur=""}else cur+=c}out.push(cur.trim());return out};const headers=split(lines[0]).map(h=>h.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,""));const idx=(...names)=>headers.findIndex(h=>names.includes(h));const ni=idx("nome","calciatore","name"),ti=idx("squadra","team"),ri=idx("ruolo","role");if(ni<0||ti<0||ri<0)throw new Error("Servono almeno le colonne Nome, Squadra e Ruolo.");return lines.slice(1).map((line,n)=>{const c=split(line),role=normalizeRole(c[ri]);return{id:`csv-${n}-${c[ni]}`,name:c[ni]||"",team:c[ti]||"",role}}).filter(p=>p.name&&p.team&&["P","D","C","A"].includes(p.role))}
async function loadCatalog(){try{const r=await fetch(`/players.json?t=${Date.now()}`);const d=await r.json();catalog=d.players||[]}catch{}const saved=localStorage.getItem("fbCatalog2025");if(saved){try{catalog=JSON.parse(saved)}catch{}}renderCatalog()}

function render(s){
  state=s;
  if(mode==="host"){
    $("hostItem").textContent=s.item||"In attesa";
    $("hostItemMeta").textContent=[s.itemTeam,s.itemRole?roleName(s.itemRole):""].filter(Boolean).join(" • ");
    
    $("hostBid").textContent=s.currentBid>=s.basePrice?s.currentBid:"—";
    $("hostLeader").textContent=s.leaderName?`In testa: ${s.leaderName}`:"Nessun offerente";
    $("statusBadge").textContent=formatStatus(s.status);
    $("playerCount").textContent=s.playerCount;
    $("playersList").innerHTML=s.players.length?s.players.map(p=>`<div class="player-chip ${p.connected?"":"off"}"><span>${p.connected?"●":"○"} ${escapeHtml(p.name)}</span><button class="kick" data-kick="${p.id}">×</button></div>`).join(""):"<p>Nessuno è ancora entrato.</p>";
    document.querySelectorAll("[data-kick]").forEach(b=>b.onclick=()=>hostAction("kick",{playerId:b.dataset.kick}));
    renderHistory($("hostHistory"),s.history);
  }
  if(mode==="player"){
    $("playerItem").textContent=s.item||"In attesa del banditore";
    $("playerItemMeta").textContent=[s.itemTeam,s.itemRole?roleName(s.itemRole):""].filter(Boolean).join(" • ");
    
    $("playerBid").textContent=s.currentBid>=s.basePrice?s.currentBid:"—";
    $("playerLeader").textContent=s.leaderName?(s.leaderId===playerId?`🔥 Sei in testa!`:`In testa: ${s.leaderName}`):"Nessun offerente";
    const open=s.status==="open";
    $("buzzBtn").disabled=!open;
    document.querySelectorAll(".increments button").forEach(b=>b.disabled=!open);
    $("playerMessage").textContent=open?"Premi per rilanciare. Ogni offerta riavvia il countdown.":s.status==="sold"?(s.leaderId===playerId?"🏆 Aggiudicato a te!":"Asta conclusa."):"Aspetta l’apertura dell’asta.";
    renderHistory($("playerHistory"),s.history);
    document.body.style.background=s.leaderId===playerId?"radial-gradient(circle at 50% -20%,#294b18 0,#080b12 48%,#05070b 100%)":"";
  }
}

$("createBtn").onclick=()=>{
  socket.emit("createRoom",{title:"Asta tra amici"},res=>{
    if(!res.ok)return $("homeError").textContent=res.error;
    code=res.code;hostToken=res.hostToken;
    localStorage.setItem("fbHost",JSON.stringify({code,hostToken}));
    history.replaceState(null,"",`/?host=${code}`);
    show("host");
    $("hostCode").textContent=code;
    const url=`${location.origin}/?room=${code}`;
    $("joinUrl").textContent=url;
    $("qrImage").src = `/qr?data=${encodeURIComponent(url)}&t=${Date.now()}`;
    render(res.state);startTimer();
  });
};

function join(){
  const c=($("joinCode").value||params.get("room")||"").toUpperCase().trim();
  const name=$("joinName").value.trim();
  const saved=JSON.parse(localStorage.getItem(`fbPlayer_${c}`)||"null");
  socket.emit("joinRoom",{code:c,name,playerToken:saved?.playerToken},res=>{
    if(!res.ok)return $("homeError").textContent=res.error;
    code=c;playerToken=res.playerToken;playerId=res.playerId;
    localStorage.setItem(`fbPlayer_${c}`,JSON.stringify({playerToken,playerId,name}));
    history.replaceState(null,"",`/?room=${code}`);
    show("player");
    $("playerIdentity").textContent=name;
    $("playerRoom").textContent=`STANZA ${code}`;
    render(res.state);startTimer();vibrate([30,30,30]);
  });
}
$("joinBtn").onclick=join;
$("joinName").addEventListener("keydown",e=>{if(e.key==="Enter")join()});

function hostAction(action,payload={}){
  socket.emit("hostAction",{code,hostToken,action,payload},res=>{if(!res.ok)toast(res.error)});
}
$("prepareBtn").onclick=()=>hostAction("prepare",{item:$("itemInput").value,itemTeam:selectedPlayer?.team||"",itemRole:selectedPlayer?.role||"",basePrice:$("baseInput").value,duration:$("durationInput").value});
$("startBtn").onclick=()=>hostAction("start");
$("pauseBtn").onclick=()=>hostAction(state?.status==="paused"?"resume":"pause");
$("sellBtn").onclick=()=>hostAction("sell");
$("resetBtn").onclick=()=>hostAction("reset");

function bid(inc){
  socket.emit("bid",{code,playerToken,increment:Number(inc)},res=>{
    if(!res.ok)return toast(res.error);
    vibrate(45);
  });
}
$("buzzBtn").onclick=()=>bid(1);
document.querySelectorAll(".increments button").forEach(b=>b.onclick=()=>bid(b.dataset.inc));


$("playerSearch").addEventListener("input",renderCatalog);
document.querySelectorAll("[data-role]").forEach(b=>b.onclick=()=>{activeRole=b.dataset.role;document.querySelectorAll("[data-role]").forEach(x=>x.classList.toggle("active",x===b));renderCatalog()});
$("csvInput").addEventListener("change",async e=>{const file=e.target.files?.[0];if(!file)return;try{catalog=parseCSV(await file.text());localStorage.setItem("fbCatalog2025",JSON.stringify(catalog));selectedPlayer=null;renderCatalog();toast(`${catalog.length} calciatori importati`)}catch(err){toast(err.message)}});
$("itemInput").addEventListener("input",()=>{if(selectedPlayer&&$("itemInput").value!==selectedPlayer.name){selectedPlayer=null;$("selectedName").textContent="Inserimento manuale";$("selectedMeta").textContent="Nessuna squadra o ruolo associato";renderCatalog()}});
loadCatalog();

socket.on("state",render);
socket.on("sound",kind=>{sound(kind);if(kind==="sold")vibrate([100,60,180])});
socket.on("kicked",()=>{alert("Sei stato rimosso dalla stanza.");localStorage.removeItem(`fbPlayer_${code}`);location.href="/"});
socket.on("disconnect",()=>{if(mode==="player"){$("connectionDot").textContent="● OFFLINE";$("connectionDot").className="offline"}});
socket.on("connect",()=>{
  if(mode==="player"){$("connectionDot").textContent="● ONLINE";$("connectionDot").className="online"}
  if(mode==="host"&&code&&hostToken) socket.emit("restoreHost",{code,hostToken},res=>res.ok&&render(res.state));
  if(mode==="player"&&code&&playerToken){
    const saved=JSON.parse(localStorage.getItem(`fbPlayer_${code}`)||"null");
    socket.emit("joinRoom",{code,name:saved?.name||"Giocatore",playerToken},res=>res.ok&&render(res.state));
  }
});

(function boot(){
  const room=params.get("room");
  if(room){$("joinCode").value=room.toUpperCase();$("joinCode").readOnly=true}
  const host=params.get("host");
  const savedHost=JSON.parse(localStorage.getItem("fbHost")||"null");
  if(host&&savedHost?.code===host&&savedHost.hostToken){
    code=host;hostToken=savedHost.hostToken;
    socket.emit("restoreHost",{code,hostToken},res=>{
      if(!res.ok)return;
      show("host");$("hostCode").textContent=code;
      const url=`${location.origin}/?room=${code}`;$("joinUrl").textContent=url;
      $("qrImage").src = `/qr?data=${encodeURIComponent(url)}&t=${Date.now()}`;
      render(res.state);startTimer();
    });
  }
})();
