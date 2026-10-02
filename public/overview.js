import { node, time, duration, table } from './ui.js';
let sessions = [], connected = false, signature = '', selected = null, historyGeneration = 0, selectedVersion = '';
const container = document.getElementById('team-overview'), history = document.getElementById('team-history');
const statuses = { pending:'Pending', active:'Active', finished:'Finished', expired:'Expired', cancelled:'Cancelled', ended:'Finished' };
const historyVersion = team => JSON.stringify([team.currentRoomId,team.status,(team.roomTimes || []).map(room=>[room.roomId,room.roomName,room.startedAt,room.stoppedAt])]);
function timers() {
  for (const cell of container.querySelectorAll('[data-timer]')) {
    const team = sessions.find(s => s.id === cell.dataset.timer); if (!team) continue;
    const times=team.roomTimes || [];
    const elapsed=room=>room.stoppedAt?Number(room.elapsedMs || 0):Math.max(0,Date.now()-Date.parse(room.startedAt));
    cell.textContent = !connected && times.some(room=>!room.stoppedAt) ? 'Unavailable while disconnected' : `${duration(times.reduce((sum,room)=>sum+elapsed(room),0))} total${times.length?' · '+times.map(room=>`${room.roomName}: ${duration(elapsed(room))}${room.stoppedAt?'':' (running)'}`).join(' · '):''}`;
  }
}
async function showHistory(team) {
  selected = team.id; selectedVersion = historyVersion(team); const generation = ++historyGeneration; history.hidden = false; history.replaceChildren();
  const heading = node('div', undefined, 'wf-heading'); heading.append(node('h2', `${team.teamName} · History`));
  const close = node('button', 'Close', 'secondary'); close.type='button'; close.addEventListener('click', () => { selected=null; historyGeneration++; history.hidden=true; }); heading.append(close); history.append(heading);
  const content = node('div', undefined, 'table-wrap'); content.append(node('p','Loading visits…','empty')); history.append(content);
  if(Array.isArray(team.roomTimes)) {
    table(content,['Room','Started','Stopped','Time'],team.roomTimes.map(room=>[room.roomName,time(room.startedAt),time(room.stoppedAt),duration(room.stoppedAt?room.elapsedMs:Math.max(0,Date.now()-Date.parse(room.startedAt)))]),'No room times recorded yet.');return;
  }
  try { const response = await fetch(`/api/reception/sessions/${encodeURIComponent(team.id)}/history`, { signal:AbortSignal.timeout(10000), cache:'no-store' }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not load team history.'); if (generation !== historyGeneration) return;
    table(content,['Room','Entered','Exited','Reader'],(data.visits || []).map(visit => [visit.roomName, time(visit.enteredAt), time(visit.exitedAt), visit.readerName || '—']), 'No room visits yet.');
  } catch(error) { if(generation === historyGeneration) { content.replaceChildren(node('p', error.message, 'wf-error')); content.setAttribute('role','alert'); } }
}
export function updateOverview(state = {}) {
  if(state.sessions) sessions=state.sessions.filter(team => ['pending','active'].includes(team.status)); connected=state.connected ?? connected;
  const selectedTeam = sessions.find(team => team.id === selected);
  if (selected && !selectedTeam) { selected=null; historyGeneration++; history.hidden=true; history.replaceChildren(); }
  if (connected && selectedTeam && historyVersion(selectedTeam) !== selectedVersion) showHistory(selectedTeam);
  const next=JSON.stringify([sessions.map(({ elapsedMs, ...team }) => team),connected]); if(next === signature) { timers(); return; } signature=next;
  const focused=document.activeElement?.dataset.history;
  table(container,['Team','Status','Time','Current room','Wristbands',''],sessions.map(team => { const timer=node('span'); timer.dataset.timer=team.id; const button=node('button','History','secondary'); button.type='button'; button.dataset.history=team.id; button.disabled=!connected; button.addEventListener('click',()=>showHistory(team)); return [team.teamName,node('span',statuses[team.status] || team.status,`status-pill ${team.status === 'active' ? 'positive':'muted'}`),timer,team.currentRoomName || '—',(team.cards || []).length,button]; }), 'No waiting or playing teams. Add a team at Reception; completed sessions are in Reception history.');
  if(focused) [...container.querySelectorAll('button')].find(b=>b.dataset.history===focused)?.focus(); timers();
  if(!connected && selected) { history.hidden=true; selected=null; historyGeneration++; }
}
setInterval(timers,1000);
