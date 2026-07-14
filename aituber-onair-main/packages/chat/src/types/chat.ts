/**
 * AITuber OnAir Core type definitions
 */

/**
 * Chat message basic type
 */
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  timestamp?: number;
}

/**
 * Vision block type for image content
 */
export type VisionBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image_url';
      image_url: {
        url: string;
        detail?: 'low' | 'high' | 'auto';
      };
    };

/**
 * Message type corresponding to vision (image)
 */
export interface MessageWithVision {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | VisionBlock[];
}

/**
 * Chat type
 * - chatForm: Chat from text input
 * - youtube: Chat from YouTube comments
 * - vision: Chat from vision (image)
 */
export type ChatType = 'chatForm' | 'youtube' | 'vision';

export type AvatarMotion =
  | 'idle_cold'
  | 'side_glance'
  | 'lean_in'
  | 'smirk'
  | 'restrained_laugh'
  | 'serious_report'
  | 'thank_gift'
  | 'dismissive';

export type AvatarGaze = 'camera' | 'left' | 'right' | 'down';
export type AvatarGesture = 'still' | 'subtle' | 'expressive';

/**
 * screenplay (text with emotion)
 */
export interface Screenplay {
  text: string;
  emotion?: string;
  ttsText?: string;
  delivery?: string;
  emotionIntensity?: number;
  pauseAfterMs?: number;
  motion?: AvatarMotion;
  gaze?: AvatarGaze;
  gesture?: AvatarGesture;
}

export interface SpeechBeat extends Screenplay {
  /** Safe boundary where a coordinator may stop before the next beat. */
  interruptibleAfter: boolean;
}

export interface SpeechPlanV2 {
  version: 2;
  beats: SpeechBeat[];
}
