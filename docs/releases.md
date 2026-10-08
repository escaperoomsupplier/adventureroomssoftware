# Releases

## Version 0.2.0

Adventure Rooms ships as a Windows x64 NSIS Setup executable and macOS disk images
for Intel x64 and Apple Silicon arm64. The Electron desktop application opens its
own window and launches an included Node Single Executable Application (SEA)
server. Users do not install Node.js or npm.

## Installation and operation

Download the appropriate installer from the repository's
[releases page](https://github.com/escaperoomsupplier/adventureroomssoftware/releases).
Windows Setup installs for the current user. On macOS, open the DMG and drag
Adventure Rooms to Applications, then open the installed app.

Launching the desktop application starts its local server. Closing its window or
quitting the application shuts the server down. A separate browser at
`http://localhost:4000` is only a client: closing that browser does not stop the
desktop application. Remote display clients use the server computer's LAN address.

Installed builds keep writable data in the user profile, separate from executable
files. Use **File → Open configuration folder** to locate it:

| Platform | Configuration directory |
| --- | --- |
| Windows | `%APPDATA%/Adventure Rooms/config` |
| macOS | `~/Library/Application Support/Adventure Rooms/config` |

Before updating, quit the application cleanly and back up the complete configuration
directory, including media and runtime history. Install the new version and verify
the map, readers, teams and screens. Retain the backup until verification is complete.
Never run two servers against the same configuration directory.

## Signing

Windows installers are unsigned. macOS builds are ad-hoc signed and are not
notarized. They do not carry a verified publisher identity, and operating-system
security checks may block them. Publisher signing and notarization are not part
of the 0.2.0 release process.

## Build locally

Use exactly Node.js 24.11.1 for reproducible native builds. From the repository root:

```sh
npm ci
npm run build:release
npm run test:release
```

`npm ci` installs development packaging tools. `build:release` builds the SEA
server and packages the desktop installer with electron-builder. Build on the
target operating system and architecture. `test:release` checks the packaged
server and desktop application; source tests alone are not sufficient to validate
an installer.

Release smoke tests use temporary configuration, loopback networking and disabled
discovery. They must not discover or command actual venue devices. Check bundled
assets, server startup, API availability and clean shutdown.

For development without an installer, `npm start` runs the source server using
Node built-ins. No runtime package installation is required. This source mode
uses the repository's `config` directory by default and stops with Ctrl+C.

## GitHub Actions publication

Run the release workflow manually, or push the `v0.2.0` tag for this version.
The workflow builds and smoke-tests Windows x64, macOS x64 and macOS arm64.
Manual runs retain installers as workflow artifacts. A version tag publishes a
GitHub Release only after every platform job succeeds.

Before publishing, verify that:

- The package version and release tag agree: `0.2.0` and `v0.2.0`.
- Source tests and packaged server/desktop smoke checks pass on every platform.
- The release contains Windows Setup and both macOS architecture installers.
- No venue configuration, wristband data, runtime database or uploaded media is
  included in installer contents.
- Release notes identify supported platforms and signing limitations.

GitHub distributes builds; normal venue operation remains local and needs neither
a GitHub account nor Internet access.
