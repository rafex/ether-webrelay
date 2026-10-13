import { MediaPipeEffects } from './infrastructure/effects/mediapipe-effects';
import { WebRelayApp } from './ui/app';
import { recordingToggle } from './ui/call-recorder';

void new WebRelayApp((config) => {
  const effects = new MediaPipeEffects(config.effectsModelUrl);
  return {
    effects,
    backgrounds: () => effects.backgrounds(),
    uploadBackground: (file) => effects.registerImage(file),
    effectsStatus: () => effects.status,
    recorder: recordingToggle,
  };
}).start();
