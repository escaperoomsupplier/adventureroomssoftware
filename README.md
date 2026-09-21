# Adventure Rooms — local UUPC integration

The initial foundation includes ERCC-compatible UUPC discovery, an HTTP POST
receiver, a local SQLite database, reception tools and a diagnostics panel. HTTP is the permanent
transport. Runtime operation uses no MQTT, cloud services or external assets.
One RFID reader per UUPC is assumed. Reception supports team sessions and RFID card
assignments. This stage does not yet include scoring, lock control or an Electron installer.

## Running on Windows / macOS

Node.js 24.11 or newer is required. There are no packages to install.

```sh
npm start
```

Panel: http://localhost:4000. Database: `data/adventure-rooms.sqlite` (ignored by Git).
The server runs independently of the browser window, but its process must remain
running. Stop it with Ctrl+C. Back up the database and any required WAL files after
a clean shutdown; do not copy only the database file while it is active.

The panel receives immediate server-sent events (SSE over HTTP). On connection and
reconnection, the server sends a full snapshot to restore the current view. There
is no two-second polling loop.

**Try it without hardware or network broadcasts:**

PowerShell:
```powershell
$env:DISCOVERY='0'
$env:HOST='127.0.0.1'
npm start
```

macOS:
```sh
DISCOVERY=0 HOST=127.0.0.1 npm start
```

In a second terminal, run `npm run simulate`. Run tests with `npm test` (loopback
and temporary databases only). CI runs the tests on Windows, macOS and Linux.

## Venue network

**Start with real hardware (PowerShell):**

```powershell
$env:DISCOVERY='1'
$env:HOST='0.0.0.0'
$env:PORT='4000'
npm start
```

Stop any running demo server first. Environment variables remain set in the same
terminal after the server stops: the demo's `DISCOVERY=0` disables discovery and
`HOST=127.0.0.1` prevents devices on the LAN from reaching the receiver. The commands
above explicitly restore the settings needed for real hardware.

- HTTP listens on `0.0.0.0:4000` and UDP on `0.0.0.0:9811` by default.
- Allow TCP 4000 and UDP 9811 through the firewall only on the venue network.
- Every 5 seconds, the server broadcasts `Hello_from_ERCC\0` to `255.255.255.255` on UDP 9811.
- UUPC replies with `UNIVERSAL_` followed by its 14-character ID. The firmware heartbeat repeats every 8 seconds.
- UUPC sends its full state through `POST / HTTP/1.0` to port 4000 at the hello sender's address.
- The receiver acknowledges with `200 OK` only after committing the SQLite transaction.
- The panel provides reception management and diagnostics without authentication and is intended for a trusted LAN.

Configuration variables: `HOST`, `PORT`, `DATA_DIR`, `DISCOVERY=0`, `DISCOVERY_BIND`
(interface IPv4 address), and `DISCOVERY_TARGETS` (comma-separated IPv4 addresses:
subnet broadcast addresses or controller IPs). With multiple network interfaces,
select the interface and broadcast address for the room network. Keep HTTP 4000
and UDP 9811 for real UUPC devices: the destination ports are fixed in the firmware.
Broadcasts do not normally cross subnets.

Do not run another ERCC instance on the same network at the same time. The analyzed
firmware retains the **first** ERCC address and does not replace it after subsequent
hello messages. Changing the computer, its IP address or the receiver may require
a UUPC restart. A fixed computer address or DHCP reservation is recommended.

## RFID semantics and limitations

`message.RFID` is the last state, `AABBCCDD_1` / `AABBCCDD_0`, rather than a new event
identifier. Subsequent POSTs for other state changes repeat this value. The receiver
compares it with the previous stored value for each UUPC, including after a server
restart. UIDs are stored as text, preserving leading zeros. `00000000_0` is the
firmware's initial sentinel value.

The first unknown value establishes a baseline without emitting an event. This
prevents an old card placement from being treated as a new entry, but the first
actual reading may be skipped. After startup, check connectivity and perform a
trial card placement and removal before operational use. The panel also displays
the last card state.

Firmware POSTs contain no event sequence number, boot ID or reading timestamp.
Stored timestamps represent receipt at the computer. Lost or reordered transitions
cannot be reconstructed unambiguously from the last state alone; delivery is not
guaranteed exactly once. The firmware HTTP queue is bounded and provides no durable
replay. The `/rfid/history` endpoint is not yet used. This stage does not award
points or open doors based on these events.

The current firmware forwards 4 UID bytes and does not identify the reader port.
Expander rosters shaped as `{id,full,sensors}` are acknowledged but are not processed
as the main UUPC state.

## Reception

Create a team session with a name and duration, select it, then assign one or more
eight-character RFID UIDs. The interface offers 60, 90 and 120 minutes; the API
accepts whole-minute durations from 1 to 720. A session starts when it is created.
You can type a UID or explicitly copy the selected reader's last known UID. Check
that the displayed card is the intended one before assigning it: a last reading
is not proof that the card is still present.

A card can belong to only one active, unexpired session. Release a card or end its
session before reusing it, or reuse it after the session expires. Assignments are
explicit: scanning a card does not automatically create or change a session.
Session deadlines and assignment history persist in SQLite across restarts.
The server enforces expiry even if no panel is open. These controls do not start
a room, open a door or award points.

Next steps: assign UUPC devices to rooms and add round tracking and scoring.
Physical RFID communication has been verified. Before controlling games, verify
round-control behavior and establish how round starts and results will be confirmed.
