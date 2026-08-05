const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const multer = require('multer');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const { parseWorkbookBuffer, SEASON } = require('./catalog');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors:{origin:'*'}, pingTimeout:20000, pingInterval:10000 });
const upload = multer({ storage: multer.memoryStorage(), limits:{fileSize:8*1024*1024} });
const ROOT = __dirname;
const PUBLIC_DIR = ROOT;
const CATALOG_FILE = path.join(ROOT, 'players.json');
const DATA_DIR = process.env.DATA_DIR || ROOT;
const BACKUP_FILE = path.join(DATA_DIR,'rooms.json');
const ROOM_TTL_MS = 7*24*60*60*1000;
const MAX_PLAYERS = 100;
const rooms = new Map();
fs.mkdirSync(DATA_DIR,{recursive:true});
app.use(express.json({limit:'1mb'}));
app.get('/',(_,res)=>res.sendFile(path.join(PUBLIC_DIR,'index.html')));
app.get(['/app.js','/style.css','/manifest.json','/fantabid-logo.png','/fantabid-icon.png'],(req,res)=>{
 res.setHeader('Cache-Control',req.path.endsWith('.png')?'public, max-age=86400':'no-cache');
 res.sendFile(path.join(PUBLIC_DIR,path.basename(req.path)));
});
app.get(/^\/team-[a-z0-9-]+\.svg$/,(req,res)=>{
 const file=path.join(PUBLIC_DIR,path.basename(req.path));
 if(!fs.existsSync(file))return res.status(404).end();
 res.setHeader('Cache-Control','public, max-age=86400');
 res.sendFile(file);
});
app.get('/players.json',(_,res)=>{res.setHeader('Cache-Control','no-cache');res.sendFile(CATALOG_FILE)});
app.get('/health',(_,res)=>res.json({ok:true,version:'2.1.0',season:SEASON,rooms:rooms.size}));
app.get('/qr',async(req,res)=>{try{const data=String(req.query.data||'').slice(0,600);if(!data)return res.status(400).send('Dato mancante');const png=await QRCode.toBuffer(data,{width:500,margin:2,errorCorrectionLevel:'M',color:{dark:'#1769e0',light:'#ffffff'}});res.type('png').send(png)}catch(e){res.status(500).send('Errore QR')}});

const safe=(v,n=80)=>String(v??'').replace(/[<>]/g,'').trim().slice(0,n);
const codeKey=v=>safe(v,8).toUpperCase();
const roleName=r=>({P:'Portiere',D:'Difensore',C:'Centrocampista',A:'Attaccante'})[r]||r||'';
const roleOrder=r=>({P:1,D:2,C:3,A:4})[r]||9;
function makeCode(){const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let c;do{c=Array.from({length:5},()=>a[Math.floor(Math.random()*a.length)]).join('')}while(rooms.has(c));return c}
function itemKey(r){return `${r.item}|${r.itemTeam}|${r.itemRole}`.toLowerCase()}
function spent(room,id){return room.assignments.filter(a=>a.ownerId===id).reduce((s,a)=>s+Number(a.price||0),0)}
function counts(room,id){const c={P:0,D:0,C:0,A:0};room.assignments.filter(a=>a.ownerId===id).forEach(a=>{if(c[a.role]!=null)c[a.role]++});return c}
function remainingSlots(room,id){const c=counts(room,id),l=room.settings.limits;return Object.keys(l).reduce((s,r)=>s+Math.max(0,l[r]-c[r]),0)}
function maxBid(room,id){const credits=Math.max(0,room.settings.credits-spent(room,id));return Math.max(0,credits-Math.max(0,remainingSlots(room,id)-1)*room.settings.minReserve)}
function stats(room){
 const prices=room.assignments.map(a=>Number(a.price||0)); const avg=r=>{const x=room.assignments.filter(a=>a.role===r);return x.length?Math.round(x.reduce((s,a)=>s+Number(a.price||0),0)/x.length*10)/10:0};
 const top=[...room.assignments].sort((a,b)=>b.price-a.price).slice(0,10);
 const spend=[...room.players.values()].map(p=>({id:p.id,name:p.name,spent:spent(room,p.id),remaining:Math.max(0,room.settings.credits-spent(room,p.id))})).sort((a,b)=>b.spent-a.spent);
 return {total:room.assignments.length,average:prices.length?Math.round(prices.reduce((a,b)=>a+b,0)/prices.length*10)/10:0,byRole:{P:avg('P'),D:avg('D'),C:avg('C'),A:avg('A')},top,spend};
}
function publicState(room){return {code:room.code,title:room.title,item:room.item,itemTeam:room.itemTeam,itemRole:room.itemRole,basePrice:room.basePrice,currentBid:room.currentBid,leaderId:room.leaderId,leaderName:room.leaderName,status:room.status,duration:room.duration,endAt:room.endAt,sequence:room.sequence,playerCount:room.players.size,settings:room.settings,players:[...room.players.values()].map(p=>({id:p.id,name:p.name,connected:p.connected,joinedAt:p.joinedAt,spent:spent(room,p.id),remaining:Math.max(0,room.settings.credits-spent(room,p.id)),maxBid:maxBid(room,p.id),counts:counts(room,p.id),roster:room.assignments.filter(a=>a.ownerId===p.id)})),assignments:room.assignments,history:room.history.slice(-20),stats:stats(room),savedAt:room.savedAt||null}}
function emit(room){room.updatedAt=Date.now();io.to(room.code).emit('state',publicState(room));schedulePersist()}
function clearTimer(r){if(r.timer)clearTimeout(r.timer);r.timer=null}
function serialize(r){return {...r,players:[...r.players.values()].map(p=>({...p,socketId:null,connected:false})),assignedItemKeys:[...r.assignedItemKeys],timer:null}}
function persist(){try{const data=[...rooms.values()].map(serialize);fs.writeFileSync(BACKUP_FILE,JSON.stringify(data,null,2));const now=Date.now();rooms.forEach(r=>r.savedAt=now)}catch(e){console.error('Backup:',e)}}
let persistTimer=null;function schedulePersist(){clearTimeout(persistTimer);persistTimer=setTimeout(persist,700)}
function loadBackups(){try{if(!fs.existsSync(BACKUP_FILE))return;const arr=JSON.parse(fs.readFileSync(BACKUP_FILE,'utf8'));arr.forEach(x=>{if(Date.now()-x.updatedAt>ROOM_TTL_MS)return;x.players=new Map((x.players||[]).map(p=>[p.id,p]));x.assignedItemKeys=new Set(x.assignedItemKeys||[]);x.timer=null;x.hostId=null;x.status=x.status==='open'?'paused':x.status;x.endAt=null;rooms.set(x.code,x)})}catch(e){console.error('Ripristino:',e)}}
loadBackups();setInterval(persist,2*60*1000);
function createRoom(socket,p={}){const room={code:makeCode(),hostId:socket.id,hostToken:crypto.randomUUID(),createdAt:Date.now(),updatedAt:Date.now(),savedAt:null,title:safe(p.title||'Asta tra amici',60),settings:{credits:Math.max(1,Number(p.credits)||500),minReserve:Math.max(0,Number(p.minReserve)||1),limits:{P:Math.max(0,Number(p.p)||3),D:Math.max(0,Number(p.d)||8),C:Math.max(0,Number(p.c)||8),A:Math.max(0,Number(p.a)||6)}},item:'',itemTeam:'',itemRole:'',basePrice:1,currentBid:0,leaderId:null,leaderName:'',status:'waiting',duration:10,endAt:null,timer:null,sequence:0,players:new Map(),assignments:[],assignedItemKeys:new Set(),history:[]};rooms.set(room.code,room);socket.join(room.code);persist();return room}
function finalize(room){if(room.status==='sold')return false;room.status='sold';room.endAt=null;clearTimer(room);room.sequence++;if(room.leaderId&&room.item){const key=itemKey(room);if(!room.assignedItemKeys.has(key)){const a={id:crypto.randomUUID(),player:room.item,team:room.itemTeam,role:room.itemRole,price:room.currentBid,ownerId:room.leaderId,ownerName:room.leaderName,assignedAt:Date.now()};room.assignments.push(a);room.assignedItemKeys.add(key)}}room.history.push({type:'sold',text:room.leaderName?`${room.item} a ${room.leaderName} per ${room.currentBid}`:`${room.item||'Calciatore'} non assegnato`,at:Date.now()});persist();return true}
function scheduleEnd(r){clearTimer(r);if(!r.endAt)return;r.timer=setTimeout(()=>{r.timer=null;if(finalize(r)){emit(r);io.to(r.code).emit('sound','sold')}},Math.max(0,r.endAt-Date.now()))}
function isHost(s,r,t){return s.id===r.hostId||(t&&t===r.hostToken)}

app.post('/import-listone',upload.single('file'),(req,res)=>{try{if(!req.file)return res.status(400).json({ok:false,error:'File mancante'});const catalog=parseWorkbookBuffer(req.file.buffer,req.file.originalname);res.json({ok:true,...catalog,count:catalog.players.length,file:req.file.originalname})}catch(e){res.status(400).json({ok:false,error:e.message})}});

app.get('/export.xls',(req,res)=>{const room=rooms.get(codeKey(req.query.code));if(!room||String(req.query.token)!==room.hostToken)return res.status(403).send('Non autorizzato');const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');const cell=(v,t='String',st='')=>`<Cell${st?` ss:StyleID="${st}"`:''}><Data ss:Type="${t}">${esc(v)}</Data></Cell>`;const row=x=>`<Row>${x.join('')}</Row>`;const header=x=>row(x.map(v=>cell(v,'String','Header')));const sheet=(n,w,rs)=>`<Worksheet ss:Name="${n}"><Table>${w.map(x=>`<Column ss:Width="${x}"/>`).join('')}${rs.join('')}</Table></Worksheet>`;
 const all=[header(['N.','Calciatore','Squadra','Ruolo','Aggiudicatario','Prezzo','Data e ora'])];room.assignments.forEach((a,i)=>all.push(row([cell(i+1,'Number'),cell(a.player),cell(a.team),cell(roleName(a.role)),cell(a.ownerName),cell(a.price,'Number'),cell(new Date(a.assignedAt).toLocaleString('it-IT'))])));
 const rose=[header(['Partecipante','Ruolo','Calciatore','Squadra','Prezzo'])];[...room.assignments].sort((a,b)=>a.ownerName.localeCompare(b.ownerName)||roleOrder(a.role)-roleOrder(b.role)).forEach(a=>rose.push(row([cell(a.ownerName),cell(roleName(a.role)),cell(a.player),cell(a.team),cell(a.price,'Number')])));
 const sum=[header(['Partecipante','Crediti iniziali','Spesi','Residui','P','D','C','A','Totale'])];[...room.players.values()].forEach(p=>{const c=counts(room,p.id),s=spent(room,p.id);sum.push(row([cell(p.name),cell(room.settings.credits,'Number'),cell(s,'Number'),cell(room.settings.credits-s,'Number'),cell(c.P,'Number'),cell(c.D,'Number'),cell(c.C,'Number'),cell(c.A,'Number'),cell(c.P+c.D+c.C+c.A,'Number')]))});
 const xml=`<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Default"/><Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#1769E0" ss:Pattern="Solid"/></Style></Styles>${sheet('Aggiudicazioni',[40,180,110,120,150,70,140],all)}${sheet('Rose',[150,110,180,110,70],rose)}${sheet('Riepilogo',[150,90,70,70,45,45,45,45,55],sum)}</Workbook>`;res.setHeader('Content-Type','application/vnd.ms-excel; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="FantaBid_Rose_${room.code}_2026-27.xls"`);res.send(Buffer.from(xml))});

io.on('connection',socket=>{
 socket.on('createRoom',(p,ack=()=>{})=>{try{const r=createRoom(socket,p);ack({ok:true,code:r.code,hostToken:r.hostToken,state:publicState(r)})}catch(e){ack({ok:false,error:'Creazione fallita'})}});
 socket.on('restoreHost',({code,hostToken},ack=()=>{})=>{const r=rooms.get(codeKey(code));if(!r||hostToken!==r.hostToken)return ack({ok:false,error:'Sessione non valida'});r.hostId=socket.id;socket.join(r.code);ack({ok:true,state:publicState(r)});emit(r)});
 socket.on('joinViewer',({code},ack=()=>{})=>{const r=rooms.get(codeKey(code));if(!r)return ack({ok:false,error:'Stanza inesistente'});socket.join(r.code);socket.data.viewer=true;ack({ok:true,state:publicState(r)})});
 socket.on('joinRoom',({code,name,playerToken},ack=()=>{})=>{code=codeKey(code);name=safe(name,24);const r=rooms.get(code);if(!r)return ack({ok:false,error:'Stanza inesistente o scaduta'});if(!name)return ack({ok:false,error:'Inserisci il nome'});let p=playerToken?[...r.players.values()].find(x=>x.token===playerToken):null;if(!p){if(r.players.size>=MAX_PLAYERS)return ack({ok:false,error:'Stanza piena'});if([...r.players.values()].some(x=>x.name.toLowerCase()===name.toLowerCase()))return ack({ok:false,error:'Nome già usato'});p={id:crypto.randomUUID(),token:crypto.randomUUID(),socketId:socket.id,name,joinedAt:Date.now(),connected:true,lastBidAt:0};r.players.set(p.id,p)}else{p.socketId=socket.id;p.connected=true;p.name=name||p.name}socket.data.roomCode=code;socket.data.playerId=p.id;socket.join(code);ack({ok:true,playerId:p.id,playerToken:p.token,state:publicState(r)});emit(r)});
 socket.on('hostAction',({code,hostToken,action,payload={}},ack=()=>{})=>{const r=rooms.get(codeKey(code));if(!r||!isHost(socket,r,hostToken))return ack({ok:false,error:'Non autorizzato'});if(action==='prepare'){clearTimer(r);r.item=safe(payload.item,70);r.itemTeam=safe(payload.itemTeam,40);r.itemRole=safe(payload.itemRole,2).toUpperCase();if(r.assignedItemKeys.has(itemKey(r)))return ack({ok:false,error:'Calciatore già assegnato'});r.basePrice=Math.max(0,Number(payload.basePrice)||1);r.currentBid=r.basePrice-1;r.duration=Math.min(60,Math.max(3,Number(payload.duration)||10));r.leaderId=null;r.leaderName='';r.status='ready';r.endAt=null;r.history=[]}else if(action==='start'){if(!r.item)return ack({ok:false,error:'Seleziona un calciatore'});r.status='open';r.endAt=Date.now()+r.duration*1000;r.history.push({type:'start',text:`Asta aperta: ${r.item}`,at:Date.now()});scheduleEnd(r);io.to(r.code).emit('sound','start')}else if(action==='pause'){clearTimer(r);r.status='paused';r.endAt=null}else if(action==='resume'){r.status='open';r.endAt=Date.now()+r.duration*1000;scheduleEnd(r)}else if(action==='sell'){if(finalize(r))io.to(r.code).emit('sound','sold')}else if(action==='reset'){clearTimer(r);r.currentBid=r.basePrice-1;r.leaderId=null;r.leaderName='';r.status='ready';r.endAt=null;r.history=[]}else if(action==='kick'){const p=r.players.get(safe(payload.playerId,80));if(p){io.to(p.socketId).emit('kicked');r.players.delete(p.id)}}else if(action==='settings'){if(r.assignments.length)return ack({ok:false,error:'Impostazioni bloccate dopo la prima assegnazione'});r.settings.credits=Math.max(1,Number(payload.credits)||r.settings.credits);r.settings.minReserve=Math.max(0,Number(payload.minReserve)||r.settings.minReserve);['P','D','C','A'].forEach(k=>r.settings.limits[k]=Math.max(0,Number(payload[k.toLowerCase()])||r.settings.limits[k]))}else return ack({ok:false,error:'Azione sconosciuta'});emit(r);ack({ok:true})});
 socket.on('bid',({code,playerToken,increment},ack=()=>{})=>{const r=rooms.get(codeKey(code));if(!r||r.status!=='open')return ack({ok:false,error:'Asta non aperta'});const p=[...r.players.values()].find(x=>x.token===playerToken);if(!p||p.socketId!==socket.id)return ack({ok:false,error:'Giocatore non valido'});if(Date.now()-p.lastBidAt<250)return ack({ok:false,error:'Attendi un istante'});p.lastBidAt=Date.now();increment=[1,5,10].includes(Number(increment))?Number(increment):1;const next=r.currentBid<r.basePrice?r.basePrice:r.currentBid+increment;if(next>maxBid(r,p.id))return ack({ok:false,error:`Spesa massima disponibile: ${maxBid(r,p.id)}`});r.currentBid=next;r.leaderId=p.id;r.leaderName=p.name;r.endAt=Date.now()+r.duration*1000;r.history.push({type:'bid',text:`${p.name}: ${next}`,playerId:p.id,amount:next,at:Date.now()});scheduleEnd(r);emit(r);io.to(r.code).emit('sound','bid');ack({ok:true,amount:next})});
 socket.on('disconnect',()=>{const r=rooms.get(socket.data.roomCode);const p=r?.players.get(socket.data.playerId);if(p){p.connected=false;emit(r)}})
});
setInterval(()=>{const cut=Date.now()-ROOM_TTL_MS;for(const [c,r] of rooms)if(r.updatedAt<cut){clearTimer(r);rooms.delete(c)}persist()},30*60*1000);
const PORT=process.env.PORT||3000;server.listen(PORT,'0.0.0.0',()=>console.log(`FantaBid 2.1 su ${PORT}`));
