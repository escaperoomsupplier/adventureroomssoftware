# Local operator panel

The local application (default `http://127.0.0.1:4000`) manages teams, wristbands,
room layouts, reader roles, visit history and an elapsed-time leaderboard. All
assets are local. No cloud account or Internet connection is required during use.
Configuration and team actions send no commands to physical hardware.

## Navigation

- **Overview** (`/`): interactive venue map, teams and selectable visit histories.
- **Reception** (`/reception`): prepare teams, assign wristbands, start and finish games.
- **Leaderboard** (`/leaderboard`): completed games ordered by total elapsed time.
- **Diagnostics** (`/devices`): readers, selectable details and the latest 15 RFID events.

Pages support direct links and browser Back/Forward. Navigation preserves forms
and maintains one live SSE connection. Reloading discards unsaved form entries.
When live updates disconnect, displayed data may be stale; wait for reconnection
before relying on it. Reconnection refreshes the current view.

## Set up the venue

1. On Overview, unlock the map and choose **Add room**. Enter its name and save.
2. Drag the room to position it and use its corner handle to resize. Empty space
   pans the map; the zoom controls change scale. Numeric fields below the map
   provide a keyboard alternative to dragging and resizing.
3. Select a discovered reader from the list on the right. Enter a friendly name,
   choose its room and role, and press **Add reader** to configure it explicitly.
4. Place configured readers by dragging them from the list onto a room, moving
   their markers within the room, or editing their room and coordinates below.
5. Lock the map when finished. It automatically fits all rooms, and selection
   still works for inspecting rooms and readers.

A room can have several readers; the physical connection remains one RFID reader
per UUPC. Green rooms have recent contact from every configured assigned reader;
red rooms have at least one reader unseen for more than 25 seconds. Grey means
no configured readers or a disabled room. Contact is not proof that a room is empty
or that its puzzle is ready. Disabling a room prevents assigned reader roles from
processing team visits; it does not disable hardware.

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

An **entry** reader records an active team's arrival in its assigned room. A
**start** reader starts a pending team and can also record its first room. A
**finish** reader finishes an active game. Start and finish stations can be left
unassigned to a room. All assigned rooms must be enabled for their readers' roles
to process the scan.

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
$env:DATA_DIR='data-demo'
npm start
```

On macOS:

```sh
DISCOVERY=0 HOST=127.0.0.1 PORT=14000 DATA_DIR=data-demo npm start
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
$env:DATA_DIR='data'
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
