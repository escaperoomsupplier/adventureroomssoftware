# Adventure Rooms — local UUPC integration

The initial foundation includes ERCC-compatible UUPC discovery, an HTTP POST
receiver, a local SQLite database, reception tools and a diagnostics panel. HTTP is the permanent
transport. Runtime operation uses no MQTT, cloud services or external assets.
One physical RFID reader per UUPC is assumed; a room can contain several UUPC-backed readers. Reception prepares teams and wristbands, the interactive map configures rooms and reader roles, and completed games appear on an elapsed-time leaderboard. Hardware control and an Electron installer are not included.

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

Create a team with a name and duration. Hours and minutes are entered separately,
with a default of **1 hour, 0 minutes** and a total range of 1 minute to 12 hours.
A new team is **pending**: its clock does not run until the operator presses
**Start**, or its assigned card reaches a configured start reader.

To assign a wristband, select the team and a configured reader, press **Read card**,
then remove and tap the card. Only a new placement after capture begins fills the
UID field; a stored last reading is not silently reused. Review the UID and press
**Assign card** to confirm. Manual entry of an eight-character hexadecimal UID is
also supported. A team can have several wristbands. Pending and active teams
reserve their cards; release a card before assigning it elsewhere.

Starting records the session deadline in SQLite. Finishing an active team records
its total elapsed time and releases its cards. Cancelling a pending team produces
no completed-game result. Expiry releases reservations but is not a successful
finish. None of these actions starts a physical puzzle or opens a door.

## Interactive venue map

The top of **Overview** contains the venue map. It starts locked and automatically
fits all rooms. Selection works while locked: select a rectangle, a reader marker,
or a reader in the right-hand list to open its details below the map.

Unlock editing to add rooms, drag rectangles, resize them using their corner
handles, move reader markers, pan empty map space, or zoom. The details form also
provides numeric position and size fields for keyboard operation. Locking returns
to the automatic fit. Geometry and names are saved to the local server; unsaved
form values are preserved during live updates.

Discovered readers appear in the side list. Select one, give it a friendly name,
choose a room and role, then use **Add reader**. A configured reader can be dragged
from the list into a room or assigned through the details form. Multiple readers
may belong to a room; each still represents one physical reader on its UUPC.

Room colour describes contact only: green means all configured readers assigned
to it were seen within 25 seconds, red means at least one is stale, and grey means
no configured readers or a disabled room. These colours do not indicate occupancy,
puzzle readiness or door state. Configuration sends no hardware commands.

## Reader roles and team history

- **Entry** records the active team's arrival in the assigned enabled room.
- **Start** starts a pending team's session and records its room arrival when assigned.
- **Finish** finishes an active team's game and creates its elapsed-time result.

Readers may be left unassigned to a room, for example a start or finish station.
A disabled assigned room prevents that reader from processing team visits. The
team's displayed room is its last recorded arrival, not a physical occupancy check.
Repeated snapshots and additional scans within the same room do not add duplicate
visits. Selecting a team on Overview displays its visit history.

After server startup or a detected contact gap, the first snapshot restores the
reader baseline. Remove and tap the card again before relying on a new visit,
start or finish. Machine-state changes such as a puzzle win do not themselves
finish a team's game or create a leaderboard result.

## Leaderboard and diagnostics

**Leaderboard** shows completed games ordered by total elapsed time, fastest first.
This measures time from the team's start to its finish, rather than accumulated
puzzle times or points. Removing a result hides it from the leaderboard while
retaining the underlying result and team history in SQLite.

**Diagnostics** provides a compact reader list, selectable device details and the
latest 15 RFID events. Dates represent receipt at the server. Friendly names are
configuration; hardware IDs remain available in details for identification.

All panels share one SSE connection and receive committed snapshots. RFID events
and their resulting team updates are committed atomically before acknowledging
HTTP receipt. This protects local consistency but cannot reconstruct packets the
firmware never delivered. UDP contact does not guarantee uninterrupted HTTP
callbacks; unobserved resets, outages and reordered snapshots may make recorded
visits incomplete. Hardware control requires separate verification of physical
start, reset and result behaviour.
