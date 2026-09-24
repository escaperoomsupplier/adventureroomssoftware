import { randomUUID } from 'node:crypto';

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
export class CaptureStore {
  constructor({ now = () => Date.now() } = {}) { this.now = now; this.items = new Map(); }
  start(reader) {
    this.sweep();
    if (!reader?.configured) fail(409, 'Add this reader to the venue first.');
    if (!reader.lastRfid || this.now() - Date.parse(reader.lastSeenAt) > 25000) {
      fail(409, 'Reader has no recent RFID baseline. Wait for contact, remove the card and try again.');
    }
    if ([...this.items.values()].some(c => c.readerId === reader.id && c.status === 'waiting')) fail(409, 'This reader is already waiting for a card.');
    if (this.items.size >= 256) fail(429, 'Too many recent card reads. Try again shortly.');
    const capture = { id: randomUUID(), readerId: reader.id, status: 'waiting', uid: null, expiresAt: new Date(this.now() + 60000).toISOString() };
    this.items.set(capture.id, capture);
    return { ...capture };
  }
  get(id) {
    this.sweep();
    const item = this.items.get(id);
    if (!item) fail(404, 'Card read not found. Start a new read.');
    return { ...item };
  }
  cancel(id) {
    this.get(id);
    const item = this.items.get(id);
    if (item.status === 'waiting') item.status = 'cancelled';
    return { ...item };
  }
  match({ device, event, previous }) {
    this.sweep();
    if (event?.type !== 'rfid.placed' || !previous?.lastRfid || this.now() - Date.parse(previous.lastSeenAt) > 25000) return null;
    return [...this.items.values()].find(c => c.status === 'waiting' && c.readerId === device.id) ?? null;
  }
  // Called only after the device transaction commits.
  complete(capture, uid) { capture.status = 'captured'; capture.uid = uid; }
  sweep(readers) {
    for (const [id, capture] of this.items) {
      const expiry = Date.parse(capture.expiresAt);
      if (capture.status === 'waiting' && expiry <= this.now()) capture.status = 'expired';
      if (readers && capture.status === 'waiting') {
        const reader = readers.find(r => r.id === capture.readerId);
        if (!reader?.configured || this.now() - Date.parse(reader.lastSeenAt) > 25000) capture.status = 'cancelled';
      }
      if (expiry + 60000 <= this.now()) this.items.delete(id);
    }
  }
}
