# Adventure Rooms 0.2.1

This update requires explicit RFID port numbers throughout the application.

## Changes

- RFID messages must use `UID_state_port`; messages without a port are rejected.
- Removed Legacy reader options and implicit controller/port fallbacks.
- Reader configuration requires an explicit controller ID and numbered port.
- Pairing, card capture and room timing continue to route by controller and port.
- Updated simulator, operator documentation and regression tests.

## Before updating

Quit the application and back up the complete configuration folder using **File > Open configuration folder**. This release does not automatically convert old RFID mappings or database schemas. Use a configuration already prepared for explicit ports; earlier unconverted saves require preparation before startup.

Controllers must run firmware that sends the RFID port. Assigning a port in the application does not update controller firmware. A controller can be visible through UDP while its incompatible HTTP RFID messages are rejected.

## Installers

- Windows x64: run the `windows-x64-setup.exe` installer.
- Apple Silicon Mac: open `macos-arm64.dmg` and drag Adventure Rooms to Applications.
- Intel Mac: use `macos-x64.dmg`.

Node.js is included. Venue operation stays local. Windows installers are unsigned; macOS builds are ad-hoc signed and not notarized. Operating-system security checks may affect the first launch.

Source tests and packaged startup/shutdown checks run on all three platforms before publication. SHA256SUMS.txt provides installer checksums.
