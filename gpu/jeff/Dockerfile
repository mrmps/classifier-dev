FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 TOKENIZERS_PARALLELISM=false \
    OMP_NUM_THREADS=4 TORCHINDUCTOR_COMPILE_THREADS=4 HF_HOME=/cache/huggingface \
    TORCHINDUCTOR_CACHE_DIR=/cache/inductor
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv python3-dev build-essential ca-certificates git \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY recipe.lock.json fetch.py engine.py server.py entrypoint.sh ./
RUN python fetch.py --recipe /app/recipe --checkpoint /opt/model
EXPOSE 8080
ENTRYPOINT ["bash", "/app/entrypoint.sh"]
