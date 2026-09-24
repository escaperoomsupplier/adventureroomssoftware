# Local operator panel

The local application (default `http://127.0.0.1:4000`) manages teams, wristbands,
room layouts, reader roles, visit history and an elapsed-time leaderboard. All
assets are local. No cloud account or Internet connection is required during use.
Configuration and team actions send no commands to physical hardware.

## Navigation

- **Overview** (`/`): interactive venue map, waiting/playing teams and their visit histories.
- **Reception** (`/reception`): prepare teams, assign wristbands, start and finish games.
  Current teams contains waiting and playing teams. History contains finished,
  expired and cancelled sessions, with name search, status filters and 15 per page.
- **Leaderboard** (`/leaderboard`): completed games ordered by total elapsed time.
- **Screen settings** (`/screen-settings`): defaults, media and screen automation. Displays open `/screens` to choose their player.
- **Diagnostics** (`/devices`): readers, selectable details and the latest 15 RFID events.

Pages support direct links and browser Back/Forward. Navigation preserves forms
and maintains one live SSE connection. Reloading discards unsaved form entries.
When live updates disconnect, displayed data may be stale; wait for reconnection
before relying on it. Reconnection refreshes the current view.

## Set up the venue

1. Unlock the map and choose **Add room**. Enter its name in the dialog, confirm,
   then click the map to place it. Escape or a click outside the map cancels.
2. Drag its rectangle to move it. Drag any edge to resize. Drag empty space to pan,
   use the mouse wheel to zoom, or press **Fit view** to see the layout.
3. Choose **Add reader**, select an online reader, then click a room to place and
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

Green rooms have recent contact from every configured assigned reader; red rooms
have at least one reader unseen for more than 25 seconds. Grey means no configured
readers or a disabled room. Team markers show their last registered location.
Neither color nor markers prove physical occupancy or puzzle readiness.

## Prepare a team and wristbands

1. Enter the team name and duration using **Hours** and **Minutes**. The default
   is 1 hour, 0 minutes; total duration must be 1 minute to 12 hours.
2. Choose **Add team**. The team is pending and its clock has not started.
3. Select the team and a configured reader in the wristband form.
4. Press **Read card**, then remove and tap the wristband. A new reading fills
   the UID field; an old last-known card is not reused automatically.
5. Review the UID and press **Assign card**. Manual UID entry is also available.
   Repeat for further wristbands belonging to that team.
6. Press **Start** when the team is ready, or use a configured start reader.

Cards reserved by another pending or active team cannot be assigned. Release a
card to reuse it. Cancelling a pending team creates no game result. Finishing an
active game releases its cards and creates an elapsed-time result. Expiry releases
cards but does not count as successful completion. Deadlines persist after restart.

## Follow a game

An **Entry Room** reader records an active team's arrival in its assigned room. A
**Start time** reader starts a pending team and can also record its first room. A
**Stop time** reader finishes an active game. Start and finish stations can be left
unassigned to a room. All assigned rooms must be enabled for their readers' roles
to process the scan.

An **Exit Room** reader records departure from its room without stopping the team clock.

Overview shows the team's last recorded room. Select the team to inspect its
visit history. Repeated snapshots do not create extra visits; further taps in the
same room do not create another arrival until the team moves elsewhere. Removing
a wristband from a reader does not by itself end the game.

Following server startup or a known contact gap, first allow the reader baseline
to recover, then remove and tap the card again. A recovery snapshot is not proof
of a fresh arrival. Use existing physical room controls to operate puzzles: card
roles manage software records only. A controller's reported win is not the same
as finishing the whole team's game.

## Leaderboard

Completed games are listed fastest first by **total elapsed time**, from the
team's start to its finish. This is neither a points score nor a sum of room times.
Use **Remove** to exclude a result from the displayed leaderboard. The stored
result and visit history are retained; removing a result does not erase the team.

## Diagnostics

Select a reader to inspect its ID, firmware details, last contact and last RFID
state. The compact event table shows the latest 15 events. Timestamps describe
receipt at the server, not the precise reading time on the device. Reader names
help operators identify hardware without hiding its underlying ID.

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
`12AB34CD`, and start the team explicitly. Configure the reader's room and role for
the scenario being checked, then run the simulator again to produce a fresh tap.
A start role can start a pending team; a finish role can finish an active team.
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

Do not run ERCC alongside this application on the same device network. The firmware retains the first discovered ERCC server address until the UUPC restarts. Switching servers may require a controller restart; restarting only the application will not change the retained address.

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
