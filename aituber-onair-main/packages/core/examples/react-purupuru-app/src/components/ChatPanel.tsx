import type { ChatMessage } from '../types/chat';
import type { AvatarViewTransform, VisualSettings } from '../types/settings';
import type { PuruPuruAvatarPackage } from '../lib/purupuruPackage';
import type { PuruPuruReaction } from '../lib/purupuruReactions';
import { AvatarBackground } from './AvatarPanel';
import { ChatLog } from './ChatLog';
import { ChatInput } from './ChatInput';
import type { AvatarMotion } from '../lib/avatarMotion';

interface ChatPanelProps {
  messages: ChatMessage[];
  partialResponse: string;
  isProcessing: boolean;
  onSend: (text: string) => void;
  onToggleSettings: () => void;
  mouthLevel: number;
  voiceLevel: number;
  isSpeaking: boolean;
  avatarPackage?: PuruPuruAvatarPackage | null;
  avatarReaction?: PuruPuruReaction | null;
  backgroundImageUrl?: string | null;
  visual: VisualSettings;
  avatarViewTransform: AvatarViewTransform;
  onAvatarViewTransformChange: (transform: AvatarViewTransform) => void;
  overlay?: boolean;
  avatarMotion?: AvatarMotion;
  usePersonaLiveAvatar?: boolean;
  speakingAvatarVideoUrl?: string | null;
}

export function ChatPanel({
  messages,
  partialResponse,
  isProcessing,
  onSend,
  onToggleSettings,
  mouthLevel,
  voiceLevel,
  isSpeaking,
  avatarPackage,
  avatarReaction,
  backgroundImageUrl,
  visual,
  avatarViewTransform,
  onAvatarViewTransformChange,
  overlay = false,
  avatarMotion = 'idle_cold',
  usePersonaLiveAvatar = false,
  speakingAvatarVideoUrl = null,
}: ChatPanelProps) {
  const isBroadcast = visual.layoutMode === 'broadcast';
  const shouldShowInput = !isBroadcast || visual.showInputInBroadcast;
  const latestAssistantMessage = [...messages]
    .reverse()
    .find((message) => message.role === 'assistant');
  const broadcastCaption =
    partialResponse || latestAssistantMessage?.content.trim() || '';
  const panelStyle = overlay
    ? undefined
    :
    visual.backgroundMode === 'green'
      ? { backgroundColor: '#00ff00' }
      : backgroundImageUrl
    ? {
        backgroundImage: `url(${backgroundImageUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : undefined;

  return (
    <div
      className={`chat-panel${isBroadcast ? ' chat-panel-broadcast' : ''}${
        isBroadcast && shouldShowInput ? ' chat-panel-broadcast-input' : ''
      }${overlay ? ' chat-panel-overlay' : ''}`}
      style={panelStyle}
    >
      {!overlay && <button
        type="button"
        className="settings-button chat-settings-button"
        onClick={onToggleSettings}
        aria-label="设置"
      >
        ⚙
      </button>}
      <AvatarBackground
        mouthLevel={mouthLevel}
        voiceLevel={voiceLevel}
        isSpeaking={isSpeaking}
        avatarPackage={avatarPackage}
        avatarReaction={avatarReaction}
        idleMotionEnabled={visual.idleMotionEnabled}
        avatarViewTransform={avatarViewTransform}
        onAvatarViewTransformChange={onAvatarViewTransformChange}
        avatarMotion={avatarMotion}
        usePersonaLiveAvatar={usePersonaLiveAvatar}
        speakingAvatarVideoUrl={speakingAvatarVideoUrl}
      />
      {!overlay && (isBroadcast ? (
        broadcastCaption && (
          <div className="broadcast-caption">{broadcastCaption}</div>
        )
      ) : (
        <ChatLog messages={messages} partialResponse={partialResponse} />
      ))}
      {!overlay && shouldShowInput && <ChatInput onSend={onSend} disabled={isProcessing} />}
    </div>
  );
}
