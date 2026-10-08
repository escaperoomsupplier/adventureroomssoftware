# Adventure Rooms 0.2.0

Independent RFID readers on multiple ports of one UUPC controller.

## What changed

- New firmware messages `UID_placed_port` route to the exact controller and port. Repeated snapshots are deduplicated using all three fields.
- A 14-digit numeric UUPC serial provides port capacity through digits 11–12. Known controllers expose ports 1 through their capacity; unknown IDs support observed ports and manual configuration.
- Each configured port has its own name, room, position and Start time, Stop time, Card assignment or Other role. One controller can serve multiple rooms.
- Readers are grouped by controller. The map places individual readers, and details retain controller ID, IP address and port for troubleshooting.
- Pairing, one-shot card capture and automations are isolated by port. Deleting one reader preserves its controller, other readers and recorded history.

## Upgrade from 0.1.0

Open **File > Open configuration folder**, then quit the application and back up the complete folder before installing. Existing reader names, rooms, roles and automation references are migrated automatically.

Existing single-reader mappings retain **Legacy / port unknown** until you explicitly choose their physical port in Readers or the map inspector. Legacy mappings accept only older messages without a port; they never guess the source of new numbered-port messages. Choose the correct port before using an upgraded controller for room timing or wristband assignment.

The new configuration format supports several readers per controller. Restore your complete pre-upgrade backup if reverting to 0.1.0.

## Installers

- Windows x64: run the `windows-x64-setup.exe` installer.
- Apple Silicon Mac: open `macos-arm64.dmg` and drag Adventure Rooms to Applications.
- Intel Mac: use `macos-x64.dmg`.

Node.js is included. Runtime operation remains local. Do not run two servers on the same ports or configuration folder.

Windows builds are unsigned. macOS builds use ad-hoc signing and are not notarized. Operating-system security checks may block the first launch. Green reader indicators confirm controller contact, not individual RFID sensor presence. Firmware snapshots are not a durable event stream; after startup or a contact gap, establish a baseline and tap again.

Source tests and packaged launch/shutdown checks run on Windows and both Mac architectures. SHA256SUMS.txt contains installer download checksums.
