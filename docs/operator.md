# Local operator panel

The local application (default `http://127.0.0.1:4000`) manages teams, wristbands,
room layouts, reader roles, visit history and an elapsed-time leaderboard. All
assets are local. No cloud account or Internet connection is required during use.
Configuration and team actions send no commands to physical hardware.

## Navigation

- **Overview** (`/`): interactive venue map, waiting/playing teams and their visit histories.
- **Reception** (`/reception`): prepare teams, pair wristbands, reset, save or cancel teams.
  Current teams contains waiting and playing teams. History contains finished,
  cancelled sessions, with name search, status filters and 15 per page.
- **Leaderboard** (`/leaderboard`): completed games ordered by total elapsed time.
- **Screen settings** (`/screen-settings`): defaults, media and screen automation. Displays open `/screens` to choose their player.
- **Readers** (`/devices`): controllers grouped by port, RFID configuration and the latest 15 RFID events.

Pages support direct links and browser Back/Forward. Navigation preserves forms
and maintains one live SSE connection. Reloading discards unsaved form entries.
When live updates disconnect, displayed data may be stale; wait for reconnection
before relying on it. Reconnection refreshes the current view.

## Set up the venue

1. Unlock the map and choose **Add room**. Enter its name in the dialog, confirm,
   then click the map to place it. Escape or a click outside the map cancels.
2. Drag its rectangle to move it. Drag any edge to resize. Drag empty space to pan,
   use the mouse wheel to zoom, or press **Fit view** to see the layout.
3. Choose **Add reader**, select a port under an online controller, then click a room to place and
   assign it. Click outside a room or press Escape to cancel. Select its block to
   give it a friendly name and choose its role.
4. Move reader blocks within or between rooms. The room inspector lists its readers
   and screens. Positions are saved locally; multiple readers can share a room.
5. Use **Add screen**, enter its name, then click the map to place it. Clicking a
   room assigns the screen to it; empty map space leaves it unassigned. Open
   **Screen settings** from its inspector to configure background, music and timers.
6. Lock the map when finished. It fits the venue automatically. Select items to
   inspect them; click empty space to clear selection. Clicking a locked edit field
   highlights the lock control.

Rooms can occupy negative coordinates, and new rooms begin near `(1000,1000)`.
Geometry fields are hidden. Keyboard users can Tab to a block and use arrow keys
to move it; Shift and arrows resize a room. Keyboard focus remains visible.

Green rooms have recent contact from the controllers of every configured assigned reader; red rooms
have at least one controller unseen for more than 25 seconds. Grey means no configured
readers or a disabled room. Team markers show their last registered location.
Neither color nor markers prove RFID sensor presence, physical occupancy or puzzle readiness.

## Prepare a team and wristbands

1. Enter a team name and choose **Add team**. No fixed duration is required.
2. Select the team and a configured **Card assignment** reader.
3. Start pairing and tap each wristband. Every fresh tap assigns another card.
4. Stop pairing when all wristbands are assigned. All cards are equivalent.

Pairing continues until stopped; there is no single-card confirmation loop.
Restarting the server stops pairing mode; start it again when needed.
Previously cached RFID readings do not assign cards. A card reserved by another
current team must be released before reassignment.

## Follow a game

Tap a **Start time** reader assigned to a room to begin that room's upward timer.
Tap its **Stop time** reader to stop it. Repeated taps do not restart or stop the
timer again, and do not repeat automation. Another wristband belonging to the same
team behaves identically. Stop the current room before starting a different room.

**Reset** clears all room timings and keeps the team's cards. **Cancel** ends the
team without ranking results. **Save** requires at least one completed room and
no running timer; it saves the results and releases the cards. Saving is an
operator decision, separate from tapping a room's Stop reader.

The map shows recorded room activity, not verified physical occupancy. Following
startup or a contact gap, let the reader establish its baseline, then remove and
tap the card again. No timing operation starts hardware, resets a puzzle or opens
a door.

## Leaderboard

Only saved teams receive ranking results. Global time is the sum of completed
room durations; travel and waiting between rooms are excluded. Room leaderboards
rank the completed time for that room. Results are fastest first. Removing a
ranking result retains the team's history.

## Diagnostics

The Readers page groups logical RFID readers under their physical UUPC controller.
Each port has its own name, room and role. Use **Configure as RFID** to configure a
port, or **Edit** to change an existing reader. Controller details include the
source device ID, IP address, firmware and controller port count. Port capacity is
inferred from the serial format documented in the UUPC wiki: a 14-digit numeric
serial has a production date (`YYYYMMDD`) at positions 1–8 and the port count at
positions 11–12 (positions are counted from 1). Recognized serials automatically
provide candidate ports 1 through that count in Readers and the map picker.
An unrecognized serial leaves capacity unknown; enter the actual port manually
(1–255). Previously observed port numbers can also appear as candidates.

A port candidate is not evidence that a sensor is connected. Green contact indicators
mean the controller posted within 25 seconds. They do not verify individual sensors.
Only configured RFID readers appear as map blocks or in reception and automation
selectors. Their port labels distinguish readers sharing one controller.

Older reader configurations show **Legacy / port unknown** and remain available
for pairing and Other automations with older firmware that sends no port number.
They do not handle events carrying an explicit port number. To migrate a reader,
select its actual port in the Readers page or map inspector and save; its ID and
history remain intact.
The map's Add reader picker groups available ports by online controller. Choosing
and placing a port configures it only after a valid room click; cancellation does
not save anything.

The compact event table shows the latest 15 RFID events with source-port context.
Timestamps describe receipt at the server, not the precise hardware reading time.

## Simulator without hardware

Use a separate data directory for simulations so synthetic sessions and controllers
do not mix with venue data. For example, in a new PowerShell terminal:

```powershell
$env:DISCOVERY='0'
$env:HOST='127.0.0.1'
$env:PORT='14000'
$env:CONFIG_DIR='config-demo'
npm start
```

On macOS:

```sh
DISCOVERY=0 HOST=127.0.0.1 PORT=14000 CONFIG_DIR=config-demo npm start
```

With the demo server above running, use a second terminal:

```sh
node scripts/simulate-upc.js http://127.0.0.1:14000
# Default server on port 4000, when explicitly using it for simulations:
npm run simulate
```

Node.js 24.11 or newer is required. The simulator accepts loopback destinations only and sends four full firmware-shaped packets to `POST /`: baseline `00000000_0`, placement `12AB34CD_1`, an identical snapshot, and removal `12AB34CD_0`. Its device ID is `SIMULATOR00001` (14 characters). Expect two new RFID events; the repeated snapshot is not a new placement. The simulator does not test UDP, discover devices or control hardware. The data is synthetic; do not use real wristband identifiers in examples committed to Git.

To exercise the UI, run the simulator once to discover its controller, then configure
it as a named reader on Overview. Create a pending team, assign its synthetic UID
`12AB34CD`, then use the configured room Start and Stop readers. Configure the reader's room and role for
the scenario being checked, then run the simulator again to produce a fresh tap.
A Start time reader starts its room timer; a Stop time reader completes that room timer. Save the team separately after all running timers stop.
The simulator does not create rooms, teams or reader settings automatically.

The `--win` option adds puzzle activity, win, repeated win and return-to-armed
snapshots. These machine-state changes do not replace a configured finish reader
or the operator's finish action.
## Connecting real UUPC devices

Stop the demo server, then start the receiver in PowerShell with:

```powershell
$env:DISCOVERY='1'
$env:HOST='0.0.0.0'
$env:PORT='4000'
$env:CONFIG_DIR='config'
npm start
```

Demo environment variables persist in the same terminal after shutdown. Explicitly
reset them as shown above: `DISCOVERY=0` disables UDP discovery, and
`HOST=127.0.0.1` accepts connections only from the local computer.

Enable UDP discovery through the server configuration. The computer and UUPC devices must be reachable on the local network. Allow TCP 4000 and UDP 9811 through the firewall for the application on the trusted private network. Do not forward these ports from the Internet. Multiple network interfaces and Wi-Fi client isolation can restrict broadcasts.

Do not run ERCC alongside this application on the same device network. Receiver switching depends on firmware configuration. Older firmware may retain the first discovered ERCC server address until the UUPC restarts. Newer SW10 firmware can switch receivers. Check the device configuration when changing servers.

HTTP is the permanent transport and UDP is used for discovery. Firmware snapshots
contain the last RFID state rather than a durable event log. Repeated snapshots
are filtered, but restarts, lost callbacks or rapid transitions may leave gaps in
history. UDP heartbeats do not prove that every HTTP event arrived. The system
records received visits and elapsed game time; it does not verify physical access
or operate puzzle starts, resets or locks.

## Display content and backups

Use `/screen-settings` for screen defaults, media uploads and automation. On the
physical display, open `/screens`, choose the screen and press **Start screen** to
allow audio and request fullscreen. A player can also be opened at `/screens/:id`.
See [Screens and media](screens.md) for supported formats, timed actions and setup.

The default `config` directory holds authoritative version-1 JSON configuration,
local media, `state/runtime.sqlite` and backups. `CONFIG_DIR` selects another
configuration directory. Stop the application before copying the complete directory
to another machine. Invalid configuration stops startup with an error while
preserving data; legacy data is migrated automatically. Environment variables for
`PORT`, `HOST` and `DISCOVERY` override saved settings for the current run.

## Remove venue items

Use **Delete** on the Readers page or beside **Save** in the map inspector.
Removing a reader clears its local configuration and room assignment but preserves
recorded events and team history. A device still reporting on the network may be
discovered again as an unconfigured reader.

Rooms with assigned readers, screens, automation rules or active occupants cannot
be deleted until those references are moved or cleared. Screen deletion remains
blocked while an automation references it. Historical visits are retained.

## Returning teams and pairing

Search for an existing team by name before creating another. Reuse the same team
identity for a new run; each run has independent room times and history. When
saving a later result, choose whether to keep the previous ranking result or
replace it with the new one. A new run does not silently erase an earlier result.

Choose an online Card assignment reader for continuous pairing. UDP contact is
enough to arm assignment; the next first HTTP card snapshot can assign a card.
An unchanged RFID value already known before assignment was armed is not replayed.
Stop pairing when all cards are registered.

An **Other** reader has no timing effect. Its configured automation may play media
on a selected screen whenever an assigned team card is newly tapped. Repeated
firmware snapshots do not count as new taps. Other readers may be unassigned to a
room; each rule names the exact reader.
