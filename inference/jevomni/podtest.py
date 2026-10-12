#!/usr/bin/env python3
"""Every modality, every input bound, and temp-file hygiene - run on the pod.

    JEVOMNI_TOKEN=... python3 podtest.py [billing.wav technical.wav]

Run it on the pod against localhost rather than through RunPod's proxy, so the
result is about the model and the door and not about whoever's uplink is
carrying a 240KB audio body. (On a slow residential uplink that alone can take
tens of seconds; from a datacenter client the proxy moves the same body in
under two.)

Image and video fixtures are built here with PIL and ffmpeg, both already on
the pod. Speech cannot be synthesised on the pod, so the audio checks run only
when two clips are passed - one asking for a refund, one reporting a crash. On
macOS:

    say -o billing.wav --data-format=LEI16@16000 "I was charged twice for the same order and would like one payment refunded."
    say -o technical.wav --data-format=LEI16@16000 "Every time I open the settings screen the app crashes."
"""
import base64, glob, json, os, subprocess, sys, tempfile, urllib.error, urllib.request

TOK = os.environ.get("JEVOMNI_TOKEN") or sys.exit("set JEVOMNI_TOKEN")
URL = os.environ.get("JEVOMNI_LOCAL", "http://localhost:8000") + "/v1/systemone"
MIME = {".png": "image/png", ".wav": "audio/wav", ".mp4": "video/mp4"}
FIXTURES = tempfile.mkdtemp(prefix="jevomni-fixtures-")


def fixtures():
    """A red PNG, a green clip, and a clip that is red for 2s then blue for 2s."""
    from PIL import Image
    Image.new("RGB", (256, 256), (220, 30, 30)).save(f"{FIXTURES}/red.png")

    def clip(colour, seconds, out):
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi",
                        "-i", f"color=c={colour}:s=256x256:d={seconds}",
                        "-r", "8", "-pix_fmt", "yuv420p", out], check=True)

    clip("green", 4, f"{FIXTURES}/green.mp4")
    clip("red", 2, f"{FIXTURES}/r.mp4")
    clip("blue", 2, f"{FIXTURES}/b.mp4")
    with open(f"{FIXTURES}/list.txt", "w") as f:
        f.write(f"file {FIXTURES}/r.mp4\nfile {FIXTURES}/b.mp4\n")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
                    "-i", f"{FIXTURES}/list.txt", "-c", "copy", f"{FIXTURES}/red_then_blue.mp4"], check=True)


def data_url(path):
    blob = open(path, "rb").read()
    return f"data:{MIME[os.path.splitext(path)[1]]};base64,{base64.b64encode(blob).decode()}"


def post(body):
    req = urllib.request.Request(URL, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + TOK})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def choice(question, labels):
    return {"type": "choice", "instructions": question, "criteria": {l: None for l in labels}}


results = []


def check(name, ok, detail):
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {name:<46} {detail}")


def modality(name, state, question, labels, expected, media=None):
    body = {"state": [{"id": "a", "text": state}], "questions": {"a": choice(question, labels)}}
    if media:
        body["media"] = [data_url(media)]
    status, payload = post(body)
    if status != 200:
        return check(name, False, f"{status} {payload.get('error', {}).get('type')}")
    a = payload["answers"]["a"]
    check(name, a["choice"] == expected,
          f"{a['choice']} @ {a['confidence']:.4f} (want {expected})  {payload['usage']['inference_ms']}ms")


def refused(name, body):
    status, payload = post(body)
    kind = payload.get("error", {}).get("type")
    check(name, status == 400 and kind == "jevomni_input", f"{status} {kind}")


fixtures()
ITEM = "Which category does item `a` belong to?"

print("--- modalities")
modality("text", "I was charged twice and want a refund.", ITEM, ["billing", "technical"], "billing")
modality("image", "An image is attached.", "What is the dominant colour in the attached image?",
         ["red", "green", "blue", "yellow"], "red", f"{FIXTURES}/red.png")
modality("video", "A short video is attached.", "What colour fills the attached video?",
         ["red", "green", "blue", "yellow"], "green", f"{FIXTURES}/green.mp4")
modality("video, temporal order", "A short video is attached.",
         "Which colour appears FIRST in the attached video?", ["red", "blue"], "red",
         f"{FIXTURES}/red_then_blue.mp4")
if len(sys.argv) == 3:
    for clip, expected in zip(sys.argv[1:], ["billing", "technical"]):
        modality(f"audio, {os.path.basename(clip)}", "The attached audio is a support voicemail.",
                 "Which category does the request in item `a` belong to?",
                 ["billing", "technical", "account"], expected, clip)
else:
    print("      (audio skipped: pass billing.wav technical.wav to run it)")

print("--- every advertised format")
from PIL import Image
red = Image.new("RGB", (256, 256), (220, 30, 30))
red.save(f"{FIXTURES}/red.jpg", quality=90)
red.save(f"{FIXTURES}/red.webp")
red.save(f"{FIXTURES}/red_static.gif")
COLOUR_Q, COLOURS = "What is the dominant colour in the attached image?", ["red", "green", "blue", "yellow"]
for ext, mime in [("jpg", "image/jpeg"), ("webp", "image/webp"), ("static.gif", "image/gif")]:
    path = f"{FIXTURES}/red.{ext}" if ext != "static.gif" else f"{FIXTURES}/red_static.gif"
    body = {"media": [f"data:{mime};base64,{base64.b64encode(open(path, 'rb').read()).decode()}"],
            "state": [{"id": "a", "text": "An image is attached."}], "questions": {"a": choice(COLOUR_Q, COLOURS)}}
    status, payload = post(body)
    got = payload["answers"]["a"]["choice"] if status == 200 else payload.get("error", {}).get("type")
    check(mime, got == "red", f"{status} {got}")
subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=green:s=256x256:d=4", "-r", "8",
                "-c:v", "libvpx-vp9", "-b:v", "200k", f"{FIXTURES}/green.webm"], check=True)
status, payload = post({"media": [f"data:video/webm;base64,{base64.b64encode(open(f'{FIXTURES}/green.webm', 'rb').read()).decode()}"],
                        "state": [{"id": "a", "text": "A short video is attached."}],
                        "questions": {"a": choice("What colour fills the attached video?", COLOURS)}})
got = payload["answers"]["a"]["choice"] if status == 200 else payload.get("error", {}).get("type")
check("video/webm (vp9)", got == "green", f"{status} {got}")
if len(sys.argv) == 3:
    for codec, ext, mime in [("libmp3lame", "mp3", "audio/mpeg"), ("aac", "m4a", "audio/mp4"),
                             ("libopus", "webm", "audio/webm")]:
        out = f"{FIXTURES}/billing.{ext}"
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", sys.argv[1], "-c:a", codec, "-b:a", "64k",
                        *(["-f", "webm"] if ext == "webm" else []), out], check=True)
        status, payload = post({"media": [f"data:{mime};base64,{base64.b64encode(open(out, 'rb').read()).decode()}"],
                                "state": [{"id": "a", "text": "The attached audio is a support voicemail."}],
                                "questions": {"a": choice("Which category does the request in item `a` belong to?",
                                                          ["billing", "technical", "account"])}})
        got = payload["answers"]["a"]["choice"] if status == 200 else payload.get("error", {}).get("type")
        check(mime, got == "billing", f"{status} {got}")

print("--- question shapes over media")
png_url = data_url(f"{FIXTURES}/red.png")
status, payload = post({"media": [png_url], "state": [{"id": "a", "text": "An image is attached."}],
                        "questions": {"yes": {"type": "noul", "instructions": "Is the attached image predominantly red?"},
                                      "no": {"type": "noul", "instructions": "Is the attached image predominantly blue?"}}})
if status == 200:
    y, n = payload["answers"]["yes"]["noul"], payload["answers"]["no"]["noul"]
    check("noul over an image, true and false", y > 0.5 > n, f"red?={y:.3f} blue?={n:.3f}")
else:
    check("noul over an image, true and false", False, str(status))
if len(sys.argv) == 3:
    status, payload = post({"media": [data_url(sys.argv[2])],
                            "state": [{"id": "a", "text": "The attached audio is a support voicemail."}],
                            "questions": {"cat": choice("Which category does the request in item `a` belong to?",
                                                        ["billing", "technical", "account"]),
                                          "crash": {"type": "noul", "instructions": "Does the caller in item `a` report the app crashing?"},
                                          "refund": {"type": "noul", "instructions": "Does the caller in item `a` ask for a refund?"}}})
    if status == 200:
        a = payload["answers"]
        check("3 questions over one audio clip",
              a["cat"]["choice"] == "technical" and a["crash"]["noul"] > 0.5 > a["refund"]["noul"],
              f"cat={a['cat']['choice']} crash?={a['crash']['noul']:.3f} refund?={a['refund']['noul']:.3f}")
    else:
        check("3 questions over one audio clip", False, str(status))

print("--- truncation is refused, not answered")
frames = [Image.new("RGB", (128, 128), c) for c in [(220, 30, 30)] * 5 + [(30, 30, 220)]]
frames[0].save(f"{FIXTURES}/animated.gif", save_all=True, append_images=frames[1:], duration=200, loop=0)
refused("animated gif refused",
        {"media": [f"data:image/gif;base64,{base64.b64encode(open(f'{FIXTURES}/animated.gif', 'rb').read()).decode()}"],
         "state": [{"id": "a", "text": "x"}], "questions": {"a": choice(COLOUR_Q, COLOURS)}})
if len(sys.argv) == 3:
    for secs, ok_status in [(29, 200), (31, 400)]:
        out = f"{FIXTURES}/pad{secs}.mp3"
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", sys.argv[1], "-af", f"apad=whole_dur={secs}",
                        "-t", str(secs), "-c:a", "libmp3lame", "-b:a", "64k", out], check=True)
        status, payload = post({"media": [f"data:audio/mpeg;base64,{base64.b64encode(open(out, 'rb').read()).decode()}"],
                                "state": [{"id": "a", "text": "x"}],
                                "questions": {"a": choice("Which category?", ["billing", "technical"])}})
        check(f"{secs}s audio {'accepted' if ok_status == 200 else 'refused'}", status == ok_status, str(status))

print("--- bounds")
status, _ = post({"state": [{"id": "a", "text": "x" * 32_000}], "questions": {"a": choice(ITEM, ["x", "y"])}})
check("32,000-char item accepted", status == 200, str(status))
refused("32,001-char item refused",
        {"state": [{"id": "a", "text": "x" * 32_001}], "questions": {"a": choice(ITEM, ["x", "y"])}})
refused("text + rubric over the item cap refused",
        {"state": [{"id": "a", "text": "x" * 20_000, "rubric": "y" * 13_000}],
         "questions": {"a": choice(ITEM, ["x", "y"])}})
refused("5 questions x 30K item refused (150K read)",
        {"state": [{"id": "a", "text": "x" * 30_000}],
         "questions": {f"q{i}": choice(ITEM, ["x", "y"]) for i in range(5)}})
refused("media over 900,000 chars refused",
        {"media": ["data:image/png;base64," + "A" * 900_001], "state": [{"id": "a", "text": "x"}],
         "questions": {"a": choice(ITEM, ["x", "y"])}})

print("--- temp files")
png = data_url(f"{FIXTURES}/red.png")
before = set(glob.glob("/tmp/tmp*"))
post({"media": [png], "state": [{"id": "a", "text": "x"}],
      "questions": {"a": {"type": "choice", "instructions": "?", "criteria": {"only": None}}}})
leaked = set(glob.glob("/tmp/tmp*")) - before
check("refused media request leaves nothing in /tmp", not leaked, f"new files: {sorted(leaked) or 'none'}")
before = set(glob.glob("/tmp/tmp*"))
post({"media": [png], "state": [{"id": "a", "text": "An image."}],
      "questions": {"a": choice("What colour is the image?", ["red", "blue"])}})
leaked = set(glob.glob("/tmp/tmp*")) - before
check("answered media request leaves nothing in /tmp", not leaked, f"new files: {sorted(leaked) or 'none'}")

print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
