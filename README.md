# Adventure Rooms

**Version 0.2.0** — local software for running an adventure-room venue with UUPC
controllers and RFID wristbands. Manage reception, room timing, results, media
and display screens from one desktop application. All venue data stays on your
computer; other screens connect through your local network. No cloud account is
required.

## Features

- **Teams and wristbands:** find an existing team or create one, continuously pair
  several cards, and treat every team card equivalently.
- **Room timing:** Start time and Stop time readers control an upward timer for
  each room. There is no preset game duration; repeated taps do not restart timers.
- **Results:** save completed runs and rank teams by room time or the sum of
  completed room times. For another run, keep the previous ranking result or
  replace it. Reset clears current times but keeps cards; Cancel creates no result.
- **Venue map:** place rooms, readers and screens and inspect contact status.
  An Other reader can trigger media without changing timers.
- **Screens:** show room timers, room rankings or a global ranking with local
  images, video and background music. Physical screen location and ranking room
  are independent settings.
- **Automations:** trigger media on accepted room starts/stops, team lifecycle
  events or fresh taps on a selected Other reader. New actions replace playback;
  images have a time limit, while audio and video play once.
- **Local configuration:** keep settings, media and runtime history together in a
  writable configuration folder.

The application manages software records and display content. It does not command
puzzle hardware or door locks, and the map does not verify physical occupancy.

## Download and install

Open the [GitHub releases](https://github.com/escaperoomsupplier/adventureroomssoftware/releases)
and select **v0.2.0**. Choose the installer for your computer:

| Computer | Installer |
| --- | --- |
| Windows, Intel/AMD 64-bit | Windows x64 Setup `.exe` |
| Mac with an Intel processor | macOS x64 `.dmg` |
| Mac with Apple Silicon | macOS arm64 `.dmg` |

On Windows, run Setup to install the application for your user account. On macOS,
open the disk image and drag **Adventure Rooms** into **Applications**, then launch
the installed application.

The application opens its own window and starts the included local server.
**You do not need to install Node.js.** Closing the application window or choosing
Quit stops the application and its server. Closing a separate browser client does
not stop the desktop application.

Windows builds are unsigned. macOS builds are ad-hoc signed and not notarized;
operating-system security checks may prevent opening them. See
[release details](docs/releases.md).

## Connect your venue

HTTP uses **TCP 4000**; ERCC-compatible discovery uses **UDP 9811**. UUPC devices
discover the server and push state through HTTP. Allow these ports through the
firewall on your trusted venue network.

Do not run another ERCC receiver on the same device network simultaneously.
Receiver switching depends on firmware configuration. Older firmware may retain
the first discovered ERCC address until restart; newer SW10 firmware can switch receivers. A fixed server address or DHCP reservation helps
displays reconnect reliably. Each UUPC can expose multiple ports. Configure each
RFID port independently with its own name, room and role. For the 14-digit numeric
serial format documented in the UUPC wiki, positions 1–8 contain the production
date (`YYYYMMDD`) and positions 11–12 contain the port count. Recognized serials
automatically expose port choices; unrecognized serials allow manual port entry.
RFID messages must include a numbered source port; unaddressed RFID messages are
not supported. Controller contact does not prove sensor presence.

The operator interface is also available at [localhost:4000](http://localhost:4000).
On another display, open `http://SERVER-LAN-IP:4000/screens`, choose a screen and
press **Start screen** to activate audio and request fullscreen. Another computer
cannot reach the server through the server's `localhost` address.

The application currently has **no authentication** and is intended for a trusted
LAN. Do not expose its ports to the Internet. Runtime operation needs no Internet
connection.

## Configuration and backup

Use **File → Open configuration folder** in the desktop application. Installed
builds store their configuration in your user profile:

- Windows: `%APPDATA%/Adventure Rooms/config`
- macOS: `~/Library/Application Support/Adventure Rooms/config`

The folder contains JSON settings, uploaded media and SQLite runtime history.
Quit the application cleanly before copying the **entire configuration folder**.
Do not back up only an active SQLite file. Make this backup before installing an
update; retain your existing configuration rather than replacing it with an empty
folder. Do not run two servers against the same configuration directory.

RFID snapshots are deduplicated but are not a durable record of every physical
tap. Network gaps, resets and rapid transitions can leave missing events. After
startup or a contact gap, let the reader establish its baseline, then remove and
tap the card again.

## Run from source

Install **Node.js 24.11 or newer** and Git, then:

```sh
git clone https://github.com/escaperoomsupplier/adventureroomssoftware.git
cd adventureroomssoftware
npm start
```

There are no runtime packages to install for a source server run. Open
[localhost:4000](http://localhost:4000). This starts the server in the terminal;
Ctrl+C stops it. Source runs use the repository's `config` directory unless
`CONFIG_DIR` selects another location.

```sh
npm test
```

Tests use loopback networking and temporary storage. See the
[operator guide](docs/operator.md) for simulator setup with discovery disabled,
so a development run does not interact with real controllers.

## Build installers

Use exactly **Node.js 24.11.1** for native release builds.

```sh
npm ci
npm run build:release
npm run test:release
```

Build tooling is separate from the dependency-free source server. Releases use
an Electron desktop window and an included Node SEA server executable. Build on
the target platform. The GitHub Actions release workflow builds and smoke-tests
Windows x64, macOS x64 and macOS arm64. Manual workflow runs retain downloadable
build artifacts; pushing the `v0.2.0` tag publishes a release after all platform
checks pass.

## Guides

- [Operator guide](docs/operator.md): teams, readers, simulator and troubleshooting.
- [Screens and media](docs/screens.md): players, media library and automation.
- [Venue workflow](docs/venue-workflow-plan.md): timing and event semantics.
- [Releases](docs/releases.md): installation, builds and publication.
