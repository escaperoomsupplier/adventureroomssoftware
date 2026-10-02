# Local screens, media and automation

## Configure a screen

On Overview, unlock the map, choose **Add screen**, name it and optionally assign
it to a room. Drag its block to position it. Select the block and open **Screen
settings**, or visit `/screen-settings` to configure screens from the operator panel.
The map position describes the venue layout; it does not identify or connect to a
physical monitor automatically.

Choose a screen type:

- **Room Screen**: upward timers for teams that have started the assigned room.
  Stopped times freeze and remain visible while the team is current.
- **Leaderboard Room Screen**: saved results for its required assigned room.
- **Leaderboard Global Screen**: saved team totals across completed rooms.

Leaderboard screens have a configurable limit of 1 to 100 results, fastest first.
A screen's defaults consist of:

- A color, image or video background.
- Room elapsed-time displays, enabled or disabled for Room Screens.
- Optional background music and its volume.

Upload media before selecting it in screen defaults or automation actions. Defaults
are the screen's normal content when no timed action is running.

## Open a physical display

Open `/screens` on the display's browser and select the intended screen. Its player
address is `/screens/:id`, where `:id` is the saved screen identifier. Use the
application server's LAN address when the display is on another computer.

Press **Start screen** on that display to allow audio playback and request
fullscreen. Browsers require this initial user gesture; opening a URL alone cannot
guarantee audible music or fullscreen. Keep the server and display browser running.
The operator's `/screen-settings` page is separate from the player.

## Media library

Media uploads remain local. The upload limit is **512 MB per file**. Supported file
types are PNG, JPEG, GIF and WebP images; MP4 and WebM video; and MP3, WAV and OGG
audio. A supported extension does not guarantee every codec will play in every
browser: preview media on the Windows or macOS display that will actually use it.

Files are stored under the configured local directory in `media/images`,
`media/videos` and `media/audio`. Library metadata is stored in `media.json`. Browse Images, Videos and Audio tabs;
images and videos include thumbnails. Preview opens a closable dialog. Edit a
name or replace a file with the same media type while keeping its ID and existing
automation/default references. Replacements update the media cache revision.
Do not move or rename those files independently of their metadata.

## Timed automation actions

Use the operator's automation controls to connect a rule to a screen action.
Image actions have a duration of **1 to 3600 seconds**. Audio and video play once to their natural end. A new action always
replaces the action currently playing on its target screen. Actions do not queue;
legacy queue rules are normalized to replacement behavior.

**Team uses Start time reader** runs only when a team's timer first starts in the
selected room. **Team uses Stop time reader** runs only when that running room
timer first stops. Duplicate placements, additional team wristbands and repeated
snapshots do not replay these actions. Resetting the team's room times permits a
new attempt and new first-start/first-stop actions.

**Team starts first room** runs on the first room start of an attempt.
**Team saved** runs when the operator saves the completed team. Cancel does not
create a result or fire the save rule.

When an action finishes, the screen returns to its configured defaults. The player
reports audio/video completion; a replaced action cannot stop newer playback.
Saving an automation clears the form for the next rule.

Screen actions affect the local display. They do not start or stop UUPC puzzle
hardware, operate a lock or verify that a team physically entered a room.

## Configuration and backup

`CONFIG_DIR` selects the configuration directory; its default is `config` under
the repository. `settings.json`, `rooms.json`, `readers.json`, `screens.json`,
`rules.json` and `media.json` are authoritative configuration, each with
`schemaVersion: 1`. Runtime data is separate in `state/runtime.sqlite`.

Stop the application before copying a venue to another computer. Copy the complete
configuration directory, including JSON files, media, runtime state and `backups`.
Do not copy only an active SQLite database while leaving its WAL behind. Restart
using the copied directory and check the network settings and each display URL.

The application migrates legacy local data automatically. Invalid configuration
stops startup with an error and preserves the existing data. Correct the indicated
file or restore a backup; do not delete runtime state to work around a validation
error. Environment variables `PORT`, `HOST` and `DISCOVERY` override saved settings
for the current run.

## Connection indicators

Screen blocks show green while at least one player browser is connected and has
sent a heartbeat in the last 30 seconds. Closing the last player turns the status
red; an interrupted network can take up to 30 seconds to expire. This indicates
browser connectivity, not whether a television is powered on or sound is enabled.
Reader indicators use the last 25 seconds of controller contact.
