import type {
  CommentIntelligenceSettings,
  ManneriSettings,
  StreamSettings,
  StreamingPlatformOption,
} from '../types/settings';

const STREAM_INTERVAL_OPTIONS = [5000, 10000, 20000, 30000, 60000] as const;
const COMMENT_ANALYSIS_INTERVAL_OPTIONS = [1000, 2000, 5000, 10000] as const;
const COMMENT_BATCH_SIZE_OPTIONS = [10, 25, 50, 100, 200] as const;
const COMMENT_LLM_MIN_COMMENTS_OPTIONS = [4, 8, 12, 20] as const;
const MANNERI_SIMILARITY_THRESHOLD_OPTIONS = [
  0.6, 0.7, 0.75, 0.8, 0.9,
] as const;
const MANNERI_LOOKBACK_WINDOW_OPTIONS = [4, 6, 8, 10, 15, 20] as const;
const MANNERI_MIN_MESSAGE_LENGTH_OPTIONS = [4, 8, 10, 16, 24] as const;
const VIEWER_BLOCK_DURATION_OPTIONS = [
  { label: '1 分钟', value: 60 * 1000 },
  { label: '5 分钟', value: 5 * 60 * 1000 },
  { label: '10 分钟', value: 10 * 60 * 1000 },
  { label: '30 分钟', value: 30 * 60 * 1000 },
] as const;
const MANNERI_COOLDOWN_OPTIONS = [
  { label: '1 分钟', value: 60 * 1000 },
  { label: '3 分钟', value: 3 * 60 * 1000 },
  { label: '5 分钟', value: 5 * 60 * 1000 },
  { label: '10 分钟', value: 10 * 60 * 1000 },
] as const;

interface StreamSettingsProps {
  stream: StreamSettings;
  commentIntelligence: CommentIntelligenceSettings;
  manneri: ManneriSettings;
  disabled: boolean;
  isExpanded: boolean;
  isCommentIntelligenceExpanded: boolean;
  isManneriExpanded: boolean;
  onToggleExpand: () => void;
  onToggleCommentIntelligence: () => void;
  onToggleManneri: () => void;
  streamErrorMessage?: string;
  updateStreamPlatform: (platform: StreamingPlatformOption) => void;
  updateYoutubeApiKey: (value: string) => void;
  updateYoutubeLiveId: (value: string) => void;
  updateYoutubeEnabled: (value: boolean) => void;
  updateYoutubeCommentIntervalMs: (value: number) => void;
  updateTwitchClientId: (value: string) => void;
  updateTwitchAccessToken: (value: string) => void;
  updateTwitchChannel: (value: string) => void;
  updateTwitchEnabled: (value: boolean) => void;
  updateTwitchCommentIntervalMs: (value: number) => void;
  updateBilibiliEnabled: (value: boolean) => void;
  updateCustomSseEndpoint: (value: string) => void;
  updateCustomSseEnabled: (value: boolean) => void;
  updateCommentIntelligenceEnabled: (value: boolean) => void;
  updateCommentIntelligenceMode: (
    value: CommentIntelligenceSettings['mode'],
  ) => void;
  updateCommentIntelligenceStreamTopic: (value: string) => void;
  updateCommentIntelligenceStreamTitle: (value: string) => void;
  updateCommentIntelligenceTopicFilter: (
    value: CommentIntelligenceSettings['topicFilter'],
  ) => void;
  updateCommentIntelligenceAnalysisIntervalMs: (value: number) => void;
  updateCommentIntelligenceMaxCommentsPerBatch: (value: number) => void;
  updateCommentIntelligenceMinCommentsForLLMAnalysis: (value: number) => void;
  updateCommentIntelligenceBlockHighRiskViewers: (value: boolean) => void;
  updateCommentIntelligenceViewerBlockDurationMs: (value: number) => void;
  updateManneriEnabled: (value: boolean) => void;
  updateManneriSimilarityThreshold: (value: number) => void;
  updateManneriLookbackWindow: (value: number) => void;
  updateManneriInterventionCooldownMs: (value: number) => void;
  updateManneriMinMessageLength: (value: number) => void;
}

function getTwitchRedirectUri(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  return new URL(window.location.pathname, window.location.origin).toString();
}

export function StreamSettings({
  stream,
  commentIntelligence,
  manneri,
  disabled,
  isExpanded,
  isCommentIntelligenceExpanded,
  isManneriExpanded,
  onToggleExpand,
  onToggleCommentIntelligence,
  onToggleManneri,
  streamErrorMessage,
  updateStreamPlatform,
  updateYoutubeApiKey,
  updateYoutubeLiveId,
  updateYoutubeEnabled,
  updateYoutubeCommentIntervalMs,
  updateTwitchClientId,
  updateTwitchAccessToken,
  updateTwitchChannel,
  updateTwitchEnabled,
  updateTwitchCommentIntervalMs,
  updateBilibiliEnabled,
  updateCustomSseEndpoint,
  updateCustomSseEnabled,
  updateCommentIntelligenceEnabled,
  updateCommentIntelligenceMode,
  updateCommentIntelligenceStreamTopic,
  updateCommentIntelligenceStreamTitle,
  updateCommentIntelligenceTopicFilter,
  updateCommentIntelligenceAnalysisIntervalMs,
  updateCommentIntelligenceMaxCommentsPerBatch,
  updateCommentIntelligenceMinCommentsForLLMAnalysis,
  updateCommentIntelligenceBlockHighRiskViewers,
  updateCommentIntelligenceViewerBlockDurationMs,
  updateManneriEnabled,
  updateManneriSimilarityThreshold,
  updateManneriLookbackWindow,
  updateManneriInterventionCooldownMs,
  updateManneriMinMessageLength,
}: StreamSettingsProps) {
  const twitchRedirectUri = getTwitchRedirectUri();
  const isYoutubeSelected = stream.platform === 'youtube';
  const isTwitchSelected = stream.platform === 'twitch';
  const isBilibiliSelected = stream.platform === 'bilibili';
  const isCustomSseSelected = stream.platform === 'custom-sse';
  const isTwitchReady =
    !!stream.twitchAccessToken &&
    !!stream.twitchChannel.trim() &&
    !!stream.twitchClientId.trim();
  const commentControlsDisabled = disabled || !commentIntelligence.enabled;
  const manneriControlsDisabled = disabled || !manneri.enabled;

  const handleConnectTwitch = () => {
    try {
      const state = window.crypto.randomUUID();
      sessionStorage.setItem('twitchOauthState', state);

      const params = new URLSearchParams({
        client_id: stream.twitchClientId,
        redirect_uri: twitchRedirectUri,
        response_type: 'token',
        scope: 'user:read:chat',
        state,
      });

      window.location.assign(
        `https://id.twitch.tv/oauth2/authorize?${params.toString()}`,
      );
    } catch (error) {
      console.error('Failed to start Twitch OAuth:', error);
    }
  };

  return (
    <>
      <div className="settings-section">
        <button
          type="button"
          className="settings-section-toggle"
          onClick={onToggleExpand}
          aria-expanded={isExpanded}
        >
          <h3>直播平台</h3>
          <span
            className={`settings-section-chevron${isExpanded ? ' is-open' : ''}`}
          >
            ⌄
          </span>
        </button>

        {isExpanded && (
          <>
            <div className="settings-field">
              <label htmlFor="stream-platform">平台</label>
              <select
                id="stream-platform"
                value={stream.platform}
                onChange={(event) =>
                  updateStreamPlatform(
                    event.target.value as StreamingPlatformOption,
                  )
                }
                disabled={disabled}
              >
                <option value="none">不启用</option>
                <option value="youtube">YouTube</option>
                <option value="twitch">Twitch</option>
                <option value="bilibili">B站直播</option>
                <option value="custom-sse">自定义 SSE 直播桥</option>
              </select>
            </div>

            {isYoutubeSelected && (
              <>
                <div className="settings-field">
                  <label htmlFor="stream-youtube-apikey">YouTube API 密钥</label>
                  <input
                    id="stream-youtube-apikey"
                    type="password"
                    value={stream.youtubeApiKey}
                    onChange={(event) =>
                      updateYoutubeApiKey(event.target.value)
                    }
                    placeholder="请输入 YouTube Data API v3 密钥"
                    disabled={disabled}
                  />
                </div>

                <div className="settings-field">
                  <label htmlFor="stream-youtube-liveid">
                    YouTube 直播视频 ID
                  </label>
                  <input
                    id="stream-youtube-liveid"
                    type="text"
                    value={stream.youtubeLiveId}
                    onChange={(event) =>
                      updateYoutubeLiveId(event.target.value)
                    }
                    placeholder="请输入 YouTube 直播视频 ID"
                    disabled={disabled}
                  />
                  <p className="settings-field-hint">
                    填写 YouTube 直播链接中 <code>v=</code> 后的值。
                  </p>
                </div>

                <div className="settings-field">
                  <label htmlFor="stream-youtube-interval">
                    轮询间隔
                  </label>
                  <select
                    id="stream-youtube-interval"
                    value={stream.youtubeCommentIntervalMs}
                    onChange={(event) =>
                      updateYoutubeCommentIntervalMs(Number(event.target.value))
                    }
                    disabled={disabled}
                  >
                    {STREAM_INTERVAL_OPTIONS.map((intervalMs) => (
                      <option key={intervalMs} value={intervalMs}>
                        {intervalMs.toLocaleString()} ms
                      </option>
                    ))}
                  </select>
                </div>

                <div className="settings-field">
                  <label htmlFor="stream-youtube-enabled">
                    <input
                      id="stream-youtube-enabled"
                      type="checkbox"
                      checked={stream.youtubeEnabled}
                      onChange={(event) =>
                        updateYoutubeEnabled(event.target.checked)
                      }
                      disabled={disabled}
                      style={{ marginRight: 8 }}
                    />
                    启用 YouTube 评论监听
                  </label>
                </div>
              </>
            )}

            {isTwitchSelected && (
              <>
                <div className="settings-field">
                  <label htmlFor="stream-twitch-clientid">
                    Twitch 客户端 ID
                  </label>
                  <input
                    id="stream-twitch-clientid"
                    type="password"
                    value={stream.twitchClientId}
                    onChange={(event) =>
                      updateTwitchClientId(event.target.value)
                    }
                    placeholder="请输入 Twitch 客户端 ID"
                    disabled={disabled}
                  />
                </div>

                <div className="settings-field">
                  <label>Twitch 连接</label>
                  {stream.twitchAccessToken ? (
                    <div className="settings-file-actions">
                      <span className="settings-file-status">已连接</span>
                      <button
                        type="button"
                        className="settings-clear-button"
                        onClick={() => {
                          updateTwitchAccessToken('');
                          updateTwitchEnabled(false);
                        }}
                        disabled={disabled}
                      >
                        断开连接
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="settings-file-trigger"
                      onClick={handleConnectTwitch}
                      disabled={disabled || !stream.twitchClientId.trim()}
                    >
                      连接 Twitch
                    </button>
                  )}
                  <p className="settings-field-hint">
                    请在 Twitch 开发者后台将下方地址注册为 OAuth
                    重定向地址。
                  </p>
                  <p className="settings-field-hint">{twitchRedirectUri}</p>
                </div>

                <div className="settings-field">
                  <label htmlFor="stream-twitch-channel">
                    Twitch 频道（登录名）
                  </label>
                  <input
                    id="stream-twitch-channel"
                    type="text"
                    value={stream.twitchChannel}
                    onChange={(event) =>
                      updateTwitchChannel(event.target.value)
                    }
                    placeholder="example_channel"
                    disabled={disabled}
                  />
                </div>

                <div className="settings-field">
                  <label htmlFor="stream-twitch-interval">
                    消息取出间隔
                  </label>
                  <select
                    id="stream-twitch-interval"
                    value={stream.twitchCommentIntervalMs}
                    onChange={(event) =>
                      updateTwitchCommentIntervalMs(Number(event.target.value))
                    }
                    disabled={disabled}
                  >
                    {STREAM_INTERVAL_OPTIONS.map((intervalMs) => (
                      <option key={intervalMs} value={intervalMs}>
                        {intervalMs.toLocaleString()} ms
                      </option>
                    ))}
                  </select>
                  <p className="settings-field-hint">
                    每个间隔从队列中取出一条 Twitch 消息。
                  </p>
                </div>

                <div className="settings-field">
                  <label htmlFor="stream-twitch-enabled">
                    <input
                      id="stream-twitch-enabled"
                      type="checkbox"
                      checked={stream.twitchEnabled}
                      onChange={(event) =>
                        updateTwitchEnabled(event.target.checked)
                      }
                      disabled={disabled || !isTwitchReady}
                      style={{ marginRight: 8 }}
                    />
                    启用 Twitch 评论监听
                  </label>
                </div>
              </>
            )}

            {isBilibiliSelected && (
              <>
                <div className="settings-field">
                  <p className="settings-field-hint">
                    直播间号由启动脚本读取，凭据不会保存在浏览器。
                    本模式使用公开直播间匿名弹幕长链，不需要开放平台审核。
                  </p>
                </div>
                <div className="settings-field">
                  <label htmlFor="stream-bilibili-enabled">
                    <input
                      id="stream-bilibili-enabled"
                      type="checkbox"
                      checked={stream.bilibiliEnabled}
                      onChange={(event) =>
                        updateBilibiliEnabled(event.target.checked)
                      }
                      disabled={disabled}
                      style={{ marginRight: 8 }}
                    />
                    启用 B 站直播间监听
                  </label>
                </div>
              </>
            )}

            {isCustomSseSelected && (
              <>
                <div className="settings-field">
                  <label htmlFor="stream-custom-sse-endpoint">SSE 事件地址</label>
                  <input
                    id="stream-custom-sse-endpoint"
                    type="url"
                    value={stream.customSseEndpoint}
                    onChange={(event) =>
                      updateCustomSseEndpoint(event.target.value)
                    }
                    placeholder="https://bridge.example.com/events"
                    disabled={disabled}
                  />
                  <p className="settings-field-hint">
                    桥接服务须发送 <code>room-event</code> 与 <code>status</code> SSE 事件；评论事件使用与 B站桥相同的标准字段，并允许本控制台来源跨域访问。
                  </p>
                </div>
                <div className="settings-field">
                  <label htmlFor="stream-custom-sse-enabled">
                    <input
                      id="stream-custom-sse-enabled"
                      type="checkbox"
                      checked={stream.customSseEnabled}
                      onChange={(event) =>
                        updateCustomSseEnabled(event.target.checked)
                      }
                      disabled={disabled || !stream.customSseEndpoint.trim()}
                      style={{ marginRight: 8 }}
                    />
                    启用自定义 SSE 直播桥
                  </label>
                </div>
              </>
            )}

            {streamErrorMessage ? (
              <p className="settings-field-error">{streamErrorMessage}</p>
            ) : null}
          </>
        )}
      </div>

      <div className="settings-section">
        <button
          type="button"
          className="settings-section-toggle"
          onClick={onToggleCommentIntelligence}
          aria-expanded={isCommentIntelligenceExpanded}
        >
          <h3>评论智能筛选</h3>
          <span
            className={`settings-section-chevron${isCommentIntelligenceExpanded ? ' is-open' : ''}`}
          >
            ⌄
          </span>
        </button>

        {isCommentIntelligenceExpanded && (
          <>
            <div className="settings-field">
              <label htmlFor="comment-intelligence-enabled">
                <input
                  id="comment-intelligence-enabled"
                  type="checkbox"
                  checked={commentIntelligence.enabled}
                  onChange={(event) =>
                    updateCommentIntelligenceEnabled(event.target.checked)
                  }
                  disabled={disabled}
                  style={{ marginRight: 8 }}
                />
                启用评论智能筛选
              </label>
              <p className="settings-field-hint">
                凌岚处理或说话时会暂存新评论，完成安全检查和优先级排序后，每次只选择一条回应。
              </p>
            </div>

            <div className="settings-field">
              <label htmlFor="comment-intelligence-mode">分析模式</label>
              <select
                id="comment-intelligence-mode"
                value={commentIntelligence.mode}
                onChange={(event) =>
                  updateCommentIntelligenceMode(
                    event.target.value as CommentIntelligenceSettings['mode'],
                  )
                }
                disabled={commentControlsDisabled}
              >
                <option value="rules">规则模式（无需额外 API）</option>
                <option value="hybrid">混合模式</option>
                <option value="llm-assisted">LLM 辅助模式</option>
              </select>
              <p className="settings-field-hint">
                规则模式不会额外调用 LLM。混合和 LLM 辅助模式使用上方 LLM 设置，不可用时自动回退到规则模式。
              </p>
              <div className="settings-mode-help">
                <p>
                  <strong>规则模式：</strong>
                  使用固定规则完成安全判断、优先级排序和摘要，不产生额外 LLM 费用。
                </p>
                <p>
                  <strong>混合模式：</strong>
                  通常使用规则，只有评论数达到设定阈值时才调用 LLM 分析。
                </p>
                <p>
                  <strong>LLM 辅助模式：</strong>
                  每次都用 LLM 分析评论组。上下文理解更强，但会增加 API 费用和延迟。
                </p>
              </div>
            </div>

            <div className="settings-field">
              <label htmlFor="comment-intelligence-stream-topic">
                直播主题
              </label>
              <input
                id="comment-intelligence-stream-topic"
                type="text"
                value={commentIntelligence.streamTopic}
                onChange={(event) =>
                  updateCommentIntelligenceStreamTopic(event.target.value)
                }
                placeholder="例如：AI 工具介绍"
                disabled={commentControlsDisabled}
              />
            </div>

            <div className="settings-field">
              <label htmlFor="comment-intelligence-stream-title">
                直播标题
              </label>
              <input
                id="comment-intelligence-stream-title"
                type="text"
                value={commentIntelligence.streamTitle}
                onChange={(event) =>
                  updateCommentIntelligenceStreamTitle(event.target.value)
                }
                placeholder="例如：今天试用实用 AI 工具"
                disabled={commentControlsDisabled}
              />
            </div>

            <div className="settings-field">
              <label htmlFor="comment-intelligence-topic-filter">
                主题优先级
              </label>
              <select
                id="comment-intelligence-topic-filter"
                value={commentIntelligence.topicFilter}
                onChange={(event) =>
                  updateCommentIntelligenceTopicFilter(
                    event.target
                      .value as CommentIntelligenceSettings['topicFilter'],
                  )
                }
                disabled={commentControlsDisabled}
              >
                <option value="off">不限制</option>
                <option value="prefer">优先主题相关评论</option>
                <option value="require">忽略主题外评论</option>
              </select>
            </div>

            <div className="settings-field">
              <label htmlFor="comment-intelligence-interval">分析间隔</label>
              <select
                id="comment-intelligence-interval"
                value={commentIntelligence.analysisIntervalMs}
                onChange={(event) =>
                  updateCommentIntelligenceAnalysisIntervalMs(
                    Number(event.target.value),
                  )
                }
                disabled={commentControlsDisabled}
              >
                {COMMENT_ANALYSIS_INTERVAL_OPTIONS.map((intervalMs) => (
                  <option key={intervalMs} value={intervalMs}>
                    {intervalMs.toLocaleString()} ms
                  </option>
                ))}
              </select>
            </div>

            <div className="settings-field">
              <label htmlFor="comment-intelligence-batch-size">
                每批最大评论数
              </label>
              <select
                id="comment-intelligence-batch-size"
                value={commentIntelligence.maxCommentsPerBatch}
                onChange={(event) =>
                  updateCommentIntelligenceMaxCommentsPerBatch(
                    Number(event.target.value),
                  )
                }
                disabled={commentControlsDisabled}
              >
                {COMMENT_BATCH_SIZE_OPTIONS.map((batchSize) => (
                  <option key={batchSize} value={batchSize}>
                    {batchSize}
                  </option>
                ))}
              </select>
            </div>

            {commentIntelligence.mode !== 'rules' && (
              <div className="settings-field">
                <label htmlFor="comment-intelligence-llm-min-comments">
                  启用 LLM 分析的最小评论数
                </label>
                <select
                  id="comment-intelligence-llm-min-comments"
                  value={commentIntelligence.minCommentsForLLMAnalysis}
                  onChange={(event) =>
                    updateCommentIntelligenceMinCommentsForLLMAnalysis(
                      Number(event.target.value),
                    )
                  }
                  disabled={commentControlsDisabled}
                >
                  {COMMENT_LLM_MIN_COMMENTS_OPTIONS.map((minComments) => (
                    <option key={minComments} value={minComments}>
                      {minComments}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="settings-field">
              <label htmlFor="comment-intelligence-block-viewers">
                <input
                  id="comment-intelligence-block-viewers"
                  type="checkbox"
                  checked={commentIntelligence.blockHighRiskViewers}
                  onChange={(event) =>
                    updateCommentIntelligenceBlockHighRiskViewers(
                      event.target.checked,
                    )
                  }
                  disabled={commentControlsDisabled}
                  style={{ marginRight: 8 }}
                />
                暂时屏蔽高风险观众
              </label>
              <p className="settings-field-hint">
                发送高风险评论的观众会在指定时间内被排除，避免危险内容进入回应链路。
              </p>
            </div>

            <div className="settings-field">
              <label htmlFor="comment-intelligence-block-duration">
                屏蔽时长
              </label>
              <select
                id="comment-intelligence-block-duration"
                value={commentIntelligence.viewerBlockDurationMs}
                onChange={(event) =>
                  updateCommentIntelligenceViewerBlockDurationMs(
                    Number(event.target.value),
                  )
                }
                disabled={
                  commentControlsDisabled ||
                  !commentIntelligence.blockHighRiskViewers
                }
              >
                {VIEWER_BLOCK_DURATION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>

      <div className="settings-section">
        <button
          type="button"
          className="settings-section-toggle"
          onClick={onToggleManneri}
          aria-expanded={isManneriExpanded}
        >
          <h3>对话防重复</h3>
          <span
            className={`settings-section-chevron${isManneriExpanded ? ' is-open' : ''}`}
          >
            ⌄
          </span>
        </button>

        {isManneriExpanded && (
          <>
            <div className="settings-field">
              <label htmlFor="manneri-enabled">
                <input
                  id="manneri-enabled"
                  type="checkbox"
                  checked={manneri.enabled}
                  onChange={(event) =>
                    updateManneriEnabled(event.target.checked)
                  }
                  disabled={disabled}
                  style={{ marginRight: 8 }}
                />
                启用对话防重复
              </label>
              <p className="settings-field-hint">
                当对话开始重复相似模式时，在回应前自动添加转换话题的内部指令。
              </p>
            </div>

            <div className="settings-field">
              <label htmlFor="manneri-similarity-threshold">
                相似度阈值
              </label>
              <select
                id="manneri-similarity-threshold"
                value={manneri.similarityThreshold}
                onChange={(event) =>
                  updateManneriSimilarityThreshold(Number(event.target.value))
                }
                disabled={manneriControlsDisabled}
              >
                {MANNERI_SIMILARITY_THRESHOLD_OPTIONS.map((threshold) => (
                  <option key={threshold} value={threshold}>
                    {Math.round(threshold * 100)}%
                  </option>
                ))}
              </select>
              <p className="settings-field-hint">
                值越低越容易介入，值越高则只检测明显重复。
              </p>
            </div>

            <div className="settings-field">
              <label htmlFor="manneri-lookback-window">检查最近消息数</label>
              <select
                id="manneri-lookback-window"
                value={manneri.lookbackWindow}
                onChange={(event) =>
                  updateManneriLookbackWindow(Number(event.target.value))
                }
                disabled={manneriControlsDisabled}
              >
                {MANNERI_LOOKBACK_WINDOW_OPTIONS.map((lookbackWindow) => (
                  <option key={lookbackWindow} value={lookbackWindow}>
                    {lookbackWindow}
                  </option>
                ))}
              </select>
            </div>

            <div className="settings-field">
              <label htmlFor="manneri-cooldown">介入冷却时间</label>
              <select
                id="manneri-cooldown"
                value={manneri.interventionCooldownMs}
                onChange={(event) =>
                  updateManneriInterventionCooldownMs(
                    Number(event.target.value),
                  )
                }
                disabled={manneriControlsDisabled}
              >
                {MANNERI_COOLDOWN_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="settings-field">
              <label htmlFor="manneri-min-message-length">
                最小消息长度
              </label>
              <select
                id="manneri-min-message-length"
                value={manneri.minMessageLength}
                onChange={(event) =>
                  updateManneriMinMessageLength(Number(event.target.value))
                }
                disabled={manneriControlsDisabled}
              >
                {MANNERI_MIN_MESSAGE_LENGTH_OPTIONS.map((minMessageLength) => (
                  <option key={minMessageLength} value={minMessageLength}>
                    {minMessageLength}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>
    </>
  );
}
