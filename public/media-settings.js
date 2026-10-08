import { readerLabel } from './reader-label.js';
import { node, table } from './ui.js';

let state = { rooms: [], readers: [], screens: [], rules: [], media: [], connected: false };
let busy = false, screenId = null, ruleId = null, signature = '';
let requestedScreen = new URLSearchParams(location.search).get('screen');
const screenRoot = document.getElementById('screen-settings');
const mediaRoot = document.getElementById('media-library');
const rulesRoot = document.getElementById('automations');
const roots = [screenRoot, mediaRoot, rulesRoot];
const messages = roots.map(root => { const e = node('p', '', 'ms-message'); e.setAttribute('role', 'status'); root.append(e); return e; });
const message = text => messages.forEach(e => { e.textContent = text; });
function button(text, action, cls = 'secondary') { const b = node('button', text, cls); b.type = 'button'; b.addEventListener('click', action); return b; }
function field(form, label, type = 'text') {
  const wrapper = node('label', undefined, 'ms-field'); wrapper.append(node('span', label));
  const input = node(type === 'select' ? 'select' : 'input');
  if (type !== 'select') input.type = type;
  input.setAttribute('aria-label', label); wrapper.append(input); form.append(wrapper); return input;
}
function options(select, items, placeholder = 'None') {
  const current = select.value, key = JSON.stringify(items);
  if (select.dataset.items === key) return;
  select.dataset.items = key; select.replaceChildren(new Option(placeholder, ''));
  for (const [id, name] of items) select.add(new Option(name, id));
  if (items.some(([id]) => id === current)) select.value = current;
}
function staticOptions(select, items) { for (const [value, text] of items) select.add(new Option(text, value)); }
function controls() { for (const root of roots) for (const e of root.querySelectorAll('input,select,button')) e.disabled = e.dataset.browse === 'true' ? false : busy || !state.connected; }
async function request(path, method = 'GET', body) {
  const response = await fetch(path, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`); return result;
}
async function mutate(action, success) {
  if (busy || !state.connected) return null;
  busy = true; controls(); message('');
  try { const result = await action(); message(success); return result; }
  catch (error) { message(['TypeError','TimeoutError','AbortError'].includes(error.name) ? 'Could not confirm the change. Check the current state before retrying.' : error.message); return null; }
  finally { busy = false; controls(); }
}
function removeButton(path, name) {
  const b = button('Remove', () => {
    if (b.dataset.confirm !== 'yes') { b.dataset.confirm = 'yes'; b.textContent = 'Confirm removal'; return; }
    mutate(() => request(path, 'DELETE'), `${name} removed.`);
  }); return b;
}

const screenHeading = node('h2', 'Add screen'); screenRoot.append(screenHeading);
const screenForm = node('form', undefined, 'ms-form'); screenRoot.append(screenForm);
const screenName = field(screenForm, 'Screen name'); screenName.required = true; screenName.maxLength = 80;
const screenType = field(screenForm, 'Screen type', 'select'); staticOptions(screenType, [['room','Room Screen'],['leaderboard-room','Leaderboard Room Screen'],['leaderboard-global','Leaderboard Global Screen']]);
const resultLimit = field(screenForm, 'Number of results', 'number'); resultLimit.min=1; resultLimit.max=100; resultLimit.value=10; resultLimit.required=true;
const screenRoom = field(screenForm, 'Screen location', 'select');
const rankingRoom = field(screenForm, 'Ranking room', 'select');
const backgroundType = field(screenForm, 'Background', 'select'); staticOptions(backgroundType, [['color','Solid color'],['image','Image'],['video','Video']]);
const backgroundColor = field(screenForm, 'Background color', 'color'); backgroundColor.value = '#101827';
const backgroundMedia = field(screenForm, 'Background media', 'select');
const showTimers = field(screenForm, 'Show team timers', 'checkbox'); showTimers.checked = true;
const musicMedia = field(screenForm, 'Background music', 'select');
const musicVolume = field(screenForm, 'Music volume (0–100%)', 'number'); musicVolume.min = 0; musicVolume.max = 100; musicVolume.value = 50;
const screenSave = node('button', 'Add screen'); screenSave.type = 'submit'; screenForm.append(screenSave, button('New screen', () => editScreen(null)));
const picker = node('a', 'Open screen picker', 'text-link'); picker.href = '/screens'; picker.target = '_blank'; picker.rel = 'noopener'; screenRoot.append(picker);
const screenList = node('div', undefined, 'table-wrap ms-list'); screenRoot.append(screenList);

function editScreen(screen) {
  screenId = screen?.id ?? null; screenHeading.textContent = screen ? `Edit ${screen.name}` : 'Add screen'; screenSave.textContent = screen ? 'Save screen' : 'Add screen';
  screenType.value=screen?.type ?? 'room';resultLimit.value=screen?.resultLimit ?? 10;updateScreenFields();
  screenName.value = screen?.name ?? ''; screenRoom.value = screen?.roomId ?? ''; rankingRoom.value = screen?.rankingRoomId ?? screen?.roomId ?? '';
  backgroundType.value = screen?.defaults.background.type ?? 'color'; backgroundColor.value = screen?.defaults.background.color ?? '#101827';
  refreshMediaOptions(); backgroundMedia.value = screen?.defaults.background.mediaId ?? '';
  showTimers.checked = screen?.defaults.showTimers ?? true; musicMedia.value = screen?.defaults.music.mediaId ?? ''; musicVolume.value = Math.round((screen?.defaults.music.volume ?? 0.5) * 100);
}
screenForm.addEventListener('submit', async event => {
  event.preventDefault();
  const body = { type:screenType.value,resultLimit:Number(resultLimit.value),name: screenName.value.trim(), roomId: screenRoom.value || null, rankingRoomId: screenType.value==='leaderboard-room' ? rankingRoom.value : null, defaults: {
    background: { type: backgroundType.value, color: backgroundColor.value, mediaId: backgroundType.value === 'color' ? null : backgroundMedia.value || null },
    showTimers: showTimers.checked, music: { mediaId: musicMedia.value || null, volume: Number(musicVolume.value) / 100 } } };
  const result = await mutate(() => request(`/api/screens${screenId ? `/${screenId}` : ''}`, screenId ? 'PATCH' : 'POST', body), 'Screen saved.');
  if (result?.screen) editScreen(result.screen);
});
function updateScreenFields(){screenRoom.required=false;rankingRoom.required=screenType.value==='leaderboard-room';rankingRoom.closest('label').hidden=screenType.value!=='leaderboard-room';resultLimit.closest('label').hidden=screenType.value==='room';showTimers.closest('label').hidden=screenType.value!=='room';}
screenType.addEventListener('change',updateScreenFields);updateScreenFields();
backgroundType.addEventListener('change', refreshMediaOptions);

mediaRoot.append(node('h2', 'Add local media'));
const uploadForm = node('form', undefined, 'ms-form'); mediaRoot.append(uploadForm);
const uploadFile = field(uploadForm, 'Media file', 'file'); uploadFile.accept = '.png,.jpg,.jpeg,.gif,.webp,.mp4,.webm,.mp3,.wav,.ogg'; uploadFile.required = true;
const uploadName = field(uploadForm, 'Media name'); uploadName.maxLength = 160;
const uploadButton = node('button', 'Upload'); uploadButton.type = 'submit'; uploadForm.append(uploadButton);
mediaRoot.append(node('p', 'Files are stored in config/media. Supported: PNG, JPEG, GIF, WebP, MP4, WebM, MP3, WAV and OGG. Maximum 512 MB per file.', 'field-hint'));
const mediaList = node('div', undefined, 'table-wrap ms-list'); mediaRoot.append(mediaList);
let mediaKind = 'image', editingMediaId = null;
const mediaUrl = media => `/media/${encodeURIComponent(media.id)}?v=${encodeURIComponent(media.revision || 0)}`;
const mediaTabs = node('nav', undefined, 'ms-media-tabs'); mediaTabs.setAttribute('aria-label', 'Media types');
for (const [kind, label] of [['image','Images'],['video','Videos'],['audio','Audio']]) {
  const tab = button(label, () => { mediaKind = kind; renderMedia(); }); tab.dataset.browse = 'true'; tab.dataset.kind = kind; mediaTabs.append(tab);
}
mediaRoot.insertBefore(mediaTabs, mediaList);
const previewDialog = node('dialog', undefined, 'ms-media-dialog');
const previewTitle = node('h2'); previewTitle.id = 'ms-preview-title'; previewDialog.setAttribute('aria-labelledby', previewTitle.id);
const previewContent = node('div', undefined, 'ms-preview-content');
const previewClose = button('Close preview', () => previewDialog.close()); previewClose.dataset.browse = 'true';
previewDialog.append(previewTitle, previewContent, previewClose); mediaRoot.append(previewDialog);
function clearPreview() {
  for (const element of previewContent.querySelectorAll('video,audio')) { element.pause(); element.removeAttribute('src'); element.load(); }
  previewContent.replaceChildren();
}
previewDialog.addEventListener('close', clearPreview);
previewDialog.addEventListener('cancel', clearPreview);
function previewMedia(id) {
  const media = state.media.find(item => item.id === id); if (!media) return;
  clearPreview(); previewTitle.textContent = media.name;
  const element = node(media.kind === 'image' ? 'img' : media.kind);
  if (media.kind === 'image') element.alt = media.name;
  else { element.controls = true; element.preload = 'metadata'; element.playsInline = true; element.setAttribute('playsinline',''); }
  element.src = mediaUrl(media); previewContent.append(element); previewDialog.showModal(); previewClose.focus();
}
const editDialog = node('dialog', undefined, 'ms-media-dialog');
const editTitle = node('h2', 'Edit media'); editTitle.id = 'ms-edit-title'; editDialog.setAttribute('aria-labelledby', editTitle.id);
const editForm = node('form', undefined, 'ms-form');
const editName = field(editForm, 'Media name'); editName.required = true; editName.maxLength = 160;
const editFile = field(editForm, 'Replacement file (optional)', 'file'); editFile.accept = uploadFile.accept;
const editHint = node('p', 'Existing screens and automations keep using this media. Replacement must have the same media type.', 'field-hint');
const editStatus = node('p', '', 'ms-message'); editStatus.setAttribute('role','status');
const editSave = node('button', 'Save media'); editSave.type = 'submit';
const editCancel = button('Cancel', () => editDialog.close()); editCancel.dataset.browse = 'true';
editForm.append(editHint,editStatus,editSave,editCancel); editDialog.append(editTitle,editForm); mediaRoot.append(editDialog);
editDialog.addEventListener('close', () => { editingMediaId = null; editFile.value = ''; });
function editMedia(id) {
  const media = state.media.find(item => item.id === id); if (!media) return;
  editingMediaId = id; editName.value = media.name; editFile.value = ''; editStatus.textContent = '';
  editFile.accept = ({image:'.png,.jpg,.jpeg,.gif,.webp',video:'.mp4,.webm',audio:'.mp3,.wav,.ogg'})[media.kind];
  controls(); editDialog.showModal(); editName.focus();
}
editForm.addEventListener('submit', async event => {
  event.preventDefault(); const id = editingMediaId, media = state.media.find(item => item.id === id); if (!media) return;
  const name = editName.value.trim(), file = editFile.files[0];
  if (!name) { editStatus.textContent = 'Enter a media name.'; return; }
  const extension = file?.name.split('.').pop().toLowerCase();
  const mime = { png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',mp4:'video/mp4',webm:'video/webm',mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg' }[extension];
  if (file && (!mime || mime.split('/')[0] !== media.kind)) { editStatus.textContent = 'Choose a supported replacement of the same media type.'; return; }
  editStatus.textContent = file ? 'Replacing file…' : 'Saving name…';
  const result = await mutate(async () => {
    if (!file) return request(`/api/media/${encodeURIComponent(id)}`, 'PATCH', { name });
    const response = await fetch(`/api/media/${encodeURIComponent(id)}/file?name=${encodeURIComponent(name)}`, { method:'POST',headers:{'Content-Type':mime},body:file,signal:AbortSignal.timeout(120000) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Replacement failed.'); return data;
  }, 'Media saved.');
  if (editingMediaId !== id) return;
  if (result) editDialog.close(); else editStatus.textContent = messages[0].textContent;
});
function renderMedia() {
  for (const tab of mediaTabs.children) tab.setAttribute('aria-pressed', String(tab.dataset.kind === mediaKind));
  for (const video of mediaList.querySelectorAll('video')) { video.pause(); video.removeAttribute('src'); video.load(); }
  table(mediaList, ['Preview','Media','Size',''], state.media.filter(media => media.kind === mediaKind).map(media => {
    const thumb = button('', () => previewMedia(media.id), 'ms-thumbnail'); thumb.dataset.browse = 'true'; thumb.setAttribute('aria-label', `Preview ${media.name}`);
    if (media.kind === 'audio') thumb.append(node('span', '♫', 'ms-audio-icon'));
    else {
      const element = node(media.kind === 'image' ? 'img' : 'video');
      if (media.kind === 'image') { element.alt = ''; element.loading = 'lazy'; }
      else { element.muted = true; element.preload = 'metadata'; element.playsInline = true; element.setAttribute('playsinline',''); element.addEventListener('loadedmetadata', () => { if (Number.isFinite(element.duration) && element.duration > 0) element.currentTime = Math.min(.1,element.duration/2); }, {once:true}); }
      element.src = mediaUrl(media); thumb.append(element);
    }
    const actions = node('div', undefined, 'ms-actions');
    const preview = button('Preview', () => previewMedia(media.id)); preview.dataset.browse = 'true';
    actions.append(preview,button('Edit', () => editMedia(media.id)),removeButton(`/api/media/${media.id}`, 'Media'));
    return [thumb, media.name, `${(media.sizeBytes / 1024 / 1024).toFixed(2)} MB`, actions];
  }), `No ${mediaKind === 'image' ? 'images' : mediaKind === 'video' ? 'videos' : 'audio files'} uploaded yet.`);
  controls();
}
uploadForm.addEventListener('submit', async event => {
  event.preventDefault(); const file = uploadFile.files[0]; if (!file) return;
  const extension = file.name.split('.').pop().toLowerCase();
  const mime = { png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',mp4:'video/mp4',webm:'video/webm',mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg' }[extension];
  const result = await mutate(async () => {
    message('Uploading…');
    const response = await fetch(`/api/media/upload?name=${encodeURIComponent(uploadName.value.trim() || file.name)}`, { method: 'POST', headers: { 'Content-Type': mime || file.type }, body: file, signal: AbortSignal.timeout(120000) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Upload failed.'); return data;
  }, 'Media uploaded.');
  if (result) uploadForm.reset();
});

const ruleHeading = node('h2', 'Add automation'); rulesRoot.append(ruleHeading);
const ruleForm = node('form', undefined, 'ms-form'); rulesRoot.append(ruleForm);
const ruleName = field(ruleForm, 'Automation name'); ruleName.required = true; ruleName.maxLength = 80;
const ruleRoom = field(ruleForm, 'Trigger room', 'select'); ruleRoom.required = true;
const ruleReader = field(ruleForm, 'Other reader', 'select');
const ruleTrigger = field(ruleForm, 'When', 'select'); staticOptions(ruleTrigger, [['room.entered','Team uses Start time reader'],['room.exited','Team uses Stop time reader'],['team.started','Team starts first room'],['team.ended','Team saved'],['reader.used','Team uses Other reader']]);
const ruleScreen = field(ruleForm, 'Target screen', 'select'); ruleScreen.required = true;
const actionType = field(ruleForm, 'Action', 'select'); staticOptions(actionType, [['image','Show image'],['video','Play video'],['audio','Play sound']]);
const actionMedia = field(ruleForm, 'Action media', 'select'); actionMedia.required = true;
const actionDuration = field(ruleForm, 'Duration (seconds)', 'number'); actionDuration.min = 1; actionDuration.max = 3600; actionDuration.value = 10; actionDuration.required = true;
const actionVolume = field(ruleForm, 'Action volume (0–100%)', 'number'); actionVolume.min = 0; actionVolume.max = 100; actionVolume.value = 100;
const ruleEnabled = field(ruleForm, 'Automation active', 'checkbox'); ruleEnabled.checked = true;
const ruleSave = node('button', 'Add automation'); ruleSave.type = 'submit'; ruleForm.append(ruleSave, button('New automation', () => editRule(null)));
rulesRoot.append(node('p', 'Each action replaces the current action. Images use the configured duration; audio and video play to the end. Team saved runs only when a completed run is saved. Other readers trigger an action on each fresh team-card tap without changing timers.', 'field-hint'));
const ruleList = node('div', undefined, 'table-wrap ms-list'); rulesRoot.append(ruleList);
function editRule(rule) {
  ruleId = rule?.id ?? null; ruleHeading.textContent = rule ? `Edit ${rule.name}` : 'Add automation'; ruleSave.textContent = rule ? 'Save automation' : 'Add automation';
  ruleReader.value = rule?.readerId ?? ''; ruleName.value = rule?.name ?? ''; ruleRoom.value = rule?.roomId ?? ''; ruleTrigger.value = rule?.trigger ?? 'room.entered'; ruleScreen.value = rule?.screenId ?? '';
  actionType.value = rule?.action.type ?? 'image'; refreshMediaOptions(); actionMedia.value = rule?.action.mediaId ?? '';
  actionDuration.value = rule?.action.durationSeconds ?? 10; actionVolume.value = Math.round((rule?.action.volume ?? 1) * 100); ruleEnabled.checked = rule?.enabled ?? true;
  ruleFields();
}
function ruleFields() {
  const teamTrigger = ruleTrigger.value.startsWith('team.');
  const readerTrigger=ruleTrigger.value==='reader.used';
  ruleRoom.closest('label').hidden = teamTrigger || readerTrigger; ruleRoom.required = !teamTrigger && !readerTrigger;
  ruleReader.closest('label').hidden=!readerTrigger;ruleReader.required=readerTrigger;
  const image = actionType.value === 'image'; actionDuration.closest('label').hidden = !image; actionDuration.required = image;
}
ruleTrigger.addEventListener('change', ruleFields);
actionType.addEventListener('change', ruleFields);
actionType.addEventListener('change', refreshMediaOptions);
ruleForm.addEventListener('submit', async event => {
  event.preventDefault();
  const body = { name: ruleName.value.trim(), readerId:ruleTrigger.value==='reader.used'?ruleReader.value:null,roomId: ruleTrigger.value.startsWith('team.') || ruleTrigger.value==='reader.used' ? null : ruleRoom.value, trigger: ruleTrigger.value, screenId: ruleScreen.value,
    action: { type: actionType.value, mediaId: actionMedia.value, durationSeconds: actionType.value === 'image' ? Number(actionDuration.value) : null, volume: Number(actionVolume.value) / 100 }, mode: 'replace', enabled: ruleEnabled.checked };
  const result = await mutate(() => request(`/api/screen-rules${ruleId ? `/${ruleId}` : ''}`, ruleId ? 'PATCH' : 'POST', body), 'Automation saved.');
  if (result?.rule) editRule(null);
});
function refreshMediaOptions() {
  options(backgroundMedia, state.media.filter(m => m.kind === backgroundType.value).map(m => [m.id, m.name]), 'Select media');
  options(musicMedia, state.media.filter(m => m.kind === 'audio').map(m => [m.id, m.name]), 'No music');
  options(actionMedia, state.media.filter(m => m.kind === actionType.value).map(m => [m.id, m.name]), 'Select media');
}
export function updateMediaSettings(next) {
  state = { ...state, ...next }; controls();
  const key = JSON.stringify([state.screens, state.rooms, state.rules, state.media, state.readers.map(reader=>[reader.id,reader.name,reader.port,reader.configured,reader.role])]); if (signature === key) return; signature = key;
  options(ruleReader,state.readers.filter(reader=>reader.configured && reader.role==='other').map(reader=>[reader.id,readerLabel(reader)]),'Select Other reader');
  const roomItems = state.rooms.map(r => [r.id, r.name]); options(screenRoom, roomItems, 'Unassigned'); options(rankingRoom, roomItems, 'Select ranking room'); options(ruleRoom, roomItems, 'Select room');
  options(ruleScreen, state.screens.map(s => [s.id, s.name]), 'Select screen'); refreshMediaOptions();
  const roomName = id => state.rooms.find(r => r.id === id)?.name ?? 'Unassigned';
  table(screenList, ['Screen','Type','Location','Ranking room','Background',''], state.screens.map(screen => {
    const actions = node('div', undefined, 'ms-actions'); const open = node('a', 'Open player', 'text-link'); open.href = `/screens/${screen.id}`; open.target = '_blank'; open.rel = 'noopener';
    actions.append(button('Edit', () => editScreen(screen)), open, removeButton(`/api/screens/${screen.id}`, 'Screen')); return [screen.name, ({room:'Room Screen','leaderboard-room':'Leaderboard Room Screen','leaderboard-global':'Leaderboard Global Screen'})[screen.type || 'room'], roomName(screen.roomId), screen.type==='leaderboard-room'?roomName(screen.rankingRoomId ?? screen.roomId):'—', screen.defaults.background.type, actions];
  }), 'No screens yet. Add one here or on the map.');
  renderMedia();
  table(ruleList, ['Automation','When','Screen',''], state.rules.map(rule => {
    const actions = node('div', undefined, 'ms-actions'); actions.append(button('Edit', () => editRule(rule)), button('Test', () => mutate(() => request(`/api/screens/${rule.screenId}/preview`, 'POST', { action: rule.action }), 'Preview sent to screen.')), removeButton(`/api/screen-rules/${rule.id}`, 'Automation'));
    return [rule.name + (rule.enabled ? '' : ' (paused)'), ({'team.started':'Team starts first room','team.ended':'Team saved','reader.used':`Other: ${state.readers.find(reader=>reader.id===rule.readerId)?.name || 'Unknown reader'}`})[rule.trigger] || `${rule.trigger === 'room.entered' ? 'Start time in' : 'Stop time in'} ${roomName(rule.roomId)}`, state.screens.find(s => s.id === rule.screenId)?.name ?? 'Unknown', actions];
  }), 'No automations yet.');
  if (requestedScreen) { const screen = state.screens.find(s => s.id === requestedScreen); if (screen) { editScreen(screen); requestedScreen = null; } }
  if (screenId && !state.screens.some(s => s.id === screenId)) editScreen(null);
  controls();
}
controls();

ruleFields();
window.addEventListener('pagechange', () => { message(''); previewDialog.close(); clearPreview(); editDialog.close(); });
