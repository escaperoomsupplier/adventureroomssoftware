import { node, time, duration, table } from './ui.js';
let sessions = [], connected = false, signature = '', selected = null, historyGeneration = 0, selectedVersion = '';
const container = document.getElementById('team-overview'), history = document.getElementById('team-history');
const statuses = { pending:'Pending', active:'Active', finished:'Finished', expired:'Expired', cancelled:'Cancelled', ended:'Finished' };
function timers() {
  for (const cell of container.querySelectorAll('[data-timer]')) {
    const team = sessions.find(s => s.id === cell.dataset.timer); if (!team) continue;
    cell.textContent = !connected ? 'Unavailable while disconnected' : team.status === 'pending' ? `${duration(team.durationMinutes * 60000)} available` : team.status === 'active' ? `${duration(Date.parse(team.endsAt) - Date.now())} remaining` : `${duration(team.elapsedMs)} elapsed`;
  }
}
async function showHistory(team) {
  selected = team.id; selectedVersion = JSON.stringify([team.currentRoomId, team.status]); const generation = ++historyGeneration; history.hidden = false; history.replaceChildren();
  const heading = node('div', undefined, 'wf-heading'); heading.append(node('h2', `${team.teamName} · History`));
  const close = node('button', 'Close', 'secondary'); close.type='button'; close.addEventListener('click', () => { selected=null; historyGeneration++; history.hidden=true; }); heading.append(close); history.append(heading);
  const content = node('div', undefined, 'table-wrap'); content.append(node('p','Loading visits…','empty')); history.append(content);
  try { const response = await fetch(`/api/reception/sessions/${encodeURIComponent(team.id)}/history`, { signal:AbortSignal.timeout(10000), cache:'no-store' }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not load team history.'); if (generation !== historyGeneration) return;
    table(content,['Room','Entered','Exited','Reader'],(data.visits || []).map(visit => [visit.roomName, time(visit.enteredAt), time(visit.exitedAt), visit.readerName || '—']), 'No room visits yet.');
  } catch(error) { if(generation === historyGeneration) { content.replaceChildren(node('p', error.message, 'wf-error')); content.setAttribute('role','alert'); } }
}
export function updateOverview(state = {}) {
  if(state.sessions) sessions=state.sessions; connected=state.connected ?? connected;
  const selectedTeam = sessions.find(team => team.id === selected);
  if (connected && selectedTeam && JSON.stringify([selectedTeam.currentRoomId, selectedTeam.status]) !== selectedVersion) showHistory(selectedTeam);
  const next=JSON.stringify([sessions.map(({ elapsedMs, ...team }) => team),connected]); if(next === signature) { timers(); return; } signature=next;
  const focused=document.activeElement?.dataset.history;
  table(container,['Team','Status','Time','Current room','Wristbands',''],sessions.map(team => { const timer=node('span'); timer.dataset.timer=team.id; const button=node('button','History','secondary'); button.type='button'; button.dataset.history=team.id; button.disabled=!connected; button.addEventListener('click',()=>showHistory(team)); return [team.teamName,node('span',statuses[team.status] || team.status,`status-pill ${team.status === 'active' ? 'positive':'muted'}`),timer,team.currentRoomName || '—',(team.cards || []).length,button]; }), 'No teams yet. Add a team at Reception.');
  if(focused) [...container.querySelectorAll('button')].find(b=>b.dataset.history===focused)?.focus(); timers();
  if(!connected && selected) { history.hidden=true; selected=null; historyGeneration++; }
}
setInterval(timers,1000);
