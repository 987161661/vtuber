import { sanitizeSpeechText } from '@aituber-onair/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createMemoryRecord } from '../config/memoryArchiveSeed';
import type { CharacterProfile } from '../config/characterProfile';
import {
  createInteractionTrace,
  runSleepCycle,
  type SleepReport,
} from '../lib/cognitiveMemory';
import {
  buildMemoryContext,
  defaultCoreMemories,
  memoryId,
  streamerMemoryStore,
  isNonAttributableViewerCommand,
} from '../lib/streamerMemory';
import type {
  MemoryInteraction,
  MemoryRecordInput,
  MemoryStatus,
  StreamerMemoryRecord,
} from '../types/memory';
import type { AppSettings } from '../types/settings';
import type { PersonaMemorySignal } from '../lib/personaInteractionPlanner';

type Viewer = { id?: string; name?: string };
const MICRO_SLEEP_INTERVAL = 15 * 60_000;

function emitMemoryAudit(event: Record<string, unknown>) {
  void fetch('/api/live-runtime-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      actor: { type: 'system', id: 'streamer-memory' },
      at: Date.now(),
      ...event,
    }),
  }).catch(() => undefined);
}

export interface StreamerMemoryApi {
  records: StreamerMemoryRecord[];
  lastConsolidatedAt: number;
  lastSleepReport?: SleepReport;
  contextFor: (input: string, viewer?: Viewer) => string;
  signalsFor: (input: string, viewer?: Viewer) => PersonaMemorySignal[];
  addInteraction: (
    input: string,
    reply: string,
    viewer?: Viewer,
    source?: MemoryInteraction['source'],
  ) => Promise<void>;
  sleep: (mode?: SleepReport['mode']) => Promise<SleepReport | undefined>;
  consolidate: (reason?: 'timer' | 'end') => Promise<void>;
  reflect: (digitalHumanId: string) => Promise<number>;
  refresh: () => Promise<void>;
  add: (input: MemoryRecordInput) => Promise<StreamerMemoryRecord>;
  revise: (
    id: string,
    update: Partial<StreamerMemoryRecord>,
    reason?: string,
  ) => Promise<void>;
  confirm: (id: string) => Promise<void>;
  dispute: (id: string) => Promise<void>;
  promote: (id: string) => Promise<void>;
  archive: (id: string) => Promise<void>;
  restore: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  removeDigitalHuman: (digitalHumanId: string) => Promise<void>;
  removeViewer: (viewerId: string) => Promise<void>;
  clear: (scope?: StreamerMemoryRecord['scope']) => Promise<void>;
  export: () => Promise<StreamerMemoryRecord[]>;
  import: (records: StreamerMemoryRecord[]) => Promise<void>;
}

export function useStreamerMemory(
  _settings: AppSettings,
  isBusy: boolean,
  profile: CharacterProfile,
): StreamerMemoryApi {
  const [records, setRecords] = useState<StreamerMemoryRecord[]>([]);
  // `addInteraction` finishes outside React's render cycle. Keep the latest
  // committed snapshot in a ref so the immediately following viewer turn can
  // retrieve it instead of waiting for a state render to publish it.
  const recordsRef = useRef<StreamerMemoryRecord[]>([]);
  const [lastConsolidatedAt, setLastConsolidatedAt] = useState(0);
  const [lastSleepReport, setLastSleepReport] = useState<SleepReport>();
  const running = useRef(false);
  const sessionId = useRef(
    `${profile.id}:${new Date().toISOString().slice(0, 10)}:${crypto.randomUUID()}`,
  );

  const refresh = useCallback(async () => {
    const nextRecords = await streamerMemoryStore.list();
    recordsRef.current = nextRecords;
    setRecords(nextRecords);
  }, []);

  useEffect(() => {
    void (async () => {
      const current = await streamerMemoryStore.list();
      for (const autobiographicalMemory of defaultCoreMemories(profile)) {
        const existing = current.find(
          (record) => record.id === autobiographicalMemory.id,
        );
        if (!existing) {
          await streamerMemoryStore.put(autobiographicalMemory);
          continue;
        }
        const currentSeedVersion =
          typeof existing.details.foundationSeedVersion === 'number'
            ? existing.details.foundationSeedVersion
            : 0;
        const targetSeedVersion =
          typeof autobiographicalMemory.details.foundationSeedVersion ===
          'number'
            ? autobiographicalMemory.details.foundationSeedVersion
            : currentSeedVersion;
        const refreshSeedContent =
          currentSeedVersion < targetSeedVersion &&
          existing.details.operatorModified !== true;
        const needsFoundationUpgrade =
          existing.protected &&
          (existing.status !== 'protected' ||
            existing.memoryTier !== 'long_term' ||
            existing.phase !== 'long_term' ||
            currentSeedVersion < targetSeedVersion);
        if (needsFoundationUpgrade) {
          const details = refreshSeedContent
            ? {
                ...existing.details,
                ...autobiographicalMemory.details,
                foundationSeedVersion: targetSeedVersion,
              }
            : {
                ...autobiographicalMemory.details,
                ...existing.details,
                foundationSeedVersion: targetSeedVersion,
              };
          const contentChanged =
            refreshSeedContent &&
            existing.content !== autobiographicalMemory.content;
          await streamerMemoryStore.put({
            ...existing,
            title: refreshSeedContent
              ? autobiographicalMemory.title
              : existing.title,
            content: refreshSeedContent
              ? autobiographicalMemory.content
              : existing.content,
            status: 'protected',
            protected: true,
            memoryTier: 'long_term',
            phase: 'long_term',
            sleepState: 'settled',
            activation: Math.max(existing.activation, 0.82),
            stability: Math.max(existing.stability, 0.86),
            halfLifeMs: Math.max(
              existing.halfLifeMs,
              autobiographicalMemory.halfLifeMs,
            ),
            details,
            versionHistory: contentChanged
              ? [
                  ...existing.versionHistory,
                  {
                    content: existing.content,
                    details: existing.details,
                    replacedAt: Date.now(),
                    reason: '升级凌岚陪伴型人物曲线预设',
                  },
                ]
              : existing.versionHistory,
          });
        }
      }
      await refresh();
      const [lastAt, report] = await Promise.all([
        streamerMemoryStore.getMeta<number>(`lastSleepAt:${profile.id}`),
        streamerMemoryStore.getMeta<SleepReport>(
          `lastSleepReport:${profile.id}`,
        ),
      ]);
      setLastConsolidatedAt(lastAt || 0);
      setLastSleepReport(report);
    })();
  }, [profile, refresh]);

  const contextFor = useCallback(
    (input: string, viewer?: Viewer) =>
      buildMemoryContext(
        recordsRef.current,
        input,
        viewer?.id,
        1500,
        profile.memory.coreRecordId,
        profile.id,
      ),
    [profile.id, profile.memory.coreRecordId],
  );
  const signalsFor = useCallback(
    (input: string, viewer?: Viewer): PersonaMemorySignal[] => {
      const now = Date.now();
      const terms = input
        .normalize('NFKC')
        .toLowerCase()
        .split(/[\s，。！？、]+/u)
        .filter((term) => term.length >= 2);
      return recordsRef.current
        .filter(
          (record) =>
            record.digitalHumanId === profile.id &&
            record.phase !== 'forgotten' &&
            !['suppressed', 'archived'].includes(record.status) &&
            (!record.expiresAt || record.expiresAt > now) &&
            (!record.subjectId || record.subjectId === viewer?.id) &&
            !isNonAttributableViewerCommand(record) &&
            (record.visibility !== 'private' ||
              Boolean(viewer?.id && record.subjectId === viewer.id)),
        )
        .map((record) => ({
          record,
          relevance:
            (record.subjectId === viewer?.id ? 3 : 0) +
            terms.filter((term) =>
              `${record.title} ${record.content}`.toLowerCase().includes(term),
            ).length +
            record.activation,
        }))
        .filter(({ relevance }) => relevance >= 1)
        .sort((left, right) => right.relevance - left.relevance)
        .slice(0, 6)
        .map(({ record }) => ({
          topic: `${record.title}：${sanitizeSpeechText(record.content)}`.slice(
            0,
            120,
          ),
          confidence: Math.max(0, Math.min(1, record.confidence)),
          sourceKind:
            record.kind === 'commitment'
              ? 'host_commitment'
              : record.subjectType === 'viewer' &&
                  ['user_observation', 'live_event'].includes(record.sourceType)
                ? 'viewer_claim'
                : 'verified',
        }));
    },
    [profile.id],
  );

  const persist = useCallback(
    async (record: StreamerMemoryRecord) => {
      const before = await streamerMemoryStore.get(record.id);
      await streamerMemoryStore.put(record);
      recordsRef.current = [
        ...recordsRef.current.filter((item) => item.id !== record.id),
        record,
      ];
      setRecords(recordsRef.current);
      emitMemoryAudit({
        eventId: `memory:${record.id}`,
        stage: 'memory_record_upserted',
        before: before ?? null,
        after: record,
      });
      await refresh();
    },
    [refresh],
  );

  const sleep = useCallback(
    async (mode: SleepReport['mode'] = 'micro') => {
      if (running.current || isBusy) return undefined;
      running.current = true;
      try {
        const current = await streamerMemoryStore.list();
        const result = runSleepCycle(current, profile.id, mode);
        const ownRecords = result.records.filter(
          (record) => record.digitalHumanId === profile.id,
        );
        for (const record of ownRecords) await streamerMemoryStore.put(record);
        await Promise.all([
          streamerMemoryStore.setMeta(`lastSleepAt:${profile.id}`, Date.now()),
          streamerMemoryStore.setMeta(
            `lastSleepReport:${profile.id}`,
            result.report,
          ),
        ]);
        setLastConsolidatedAt(Date.now());
        setLastSleepReport(result.report);
        emitMemoryAudit({
          eventId: `memory-sleep:${profile.id}:${result.report.completedAt}`,
          stage: 'memory_sleep_completed',
          digitalHumanId: profile.id,
          mode,
          beforeCount: current.length,
          afterCount: result.records.length,
          result: result.report,
        });
        await refresh();
        return result.report;
      } finally {
        running.current = false;
      }
    },
    [isBusy, profile.id, refresh],
  );

  useEffect(() => {
    const timer = window.setInterval(
      () => void sleep('micro'),
      MICRO_SLEEP_INTERVAL,
    );
    return () => window.clearInterval(timer);
  }, [sleep]);

  // This cleanup must run only when the memory owner unmounts. Depending on
  // `sleep` reran it whenever `isBusy` changed, causing repeated post-stream
  // consolidation during ordinary conversations.
  const sleepRef = useRef(sleep);
  sleepRef.current = sleep;
  useEffect(
    () => () => {
      void sleepRef.current('post_stream');
    },
    [],
  );

  const addInteraction = useCallback(
    async (
      input: string,
      reply: string,
      viewer?: Viewer,
      source: MemoryInteraction['source'] = 'chat',
    ) => {
      const cleanInput = sanitizeSpeechText(input);
      const cleanReply = sanitizeSpeechText(reply);
      if (!cleanInput || !cleanReply) return;
      const interaction: MemoryInteraction = {
        id: memoryId(),
        at: Date.now(),
        viewerId: viewer?.id,
        viewerName: viewer?.name,
        input: cleanInput,
        reply: cleanReply,
        source,
      };
      await persist(
        createInteractionTrace(interaction, profile.id, sessionId.current),
      );
    },
    [persist, profile.id],
  );

  const add = useCallback(
    async (input: MemoryRecordInput) => {
      const record = createMemoryRecord(input);
      await persist(record);
      return record;
    },
    [persist],
  );

  const revise = useCallback(
    async (
      id: string,
      update: Partial<StreamerMemoryRecord>,
      reason = '运营者在高级记忆审计中修改',
    ) => {
      const current = await streamerMemoryStore.get(id);
      if (!current) return;
      const changed =
        (typeof update.content === 'string' &&
          update.content !== current.content) ||
        (update.details &&
          JSON.stringify(update.details) !== JSON.stringify(current.details));
      const revisedDetails = update.details || current.details;
      await persist({
        ...current,
        ...update,
        id: current.id,
        digitalHumanId: current.digitalHumanId,
        details:
          changed && current.protected
            ? { ...revisedDetails, operatorModified: true }
            : revisedDetails,
        versionHistory: changed
          ? [
              ...current.versionHistory,
              {
                content: current.content,
                details: current.details,
                replacedAt: Date.now(),
                reason,
              },
            ]
          : current.versionHistory,
        updatedAt: Date.now(),
      });
    },
    [persist],
  );

  const changeEvidence = useCallback(
    async (id: string, action: 'confirm' | 'dispute') => {
      const current = await streamerMemoryStore.get(id);
      if (!current) return;
      const confirmed = action === 'confirm';
      const now = Date.now();
      await persist({
        ...current,
        status: confirmed ? 'confirmed' : 'suppressed',
        memoryTier: confirmed ? 'long_term' : current.memoryTier,
        longTermType:
          confirmed && !current.longTermType
            ? current.dimension === 'relationship'
              ? 'relational'
              : current.dimension === 'episode'
                ? 'episodic'
                : current.dimension === 'commitment'
                  ? 'procedural'
                  : 'semantic'
            : current.longTermType,
        phase: confirmed ? 'long_term' : 'dormant',
        sleepState: 'settled',
        reinforcement: current.reinforcement + (confirmed ? 1 : 0),
        disputation: current.disputation + (confirmed ? 0 : 1),
        activation: confirmed ? Math.max(0.72, current.activation) : 0.08,
        stability: confirmed
          ? Math.max(0.48, current.stability)
          : Math.max(0.05, current.stability - 0.2),
        halfLifeMs: confirmed
          ? Math.max(current.halfLifeMs, 30 * 86_400_000)
          : current.halfLifeMs,
        lastConfirmedAt: confirmed ? now : current.lastConfirmedAt,
        updatedAt: now,
      });
    },
    [persist],
  );

  const setStatus = useCallback(
    async (
      id: string,
      status: MemoryStatus,
      extra: Partial<StreamerMemoryRecord> = {},
    ) => {
      const current = await streamerMemoryStore.get(id);
      if (!current) return;
      await persist({ ...current, ...extra, status, updatedAt: Date.now() });
    },
    [persist],
  );

  const reflect = useCallback(
    async (digitalHumanId: string) => {
      if (digitalHumanId !== profile.id) return 0;
      const report = await sleep('post_stream');
      return report?.promoted || 0;
    },
    [profile.id, sleep],
  );

  return useMemo(
    () => ({
      records,
      lastConsolidatedAt,
      lastSleepReport,
      contextFor,
      signalsFor,
      addInteraction,
      sleep,
      consolidate: async (reason: 'timer' | 'end' = 'timer') => {
        await sleep(reason === 'end' ? 'post_stream' : 'micro');
      },
      reflect,
      refresh,
      add,
      revise,
      confirm: (id: string) => changeEvidence(id, 'confirm'),
      dispute: (id: string) => changeEvidence(id, 'dispute'),
      promote: (id: string) =>
        setStatus(id, 'confirmed', {
          memoryTier: 'long_term',
          phase: 'long_term',
          sleepState: 'settled',
          activation: 0.82,
          stability: 0.68,
          halfLifeMs: 90 * 86_400_000,
          lastConfirmedAt: Date.now(),
        }),
      archive: (id: string) =>
        setStatus(id, 'archived', { phase: 'dormant', activation: 0.06 }),
      restore: (id: string) =>
        setStatus(id, 'confirmed', { phase: 'fading', activation: 0.34 }),
      remove: async (id: string) => {
        const record = await streamerMemoryStore.get(id);
        if (!record?.protected) await streamerMemoryStore.remove(id);
        emitMemoryAudit({
          eventId: `memory:${id}`,
          stage: record?.protected
            ? 'memory_record_remove_rejected'
            : 'memory_record_removed',
          before: record ?? null,
          reason: record?.protected ? 'protected' : undefined,
        });
        await refresh();
      },
      removeDigitalHuman: async (digitalHumanId: string) => {
        const current = await streamerMemoryStore.list();
        const removed = current.filter(
          (record) => record.digitalHumanId === digitalHumanId,
        );
        await Promise.all(
          removed.map((record) => streamerMemoryStore.remove(record.id)),
        );
        emitMemoryAudit({
          eventId: `memory-digital-human:${digitalHumanId}`,
          stage: 'memory_digital_human_removed',
          digitalHumanId,
          removed,
        });
        await refresh();
      },
      removeViewer: async (viewerId: string) => {
        const current = await streamerMemoryStore.list();
        const removed = current.filter(
          (record) => !record.protected && record.subjectId === viewerId,
        );
        await Promise.all(
          removed.map((record) => streamerMemoryStore.remove(record.id)),
        );
        emitMemoryAudit({
          eventId: `memory-viewer:${viewerId}`,
          stage: 'memory_viewer_removed',
          viewerId,
          removed,
        });
        await refresh();
      },
      clear: async (scope?: StreamerMemoryRecord['scope']) => {
        const current = await streamerMemoryStore.list();
        const removed = current.filter(
          (record) => !record.protected && (!scope || record.scope === scope),
        );
        await Promise.all(
          removed.map((record) => streamerMemoryStore.remove(record.id)),
        );
        emitMemoryAudit({
          eventId: `memory-clear:${scope ?? 'all'}:${Date.now()}`,
          stage: 'memory_scope_cleared',
          scope: scope ?? 'all',
          removed,
        });
        await refresh();
      },
      export: () => streamerMemoryStore.export(),
      import: async (imported: StreamerMemoryRecord[]) => {
        const before = await streamerMemoryStore.list();
        await streamerMemoryStore.import(imported);
        emitMemoryAudit({
          eventId: `memory-import:${Date.now()}`,
          stage: 'memory_archive_imported',
          beforeCount: before.length,
          imported,
        });
        await refresh();
      },
    }),
    [
      records,
      lastConsolidatedAt,
      lastSleepReport,
      contextFor,
      signalsFor,
      addInteraction,
      sleep,
      reflect,
      refresh,
      add,
      revise,
      changeEvidence,
      setStatus,
    ],
  );
}
