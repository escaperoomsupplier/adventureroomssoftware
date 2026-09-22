# Local operator panel

The panel on the application server (default: `http://127.0.0.1:4000`) manages team sessions, card assignments, rooms and passive round tracking. It also displays known UUPC devices, their last contact, machine state and RFID events. All assets ship with the project: no cloud, CDN or external fonts are used. Changes are saved locally; the panel sends no hardware commands.

Updates arrive immediately through server-sent events (SSE over HTTP). A full snapshot is sent on connection and reconnection to restore the current view. The panel does not poll every two seconds.

One RFID reader per UUPC is assumed. A controller is marked inactive after 25 seconds without an update. This is diagnostic information, not proof of a failure. If the server connection is lost, the last data remains visible with a warning. Event timestamps indicate receipt at the server, not the reading time on the device.

## Team sessions and cards

1. Enter the team name, choose the duration and create the session. Its clock starts immediately.
2. Select that session in the card assignment form.
3. Type the card UID or select a reader and explicitly copy its last known reading.
4. Check the UID and choose **Assign card**. A card assigned to another active session is rejected.
5. Use **Release** to remove a card assignment or **End session** to finish the visit. Expired sessions no longer reserve their cards.

Each session may have several cards. Card assignment is deliberate and never triggered automatically by a reader. Changes appear in other connected panels immediately. A session's expiry is enforced by the server, including after a restart. These actions do not control a room or change a score.

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

Start the local server, then run in a second terminal:

```sh
npm run simulate
# Another local port:
node scripts/simulate-upc.js http://127.0.0.1:4100
```

Node.js 24.11 or newer is required. The simulator accepts loopback destinations only and sends four full firmware-shaped packets to `POST /`: baseline `00000000_0`, placement `12AB34CD_1`, an identical snapshot, and removal `12AB34CD_0`. Its device ID is `SIMULATOR00001` (14 characters). Expect two new RFID events; the repeated snapshot is not a new placement. The simulator does not test UDP, discover devices or control hardware. The data is synthetic; do not use real wristband identifiers in examples committed to Git.

To test the complete tracking flow on the separate demo server:

1. Run `node scripts/simulate-upc.js http://127.0.0.1:14000` once to register the simulator.
2. Open `http://127.0.0.1:14000`, create a room assigned to `SIMULATOR00001` and leave it enabled.
3. Create a team session and assign card `12AB34CD`.
4. Run `node scripts/simulate-upc.js http://127.0.0.1:14000 --win`.
5. In **Round tracking**, expect one accepted registration and one **Win reported**.
   The repeated win packet must not add a second round or result.

The `--win` option adds activity, win, repeated win and return-to-armed snapshots.
It does not create rooms or sessions automatically.

## Tracking real rounds

Create a room, select its discovered UUPC and enable it. Assign the team's card in
Reception. While the controller reports **Armed**, remove and place that card on
the room's reader. The **Round tracking** section shows the team, room and elapsed
time since registration. **Recent scan decisions** explains cards rejected because
the room or team is already tracked, the session is inactive or the controller is
not armed. Removing a card does not end its tracked round.

Run the physical puzzle through its existing controls. The panel records later
controller activity and **Win reported**; tapping a card does not operate the
door or start the game. **Reset observed** is not an automatic loss. **Needs review**
means tracking could not be continued confidently, for example after restarting
the server or losing controller contact. No points are awarded.

**Close tracking** releases the software assignment only. Check and reset the
physical room through its existing controls before admitting another team. Register
the next round with a new placement while the controller is armed. Finishing a team
session also closes its tracking. Saved names and outcomes remain in history.

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

HTTP is the permanent transport; UDP is used for discovery. A snapshot contains the last RFID state rather than a complete event log. Duplicates are filtered, but rapid changes between snapshots, restarts or network interruptions may prevent recovery of every placement. Controller wins, including externally forced wins, are observations rather than verified scores. The application does not control round starts or physical access.
