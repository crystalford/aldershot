# Aldershot render container — ffmpeg cutter for the Transcript Editor export,
# plus audio extraction (transcription), audio enhancement ("Enhance audio")
# and forced alignment (container/align.py).
# Wired to a Cloudflare Container binding; the Worker hands it {url} and reads
# the result back into R2.
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
  ffmpeg nodejs ca-certificates curl python3 python3-venv libsndfile1 \
  librsvg2-bin fontconfig \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Forced alignment (decision 43). Three layers, each cached separately,
# because the model is 1.26 GB and nothing about editing it should push it
# again: the wheels change when torch does, the model when the bundle does,
# and align.py whenever we like.
#
# The CPU index, explicitly: the default wheel carries CUDA and is several
# gigabytes of driver this machine has no card for.
#
# PIP IS UPGRADED FIRST, AND THAT LINE IS LOAD-BEARING. bookworm's venv
# bundles pip 23.0.1, which resolves one of torch's dependencies to a SOURCE
# distribution and then needs flit_core to build it — and `--index-url` means
# the pytorch index is the only index there is, so:
#
#   Looking in indexes: https://download.pytorch.org/whl/cpu
#   ERROR: Could not find a version that satisfies the requirement
#          flit_core<4,>=3.11 (from versions: none)
#
# Four seconds into the build, the first time this image was ever built (CI
# run #15). A newer pip takes the wheel and never asks for a build backend.
#
# `--extra-index-url` would also fix the resolution and is the WRONG fix: it
# puts PyPI back in the running for torch itself, which is the multi-gigabyte
# CUDA build this line exists to avoid.
RUN python3 -m venv /opt/venv \
  && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
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
# ── The generated picture ─────────────────────────────────────
#
# "Graphics are code, never pixels" (invariant 8), so a generated picture
# arrives as SVG and rsvg-convert turns it into a frame. librsvg is two
# megabytes against Chromium's three hundred, and what actually decides
# whether the render matches what the person approved is not the engine — it
# is the FONTS.
#
# THE SAME TYPEFACES THE BROWSER USED, FROM THE SAME FILES. src/ui/fonts holds
# the woff2 the app serves, so the render sets its type in byte-identical
# faces rather than in whatever fontconfig falls back to. Doc 08 calls the
# generated still "the approval checkpoint": a picture approved in Instrument
# Sans and rendered in DejaVu Sans is not the picture that was approved.
#
# Measured before it was written: neither named face is in this image, and
# with a fallback the quote card's widest line reached 1739px of a 1920 frame
# — inside it, and outside the margin the rest of the picture keeps.
# scripts/check-graphics.cjs rasterises across five fonts and fails on any
# overflow.
#
# woff2 is a web container that fontconfig cannot read, so each face is
# decompressed to TTF at build time with fonttools — into the venv already
# here for the aligner, so this adds a wheel rather than a runtime.
COPY fonts/ /tmp/fonts/
RUN /opt/venv/bin/pip install --no-cache-dir fonttools brotli \
  && mkdir -p /usr/local/share/fonts/aldershot \
  && /opt/venv/bin/python -c "import glob,os;from fontTools.ttLib import TTFont;[(lambda f: (setattr(f,'flavor',None), f.save('/usr/local/share/fonts/aldershot/'+os.path.basename(s).replace('.woff2','.ttf'))))(TTFont(s)) for s in glob.glob('/tmp/fonts/*.woff2')]" \
  && fc-cache -f \
  && rm -rf /tmp/fonts \
  && fc-list | grep -qi "Instrument Sans" \
  && fc-list | grep -qi "IBM Plex Mono"

COPY align.py .
COPY align.mjs .
COPY render.mjs .
EXPOSE 8080
CMD ["node", "render.mjs"]
