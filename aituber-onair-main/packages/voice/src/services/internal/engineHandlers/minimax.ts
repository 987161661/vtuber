import type { VoiceEngine } from '../../../engines/VoiceEngine';
import type { MinimaxVoiceServiceOptions } from '../../VoiceService';
import {
  type EngineHandler,
  type MinimaxConfigurableEngine,
  mergeOptionValues,
} from './types';

const allowedUpdateKeys = [
  'minimaxApiUrl',
  'groupId',
  'endpoint',
  'minimaxModel',
  'minimaxVoiceSettings',
  'minimaxAudioSettings',
  'minimaxSpeed',
  'minimaxVolume',
  'minimaxPitch',
  'minimaxSampleRate',
  'minimaxBitrate',
  'minimaxAudioFormat',
  'minimaxAudioChannel',
  'minimaxLanguageBoost',
  'minimaxStream',
] as const;

export const minimaxEngineHandler: EngineHandler<MinimaxVoiceServiceOptions> = {
  allowedUpdateKeys,
  applyOptions(engine: VoiceEngine, options: MinimaxVoiceServiceOptions) {
    const minimaxEngine = engine as MinimaxConfigurableEngine;

    // Current MiniMax HTTP TTS authenticates using the Bearer API key; a
    // GroupId remains optional only for legacy integrations.
    if (options.groupId && minimaxEngine.setGroupId) {
      minimaxEngine.setGroupId(options.groupId);
    }
    if (options.endpoint && minimaxEngine.setEndpoint) {
      minimaxEngine.setEndpoint(options.endpoint);
    }
    // Apply a local gateway after the provider region default.  setEndpoint
    // deliberately clears a custom URL, so this ordering is part of the
    // runtime contract rather than a cosmetic preference.
    if (options.minimaxApiUrl && minimaxEngine.setApiEndpoint) {
      minimaxEngine.setApiEndpoint(options.minimaxApiUrl);
    }
    if (options.minimaxModel && minimaxEngine.setModel) {
      minimaxEngine.setModel(options.minimaxModel);
    }
    if (
      options.minimaxLanguageBoost !== undefined &&
      minimaxEngine.setLanguage
    ) {
      minimaxEngine.setLanguage(options.minimaxLanguageBoost);
    }
    if (options.minimaxVoiceSettings && minimaxEngine.setVoiceSettings) {
      minimaxEngine.setVoiceSettings(options.minimaxVoiceSettings);
    }
    if (options.minimaxSpeed !== undefined && minimaxEngine.setSpeed) {
      minimaxEngine.setSpeed(options.minimaxSpeed);
    }
    if (options.minimaxVolume !== undefined && minimaxEngine.setVolume) {
      minimaxEngine.setVolume(options.minimaxVolume);
    }
    if (options.minimaxPitch !== undefined && minimaxEngine.setPitch) {
      minimaxEngine.setPitch(options.minimaxPitch);
    }
    if (options.minimaxAudioSettings && minimaxEngine.setAudioSettings) {
      minimaxEngine.setAudioSettings(options.minimaxAudioSettings);
    }
    if (
      options.minimaxSampleRate !== undefined &&
      minimaxEngine.setSampleRate
    ) {
      minimaxEngine.setSampleRate(options.minimaxSampleRate);
    }
    if (options.minimaxBitrate !== undefined && minimaxEngine.setBitrate) {
      minimaxEngine.setBitrate(options.minimaxBitrate);
    }
    if (
      options.minimaxAudioFormat !== undefined &&
      minimaxEngine.setAudioFormat
    ) {
      minimaxEngine.setAudioFormat(options.minimaxAudioFormat);
    }
    if (
      options.minimaxAudioChannel !== undefined &&
      minimaxEngine.setAudioChannel
    ) {
      minimaxEngine.setAudioChannel(options.minimaxAudioChannel);
    }
  },
  mergeOptions(current, update) {
    return mergeOptionValues(current, update);
  },
};
