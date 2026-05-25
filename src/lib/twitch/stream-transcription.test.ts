import { describe, expect, it } from 'vitest';

import {
  isLikelyVisionModel,
  normalizeTwitchStreamTranscriptionModel,
} from './stream-transcription';

describe('Twitch stream context model guards', () => {
  it('keeps stream transcription on the small allowlisted models', () => {
    expect(normalizeTwitchStreamTranscriptionModel('whisper-1')).toBe('whisper-1');
    expect(normalizeTwitchStreamTranscriptionModel('gpt-4o-mini-transcribe')).toBe(
      'gpt-4o-mini-transcribe',
    );
    expect(normalizeTwitchStreamTranscriptionModel('o1-pro-2025-03-19')).toBe('whisper-1');
  });

  it('blocks known premium reasoning models from stream vision context', () => {
    expect(isLikelyVisionModel('openai-responses', 'gpt-5-nano')).toBe(true);
    expect(isLikelyVisionModel('openai-responses', 'o1-pro-2025-03-19')).toBe(false);
    expect(isLikelyVisionModel('openrouter-responses', 'openai/o1-pro-2025-03-19')).toBe(
      false,
    );
    expect(isLikelyVisionModel('openrouter-responses', 'openai/gpt-5_4-pro-2026-03-05')).toBe(
      false,
    );
  });
});
