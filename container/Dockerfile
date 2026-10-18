# Aldershot render container — ffmpeg cutter for the Transcript Editor export,
# plus audio extraction (transcription), audio enhancement ("Enhance audio")
# and forced alignment (container/align.py).
# Wired to a Cloudflare Container binding; the Worker hands it {url} and reads
# the result back into R2.
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
  ffmpeg nodejs ca-certificates curl python3 python3-venv libsndfile1 \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Forced alignment (decision 43). Three layers, each cached separately,
# because the model is 1.26 GB and nothing about editing it should push it
# again: the wheels change when torch does, the model when the bundle does,
# and align.py whenever we like.
#
# The CPU index, explicitly: the default wheel carries CUDA and is several
# gigabytes of driver this machine has no card for.
RUN python3 -m venv /opt/venv \
  && /opt/venv/bin/pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu \
     torch torchaudio \
  && /opt/venv/bin/pip install --no-cache-dir numpy soundfile
# The model, at build time. A container that fetched it on first use would
# make one unlucky upload wait ten minutes and would need the network at
# request time to align anything at all.
ENV TORCH_HOME=/opt/torch
RUN /opt/venv/bin/python -c "import torchaudio; torchaudio.pipelines.MMS_FA.get_model()"
# RNNoise model for the arnndn denoise filter (enhance-audio) — a general-
# purpose model, not fine-tuned per-user; bundled at build time so no network
# fetch happens per request. See https://github.com/richardpl/arnndn-models.
RUN curl -fsSL -o std.rnnn https://raw.githubusercontent.com/richardpl/arnndn-models/master/std.rnnn
COPY align.py .
COPY align.mjs .
COPY render.mjs .
EXPOSE 8080
CMD ["node", "render.mjs"]
