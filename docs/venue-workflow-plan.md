# Venue workflow

- Create teams by name, without a preset duration.
- Pair multiple equivalent wristbands continuously using a selected Card assignment reader and team; stop pairing explicitly.
- Start time and Stop time readers belong to rooms. They start and stop that team's room count-up timer once per attempt.
- Repeated taps do not restart timers or replay automation. A different room cannot start while a room timer is running.
- Reset clears all team room timings while retaining cards. Cancel produces no ranking results.
- Save requires at least one completed room and no running timer. It persists room results and their sum as the global result, then releases cards.
- Global ranking excludes time between rooms. Only saved teams appear in rankings.
- Room Screens show room elapsed time. Leaderboard Room Screens and Leaderboard Global Screens show the fastest saved results with a configurable limit.
- Room automation fires on the first accepted room start/stop, not every card placement. Team events represent first-room start and explicit Save.

All operation is local. HTTP snapshots are deduplicated and use a fresh baseline
after startup or a known contact gap. Pairing consumes matching new card events
without triggering game actions. Hardware snapshots cannot reconstruct missing
physical events. The map reflects recorded activity rather than occupancy.
