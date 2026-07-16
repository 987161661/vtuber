import { useCallback } from 'react';
import {
  buildTyphoonSkillContext,
  buildTyphoonReferenceContext,
  buildTyphoonUnavailableContext,
} from '../config/characterProfile';

const TYPHOON_QUESTION =
  /台风|热带风暴|热带低压|风圈|路径|登陆|风速|风力|几级|有风|风大|气压|预警|暴雨|影响|怎么样|严重|危险|历史.*风|风暴|信息来源|数据来源|哪里查|哪查|查出来/i;
const NAMED_TYPHOON_STATUS_QUESTION =
  /^\s*[\u4e00-\u9fff]{2,4}(?:啊|呀|呢)?(?:[\s，、？?]*(?:他|它|她))?(?:现在|目前|后来)?(?:怎么样|如何|去哪|到哪|在哪|还在|登陆|消散|降级|减弱)/u;

type TyphoonContextResponse = {
  content?: string;
  updatedAt?: number;
  error?: string;
};

type TyphoonQueryResponse = Record<string, unknown> & { error?: string };

export interface TyphoonEnrichment {
  context: string;
  isWeather: boolean;
  inspectLiveDecks: boolean;
  payload?: TyphoonQueryResponse;
}

// Province-only follow-ups such as "江苏什么情况" are status requests in the
// live weather context even though they omit an explicit weather noun.
const PLACE_STATUS_QUESTION =
  /(?:北京|天津|上海|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|广西|海南|四川|贵州|云南|西藏|陕西|甘肃|青海|宁夏|新疆|台湾|香港|澳门)(?:省|市|自治区)?.{0,8}(?:什么情况|怎么样|怎样了|有影响吗?|什么时候到|何时到|会到吗?|会路过吗?|天气|风力|风大|下雨|预警|影响)/;

// The radar is a dedicated typhoon live room. New viewers commonly omit the
// subject after seeing the live map, e.g. "到哪里了？". Treat those short
// deictic questions as asking about the currently active typhoon.
const LIVE_TYPHOON_SHORTHAND_QUESTION =
  /^(?:现在)?(?:到哪(?:里)?了?|走到哪(?:里)?了?|位置(?:呢|在哪(?:里)?)?)(?:[？?！!。…\s]*)$/;

const LIVE_DECK_QUESTION =
  /BOSS|boss|观众态势|专业分析|能量|结构|眼墙|雷达画面|图层|卫星|风场|GFS|ECMWF|CWA/i;

export function useTyphoonSkill(enabled: boolean) {
  const enrich = useCallback(
    async (
      question: string,
      options: { force?: boolean; simulateTimeout?: boolean } = {},
    ): Promise<TyphoonEnrichment> => {
      if (
        !enabled ||
        (!options.force &&
          !TYPHOON_QUESTION.test(question) &&
          !NAMED_TYPHOON_STATUS_QUESTION.test(question) &&
          !PLACE_STATUS_QUESTION.test(question) &&
          !LIVE_TYPHOON_SHORTHAND_QUESTION.test(question) &&
          !/boss|BOSS|GFS|ECMWF|CWA|radar|雷达界面|台风雷达|卫星|风场/.test(
            question,
          ))
      ) {
        return { context: '', isWeather: false, inspectLiveDecks: false };
      }
      const inspectLiveDecks = LIVE_DECK_QUESTION.test(question);

      if (options.simulateTimeout) {
        return {
          context: buildTyphoonUnavailableContext(),
          isWeather: true,
          inspectLiveDecks,
        };
      }

      try {
        const response = await fetch(
          `/api/typhoon-query?question=${encodeURIComponent(question)}`,
          { cache: 'no-store' },
        );
        const payload = (await response.json()) as TyphoonQueryResponse;
        if (response.ok && !payload.error) {
          return {
            context: buildTyphoonSkillContext(
              JSON.stringify(payload),
              Date.now(),
            ),
            isWeather: true,
            inspectLiveDecks,
            payload,
          };
        }

        const fallbackResponse = await fetch('/api/typhoon-context', {
          cache: 'no-store',
        });
        const fallback =
          (await fallbackResponse.json()) as TyphoonContextResponse;
        if (!fallbackResponse.ok || !fallback.content) {
          return {
            context: buildTyphoonUnavailableContext(),
            isWeather: true,
            inspectLiveDecks,
          };
        }
        return {
          context: buildTyphoonReferenceContext(
            fallback.content.slice(0, 7000),
            fallback.updatedAt,
          ),
          isWeather: true,
          inspectLiveDecks,
        };
      } catch {
        return {
          context: buildTyphoonUnavailableContext(),
          isWeather: true,
          inspectLiveDecks,
        };
      }
    },
    [enabled],
  );

  return { enrich };
}
