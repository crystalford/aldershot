"""
FORCED ALIGNMENT, one window at a time, over a model loaded once.

The recogniser (Whisper) says roughly where a word is — about 110 ms, which
at 25fps is a three-frame window, which is the difference between a cut on
the breath and a cut through the start of the next word. This reads the
audio against the words the recogniser already found and says where they
actually are, to about one frame.

IT NEVER DECIDES WHAT WAS SAID. The transcript is an input. Forced alignment
is a search for the best path through an audio that produces a GIVEN
sequence, so the words that come out are the words that went in, and this
cannot invent, drop or reorder one. That is why it is here rather than a
second recognition pass: a second pass would disagree with the first, and
then the product would have two transcripts and no way to choose.

A PROCESS, NOT A SCRIPT. The model is 1.26 GB and takes about ten seconds to
load; a source is tens of windows. So this loads once and then reads one JSON
job per line from stdin, writing one JSON result per line to stdout. Anything
it says on stderr is a log and is ignored by the caller.

  in   {"wav": "/tmp/w12.wav", "words": ["i", "had", "that"]}
  out  {"ok": true, "timings": [[0.644, 0.664, 1.0], ...]}
  out  {"ok": false, "error": "..."}

Times are SECONDS from the start of that wav, which the caller offsets.
"""
import json
import sys

import torch
import torchaudio
import torchaudio.functional as AF
import soundfile as sf

# MMS_FA: an alignment model, not an ASR model repurposed, and multilingual.
# See decision 43 in docs/handoff/13-DECISIONS.md, including why the smaller
# English model is one line away if cold starts ever matter.
BUNDLE = torchaudio.pipelines.MMS_FA
SAMPLE_RATE = BUNDLE.sample_rate


def log(msg):
    print(f"align: {msg}", file=sys.stderr, flush=True)


log("loading the model")
MODEL = BUNDLE.get_model()
MODEL.eval()
DICT = BUNDLE.get_dict()
log(f"ready — {len(DICT)} tokens, {SAMPLE_RATE} Hz")


def tokenise(words):
    """
    Each word as its token ids, and the words that have none.

    A word with no token in the dictionary — a number, an emoji, a script the
    model has no letters for — cannot be aligned and must not silently take
    its neighbour's span. It is reported as unalignable and the caller leaves
    the recogniser's own timing in place.
    """
    toks, missing = [], []
    for i, w in enumerate(words):
        ids = [DICT[c] for c in w.lower() if c in DICT]
        toks.append(ids)
        if not ids:
            missing.append(i)
    return toks, missing


def align(wav_path, words):
    data, sr = sf.read(wav_path, dtype="float32", always_2d=True)
    wav = torch.from_numpy(data.T)
    if sr != SAMPLE_RATE:
        wav = AF.resample(wav, sr, SAMPLE_RATE)
    wav = wav.mean(0, keepdim=True)

    toks, missing = tokenise(words)
    flat = [t for w in toks for t in w]
    if not flat:
        return {"ok": False, "error": "no alignable words in this window"}

    with torch.inference_mode():
        emission, _ = MODEL(wav)

    """
    MORE LETTERS THAN FRAMES IS NOT AN ERROR TO CRASH ON.

    forced_align needs at least one frame per token. A window whose audio is
    shorter than its words — a seam, a bad recogniser timing — would raise,
    and one raise in the middle of a source would lose every window after it.
    It is reported instead, and those words keep the timing they had.
    """
    if emission.shape[1] < len(flat):
        return {"ok": False, "error": "window too short for its words"}

    targets = torch.tensor([flat], dtype=torch.int32)
    aligned, scores = AF.forced_align(emission, targets, blank=0)
    spans = AF.merge_tokens(aligned[0], scores[0].exp())

    # Seconds per emission frame, measured off this window rather than
    # assumed: the model's stride is a property of the model, and a hard
    # 20 ms here would be wrong the day the model changes.
    ratio = wav.shape[1] / emission.shape[1] / SAMPLE_RATE

    out, at = [], 0
    for ids in toks:
        if not ids:
            out.append(None)
            continue
        seg = spans[at:at + len(ids)]
        at += len(ids)
        if not seg:
            out.append(None)
            continue
        score = sum(s.score for s in seg) / len(seg)
        out.append([seg[0].start * ratio, seg[-1].end * ratio, score])
    return {"ok": True, "timings": out, "missing": missing}


for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        job = json.loads(line)
        result = align(job["wav"], job["words"])
    except Exception as e:  # noqa: BLE001 — one bad window must not end the process
        result = {"ok": False, "error": f"{type(e).__name__}: {e}"}
    print(json.dumps(result), flush=True)
