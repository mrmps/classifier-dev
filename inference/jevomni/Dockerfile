# Jev-Omni behind the System One door.
#
# The weights and the reference loader are baked in at one pinned revision.
# Jev-Omni ships jev_omni.py as executable code in its model repository and the
# card's own snippet runs it straight off `snapshot_download` at whatever main
# happens to be; a service that bills by the hour and answers production
# traffic pins the commit instead, so what runs next month is what was read
# this month.
FROM runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404

# ffmpeg is not optional: jev_omni.predict shells out to it for every audio
# request and fails with a CalledProcessError if it is missing.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

ENV JEVOMNI_REVISION=5addda86ddee081a68fb067477ea100c221b8917 \
    HF_HOME=/runpod-volume/hf \
    PYTHONUNBUFFERED=1

WORKDIR /srv
COPY requirements.txt /srv/requirements.txt
RUN pip install --no-cache-dir -r /srv/requirements.txt

# The loader, at the pinned revision, vendored next to the server rather than
# imported off a mutable sys.path at runtime.
RUN python -c "\
from huggingface_hub import hf_hub_download; import shutil, os;\
shutil.copy(hf_hub_download('akhilaaa3/Jev-Omni', 'jev_omni.py', revision=os.environ['JEVOMNI_REVISION']), '/srv/jev_omni.py')"

# Weights in the image, so a replacement pod serves on container pull alone and
# a lost volume costs nothing. ~24GB bf16.
RUN python -c "\
import os; from huggingface_hub import snapshot_download;\
snapshot_download('akhilaaa3/Jev-Omni', revision=os.environ['JEVOMNI_REVISION'], allow_patterns=[\
'config.json','generation_config.json','model*.safetensors*','processor_config.json',\
'tokenizer.json','tokenizer_config.json','chat_template.jinja','decision_config.json','head.pt'])"

COPY server.py /srv/server.py
EXPOSE 8000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log"]
