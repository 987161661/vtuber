import { useEffect, useRef } from 'react';
import type { useScreenVisionController } from '../hooks/useScreenVisionController';
import type { ScreenVisionSettings } from '../types/settings';

type ScreenVisionController = ReturnType<typeof useScreenVisionController>;

interface ScreenVisionPanelProps {
  disabled?: boolean;
  settings: ScreenVisionSettings;
  controller: ScreenVisionController;
  onDeviceIdChange: (deviceId: string) => void;
  onPromptChange: (prompt: string) => void;
  onAutoIntervalMsChange: (autoIntervalMs: number) => void;
}

const AUTO_CAPTURE_INTERVAL_OPTIONS = [
  { value: 0, label: '仅手动' },
  { value: 30_000, label: '每 30 秒' },
  { value: 60_000, label: '每 1 分钟' },
  { value: 120_000, label: '每 2 分钟' },
  { value: 300_000, label: '每 5 分钟' },
] as const;

export function ScreenVisionPanel({
  disabled = false,
  settings,
  controller,
  onDeviceIdChange,
  onPromptChange,
  onAutoIntervalMsChange,
}: ScreenVisionPanelProps) {
  const previewRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = previewRef.current;
    if (!video) {
      return;
    }

    video.srcObject = controller.stream;
    if (controller.stream) {
      void video.play();
    }

    return () => {
      video.srcObject = null;
    };
  }, [controller.stream]);

  return (
    <div className="screen-vision-panel">
      <div className="settings-field">
        <label htmlFor="screen-vision-device">摄像头输入</label>
        <select
          id="screen-vision-device"
          value={settings.deviceId}
          onChange={(event) => onDeviceIdChange(event.target.value)}
          disabled={disabled}
        >
          {controller.devices.length === 0 && (
            <option value="">正在检测摄像头……</option>
          )}
          {controller.devices.map((device, index) => (
            <option key={device.deviceId || index} value={device.deviceId}>
              {device.label || `摄像头 ${index + 1}`}
            </option>
          ))}
        </select>
        <p className="settings-field-hint">
          如需让凌岚观看直播画面，请选择 OBS Virtual Camera 并启动预览。
        </p>
      </div>

      <video
        ref={previewRef}
        className="screen-vision-preview"
        muted
        playsInline
      />

      <div className="settings-field">
        <label htmlFor="screen-vision-prompt">画面分析指令</label>
        <input
          id="screen-vision-prompt"
          type="text"
          value={settings.prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          disabled={disabled}
        />
      </div>

      <div className="settings-field">
        <label htmlFor="screen-vision-interval">自动分析间隔</label>
        <select
          id="screen-vision-interval"
          value={settings.autoIntervalMs}
          onChange={(event) =>
            onAutoIntervalMsChange(Number(event.target.value))
          }
          disabled={disabled}
        >
          {AUTO_CAPTURE_INTERVAL_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="settings-field-hint">
          仅在预览运行时，按选定间隔发送当前画面。关闭设置面板后仍会继续运行。
        </p>
      </div>

      <div className="screen-vision-actions">
        <button
          type="button"
          className="settings-action-button"
          onClick={controller.isPreviewing ? controller.stop : controller.start}
          disabled={disabled}
        >
          {controller.isPreviewing ? '停止预览' : '开始预览'}
        </button>
        <button
          type="button"
          className="settings-action-button"
          onClick={() => void controller.captureAndSend()}
          disabled={disabled || !controller.isPreviewing}
        >
          立即分析画面
        </button>
      </div>

      {controller.statusMessage && (
        <p className="settings-field-hint">{controller.statusMessage}</p>
      )}
    </div>
  );
}
