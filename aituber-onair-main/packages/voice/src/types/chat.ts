/**
 * Chat and screenplay related types for voice package
 */

/**
 * screenplay (text with emotion)
 */
export interface VoiceProsody {
  /** All values are normalized from -1 (less) to 1 (more). */
  pace?: number;
  pitch?: number;
  volume?: number;
  warmth?: number;
  tension?: number;
  energy?: number;
  assertiveness?: number;
  breathiness?: number;
}

export interface ChatScreenplay {
  text: string;
  emotion?: string;
  /**
   * Text sent to the speech engine. It may contain provider-supported vocal
   * tags such as `(laughs)` while `text` remains clean for chat display.
   */
  ttsText?: string;
  /** A compact delivery hint chosen by the character planner. */
  delivery?: string;
  /** 0-1 strength for the selected emotion. */
  emotionIntensity?: number;
  /**
   * Composable delivery controls. Engines use the controls they support and
   * ignore the rest, so a screenplay is portable across providers.
   */
  prosody?: VoiceProsody;
  /** Optional pause after the line, in milliseconds. */
  pauseAfterMs?: number;
  motion?:
    | 'idle_cold'
    | 'side_glance'
    | 'lean_in'
    | 'smirk'
    | 'restrained_laugh'
    | 'serious_report'
    | 'thank_gift'
    | 'dismissive';
  gaze?: 'camera' | 'left' | 'right' | 'down';
  gesture?: 'still' | 'subtle' | 'expressive';
}

export interface SpeechBeat extends ChatScreenplay {
  interruptibleAfter: boolean;
}

export interface SpeechPlanV2 {
  version: 2;
  beats: SpeechBeat[];
}

/**
 * Speech synthesis options
 */
export interface SpeakOptions {
  speed?: number;
  pitch?: number;
  intonation?: number;
  volumeScale?: number;
}
