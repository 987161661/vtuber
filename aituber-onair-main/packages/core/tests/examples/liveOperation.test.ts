import { describe, expect, it } from 'vitest';
import { projectLiveOperation } from '../../examples/react-purupuru-app/src/lib/liveOperation';

describe('live operation projection', () => {
  it('starts in a safe standby state', () => {
    expect(
      projectLiveOperation({
        autoBroadcastEnabled: false,
        platformLive: false,
      }),
    ).toMatchObject({
      phase: 'standby',
      automationAction: 'start',
      automationLabel: '开始站内预演',
    });
  });

  it('never calls automation alone a formal broadcast', () => {
    expect(
      projectLiveOperation({
        autoBroadcastEnabled: true,
        platformLive: false,
      }),
    ).toMatchObject({
      phase: 'preview',
      title: '站内预演中',
      automationAction: 'pause',
    });
  });

  it('promotes only an external live signal to formal broadcast', () => {
    expect(
      projectLiveOperation({
        autoBroadcastEnabled: true,
        platformLive: true,
      }),
    ).toMatchObject({
      phase: 'live',
      title: '正式直播中',
      automationLabel: '暂停自动播出',
    });
  });

  it('keeps external live state visible while automation is paused', () => {
    expect(
      projectLiveOperation({
        autoBroadcastEnabled: false,
        platformLive: true,
      }),
    ).toMatchObject({
      phase: 'live-paused',
      title: '直播中 · 自动播出已暂停',
      automationAction: 'resume',
    });
  });
});
