# Adventure Rooms 0.1.0

First installable release for local adventure room operations.

## Downloads

- **Windows x64:** run the `windows-x64-setup.exe` installer.
- **Mac with Apple Silicon:** open the `macos-arm64.dmg` file and drag Adventure Rooms to Applications.
- **Mac with Intel:** use `macos-x64.dmg` instead.

Node.js is included. The app opens its own window and runs an HTTP server with UDP UUPC discovery on your local network. Quit the app to stop its server. Do not run it alongside another ERCC instance or a source server using the same ports.

## Features

- Interactive room map and named RFID readers, including Start time, Stop time, Card assignment and Other roles.
- Independent room timers, multiple wristbands per team and returning-team search.
- Saved room/global rankings with explicit keep-or-replace decisions for repeat attempts.
- Room displays, room/global leaderboard displays and media automation.
- Image/video/audio library with previews and replacement without breaking references.
- Local JSON configuration and SQLite history; no cloud connection required.

Use **File > Open configuration folder** to locate the local `config` folder, then quit the app before copying or backing it up. Existing source-checkout data can be copied there while both servers are stopped; keep the whole folder together.

## Known limitations

This release is not signed with a verified publisher certificate or notarized by Apple, so operating-system security warnings may appear. It is intended for a trusted venue LAN and has no authentication. One RFID reader per UUPC is assumed. It does not send puzzle hardware commands.

Installer builds and packaged launch/shutdown checks run on Windows, Intel macOS and Apple Silicon macOS. SHA256SUMS.txt contains download checksums.
