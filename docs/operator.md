# Local operator panel

The panel on the application server (default: `http://127.0.0.1:4000`) displays known UUPC devices, their last contact, machine state and RFID events. All assets ship with the project: no cloud, CDN or external fonts are used. The panel is read-only and sends no hardware commands.

Updates arrive immediately through server-sent events (SSE over HTTP). A full snapshot is sent on connection and reconnection to restore the current view. The panel does not poll every two seconds.

One RFID reader per UUPC is assumed. A controller is marked inactive after 25 seconds without an update. This is diagnostic information, not proof of a failure. If the server connection is lost, the last data remains visible with a warning. Event timestamps indicate receipt at the server, not the reading time on the device.

## Simulator without hardware

Start the local server, then run in a second terminal:

```sh
npm run simulate
# Another local port:
node scripts/simulate-upc.js http://127.0.0.1:4100
```

Node.js 24.11 or newer is required. The simulator accepts loopback destinations only and sends four full firmware-shaped packets to `POST /`: baseline `00000000_0`, placement `12AB34CD_1`, an identical snapshot, and removal `12AB34CD_0`. Its device ID is `SIMULATOR00001` (14 characters). Expect two new RFID events; the repeated snapshot is not a new placement. The simulator does not test UDP, discover devices or control hardware. The data is synthetic; do not use real wristband identifiers in examples committed to Git.

## Connecting real UUPC devices

Stop the demo server, then start the receiver in PowerShell with:

```powershell
$env:DISCOVERY='1'
$env:HOST='0.0.0.0'
$env:PORT='4000'
npm start
```

Demo environment variables persist in the same terminal after shutdown. Explicitly
reset them as shown above: `DISCOVERY=0` disables UDP discovery, and
`HOST=127.0.0.1` accepts connections only from the local computer.

Enable UDP discovery through the server configuration. The computer and UUPC devices must be reachable on the local network. Allow TCP 4000 and UDP 9811 through the firewall for the application on the trusted private network. Do not forward these ports from the Internet. Multiple network interfaces and Wi-Fi client isolation can restrict broadcasts.

Do not run ERCC alongside this application on the same device network. The firmware retains the first discovered ERCC server address until the UUPC restarts. Switching servers may require a controller restart; restarting only the application will not change the retained address.

HTTP is the permanent transport; UDP is used for discovery. A snapshot contains the last RFID state rather than a complete event log. Duplicates are filtered, but rapid changes between snapshots, restarts or network interruptions may prevent recovery of every placement. The diagnostics panel is not yet a round management or scoring system.
