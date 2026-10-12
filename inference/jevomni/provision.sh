#!/bin/bash
# One-shot provisioning for a fresh Jev-Omni pod.
#
#   scp server.py requirements.txt provision.sh restart.sh stop.sh root@<pod>:/root/
#   ssh root@<pod> "JEVOMNI_TOKEN=... setsid /root/provision.sh > /root/provision.log 2>&1 &"
#
# Every step below is a fix for something the stock RunPod PyTorch image gets
# wrong. None of it is optional, and none of it is discoverable from the model
# card, so this file is the record of it.
set -euo pipefail
export HF_HOME=/root/hf
export JEVOMNI_REVISION=5addda86ddee081a68fb067477ea100c221b8917
cd /root

: "${JEVOMNI_TOKEN:?set JEVOMNI_TOKEN in the environment, never in this file}"

# 1. PEP 668. The image's Python is marked externally managed and pip refuses
#    to install into it without this.
pip install --no-cache-dir --break-system-packages -r requirements.txt

# 2. requirements.txt pulls torch >=2.10; the image ships torchaudio built
#    against torch 2.8. The mismatched libtorchaudio.so fails to load on an
#    undefined torch::autograd::deleteNode and takes the server down at import.
#    No torchaudio release matched torch 2.14 when this was written, so it goes.
#    Audio is unsupported as a consequence - text, image and video do not touch it.
pip uninstall -y --break-system-packages torchaudio || true
rm -rf /usr/local/lib/python3.12/dist-packages/torchaudio

# 3. The loader and the weights at one pinned revision. Jev-Omni ships
#    jev_omni.py as executable code in its model repo and the card's snippet
#    runs whatever main happens to be; a service that answers production
#    traffic pins the commit.
python - <<PY
import os, shutil
from huggingface_hub import hf_hub_download, snapshot_download
rev = os.environ["JEVOMNI_REVISION"]
shutil.copy(hf_hub_download("akhilaaa3/Jev-Omni", "jev_omni.py", revision=rev), "/root/jev_omni.py")
snapshot_download("akhilaaa3/Jev-Omni", revision=rev, allow_patterns=[
  "config.json","generation_config.json","model*.safetensors*","processor_config.json",
  "tokenizer.json","tokenizer_config.json","chat_template.jinja","decision_config.json","head.pt"])
print("weights ready")
PY

# 4. Upstream bug, patched here until it lands there. jev_omni.predict builds
#    its ffmpeg output path with NamedTemporaryFile - which creates the file -
#    and then runs ffmpeg without -y, so ffmpeg refuses to overwrite it, prints
#    "Not overwriting - exiting", and soundfile fails on the empty result.
#    Every audio request raises LibsndfileError without this; the audio path as
#    shipped cannot ever have been run.
#
#    soundfile does that decoding, not torchaudio, which is why removing
#    torchaudio in step 2 costs no functionality.
before=$(md5sum /root/jev_omni.py | cut -d' ' -f1)
sed -i 's|"ffmpeg", "-v", "error", "-i"|"ffmpeg", "-y", "-v", "error", "-i"|' /root/jev_omni.py
if [ "$before" = "$(md5sum /root/jev_omni.py | cut -d' ' -f1)" ]; then
  echo "WARNING: the ffmpeg -y patch did not apply; check whether upstream fixed it" >&2
  grep -n ffmpeg /root/jev_omni.py >&2
fi

exec /root/restart.sh
