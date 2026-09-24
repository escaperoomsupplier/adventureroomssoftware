# Venue workflow

## Delivery tasks

- Team lifecycle: prepare a team with a duration; assign cards before starting; start manually or at a start reader; finish manually or at a finish reader.
- Reception: separate hours and minutes, default one hour; explicit fresh-card capture with waiting, cancellation and timeout; confirmation before assignment.
- Reader registry: friendly names, explicit configuration, room assignment and entry/start/finish roles.
- Venue map: grid, room positioning and resizing, reader positioning, fit-to-view lock, selection and editable details.
- Team overview: timers, last scanned room and chronological room visits.
- Leaderboard: completed games ranked by elapsed time; remove results without deleting team history.
- Compact diagnostics: reader table, on-demand technical details and at most 15 recent RFID events.
- Interface cleanup: remove old round tracking, footer slogans and redundant navigation/header status text.
- Integration: preserve existing local data, verify HTTP/UDP transport, atomic scan processing, recovery and browser interactions.

## Rules

Creating a team does not start its clock. A start reader starts a prepared team once;
further start scans do not reset the timer. Entry readers record the latest scanned
room for active teams. Repeated scans in the same room do not duplicate a visit.
A finish reader completes an active game; expired and cancelled games do not enter
the leaderboard. Ranking measures total elapsed game time, not puzzle machine states.
The latest scanned room is an indication of team location, not proof of occupancy.

Explicit reception card capture consumes the selected scan for assignment rather
than triggering a game action. A cached UID is never copied automatically. Reader
snapshots have no durable event sequence, so restart and detected contact gaps must
reestablish a baseline before automatic game actions resume.

Implementation is split into independent changes for domain storage, reception,
map interaction and final application integration. Each change is reviewed through
a pull request before integration on the main branch.
