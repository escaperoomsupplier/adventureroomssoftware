# Adventure rooms: research and hardware analysis

Working file for the blog post and Facebook posts. Date: 2026-09-14.
Sources: wiki.escaperoomsupplier.com, www.escaperoomsupplier.com, Room Escape Artist, challengearcades.com, operator sites (Prison Island, Boda Borg, Activate, Cube Challenges).

## 1. What the industry calls them

Nobody has settled on one name. The same venue type appears as:

- adventure rooms / adventure center (Prison Island calls itself an "indoor adventure destination")
- challenge arcade (Room Escape Artist and challengearcades.com use this as the category name)
- active gaming (Activate's own term, copied by hardware vendors such as Kyda)
- action games (French market)
- quests / questing (Boda Borg)
- game arena, cells, cube challenges (brand-specific)

For our text: use "adventure rooms" in the title and first paragraph, then explain the other names once so readers searching for "challenge arcade" or "active gaming" find us.

## 2. The format

A facility is one reception (game master desk) plus a corridor with doors. Behind every door sits one short game, usually 2 to 5 minutes long. A team of 2 to 6 players walks the corridor, picks a door, taps in, plays, and comes out with points or nothing. The team buys a time window, not a game.

Concrete examples and their numbers:

| Venue | Origin | Rooms per site | Time per room | Session | Team | Identity | Scoring |
|---|---|---|---|---|---|---|---|
| Boda Borg | Sweden, 1995 (Torpshammar) | 20-25 quests, each 2-4 linked rooms | linear, no timer per room | half day to whole day | 3-5 | none needed, linear progress | pass/fail per quest |
| Prison Island | Sweden | 20-48 cells (Gothenburg 38, Belfast 31) | 2-5 min | 1 / 1.5 / 2 h | 2-5, best 3-4 | electronic key tag stores points | 25-100 pts per cell by difficulty, live ranking, printout at the end |
| Activate | Winnipeg, Canada, 2019 | ~13 rooms, 700+ levels | few minutes | 75 min typical | 2-5 | RFID wristband logs every achievement | points, levels 1-10, coop or competitive mode |
| Cube Challenges | France / Switzerland | 30 rooms | few minutes | 60 / 90 min | 2-6 | RFID wristband scanned at door starts the game | room turns green on success, points collected |

Rules that operators combine:

- free roam, any order, unlimited retries within the time window (Prison Island, Cube, Activate)
- one attempt per room (a harder variant; needs the system to remember which team already entered)
- linear quest chains where the next door opens only after the previous room (Boda Borg)
- cooperative mode (whole team against the room) or competitive mode (team against team on the leaderboard)
- points weighted by difficulty, shown on the door
- red light for time out or fail, green light for success

## 3. Why the format grew

Numbers first, then the mechanics behind them.

**Growth data**
- challengearcades.com directory: 138 sites in 18 countries (Dec 2023), 172 sites in 25 countries (Apr 2024), 379 sites in 35 countries (Feb 2026)
- Prison Island: 98+ locations, 20+ countries, franchise construction in Indianapolis budgeted at 1.5 M USD (JFB Construction, Sept 2025), new North Texas site
- Activate: 60+ locations across North America, Dubai, France, UK; 48 US facilities at end of 2025, +20 in one year, now the third-largest "escape room" chain in the US by facility count; licensing deal with Hadrena for 6 Western European countries, first France site at Val d'Europe (Oct 2025)
- Boda Borg: 11 sites, ~5 M guests served, 20+ M USD annual revenue, Berlin site (3,300 m²) planned for mid-2027
- Room Escape Artist, US report Dec 2025: about 2,000 escape room facilities, flat since 2022; challenge arcades counted inside that number went from 48 to 71 (+47 % year over year); classic escape room bookings are 78 % private

**Why operators build them**
1. Throughput. A classic escape room takes one group per hour. A corridor with 20 doors takes 15 to 20 teams in the same hour, each team paying for 60 to 120 minutes.
2. Replayability. A team that scored 600 of 1,200 points has a reason to come back. An escape room player who saw the ending has none. Leagues and seasonal rankings feed on this.
3. Staff per player. One person at the desk checks teams in. Nobody watches a camera feed per room, nobody resets a room between groups. Rooms reset themselves when the door closes.
4. Reset time close to zero. Short physical or skill games rarely leave props on the floor.
5. Audience width. Prison Island sells "9 to 99". Physical, technical and tactical cells let a family or a corporate group mix skills.
6. Social media. Short, visual, competitive games film well (Activate's Mega Grid went viral on TikTok).
7. Corporate groups of 30 to 200 fit at once; Boda Borg accepts 200+ and splits them into small teams.

**Why the format is hard to copy**
- Each brand runs a closed, proprietary control system. Franchise fees and white-label hardware are the entry ticket.
- The core technical problem repeats at every door: know which team is standing there, let them in, start a clock, judge success, store the result with a timestamp, show it on a screen in the corridor and on the ranking. Operators who build with off-the-shelf escape room electronics used to hit a wall at "know which team".

## 4. Identity: QR codes versus RFID

QR codes on a printed card or a phone screen:
- need a camera and line of sight; 3 to 6 seconds per scan in practice (wristband industry data), glare and cracked screens cause failed reads
- printed codes cannot be reassigned; a phone screen can be photographed and shared
- players carry a phone into a physical game, or hold a paper card while climbing
- every reader is a camera plus a computer, which costs more than an RFID reader

RFID wristbands (13.56 MHz, ISO 14443A / MIFARE):
- tap and go, 0.1 to 0.3 s per read, no alignment
- every band has a factory unique ID (UID). The system creator maps UID to team in software at check-in, so the same 200 bands serve every group forever
- silicone bands survive water, sweat and climbing; they cost roughly 1 to 3 USD each in bulk (YARONGTECH, ABC RFID and similar suppliers)
- the reader hides behind plywood, plastic or glass (not metal)

Every branded venue in the table above uses an RFID key tag or wristband. This is the part the new UUPC feature unlocks for independent builders.

## 5. What ERS hardware does today (verified on the wiki, Sept 2026)

### RFID sensor
- Product: https://www.escaperoomsupplier.com/product/rfid-sensor/
- Manual: https://wiki.escaperoomsupplier.com/wiki/RFID_sensor_manual
- 13.56 MHz, ISO 14443A (MIFARE). Reads cards, tags, stickers and any other ISO 14443A object, so third-party MIFARE wristbands work.
- Read range through plywood: card 30 mm, sticker 18 mm, tag 12 mm. A wristband sits in the middle, so players tap the band on the marked spot rather than wave it.
- Teaching mode registers up to 18 items per sensor for classic "put the right object here" puzzles. For adventure rooms we do not use teaching at all; the controller forwards every UID it sees.
- Consumables in the shop: RFID card https://www.escaperoomsupplier.com/product/rfid-card/, RFID tag https://www.escaperoomsupplier.com/product/rfid-tag/, RFID sticker https://www.escaperoomsupplier.com/product/rfid-sticker/. Wristbands are not in the shop; recommend any MIFARE Classic 1K silicone wristband.
- Related: Multi RFID sensor https://www.escaperoomsupplier.com/product/multi-rfid-puzzle/ (several readers on one unit), RFID Activation Circle sensor https://www.escaperoomsupplier.com/product/rfid-activation-circle-sensor/ (275 mm ring with LED progress ring, 1 to 60 s hold; a good "check-in pad" at the entrance or a co-op hold inside a room).

### Ultimate Universal puzzle controller (UUPC)
- Products: 2 ports https://www.escaperoomsupplier.com/product/ultimate-universal-puzzle-controller-2-ports/, 8 ports https://www.escaperoomsupplier.com/product/ultimate-universal-puzzle-controller-8-ports/, 16 https://www.escaperoomsupplier.com/product/ultimate-universal-puzzle-controller-16-ports/, 24 https://www.escaperoomsupplier.com/product/ultimate-universal-puzzle-controller-24-ports/, 32 https://www.escaperoomsupplier.com/product/ultimate-universal-puzzle-controller-32-ports/
- Manual: https://wiki.escaperoomsupplier.com/wiki/Ultimate_Universal_Puzzle_Controller
- API: https://wiki.escaperoomsupplier.com/wiki/Ultimate_Universal_Puzzle_Controller_API
- New feature page: https://wiki.escaperoomsupplier.com/wiki/Ultimate_Universal_Puzzle_Controller_-_how_to_read_RFID_cards_in_your_own_software
- Course: https://wiki.escaperoomsupplier.com/wiki/UUPC_course
- 8 game modes (STATE, SEQUENCE, IMPULSE, ELIMINATION, MASTERMIND, SIMON SAYS, WHACK-A-MOLE, RFID DISPLAY). Modes 6 and 7 are ready-made adventure-room games on their own (repeat the light pattern, hit the lit buttons before the timeout).
- Machine states: 0 ARMED, 1 IN PROGRESS, 2 WIN, 3 LEARNING. External software can read and set them.
- Output relay module (7 A, potential-free) drives electromagnets or any 12-240 V device on win.
- Sound from USB stick, WAV, ambient loop, per-port sounds, win sequence (prewin / win / postwin). The length of 9998win.wav sets how long outputs stay active, which is how you time a door release.

**RFID UID reporting, four ways (the new feature)**
Every card placed or removed on any RFID sensor produces an event `AABBCCDD_1` (8 hex characters UID, `_1` placed, `_0` removed).
1. HTTP polling: `GET http://<UUPC_IP>/rfid/history` returns the last 10 events with sequence numbers. Simplest; the wiki ships a 20-line Python example that polls once per second.
2. Webhook push (ERCC emulation): the UUPC POSTs its full state JSON to port 4000 of whoever sent the discovery packet (`Hello_from_ERCC` on UDP 9811); the UID sits in `message.RFID`. Only one listener at a time, so this conflicts with running ERCC on the same network.
3. MQTT: topic `UPC_<ID>/get/message_last_rfid`, broker set in the web interface, credentials UPC/UPC. Fits Node-RED and dashboards.
4. OSC: `/UPC_<ID>/get/message_last_rfid` on UDP 53000, for QLab and show control.
The same channels carry `machine_state`, so the server learns "team X entered at 14:02:10" and "room won at 14:04:31" from one device.

Mode 8 (RFID DISPLAY, SW4+) is the offline cousin: a text file on the USB stick maps UIDs to 4-character messages on an LED display. Useful for a "HI 07" greeting at the door without any server, not enough for scoring.

### Locks and doors
- Electromagnet output set (70 kg for lids and drawers, 180 kg for doors): https://www.escaperoomsupplier.com/product/electromagnet-output-set/ , manual https://wiki.escaperoomsupplier.com/wiki/Electromagnet_output_set_manual
- Door pusher (spring, no power, swings the door open the moment the magnet releases): https://www.escaperoomsupplier.com/product/door-pusher/
- Electro-lock output set (strike lock alternative): https://www.escaperoomsupplier.com/product/electro-lock-output-set/
- Magnetic padlock for boxes inside rooms: https://www.escaperoomsupplier.com/product/magnetic-padlock/

### Sensors that make good 3-minute games
- Arcade Button sensor https://www.escaperoomsupplier.com/product/arcade-buttons-sensor/, LED Button sensor https://www.escaperoomsupplier.com/product/led-button-sensor/, LED Flat Button https://www.escaperoomsupplier.com/product/led-flat-button-sensor/, Foot Button https://www.escaperoomsupplier.com/product/foot-button-sensor/, Panic Button https://www.escaperoomsupplier.com/product/panic-button-sensor/, RGB Button https://www.escaperoomsupplier.com/product/rgb-button-sensor/
- Pull-to-unlock https://www.escaperoomsupplier.com/product/pull-to-unlock-sensor/, Rotate-to-unlock https://www.escaperoomsupplier.com/product/rotate-to-unlock-sensor/
- Monostable sensors listed as compatible with SIMON SAYS / WHACK-A-MOLE: Arcade Button, Foot Button, Hall, Hands & Body, Ignition, Joystick, Knock Knock, LED Button, LED Flat Button, Light, Magnetic, Metal, Mystery Hole, Optical Tripwire, Pressure Mat, Pull-to-unlock, Small Red Button, Small Tripwire, Touch Plate
- Game examples the user gave: "press the button on the far wall without touching the floor" = pressure mats as fail sensors + a button as the win sensor; the UUPC in STATE or SEQUENCE mode reports WIN only if the mats stayed untriggered. Tripwires (laser maze), knock patterns, Simon Says walls, whack-a-mole grids all come from the same box.

### Timers and displays
- Escape Room Timer https://www.escaperoomsupplier.com/product/escape-room-timer/ with Big timer display https://www.escaperoomsupplier.com/product/additional-timer-display-for-escape-room-timer/ and Small timer display https://www.escaperoomsupplier.com/product/small-timer-display-for-escape-room-timer/ for an in-room countdown without a PC
- Any HDMI monitor or tablet with a browser can show an ERCC player screen instead

### Escape Room Command Center (ERCC)
- Product: https://www.escaperoomsupplier.com/product/escape-room-command-center-software/ (from 19 zł/month, 30-day trial, one year free with a UPC purchase)
- Wiki: https://wiki.escaperoomsupplier.com/wiki/Escape_Room_Command_Center , features https://wiki.escaperoomsupplier.com/wiki/All_ERCC_features , API https://wiki.escaperoomsupplier.com/wiki/Escape_Room_Command_Center_API
- Runs on the game master PC, auto-detects every UUPC on the LAN, shows puzzle states live, starts and stops timers, sends hints, drives player screens on any browser at `PC_IP:4000`.
- REST API on port 4000: list rooms, start/pause/reset/add time, send hints, set virtual device states.
- Limit: 4 rooms per instance by default, "expandable on request". A 20-door corridor needs that expansion or a custom server.
- Not documented in ERCC: points, teams, leaderboards, per-team timestamps. That logic lives in the system creator's own server (the Python / Node-RED layer), which then feeds a web page for the corridor monitors.

## 6. Bill of materials for one facility

**Central (once)**
- game master PC (Windows/Mac/Linux) running ERCC and/or the custom scoring server
- gigabit switch with one port per UUPC, plus router with DHCP
- one RFID sensor + 2-port UUPC at the desk as the check-in reader (pair bands to a team name)
- monitors in the corridor (any HDMI screen with a browser, Chromecast, or tablet) showing room status: READY / IN PROGRESS / DONE + points, and the live ranking
- 100 to 300 MIFARE Classic 1K silicone wristbands (third-party)

**Per game room**
- 1 UUPC (8 ports covers reader + door magnet + 4-6 game sensors; 16 ports for whack-a-mole grids)
- 1 RFID sensor at the door, hidden behind a plywood or acrylic plate with a printed "tap here" mark
- 1 electromagnet output set 180 kg + door pusher (door opens on tap, closes and locks when the team leaves)
- game sensors (buttons, mats, tripwires, pull/rotate) as fail and win inputs
- optional: Escape Room Timer display, LED strip via LED controller for red/green state, speaker for the win/lose sound from the UUPC

**Flow per door (one UUPC does it all)**
1. Band tap → UUPC reports `UID_1` → server checks team, session time left, attempts rule.
2. Server sets the UUPC machine state to IN PROGRESS and the door magnet output high; door pusher swings the door; timestamp saved.
3. Inside, sensors run the puzzle; the UUPC counts steps; WIN state fires, or the server stops the round when the room timer expires.
4. Server records WIN/FAIL + duration, adds points, pushes the update to the corridor page and the ranking; the UUPC returns to ARMED after the postwin sound.

Design decisions to state in the article: use HTTP polling or MQTT when ERCC also runs on the LAN (only one webhook listener is allowed); use ERCC emulation when the custom server replaces ERCC entirely.

## 7. Answers from Marcin (2026-09-14)

1. Version: HWGSW7, August 2026. Changelog entry: "Improved MQTT stability. RFID card events (card placed / card removed) are now reported through the remote API - ERCC, MQTT, OSC and a new HTTP endpoint." Source: https://wiki.escaperoomsupplier.com/wiki/Ultimate_Universal_Puzzle_Controller#23._Changelog . HWGSW8 (September 2026) added ambient audio.
2. Scoring, teams, leaderboard: the builder's own server. ERS software (ERCC) is not built for this game type; the post says so.
3. Wristbands: ERS will not stock them. The post recommends third-party MIFARE Classic 1K / ISO 14443A silicone bands and warns that 125 kHz bands will not work.

Still unmeasured: wristband read range through a plywood plate (card 30 mm, tag 12 mm are the published figures). The post tells players to tap the band on the marked spot.

## 8. Proposed content plan

Blog post (Type 1, ~1,500-2,000 words), file `01_blog_adventure_rooms.md`:
1. The corridor with twenty doors (what adventure rooms are, the names, the four brands and their numbers)
2. Why operators are building them (throughput, replay, staff, reset, audience, TikTok)
3. Rules you can choose (free roam, one attempt, linear, coop/competitive, weighted points)
4. The hardware problem every door repeats (identity, access, timing, verdict, record, display)
5. Wristbands versus QR codes
6. Software layer: what the UUPC now tells your server (four channels, event format, machine states, 20-line Python)
7. Hardware layer: bill of materials per door and for the desk, with links
8. One door, one minute: the flow step by step
9. Starting small: three doors, one UUPC each, one PC, one monitor

Facebook posts (each in its own file `fb_01_...md` to `fb_05_...md`):
1. Announcement: UUPC now hands you every RFID UID it sees, four ways; link to wiki page
2. Trend note: challenge arcades 138 → 379 sites in 26 months; Activate now third-largest US chain
3. "One door, one UUPC" diagram post: tap, open, play, score
4. Wristbands vs QR codes in five lines
5. Build-it-small: what three adventure rooms cost in hardware (pull prices from the shop when writing)
