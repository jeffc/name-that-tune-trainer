# Name That Tune Trainer

## Background

This is a practice tool to help with "name that tune" trivia. In this kind of
trivia, the host will ask participants to name either the artist/band/group or
the title of the song, then play the song, starting from the beginning. Teams
score points by entering the first letter of the requested information into
their devices (skipping articles like "a", "an", or "the"). Teams cannot change
their answer once selected. Since input devices are limited to standard letters (A-Z), songs where the normalized target answer (title or artist) begins with a number or symbol must be excluded.

Songs are chosen from popular / decently-well-known songs
from the 60s until the present day.

## Application Description

The application should help the user practice for this style of trivia. It
should prompt for either the title of the song or the name of the artist, then
start the song. The application should keep track of correct/incorrect guesses
on screen, as well as keeping a log of what's been played, the user's guess, and
the correct answer.

The application should have configuration options to set the number of questions
in a round (where the user can then stop and review), and should also let the
user select specific decades/genres to focus on (or just let it be a true
shuffle through everything) for each round.

## Core Requirements

The application should be able to run on desktop or mobile devices. The desktop
version should be runnable cross-platform within a browser. None of the versions
should require an external server to run.

## Song Selection

When starting a round, the application should select the appropriate number of
songs randomly from its lists (subject to whatever filters the user asked for)
and progress through them. It shouldn't pick duplicates.

Where to source the song lists from is one current unknown - historical
billboard charts are one option, but there might be others. The song lists will
need to be annotated with a genre (for use with filtering). Ideally, the
application could update its song lists automatically to pull in the latest
hits, since name-that-tune trivia often biases towards more recent tracks.

## Playback

Playback is another unknown. The best idea I have right now is to have the
application make calls to the spotify API to control a spotify session (running
an another browser tab or the spotify desktop/mobile app), which lets spotify
deal with the licensed content and playback controls rather than needing to do
it ourself

## Stretch Goal

The official "name that tune" trivia uses the "Speed Quizzing" App. It would
awesome if the application had a mode that could act as a speed quizzing server
that devices could connect to, but this is a stretch goal and not a core MVP
functionality.
