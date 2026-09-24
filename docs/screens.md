# Local screens, media and automation

## Configure a screen

On Overview, unlock the map, choose **Add screen**, name it and optionally assign
it to a room. Drag its block to position it. Select the block and open **Screen
settings**, or visit `/screen-settings` to configure screens from the operator panel.
The map position describes the venue layout; it does not identify or connect to a
physical monitor automatically.

A screen's defaults consist of:

- A colour, image or video background.
- Team timers, enabled or disabled.
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
`media/videos` and `media/audio`. Library metadata is stored in `media.json`.
Do not move or rename those files independently of their metadata.

## Timed automation actions

Use the operator's automation controls to connect a rule to a screen action.
Each action has an explicit duration of **1 to 3600 seconds**. Its delivery mode is:

- **Replace**: replace the current action with the new action.
- **Queue**: wait for earlier actions to finish before playing the new action.

When timed actions finish, the screen returns to its configured defaults. Choose
an intentional duration even for audio and video rather than assuming a file's
length controls the action. Test the rule, target display, sound and return to
defaults before using it during a game.

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
