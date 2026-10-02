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

Panel: http://localhost:4000. The default local configuration directory is `config`
under the repository; set `CONFIG_DIR` to use another directory. JSON files are
the authoritative venue configuration, while sessions and history are stored in
`config/state/runtime.sqlite`. These local files are excluded from Git.

The server runs independently of the browser window, but its process must remain
running. Stop it with Ctrl+C. Back up the complete configuration directory after
a clean shutdown, including media, runtime state and backups.

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

Configuration variables: `HOST`, `PORT`, `CONFIG_DIR`, `DISCOVERY=0`, `DISCOVERY_BIND`
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

Create a team by name. There is no preset game duration or countdown. Assign one
or more wristbands; every card has equal access to that team's room timers.
Select a configured **Card assignment** reader and the target team, then start
pairing. Each new tap assigns another card until pairing is stopped. Cached RFID
state does not assign a card. Cards reserved by another current team cannot be
reassigned silently; release the previous binding first.

Room timers count upward. **Reset** clears all of a current team's room times
while retaining its cards. **Cancel** ends the team without ranking results.
**Save** requires at least one completed room and no running room timer; it saves
results and releases the cards. These operations do not control physical puzzles.

## Interactive venue map

The map starts locked and fits all rooms and screens. Select a room, reader or
screen to inspect it below the map. Click empty map space to clear the selection.
Attempting to edit a locked field highlights the lock in the map header.

Unlock to drag rooms, resize from any of their four edges, pan empty space or zoom
with the mouse wheel. **Fit view** restores a view of the layout. Coordinates can
be negative; new rooms begin near `(1000,1000)`. Numeric geometry and enabled fields
are not part of the map inspector. Keyboard users can focus a block and use arrow
keys to move it, or Shift and arrows to resize a room.

Choose **Add reader** to list readers currently online. Select one, then click a
room to place and assign it. Clicking outside a room or pressing Escape cancels
placement. Reader blocks can move within a room or between rooms. Give each reader
a friendly name and select its role in the inspector. Room details list its readers
and screens. Multiple readers can belong to a room, each backed by its own UUPC.

Room names appear inside their rectangles. Green indicates recent contact from all
configured assigned readers, red indicates a stale reader, and grey indicates no
configured readers. Active team markers show the last registered
room, not verified physical occupancy. Unsaved inspector fields survive live updates.

Use **Add room** or **Add screen** to enter a name in a dialog, then click the map
to place the new block. No configuration is saved until placement; Escape cancels.
Screens placed inside a room are assigned to it. Select a screen to change its
name or open its advanced settings. See [Screens and media](docs/screens.md) for
player setup, media uploads and automation.

## Reader roles and team history

- **Start time** starts the assigned room's timer on the team's first accepted tap.
- **Stop time** stops that room's running timer on its first accepted stop tap.
- **Card assignment** continuously assigns fresh card taps to the selected team while pairing is enabled.

Start and Stop readers must be assigned to a room. Repeated Start or Stop taps,
including taps from another wristband of the same team, do not restart a timer or
repeat its automation. Starting another room while one is running is not allowed.
Stop the running room before continuing. Reset clears all room times for a fresh attempt.

Overview shows recorded room activity, not verified physical occupancy. Team
history records room timings. After startup or a contact gap, wait for the RFID
baseline, then remove and tap again; recovery snapshots are not new actions.
Machine-state changes such as a puzzle win do not automatically save a team.

## Leaderboard and readers

**Leaderboard** shows saved teams fastest first. Global time is the sum of completed
room durations, excluding time spent between rooms. Room rankings use each saved
room result. Cancelled teams have no ranking results. Removing a result hides it
while retaining team history.

**Readers** provides a compact reader list, selectable device details and the
latest 15 RFID events. Dates represent receipt at the server. Friendly names are
configuration; hardware IDs remain available in details for identification.

All panels share one SSE connection and receive committed snapshots. RFID events
and their resulting team updates are committed atomically before acknowledging
HTTP receipt. This protects local consistency but cannot reconstruct packets the
firmware never delivered. UDP contact does not guarantee uninterrupted HTTP
callbacks; unobserved resets, outages and reordered snapshots may make recorded
visits incomplete. Hardware control requires separate verification of physical
start, reset and result behaviour.

## Portable configuration

The default `config` directory contains `settings.json`, `rooms.json`, `readers.json`,
`screens.json`, `rules.json` and `media.json`, each with `schemaVersion: 1`. These
JSON files are authoritative. Media lives in `media/audio`, `media/images` and
`media/videos`; runtime SQLite data lives in `state/runtime.sqlite`; saved backups
live in `backups`. Set `CONFIG_DIR` to move this entire local directory elsewhere.

Stop the server before copying the whole directory to another computer. Legacy
local data is migrated automatically. Invalid configuration stops startup with an
error and preserves the data. `PORT`, `HOST` and `DISCOVERY` environment variables
override values in settings for the current run.

## Screens and automation

Configure displays at `/screen-settings`; open `/screens` to choose a display or
`/screens/:id` to open its player. Press **Start screen** on the display for the
initial audio/fullscreen gesture. Defaults include a color/image/video background,
optional music and team timers. Image actions use a duration of 1 to 3600 seconds;
audio and video play once to their natural end. Actions replace current playback.

Media uploads are local, limited to 512 MB per file, and support PNG, JPEG, GIF,
WebP, MP4, WebM, MP3, WAV and OGG. See [Screens and media](docs/screens.md) for setup
and backup instructions. This remains a Node application; no desktop installer is
included.

Automations run once on the first accepted Start time and Stop time tap for a
team in a room. Team-wide rules may run when the first room starts or the team is
saved. Repeated taps and firmware snapshots do not replay actions. Reset permits
a new attempt. New actions replace current playback.

## Current teams and history

Overview shows only pending and active teams. Reception opens on **Current teams**;
saved and cancelled sessions move automatically to **History**. Search
history by team name, filter its status and browse 15 sessions per page. Visit
history remains available without keeping old teams in the operational view.
