# Aldershot render container — ffmpeg cutter for the Transcript Editor export,
# plus audio extraction (transcription) and audio enhancement ("Enhance audio").
# Wired to a Cloudflare Container binding; the Worker hands it {url} and reads
# the result back into R2.
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg nodejs ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# RNNoise model for the arnndn denoise filter (enhance-audio) — a general-
# purpose model, not fine-tuned per-user; bundled at build time so no network
# fetch happens per request. See https://github.com/richardpl/arnndn-models.
RUN curl -fsSL -o std.rnnn https://raw.githubusercontent.com/richardpl/arnndn-models/master/std.rnnn
COPY render.mjs .
EXPOSE 8080
CMD ["node", "render.mjs"]
