#!/bin/bash
# Stop whatever is serving on port 8000.
#
# This is a file, not a line in an ssh command, for a reason that cost two
# sessions: any `pkill -f` pattern that matches the server also matches the ssh
# command carrying it, so the kill takes down the shell mid-restart and leaves
# the pod serving the old code. A script's own command line is just its path,
# so nothing here can match the caller.
#
# It also does not use `fuser`: psmisc is not installed in the RunPod PyTorch
# image, so `fuser -k 8000/tcp` silently does nothing, the replacement uvicorn
# fails to bind, and the old process keeps answering with the old module in
# memory. That is exactly how a patched jev_omni.py appeared not to take.
set -euo pipefail
python3 - <<'PY'
import glob, os, signal

mine = {os.getpid(), os.getppid()}
killed = []
for entry in glob.glob("/proc/[0-9]*/cmdline"):
    pid = int(entry.split("/")[2])
    if pid in mine:
        continue
    try:
        argv = open(entry, "rb").read().decode(errors="replace").split("\0")
    except OSError:
        continue
    if any(a.endswith("uvicorn") for a in argv) and "server:app" in argv:
        try:
            os.kill(pid, signal.SIGKILL)
            killed.append(pid)
        except OSError:
            pass
print("stopped:", killed or "nothing was running")
PY
sleep 2
