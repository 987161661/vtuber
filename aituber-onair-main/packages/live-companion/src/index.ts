export {
  InMemoryLiveMemoryRepository,
  LiveMemoryManager,
} from './memory.js';
export type { LiveMemoryManagerOptions } from './memory.js';
export { LivePresenceTracker } from './presence.js';
export {
  DEFAULT_PROACTIVE_TALK_POLICY,
  ProactiveTalkPlanner,
} from './proactive.js';
export type { ProactiveTalkPlannerInput } from './proactive.js';
export {
  AvatarBehaviorBus,
  createAvatarBehaviorEvent,
} from './avatar.js';
export {
  DEFAULT_LIVE_HOST_POLICY,
  LiveHostCoordinator,
} from './coordinator.js';
export {
  NOOP_LIVE_TELEMETRY,
  OpenTelemetryLiveTelemetry,
  createLiveTelemetryRecord,
} from './telemetry.js';
export type {
  LiveTelemetryRecordV1,
  LiveTelemetrySink,
  OpenTelemetryLiveTelemetryOptions,
} from './telemetry.js';
export { StreamingSpeechPlane } from './speech-plane.js';
export type {
  SpeechAudioPacketV1,
  SpeechControlBeatV1,
  SpeechControlPlanV1,
  SpeechPlaneEventV1,
  SpeechPlaneResultV1,
  SpeechPlaneStageV1,
  SpeechProsodyV1,
  StreamingSpeechPlaneOptions,
  StreamingSpeechPlayer,
  StreamingSpeechRenderer,
} from './speech-plane.js';
export { TemporalMemoryGraph } from './memory-graph.js';
export type {
  TemporalMemoryAssertionV1,
  TemporalMemoryEdgeV1,
  TemporalMemoryGraphWeightsV1,
  TemporalMemoryNodeKindV1,
  TemporalMemoryNodeV1,
  TemporalMemoryProvenanceV1,
  TemporalMemoryQueryResultV1,
  TemporalMemoryQueryV1,
  TemporalMemoryRetractionV1,
} from './memory-graph.js';
export { DeadlineAwareModelRouter } from './model-router.js';
export type {
  DeadlineAwareModelRouterPolicyV1,
  ModelCircuitHealthV1,
  ModelRouteCandidateV1,
  ModelRouteDecisionV1,
  ModelRouteOutcomeV1,
  ModelRouteRequestV1,
} from './model-router.js';
export { AdaptiveLocalInference, OnnxRuntimeWebBackend } from './local-inference.js';
export type {
  AdaptiveLocalInferenceOptions,
  LocalExecutionProviderV1,
  LocalInferenceBackend,
  LocalInferenceResultV1,
  LocalInferenceSession,
  LocalModelManifestV1,
  LocalProviderFailureV1,
  LocalTensorTypeV1,
  LocalTensorV1,
} from './local-inference.js';
export {
  AvatarRenderRuntime,
  CallbackAvatarRendererAdapter,
  RemoteAvatarRendererAdapter,
} from './avatar-renderer.js';
export type {
  AvatarRenderFailureV1,
  AvatarRenderFrameV1,
  AvatarRenderReceiptV1,
  AvatarRendererAdapter,
  AvatarRendererHardwareV1,
  AvatarRendererInputV1,
  AvatarRendererManifestV1,
  AvatarRenderSelectionV1,
  CallbackAvatarRendererHandlers,
  RemoteAvatarRendererTransport,
} from './avatar-renderer.js';
export * from './types.js';
