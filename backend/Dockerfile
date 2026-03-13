FROM nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 python3.11-dev python3-pip \
    ffmpeg curl \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.11 /usr/bin/python3 \
    && ln -sf /usr/bin/python3 /usr/bin/python

# Install PyTorch with CUDA 11.8 — supports sm_61 (GTX 1070) through sm_90
# Pinned versions so this layer stays cached even when requirements.txt changes
RUN pip install --no-cache-dir \
    torch==2.1.2 torchaudio==2.1.2 \
    --index-url https://download.pytorch.org/whl/cu118

# Force numpy<2.0 immediately after PyTorch — prevents ABI mismatch with transformers/kokoro
RUN pip install --no-cache-dir "numpy>=1.24.0,<2.0"

# Install remaining deps — changing requirements.txt only busts THIS layer
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cu118

COPY . .

EXPOSE 8000

CMD ["python", "server.py"]
