const list=document.getElementById('screen-list');
try {
  const responses=await Promise.all([fetch('/api/screens'),fetch('/api/rooms')]);
  if(responses.some(response=>!response.ok))throw new Error('Could not load screens. Refresh to retry.');
  const [screens,rooms]=await Promise.all(responses.map(response=>response.json()));
  const roomName=id=>rooms.find(room=>room.id===id)?.name || 'Unassigned';
  for(const screen of screens){
    const tile=document.createElement('a');tile.href=`/screens/${encodeURIComponent(screen.id)}`;
    const title=document.createElement('h2');title.textContent=screen.name;
    const location=document.createElement('p');location.textContent=`Location: ${roomName(screen.roomId)}`;tile.append(title,location);
    if(screen.type==='leaderboard-room'){const ranking=document.createElement('p');ranking.textContent=`Ranking room: ${roomName(screen.rankingRoomId ?? screen.roomId)}`;tile.append(ranking);}
    else if(screen.type==='leaderboard-global'){const ranking=document.createElement('p');ranking.textContent='Global leaderboard';tile.append(ranking);}
    list.append(tile);
  }
  if(!screens.length){const empty=document.createElement('p');empty.textContent='No screens configured yet.';list.append(empty);}
} catch(error){const message=document.getElementById('picker-error');message.textContent=error.message;message.hidden=false;}
