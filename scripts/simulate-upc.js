import { setTimeout as delay } from 'node:timers/promises';

// Deliberately no UDP discovery and no hardware commands: only synthetic HTTP POSTs.
const target = new URL(process.argv[2] || 'http://127.0.0.1:4000');
if (target.protocol !== 'http:') throw new Error('The simulator requires an HTTP URL.');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) {
  throw new Error('The simulator is restricted to loopback: localhost, 127.0.0.1 or [::1].');
}
target.pathname = '/';
target.search = '';
target.hash = '';

const snapshot = (rfid) => ({
  id: 'SIMULATOR00001',
  sv: '1',
  hv: '5',
  puzzle_state: { number_of_steps: '1', current_step: '0', attempt_number: '0' },
  universal_state: {
    machine_state: '0', output_state: '0', input_states: '0', output_states: '0',
    overwritten_inputs: '0', overwritten_outputs: '0',
  },
  message: { type: '', content: '', RFID: rfid },
});

console.log(`UUPC simulator (one RFID reader), target: ${target.origin}`);
for (const [label, rfid] of [
  ['Initial state', '00000000_0'],
  ['Card placement', '12AB34CD_1'],
  ['Repeated full snapshot — no new placement', '12AB34CD_1'],
  ['Card removal', '12AB34CD_0'],
]) {
  const response = await fetch(target, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(snapshot(rfid)), signal: AbortSignal.timeout(5000),
  });
  await response.text();
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  console.log(`${label}: ${rfid} → HTTP ${response.status}`);
  await delay(750);
}
console.log('Done. Expect two new events: placement and removal.');
