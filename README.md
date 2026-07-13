# VTuber Local Toolset

This repository is a source snapshot of the local VTuber integration workspace.
It combines the active AITuber OnAir application, local realtime bridges, and
the portrait-animation projects used by those integrations.

## Layout

- `aituber-onair-main/` - active AITuber OnAir monorepo and the customized
  `react-purupuru-app` runtime.
- `FlashHead-bridge/` - local FlashHead service bridge and Windows launchers.
- `LivePortrait/` - LivePortrait source imported from
  `KlingAIResearch/LivePortrait` at `9b294b3`.
- `MuseTalk/` - MuseTalk source imported from `TMElyralab/MuseTalk` at
  `0a89dec`, plus the local realtime service launcher.
- `PersonaLive-source/` - PersonaLive source imported from
  `GVCLab/PersonaLive` at `e84ad69`, plus the local driving reference asset.

## Local-only assets

Downloaded model weights, Python virtual environments, JavaScript dependencies,
runtime logs, generated media, captured audio, and tool archives are intentionally
excluded from Git. Follow each component's setup documentation to restore its
dependencies and model files after cloning.

The included upstream projects retain their own licenses. Review the license in
each component before redistribution or deployment.
