# Aldershot render container — ffmpeg cutter for the Transcript Editor export.
# Wired to a Cloudflare Container binding in a later step; the Worker hands it
# {mediaKey, ranges} and it renders the cut MP4 back into R2.
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg nodejs ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY render.mjs .
EXPOSE 8080
CMD ["node", "render.mjs"]
