const list=document.getElementById('screen-list');
try {
  const responses=await Promise.all([fetch('/api/screens'),fetch('/api/rooms')]);
  if(responses.some(response=>!response.ok))throw new Error('Could not load screens. Refresh to retry.');
  const [screens,rooms]=await Promise.all(responses.map(response=>response.json()));
  for(const screen of screens){const tile=document.createElement('a');tile.href=`/screens/${encodeURIComponent(screen.id)}`;const title=document.createElement('h2');title.textContent=screen.type==='leaderboard-global'?'Global leaderboard':rooms.find(room=>room.id===screen.roomId)?.name || 'Unassigned room';const name=document.createElement('p');name.textContent=screen.name;tile.append(title,name);list.append(tile);}
  if(!screens.length){const empty=document.createElement('p');empty.textContent='No screens configured yet.';list.append(empty);}
} catch(error){const message=document.getElementById('picker-error');message.textContent=error.message;message.hidden=false;}
