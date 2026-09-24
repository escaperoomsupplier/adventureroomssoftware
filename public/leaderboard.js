import { node, time, duration, table, uncertain } from './ui.js';
let entries=[], connected=false, pending=false, confirming=null, signature='';
const container=document.getElementById('leaderboard'), message=document.getElementById('leaderboard-message');
function render() {
  const next=JSON.stringify([entries,connected,pending,confirming]); if(next===signature)return; signature=next;
  const sorted=[...entries].sort((a,b)=>(a.elapsedMs ?? a.durationMs)-(b.elapsedMs ?? b.durationMs));
  table(container,['Rank','Team','Time','Completed',''],sorted.map((entry,index)=> {
    const actions=node('div',undefined,'wf-actions');
    if(confirming===entry.id) { actions.append(node('span','Remove this result? History is kept.','field-hint')); const yes=node('button','Remove result'); yes.disabled=pending || !connected; yes.addEventListener('click',()=>remove(entry.id)); const no=node('button','Keep','secondary'); no.disabled=pending; no.addEventListener('click',()=>{confirming=null;render();}); actions.append(yes,no); }
    else {const button=node('button','Remove','secondary');button.disabled=pending || !connected;button.addEventListener('click',()=>{confirming=entry.id;render();});actions.append(button);}
    return [index+1,entry.teamName,duration(entry.elapsedMs ?? entry.durationMs),time(entry.finishedAt),actions];
  }),'No completed games yet.');
}
async function remove(id) {
  if(pending || !connected)return; pending=true; render(); message.textContent='';
  try {const response=await fetch(`/api/leaderboard/${encodeURIComponent(id)}`,{method:'DELETE',signal:AbortSignal.timeout(10000)});if(!response.ok){const data=await response.json();throw new Error(data.error || `Request rejected (HTTP ${response.status}).`);} entries=entries.filter(entry=>entry.id!==id);confirming=null;message.textContent='Result removed from the leaderboard. Team history is retained.';}
  catch(error){message.textContent=uncertain(error)?'Could not confirm removal. Check the refreshed leaderboard before retrying.':error.message;}
  finally{pending=false;render();}
}
export function updateLeaderboard(state={}) {if(state.leaderboard)entries=state.leaderboard;connected=state.connected??connected;render();}
