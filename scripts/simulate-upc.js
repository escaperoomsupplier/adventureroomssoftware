import { setTimeout as delay } from 'node:timers/promises';

// Deliberately no UDP discovery and no hardware commands: only synthetic HTTP POSTs.
const args = process.argv.slice(2);
const withWin = args.includes('--win');
const destinations = args.filter(arg => arg !== '--win');
if (destinations.length > 1 || destinations.some(arg => arg.startsWith('--'))) {
  throw new Error('Usage: node scripts/simulate-upc.js [http://localhost:port] [--win]');
}
const target = new URL(destinations[0] || 'http://127.0.0.1:4000');
if (target.protocol !== 'http:') throw new Error('The simulator requires an HTTP URL.');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) {
  throw new Error('The simulator is restricted to loopback: localhost, 127.0.0.1 or [::1].');
}
target.pathname = '/';
target.search = '';
target.hash = '';

const snapshot = (rfid, state = '0') => ({
  id: 'SIMULATOR00001',
  sv: '1',
  hv: '5',
  puzzle_state: { number_of_steps: '1', current_step: '0', attempt_number: '0' },
  universal_state: {
    machine_state: state, output_state: '0', input_states: '0', output_states: '0',
    overwritten_inputs: '0', overwritten_outputs: '0',
  },
  message: { type: '', content: '', RFID: rfid },
});

console.log(`UUPC simulator (one RFID reader), target: ${target.origin}`);
const steps = [
  ['Initial state', '00000000_0'],
  ['Card placement', '12AB34CD_1'],
  ['Repeated full snapshot — no new placement', '12AB34CD_1'],
  ['Card removal', '12AB34CD_0'],
];
if (withWin) steps.push(
  ['Puzzle activity', '12AB34CD_0', '1'],
  ['Win reported', '12AB34CD_0', '2'],
  ['Repeated win snapshot', '12AB34CD_0', '2'],
  ['Return to armed', '12AB34CD_0', '0'],
);
for (const [label, rfid, state = '0'] of steps) {
  const response = await fetch(target, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(snapshot(rfid, state)), signal: AbortSignal.timeout(5000),
  });
  await response.text();
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  console.log(`${label}: ${rfid}, machine state ${state} → HTTP ${response.status}`);
  await delay(750);
}
console.log('Done. Expect two new events: placement and removal.');
if (withWin) console.log('An enabled room and active session assigned to 12AB34CD are required to track this simulated win.');
