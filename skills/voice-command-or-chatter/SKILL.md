---
name: voice-command-or-chatter
description: Decide whether a speech transcript line is aimed at the assistant or at the other people in the room. Classifies each utterance as command, question, chatter or partial with a calibrated confidence, so an always-on microphone wakes on the two that are addressed to it and stays quiet through the rest. Use when wiring Whisper or any ASR to an agent, building a voice assistant, meeting bot or car interface, or on "it answers things nobody asked it", "false wakes", "it fires halfway through a sentence".
license: MIT
---

# Wake only on what was said to you

Continuous ASR gives you every word in the room, including the half of it that
was never meant for the assistant. A wake word solves that by making people
talk like a remote control. Classifying the utterance instead lets them talk
normally, and gives you a number to gate on.

Four labels carry it: `command`, `question`, `chatter`, `partial`.

## When not to use it

- With a wake word already in the pipeline. The wake word did the job.
- For what the command *means*. This says the line was addressed to you; your
  own model turns it into an intent and slots.
- On audio. It reads text, so ASR comes first, and its errors are yours.
- Where a false wake is expensive — a car control, a payment. Raise the gate
  and confirm out loud.

## 1. One line, to check the wiring

```
curl -s "https://classifier.dev/command,question,chatter,partial/turn+off+the+kitchen+lights"
command
```

## 2. A real run from the shell

```
npm i -g classifier-dev@0.1.3
```

`transcript.txt`, one utterance per line, straight out of the ASR:

```
classify command,question,chatter,partial \
  -i "Each line is one utterance from a live transcript of a room with a voice assistant in it. A command asks the assistant to do something, a question asks it for information, chatter is speech between people, and partial is a fragment cut off mid-utterance." \
  < transcript.txt
```

Real output, `label<TAB>confidence<TAB>text`:

```
command	1.00	turn off the kitchen lights
question	1.00	what time does the pharmacy close
chatter	1.00	so anyway i told him it was fine and he just laughed
partial	1.00	i think the
chatter	0.55	no no i meant the other one, the blue one
command	1.00	play something quiet
chatter	0.98	yeah okay so we should probably leave around six
command	0.83	can you add milk to the shopping
```

That `instructions` sentence is doing real work: it is what makes "so anyway I
told him" chatter rather than a command to tell someone something. Write it
once, from your own product's point of view, and keep it fixed.

## 3. The gate

Wake on `command` or `question` **at or above 0.85**, and only then.

- **0.85 and up — wake.** Three of the eight lines above. Three more are
  chatter or partial at 0.98 or better and never wake it at any score.
- **0.5 to 0.85 — do not wake; keep the line.** Line 8 lands at 0.83 and line 5
  at 0.55. Hold them in the window (below) and re-score when the next words
  arrive; a real request is almost always completed.
- **Below 0.5 — drop it.** This is chatter you were never part of.
- **`chatter` or `partial` — stay asleep**, whatever the confidence.

0.85 rather than the usual 0.9 because a missed wake costs a repeat and a false
wake costs trust in the microphone; move it up, not down, if the room is noisy.

**Do not put `tier: "smart"` in the wake path.** It escalates answers under 0.7
to a reasoning model, and on line 5 it did: `escalated: true`, still `chatter`,
0.52, `usage.ms` 1,713 against about 150 ms on `fast`. A second and a half is
the whole latency budget of a voice turn. Use `smart` offline, on yesterday's
transcripts, to find where the gate was wrong.

## 4. The sliding window over partials

Streaming ASR emits a growing prefix several times a second. Classifying every
emission wakes the assistant mid-sentence. Instead:

- Keep a buffer of the current utterance. Classify only when the ASR reports a
  segment boundary, or after about 600 ms of silence.
- Re-score the buffer on each new boundary, not each token.
- `partial` above 0.85 means the sentence is not finished: keep buffering, do
  not wake, do not clear.
- Clear the buffer on a wake, or after two seconds of silence.

The same four labels over one utterance as it grows:

```
partial	0.57	set a
command	0.67	set a timer
command	0.55	set a timer for twelve
command	1.00	set a timer for twelve minutes
```

Only the complete sentence clears 0.85. That is the behaviour you want, and it
is why the gate goes on the buffer rather than on each emission.

## Pitfalls

- **A line near the gate moves between runs.** Line 8 came back 0.83, 0.87 and
  0.80 on three runs of the same file. Re-score the finished utterance; do not
  wake on the first crossing of a growing prefix.
- **Every call returns one of your four labels.** Music, a television and a
  one-sided phone call all land somewhere. If those are common in the room, add
  a fifth label such as `background audio or someone else's phone call`.
- **Scores do not validate ASR input.** Include labels for punctuation, noise
  markers and other expected artifacts. Treat any unavailable score as "do not
  wake", never as zero.
- **Batch the offline pass.** Up to 1,000 utterances per call and 3,000
  classifications a minute per IP; a whole day of transcript is a few calls.

## What done looks like

Every utterance has a label and a confidence in the log. The assistant wakes
only on `command` or `question` at 0.85 or higher, a growing partial never
wakes it, and the 0.5 to 0.85 lines are kept for a weekly look at where the
gate was wrong.
