import { DeepgramClient } from "@deepgram/sdk";
import type { TranscriptWord } from "@/types/studio";

if (!process.env.DEEPGRAM_API_KEY) {
  throw new Error("Missing DEEPGRAM_API_KEY");
}

const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

export interface TranscribeResult {
  words: TranscriptWord[];
  full_text: string;
  duration_seconds: number;
}

export async function transcribeAudio(audioUrl: string): Promise<TranscribeResult> {
  const raw = await deepgram.listen.v1.media.transcribeUrl({
    url: audioUrl,
    model: "nova-2",
    smart_format: true,
    punctuate: true,
    utterances: false,
    paragraphs: false,
  });

  // Deepgram returns ListenV1Response for sync calls; cast away the union with ListenV1AcceptedResponse
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = raw as any;

  const channel = response.results?.channels?.[0]?.alternatives?.[0];
  if (!channel) throw new Error("No transcription channel in result");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const words: TranscriptWord[] = ((channel.words ?? []) as any[]).map((w) => ({
    word: (w.word as string) ?? "",
    punctuated_word: (w.word as string) ?? "",
    start: (w.start as number) ?? 0,
    end: (w.end as number) ?? 0,
    confidence: (w.confidence as number) ?? 0,
  }));

  const full_text = channel.transcript ?? words.map((w) => w.punctuated_word).join(" ");
  const duration_seconds = response.metadata?.duration ?? (words.at(-1)?.end ?? 0);

  return { words, full_text, duration_seconds };
}
