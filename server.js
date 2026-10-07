const express=require('express');const http=require('http');const cors=require('cors');const{Server}=require('socket.io');
let adminAuth=null,firestore=null,FieldValue=null;
try{
 const{initializeApp,getApps,cert}=require('firebase-admin/app');
 const{getAuth}=require('firebase-admin/auth');
 const{getFirestore}=require('firebase-admin/firestore');
 if(process.env.FIREBASE_PROJECT_ID&&process.env.FIREBASE_CLIENT_EMAIL&&process.env.FIREBASE_PRIVATE_KEY){
  const app=getApps()[0]||initializeApp({credential:cert({projectId:process.env.FIREBASE_PROJECT_ID,clientEmail:process.env.FIREBASE_CLIENT_EMAIL,privateKey:process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g,'\n')})});
  adminAuth=getAuth(app);firestore=getFirestore(app);FieldValue=require('firebase-admin/firestore').FieldValue;
 }
}catch(e){console.warn('Firebase Admin is not configured:',e.message)}

const app=express();app.use(cors());app.get('/health',(_q,s)=>s.json({ok:true,service:'game-server'}));const server=http.createServer(app);
const io=new Server(server,{cors:{origin:process.env.CLIENT_ORIGIN||'*',methods:['GET','POST']}});
io.use(async(socket,next)=>{
 const token=socket.handshake.auth?.token;
 if(!token){socket.data.uid=null;return next()}
 if(!adminAuth)return next(new Error('AUTH_SERVER_NOT_CONFIGURED'));
 try{const decoded=await adminAuth.verifyIdToken(token);socket.data.uid=decoded.uid;socket.data.email=decoded.email||null;next()}
 catch(e){next(new Error('AUTH_INVALID'))}
});
const rooms=new Map();const activity=[];const recordActivity=(type,text,game=null)=>{activity.unshift({id:Date.now()+Math.random(),type,text,game,at:new Date().toISOString()});if(activity.length>30)activity.pop()};const MAX={ttt:2,connect4:2},COLORS=['red','blue','green','yellow'],empty=n=>Array(n).fill(null),rid=x=>String(x||'').trim().toUpperCase(),name=(x,d)=>String(x||d).trim().slice(0,20)||d;
const tttWin=b=>{for(const[a,c,d]of[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]])if(b[a]&&b[a]===b[c]&&b[a]===b[d])return b[a];return null};
async function persistResult(r,winnerSlot){
 if(!firestore||!r.players.length)return;
 try{
  const batch=firestore.batch();
  const winnerUid=Number.isInteger(winnerSlot)?r.players[winnerSlot]?.uid||null:null;
  for(const p of r.players){
   if(!p.uid)continue;
   const ref=firestore.collection('players').doc(p.uid);
   const inc=Number.isInteger(winnerSlot)
    ?{totalGames:FieldValue.increment(1),wins:FieldValue.increment(p.slot===winnerSlot?1:0),losses:FieldValue.increment(p.slot===winnerSlot?0:1),points:FieldValue.increment(p.slot===winnerSlot?3:0),updatedAt:FieldValue.serverTimestamp()}
    :{totalGames:FieldValue.increment(1),draws:FieldValue.increment(1),updatedAt:FieldValue.serverTimestamp()};
   batch.set(ref,inc,{merge:true});
  }
  const match=firestore.collection('matches').doc();
  batch.set(match,{game:r.game,roomId:r.id,round:r.round,playerUids:r.players.map(p=>p.uid).filter(Boolean),winnerUid,result:Number.isInteger(winnerSlot)?'win':'draw',createdAt:FieldValue.serverTimestamp()});
  await batch.commit();
 }catch(e){console.error('Failed to persist match result:',e.message)}
}
function room(id,game){const r={id,game,players:[],status:'waiting',winner:null,messages:[],round:1,scores:[],advanceTimer:null};if(game==='ttt')Object.assign(r,{board:empty(9),turn:'X',draw:false});if(game==='connect4')Object.assign(r,{board:empty(42),turn:0,draw:false});return r}
const player=(r,id)=>r.players.find(p=>p.id===id), players=r=>r.players.map(p=>({id:p.id,name:p.name,slot:p.slot,color:p.color,symbol:p.symbol}));
function state(r,id){const c={roomId:r.id,game:r.game,status:r.status,winner:r.winner,players:players(r),maxPlayers:MAX[r.game],round:r.round,scores:r.scores};return{...c,board:r.board,currentTurn:r.turn,draw:r.draw}}
function broadcast(r){r.players.forEach(p=>io.to(p.id).emit('game-state',state(r,p.id)))}
function finish(r,winnerSlot=null){if(r.status==='finished')return;r.winner=Number.isInteger(winnerSlot)?winnerSlot:null;r.status='finished';recordActivity('result',Number.isInteger(winnerSlot)?r.players[winnerSlot]?.name+' won round '+r.round+' in '+r.game:'Round '+r.round+' ended in a draw',r.game);if(Number.isInteger(winnerSlot))r.scores[winnerSlot]=(r.scores[winnerSlot]||0)+1;persistResult(r,winnerSlot);broadcast(r);clearTimeout(r.advanceTimer);r.advanceTimer=setTimeout(()=>{if(rooms.get(r.id)!==r||r.players.length<2)return;reset(r);broadcast(r)},4000)}
function reset(r){r.winner=null;r.round+=1;r.status='playing';if(r.game==='ttt')Object.assign(r,{board:empty(9),turn:'X',draw:false});if(r.game==='connect4')Object.assign(r,{board:empty(42),turn:0,draw:false})}
function c4(r,p,a,x){if(r.status!=='playing'||r.turn!==p.slot||a!=='drop')return;const col=Number(x.col);if(!Number.isInteger(col)||col<0||col>6)return;let placed=false;for(let row=5;row>=0;row--){const i=row*7+col;if(r.board[i]===null){r.board[i]=p.slot;placed=true;break}}if(!placed)return;const b=r.board,s=p.slot;for(let row=0;row<6;row++)for(let col2=0;col2<7;col2++)if(b[row*7+col2]===s)for(const[dr,dc]of[[1,0],[0,1],[1,1],[1,-1]]){let n=1;for(let k=1;k<4;k++){const rr=row+dr*k,cc=col2+dc*k;if(rr>=0&&rr<6&&cc>=0&&cc<7&&b[rr*7+cc]===s)n++;else break}if(n>=4){finish(r,s);return}}if(b.every(Boolean)){r.draw=true;finish(r,null)}else r.turn=1-r.turn}
function ludo(r,p,a,x){if(r.status!=='playing'||r.turn!==p.slot||r.winner!==null)return;if(a==='roll'){if(r.dice!==null)return;r.dice=1+Math.floor(Math.random()*6);r.rolledBy=p.slot;if(!p.tokens.some(t=>can(p,t,r.dice))){r.dice=r.rolledBy=null;r.turn=(r.turn+1)%r.players.length}return}if(a!=='move'||r.rolledBy!==p.slot)return;const i=Number(x.token),d=r.dice;if(!Number.isInteger(i)||i<0||i>3||!can(p,p.tokens[i],d))return;let n=p.tokens[i];n=n===-1?0:n+d;p.tokens[i]=n;const g=lg(p.slot,n);if(g!==null&&n<52)for(const o of r.players)if(o.id!==p.id)o.tokens=o.tokens.map(v=>v>=0&&v<52&&lg(o.slot,v)===g&&g%13!==0?-1:v);if(p.tokens.every(v=>v===56)){r.dice=r.rolledBy=null;finish(r,p.slot);return}const extra=d===6;r.dice=r.rolledBy=null;if(!extra)r.turn=(r.turn+1)%r.players.length}
function battle(r,p,a,x){if(a==='place-ships'&&r.status==='waiting'){if(!validShips(x.ships))return;p.ships=x.ships.map(s=>({cells:s.cells.slice()}));p.ready=true;if(r.players.length===2&&r.players.every(v=>v.ready))r.status='playing';return}if(r.status!=='playing'||a!=='fire'||r.turn!==p.slot)return;const o=r.players.find(v=>v.id!==p.id),i=Number(x.index);if(!o||!Number.isInteger(i)||i<0||i>=100||p.shots.some(s=>s.index===i))return;const hit=cells(o.ships).includes(i);p.shots.push({index:i,hit});o.incomingShots.push({index:i,hit});if(cells(o.ships).every(n=>p.shots.some(s=>s.index===n&&s.hit))){finish(r,p.slot)}else r.turn=o.slot}
io.on('connection',s=>{s.on('createRoom',({roomId,name:n,game='ttt'})=>{const id=rid(roomId);if(!/^[A-Z0-9]{4,8}$/.test(id)||!MAX[game])return s.emit('errorMessage','Invalid room or game.');if(rooms.has(id))return s.emit('errorMessage','That room already exists.');const r=room(id,game),p={id:s.id,uid:s.data.uid||null,name:name(n,'Player 1'),slot:0,color:COLORS[0],symbol:'X',ships:[],shots:[],incomingShots:[],ready:false};r.players.push(p);r.scores[0]=0;rooms.set(id,r);recordActivity('room',p.name+' created a '+game+' room',game);s.join(id);s.emit('roomCreated',{roomId:id,game,slot:0,color:p.color,symbol:p.symbol});broadcast(r)});
s.on('joinRoom',({roomId,name:n,game})=>{const id=rid(roomId),r=rooms.get(id);if(!r)return s.emit('errorMessage','Room not found.');if(game&&game!==r.game)return s.emit('errorMessage','Wrong game for this room.');if(r.players.length>=MAX[r.game])return s.emit('errorMessage','Room is full.');const slot=r.players.length,p={id:s.id,uid:s.data.uid||null,name:name(n,'Player '+(slot+1)),slot,color:COLORS[slot],symbol:slot?'O':'X',ships:[],shots:[],incomingShots:[],ready:false};r.players.push(p);r.scores[slot]=0;recordActivity('join',p.name+' joined '+r.game+' room '+r.id,r.game);s.join(id);if(r.players.length>=2)r.status='playing';s.emit('roomJoined',{roomId:id,game:r.game,slot,color:p.color,symbol:p.symbol});broadcast(r)});
s.on('make-move',({roomId,index})=>{const r=rooms.get(rid(roomId)),p=r&&player(r,s.id);if(!r||r.game!=='ttt'||r.status!=='playing'||!p||p.symbol!==r.turn||!Number.isInteger(index)||index<0||index>8||r.board[index])return;r.board[index]=p.symbol;const w=tttWin(r.board);if(w){finish(r,p.slot)}else if(r.board.every(Boolean)){r.draw=true;finish(r,null)}else {r.turn=r.turn==='X'?'O':'X';broadcast(r)}});
s.on('game-action',({roomId,action,payload={}})=>{const r=rooms.get(rid(roomId)),p=r&&player(r,s.id);if(!r||!p)return;if(r.game==='connect4')c4(r,p,action,payload);if(r.game==='ludo')ludo(r,p,action,payload);if(false)battle(r,p,action,payload);broadcast(r)});
s.on('rematch',({roomId})=>{const r=rooms.get(rid(roomId));if(!r||r.players.length<2)return;clearTimeout(r.advanceTimer);reset(r);broadcast(r)});
s.on('chat-message',({roomId,text:msg})=>{const r=rooms.get(rid(roomId)),p=r&&player(r,s.id),m=String(msg||'').trim().slice(0,300);if(!r||!p||!m)return;const x={id:Date.now()+Math.random(),name:p.name,color:p.color,text:m,at:new Date().toISOString()};recordActivity('chat',p.name+' sent a message in '+r.id,r.game);r.messages.push(x);if(r.messages.length>50)r.messages.shift();io.to(r.id).emit('chat-message',x)});
s.on('voice-signal',({roomId,targetId,data})=>{const r=rooms.get(rid(roomId));if(r&&player(r,s.id)&&player(r,targetId))io.to(targetId).emit('voice-signal',{fromId:s.id,data})});
s.on('disconnect',()=>{for(const r of rooms.values()){if(!player(r,s.id))continue;r.players=r.players.filter(p=>p.id!==s.id);if(!r.players.length){clearTimeout(r.advanceTimer);rooms.delete(r.id);return}r.status='waiting';r.winner=null;r.round=1;r.scores=[];clearTimeout(r.advanceTimer);if(r.game==='ttt'){r.board=empty(9);r.turn='X';r.draw=false}if(r.game==='connect4'){r.board=empty(42);r.turn=0;r.draw=false}io.to(r.id).emit('playerLeft');broadcast(r);return}})});
app.get('/api/hub',async(_q,s)=>{
 const roomList=[...rooms.values()].map(r=>({
  id:r.id,game:r.game,status:r.status,round:r.round,scores:r.scores,
  winner:r.winner,maxPlayers:MAX[r.game],
  players:r.players.map(p=>({id:p.id,name:p.name,slot:p.slot,color:p.color}))
 }));
 let leaders=[];
 if(firestore){
  try{
   const snap=await firestore.collection('players').orderBy('points','desc').limit(10).get();
   leaders=snap.docs.map(d=>{const x=d.data();return{name:x.username||'Player',score:x.points||0}});
  }catch(e){console.error('Leaderboard read failed:',e.message)}
 }
 if(!leaders.length){
  const leaderboard={};
  roomList.forEach(r=>r.players.forEach(p=>{leaderboard[p.name]=(leaderboard[p.name]||0)+(r.scores?.[p.slot]||0)}));
  leaders=Object.entries(leaderboard).map(([name,score])=>({name,score})).sort((a,b)=>b.score-a.score).slice(0,10);
 }
 s.json({onlinePlayers:io.engine.clientsCount,activeRooms:roomList.length,rooms:roomList,leaderboard:leaders,activity:activity.slice(0,12)});
});
const PORT=Number(process.env.PORT)||5000;server.listen(PORT,()=>console.log('Game server listening on '+PORT));