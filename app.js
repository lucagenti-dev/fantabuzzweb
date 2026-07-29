const socket = io();
const $ = id => document.getElementById(id);
let mode = "home", code = "", hostToken = "", playerToken = "", playerId = "", state = null;
let timerLoop = null;
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

function render(s){
  state=s;
  if(mode==="host"){
    $("hostItem").textContent=s.item||"In attesa";
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
    $("qr").innerHTML="";
    QRCode.toCanvas(url,{width:170,margin:1},(err,canvas)=>{if(!err)$("qr").appendChild(canvas)});
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
$("prepareBtn").onclick=()=>hostAction("prepare",{item:$("itemInput").value,basePrice:$("baseInput").value,duration:$("durationInput").value});
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
      QRCode.toCanvas(url,{width:170,margin:1},(err,canvas)=>{if(!err)$("qr").appendChild(canvas)});
      render(res.state);startTimer();
    });
  }
})();
