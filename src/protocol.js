export const HELLO_PAYLOAD = Buffer.from('Hello_from_ERCC\0', 'ascii');
const ID = /^[A-Za-z0-9_-]{14}$/;

export function parseHeartbeat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length !== 24) return null;
  // UTF-8 prevents high-bit bytes from becoming valid ASCII through truncation.
  const message = buffer.toString('utf8');
  if (!message.startsWith('UNIVERSAL_')) return null;
  const id = message.slice(10);
  return ID.test(id) ? id : null;
}

function version(value, field) {
  if (value === undefined) return null;
  if (!/^[0-9]{1,10}$/.test(String(value))) throw new TypeError(`Invalid ${field}`);
  return String(value);
}

// A snapshot is not an RFID event: callers must compare its last-card state.
export function parseSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !ID.test(raw.id ?? '')) {
    throw new TypeError('Invalid UUPC snapshot id');
  }
  const state = raw.universal_state?.machine_state;
  if (!/^[0-3]$/.test(String(state))) throw new TypeError('Invalid machine_state');
  let rfid = null;
  const card = raw.message?.RFID;
  if (card !== undefined && card !== '') {
    if (typeof card !== 'string' || !/^[0-9a-fA-F]{8}_[01]$/.test(card)) {
      throw new TypeError('Invalid RFID state');
    }
    rfid = { uid: card.slice(0, 8).toUpperCase(), placed: card[9] === '1' };
  }
  return {
    id: raw.id,
    softwareVersion: version(raw.sv, 'sv'),
    hardwareVersion: version(raw.hv, 'hv'),
    machineState: Number(state),
    rfid,
    raw,
  };
}

