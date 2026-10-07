#!/usr/bin/env bash
set -euo pipefail
# Base image: runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404

root=${IMAJEV_ROOT:-/opt/imajev}
venv=${IMAJEV_VENV:-/opt/imajev-venv}
python -m venv --system-site-packages "$venv"
"$venv/bin/python" -m pip install \
  transformers==5.19.0 peft==0.21.2 accelerate==1.15.0 safetensors==0.8.0 \
  huggingface_hub==1.33.0 Pillow==11.0.0 fastapi==0.142.2 uvicorn==0.54.0 \
  python-multipart==0.0.32 flash-linear-attention==0.5.2
"$venv/bin/python" -m pip install causal-conv1d==1.7.0 --no-build-isolation
if [ ! -d "$root/.git" ]; then
  git clone https://github.com/mohit67890/imajev.git "$root"
fi
git -C "$root" checkout ccf586d43d2a580319b6535c893668904d909eb9
cd "$root"
"$venv/bin/python" scripts/download_model.py --model 4b
"$venv/bin/hf" download mohit67890/imajev-4b \
  --revision f8d8234cebc6c99065c07731e59716dc0a6e27ab \
  --local-dir adapters/imajev-4b --exclude 'mlx/*'
