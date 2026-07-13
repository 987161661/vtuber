import { readFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const DEFAULT_ROOT = process.env.TYPHOON_RADAR_ROOT || 'D:/typhoon boss radar';
const DEFAULT_BASE_URL = process.env.TYPHOON_RADAR_BASE_URL || 'http://127.0.0.1:3038';
const DOCUMENT_NAME = '台风实时演进分析.md';
const DOCUMENT_STALE_MS = 75 * 60_000;

const PLACE_ALIASES = new Map([
  ['北京', ['北京市', '北京']], ['天津', ['天津市', '天津']],
  ['上海', ['上海市', '上海']], ['重庆', ['重庆市', '重庆']],
  ['河北', ['河北省', '石家庄']], ['山西', ['山西省', '太原']],
  ['内蒙古', ['内蒙古自治区', '呼和浩特']], ['辽宁', ['辽宁省', '沈阳']],
  ['吉林', ['吉林省', '长春']], ['黑龙江', ['黑龙江省', '哈尔滨']],
  ['江苏', ['江苏省', '南京']], ['浙江', ['浙江省', '杭州']],
  ['安徽', ['安徽省', '合肥']], ['福建', ['福建省', '福州']],
  ['江西', ['江西省', '南昌']], ['山东', ['山东省', '济南']],
  ['河南', ['河南省', '郑州']], ['湖北', ['湖北省', '武汉']],
  ['湖南', ['湖南省', '长沙']], ['广东', ['广东省', '广州']],
  ['广西', ['广西壮族自治区', '南宁']], ['海南', ['海南省', '海口']],
  ['四川', ['四川省', '成都']], ['贵州', ['贵州省', '贵阳']],
  ['云南', ['云南省', '昆明']], ['西藏', ['西藏自治区', '拉萨']],
  ['陕西', ['陕西省', '西安']], ['甘肃', ['甘肃省', '兰州']],
  ['青海', ['青海省', '西宁']], ['宁夏', ['宁夏回族自治区', '银川']],
  ['新疆', ['新疆维吾尔自治区', '乌鲁木齐']], ['台湾', ['台湾省', '台北']],
  ['香港', ['香港特别行政区', '香港']], ['澳门', ['澳门特别行政区', '澳门']],
]);

function getQuestion(argv) {
  const index = argv.indexOf('--question');
  return index >= 0 ? String(argv[index + 1] || '').trim() : argv.slice(2).join(' ').trim();
}

function extractKnownPlace(question, cityRows) {
  for (const [alias, pair] of PLACE_ALIASES) {
    if (question.includes(alias) || question.includes(pair[1])) {
      return { alias, province: pair[0], city: pair[1] };
    }
  }
  const row = cityRows.find((item) => question.includes(item.city) || question.includes(item.province));
  return row ? { alias: row.city, province: row.province, city: row.city } : null;
}

export function extractSpecificPlace(question, knownPlace = null) {
  if (knownPlace) return knownPlace.city;
  const patterns = [
    /(?:我在|人在|位于|来自)([\u4e00-\u9fff]{2,7}?)(?=感觉|现在|这边|这里|当地|有|没|会|风|雨|台风|，|。|！|？|\s|$)/,
    /^([\u4e00-\u9fff]{2,7}?)(?:市|县|区)?(?=现在|这边|这里|当地|有|没|会|风|雨|台风|几级|影响|，|。|！|？|\s|$)/,
    /(?:到|路过|影响|看看|查一下)([\u4e00-\u9fff]{2,7}?)(?:市|县|区)?(?=吗|呢|有|会|几级|影响|，|。|！|？|\s|$)/,
  ];
  for (const pattern of patterns) {
    const matched = question
      .match(pattern)?.[1]
      ?.trim()
      .replace(/^(?:会到|到|路过|经过|影响|看看|查一下)/, '')
      .replace(/[吗呢啊呀]$/, '');
    if (matched && matched.length >= 2 && matched.length <= 7) return matched;
  }
  return null;
}

function normalizeProvinceToken(value) {
  return String(value || '').replace(/省|市|壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区/g, '');
}

export function isAllowedGeocodeCandidate(item, name, expectedProvince = null) {
  const expected = normalizeProvinceToken(expectedProvince);
  const normalizedName = normalizeProvinceToken(name);
  const displayName = normalizeProvinceToken(item?.display_name);
  const type = String(item?.addresstype || item?.type || '').toLowerCase();
  const category = String(item?.category || item?.class || '').toLowerCase();
  const allowedTypes = new Set([
    'administrative', 'city', 'town', 'county', 'district', 'municipality',
    'village', 'suburb', 'state',
  ]);
  return (
    (allowedTypes.has(type) || category === 'boundary' || category === 'place') &&
    displayName.includes(normalizedName) &&
    (!expected || displayName.includes(expected))
  );
}

async function geocodeChinaPlace(name, expectedProvince = null) {
  try {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.search = new URLSearchParams({
      format: 'jsonv2', limit: '5', 'accept-language': 'zh-CN',
      q: [name, expectedProvince, '中国'].filter(Boolean).join(', '),
    }).toString();
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { Accept: 'application/json', 'User-Agent': 'LinglanTyphoonRadar/1.0 local-app' },
    });
    if (response.ok) {
      const results = await response.json();
      const result = results.find((item) =>
        isAllowedGeocodeCandidate(item, name, expectedProvince));
      if (result) {
        const parts = String(result.display_name || '').split(',').map((item) => item.trim());
        const province = expectedProvince || parts.find((item) => /省|自治区|特别行政区$/.test(item)) || null;
        return {
          alias: name, province, city: parts[0] || name,
          latitude: Number(result.lat), longitude: Number(result.lon), geocoded: true,
          geocoder: 'OpenStreetMap Nominatim',
          geocodeType: String(result.addresstype || result.type || 'administrative'),
          confidence: 0.92,
        };
      }
    }
  } catch {
    // Fall through to the secondary geocoder.
  }

  const candidates = [...new Set([name, name.slice(-2), name.slice(-3), name.slice(-4)])]
    .filter((item) => item.length >= 2);
  for (const candidate of candidates) {
    try {
      const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
      url.search = new URLSearchParams({
        name: candidate, count: '5', language: 'zh', format: 'json', countryCode: 'CN',
      }).toString();
      const payload = await fetchJson(url.toString());
      const expected = normalizeProvinceToken(expectedProvince);
      const normalizedCandidate = normalizeProvinceToken(candidate);
      const result = payload.results?.find((item) =>
        item.country_code === 'CN' &&
        normalizeProvinceToken(item.name).includes(normalizedCandidate) &&
        (!expected || normalizeProvinceToken(item.admin1).includes(expected)));
      if (result && Number.isFinite(result.latitude) && Number.isFinite(result.longitude)) {
        return {
          alias: candidate,
          province: expectedProvince || String(result.admin1 || '').trim() || null,
          city: String(result.name || candidate),
          latitude: Number(result.latitude),
          longitude: Number(result.longitude),
          geocoded: true, geocoder: 'Open-Meteo Geocoding',
          geocodeType: String(result.feature_code || 'place'),
          confidence: 0.82,
        };
      }
    } catch {
      // Try the next shorter place candidate.
    }
  }
  return null;
}

async function resolvePlace(question, cityRows) {
  const known = extractKnownPlace(question, cityRows);
  const specific = extractSpecificPlace(question, known);
  if (specific && specific !== known?.city) {
    const geocoded = await geocodeChinaPlace(specific, known?.province || null);
    if (geocoded) return resolvedPlace(specific, geocoded);
  }
  if (known) {
    return resolvedPlace(known.alias, {
      ...known,
      confidence: 1,
      geocoder: 'known-place',
      geocodeType: 'administrative',
    });
  }
  if (specific) {
    const geocoded = await geocodeChinaPlace(specific);
    if (geocoded) return resolvedPlace(specific, geocoded);
  }
  return {
    place: null,
    resolution: {
      status: specific ? 'rejected' : 'unresolved',
      query: specific,
      canonicalName: null,
      province: null,
      confidence: 0,
      method: specific ? 'geocoder-rejected' : 'no-place-token',
      geocodeType: null,
      rejectReason: specific
        ? '地理结果不是可验证的行政区或居民点'
        : '问题中没有可可靠抽取的地点',
    },
  };
}

function resolvedPlace(query, place) {
  return {
    place,
    resolution: {
      status: 'resolved',
      query,
      canonicalName: place.city,
      province: place.province,
      confidence: Number(place.confidence || 0.8),
      method: place.geocoder || 'known-place',
      geocodeType: place.geocodeType || 'administrative',
      rejectReason: null,
    },
  };
}

function windForceFromSpeed(speed) {
  const upperBounds = [
    0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8,
    24.5, 28.5, 32.7, 37.0, 41.5, 46.2, 51.0, 56.1,
  ];
  const level = upperBounds.findIndex((bound) => speed < bound);
  return level === -1 ? 17 : level;
}

function windDirectionLabel(degrees) {
  const labels = ['北风', '东北风', '东风', '东南风', '南风', '西南风', '西风', '西北风'];
  return labels[Math.round((((degrees % 360) + 360) % 360) / 45) % labels.length];
}

function toBeijingTime(iso) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(iso)).replaceAll('/', '-');
}

async function fetchCoordinateWind(place) {
  const url = new URL('https://api.met.no/weatherapi/locationforecast/2.0/compact');
  url.search = new URLSearchParams({
    lat: place.latitude.toFixed(4), lon: place.longitude.toFixed(4),
  }).toString();
  const payload = await fetchJson(url.toString());
  const point = payload.properties?.timeseries?.[0];
  const details = point?.data?.instant?.details;
  const windMps = Number(details?.wind_speed);
  const direction = Number(details?.wind_from_direction);
  if (!Number.isFinite(windMps) || !Number.isFinite(direction)) return null;
  return {
    province: place.province, city: place.city,
    windMps: Number(windMps.toFixed(1)),
    windForceLevel: windForceFromSpeed(windMps),
    windDirection: windDirectionLabel(direction),
    observedAt: toBeijingTime(point.time),
    status: '该坐标的10米模式预报',
    coordinates: { lat: place.latitude, lon: place.longitude },
  };
}

function parseDocument(content, modifiedAt) {
  const rows = [];
  for (const line of content.split(/\r?\n/)) {
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== 7 || !/m\/s/.test(cells[2]) || !/级/.test(cells[3])) continue;
    rows.push({
      province: cells[0], city: cells[1],
      windMps: Number.parseFloat(cells[2]),
      windForceLevel: Number.parseInt(cells[3], 10),
      windDirection: cells[4], observedAt: cells[5], status: cells[6],
    });
  }
  const pick = (pattern) => content.match(pattern)?.[1]?.trim() || null;
  return {
    runAt: pick(/- 本轮运行：([^\n]+)/),
    source: pick(/- 数据源：([^\n]+)/),
    sourceUrl: pick(/- 数据接口：([^\n]+)/),
    cityWindSource: pick(/- 城市风场来源：([^\n]+)/),
    modifiedAt: modifiedAt.toISOString(),
    stale: Date.now() - modifiedAt.getTime() > DOCUMENT_STALE_MS,
    cityRows: rows,
  };
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.json();
}

export function intentFor(question) {
  if (/在哪里|在哪儿|位置|到哪(?:里|儿)?了|走到哪/.test(question)) return 'location';
  if (/(?:北京|天津|上海|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|广西|海南|四川|贵州|云南|西藏|陕西|甘肃|青海|宁夏|新疆|台湾|香港|澳门).*(?:什么情况|怎么样|怎样了|有影响吗?)/.test(question)) return 'impact';
  if (/来源|哪里查|哪查|数据.*哪|依据|接口/.test(question)) return 'source';
  if (/(?:会到|路过|经过)[\u4e00-\u9fff]{2,7}|[\u4e00-\u9fff]{2,7}(?:会到|路过|经过)/.test(question)) return 'impact';
  if (/登陆|到达|什么时候到|何时到/.test(question)) return 'landfall';
  if (/几级|风力|风速|风大|有没有风|多大风|没.{0,2}风|无风|有风|没.{0,2}雨|雨停|下雨/.test(question)) return 'wind';
  if (/影响|怎么样|如何|严重|危险/.test(question)) return 'impact';
  return 'storm';
}

function compactStorm(storm) {
  if (!storm) return null;
  const primary = storm.forecastScenarios?.find((item) => item.isPrimary) || storm.forecastScenarios?.[0];
  const latestTrackPoint = [...(storm.track || [])]
    .reverse()
    .find((point) => point?.locationDescription);
  const observedAtMs = Date.parse(storm.updatedAt);
  const observationAgeMinutes = Number.isFinite(observedAtMs)
    ? Math.max(0, Math.round((Date.now() - observedAtMs) / 60_000))
    : null;
  return {
    id: storm.id, nameZh: storm.nameZh, nameEn: storm.nameEn,
    stage: storm.stage, centerWindForceLevel: windForceFromSpeed(storm.maxWind),
    maxWindMps: storm.maxWind, pressureHpa: storm.minPressure,
    position: storm.position, moveDirection: storm.moveDirection,
    locationDescription:
      storm.locationDescription || latestTrackPoint?.locationDescription || null,
    moveSpeedKmh: storm.moveSpeed,
    observedAt: storm.updatedAt,
    observedAtBeijing: toBeijingTime(storm.updatedAt),
    observationAgeMinutes,
    observationStale: observationAgeMinutes === null || observationAgeMinutes > 180,
    windRadiiKm: storm.windRadiiKm,
    forecastAgency: primary?.agency || null,
    forecast: (primary?.points || storm.forecast || []).slice(0, 12).map((point) => ({
      ...point,
      timeBeijing: toBeijingTime(point.time),
    })),
    landfalls: (storm.landfalls || []).map((item) => ({
      time: item.time,
      timeBeijing: toBeijingTime(item.time),
      place: item.place,
      lat: item.lat,
      lon: item.lon,
      note: item.note,
    })),
  };
}

export function selectStormsForQuestion(question, storms) {
  const named = storms.filter((storm) =>
    [storm.nameZh, storm.nameEn]
      .filter(Boolean)
      .some((name) => question.toLowerCase().includes(String(name).toLowerCase())),
  );
  return named.length ? named : storms;
}

export function stormLocationAnswer(storm) {
  const coordinates = Number.isFinite(storm.position?.lat) && Number.isFinite(storm.position?.lon)
    ? `北纬${storm.position.lat}、东经${storm.position.lon}`
    : '';
  if (storm.locationDescription) {
    return `${storm.nameZh}中心目前${storm.locationDescription}${coordinates ? `（${coordinates}）` : ''}`;
  }
  return `${storm.nameZh}中心目前在${coordinates || '当前可核实位置'}；当前信源没有提供可核实的城市名称`;
}

export function buildLandfallStatus(question, storms) {
  const records = selectStormsForQuestion(question, storms).flatMap((storm) =>
    (storm.landfalls || []).map((item) => ({
      stormId: storm.id,
      stormName: storm.nameZh,
      ...item,
    })),
  );
  if (records.length > 0) {
    return {
      status: 'confirmed',
      confirmed: true,
      records,
      message: '当前查询源提供了已确认登陆记录，可按 records 原样引用。',
    };
  }
  return {
    status: 'not_provided',
    confirmed: null,
    records: [],
    message: '当前查询结果未附带可核实的登陆记录；这不等于确认未登陆，也不能据此说台风还在海里。',
  };
}

function shortTime(value) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return String(value || '');
  return `${new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(parsed))}（北京时间）`;
}

function buildRequiredAnswer(question, intent, cityWind, defense, storms, sources, landfall) {
  const selectedStorms = selectStormsForQuestion(question, storms);
  const storm = selectedStorms[0];
  if (intent === 'location') {
    return `${selectedStorms.map(stormLocationAnswer).join('；')}。`;
  }
  if (intent === 'source') {
    return `台风位置、强度、风圈和路径预报来自${sources[0].name}；城市风力来自${sources[1].name}的10米模式风场。`;
  }
  if (intent === 'landfall') {
    if (landfall.confirmed === true) {
      const latest = landfall.records.at(-1);
      return `${latest.stormName}已有确认登陆记录；最近一次为${shortTime(latest.time)}在${latest.place}登陆。`;
    }
    const next = storm?.forecast?.[1] || storm?.forecast?.[0];
    const forecastText = next
      ? `中国路径预报的下一点是${shortTime(next.time)}，位于${next.lat}°N、${next.lon}°E，中心风速${next.wind}米每秒。`
      : '当前来源没有可用的后续路径预报点。';
    return `当前查询结果未附带可核实的登陆记录，但这不等于确认未登陆。${forecastText}这是路径预报点，不是登陆事实。`;
  }
  if (cityWind) {
    const viewerReport = /(?:我在|这边|这里|当地).*(?:没.{0,2}风|无风|没.{0,2}雨|雨停|风大|下雨)/.test(question)
      ? `你说${cityWind.city}现场${/没.{0,2}风|无风/.test(question) ? '没什么风' : '的感受我收到了'}；`
      : '';
    const eyeAnswer = /风眼/.test(question)
      ? `目前没有证据确认${cityWind.city}会进入风眼；`
      : '';
    const routeAnswer = /会到|路过|经过/.test(question)
      ? `当前路径预报未确认会经过${cityWind.city}；`
      : '';
    if (viewerReport || eyeAnswer || routeAnswer) {
      return `${viewerReport}${eyeAnswer}${routeAnswer}模式预报约${cityWind.windMps}米每秒、${cityWind.windForceLevel}级${cityWind.windDirection}，仅供参考。`;
    }
    const localWind = `${cityWind.city}坐标的模式预报约${cityWind.windMps}米每秒、${cityWind.windForceLevel}级${cityWind.windDirection}，数据时次${shortTime(cityWind.observedAt)}`;
    const scope = cityWind.coordinates
      ? '；这是该坐标的10米模式预报，不等同于当地气象站实况'
      : '；这是代表坐标的10米模式预报，不等同于全市气象站实况';
    const impact = intent === 'impact' && defense
      ? `。台风雷达产品将${defense.province}判为${defense.status}，距台风中心约${defense.distanceKm}公里`
      : '';
    return `${localWind}${scope}${impact}。`;
  }
  if (storm) {
    return `${storm.nameZh}最新实况为${storm.stage}，中心风速${storm.maxWindMps}米每秒、${storm.centerWindForceLevel}级，中心气压${storm.pressureHpa}百帕，时次${shortTime(storm.observedAt)}。`;
  }
  return '当前查询没有取得足够的台风或当地风力数据，不能给出具体数字。';
}

function buildDeliveryGuide(question, intent, defense) {
  if (/没概念|没有概念|不懂|害怕|担心|慌/.test(question)) {
    return { emotion: 'relaxed', delivery: 'warm', emotionIntensity: 0.62, reason: '观众需要耐心解释和安抚' };
  }
  if (intent === 'impact' || intent === 'landfall' || /核心|外围雨带/.test(defense?.status || '')) {
    return { emotion: 'neutral', delivery: 'serious', emotionIntensity: 0.7, reason: '风险或路径信息应严肃直接' };
  }
  if (intent === 'source') {
    return { emotion: 'relaxed', delivery: 'natural', emotionIntensity: 0.48, reason: '来源说明要自信清楚但不紧张' };
  }
  return { emotion: 'relaxed', delivery: 'warm', emotionIntensity: 0.55, reason: '数字解释保持清楚且有人味' };
}

function buildClaims(question, cityWind, defense, storms, sources) {
  const claims = [];
  const selectedStorms = selectStormsForQuestion(question, storms);
  if (intentFor(question) === 'location') {
    for (const storm of selectedStorms) {
      claims.push({
        id: `storm-location-${storm.id}`,
        type: 'official_observation',
        text: `${stormLocationAnswer(storm)}。`,
        source: sources[0].name,
        observedAt: storm.observedAt,
        confidence: 'high',
      });
    }
    return claims;
  }
  const storm = selectedStorms[0];
  if (storm) {
    claims.push({
      id: 'storm-current',
      type: 'official_observation',
      text: `${storm.nameZh || '当前台风'}中心风速${storm.maxWindMps}米每秒、${storm.centerWindForceLevel}级，位置东经${storm.position?.lon}、北纬${storm.position?.lat}。`,
      locationDescription: storm.locationDescription,
      source: sources[0].name,
      observedAt: storm.observedAt,
      confidence: 'high',
    });
    const next = storm.forecast?.[1] || storm.forecast?.[0];
    if (next) {
      claims.push({
        id: 'storm-forecast',
        type: 'official_forecast',
        text: `机构路径预报点为${shortTime(next.time)}、${next.lat}°N、${next.lon}°E。`,
        source: storm.forecastAgency || sources[0].name,
        observedAt: next.time,
        confidence: 'medium',
      });
    }
  }
  if (cityWind) {
    claims.push({
      id: 'city-model-wind',
      type: 'model_inference',
      text: `${cityWind.city}坐标的10米模式预报约${cityWind.windMps}米每秒、${cityWind.windForceLevel}级${cityWind.windDirection}。`,
      source: sources[1].name,
      observedAt: cityWind.observedAt,
      confidence: 'medium',
    });
  }
  if (defense) {
    claims.push({
      id: 'radar-impact-assessment',
      type: 'model_inference',
      text: String(defense.riskLine || defense.status || ''),
      source: '本地台风雷达影响判定',
      observedAt: null,
      confidence: 'low',
    });
  }
  if (/我在|这边|这里|当地/.test(question) && /没.{0,2}风|无风|没.{0,2}雨|雨停|风大|下雨/.test(question)) {
    claims.push({
      id: 'viewer-local-report',
      type: 'viewer_report',
      text: `观众报告的当地现场感受：${question.slice(0, 100)}`,
      source: '观众现场反馈',
      observedAt: new Date().toISOString(),
      confidence: 'medium',
    });
  }
  return claims.filter((claim) => claim.text);
}

export async function queryTyphoonRadar(question, options = {}) {
  const root = options.root || DEFAULT_ROOT;
  const baseUrl = options.baseUrl || DEFAULT_BASE_URL;
  const documentPath = `${root}/${DOCUMENT_NAME}`;
  const intent = intentFor(question);
  const needsStormTrack = !['source', 'wind'].includes(intent);
  const [content, metadata, stormsPayload] = await Promise.all([
    readFile(documentPath, 'utf8'),
    stat(documentPath),
    needsStormTrack
      ? fetchJson(`${baseUrl}/api/storms/current`)
      : Promise.resolve({ storms: [] }),
  ]);
  const document = parseDocument(content, metadata.mtime);
  const needsPlace = ['wind', 'impact'].includes(intent);
  const placeResult = needsPlace
    ? await resolvePlace(question, document.cityRows)
    : {
        place: null,
        resolution: {
          status: 'not_required', query: null, canonicalName: null,
          province: null, confidence: 1, method: 'not-required',
          geocodeType: null, rejectReason: null,
        },
      };
  const place = placeResult.place;
  let cityWind = place && !place.geocoded
    ? document.cityRows.find((row) => row.city === place.city || row.province === place.province) || null
    : null;
  if (!cityWind && place?.geocoded) {
    try {
      cityWind = await fetchCoordinateWind(place);
    } catch {
      cityWind = null;
    }
  }
  let defense = null;
  if (place) {
    try {
      const payload = await fetchJson(`${baseUrl}/api/city-status?province=${encodeURIComponent(place.province)}`);
      defense = payload.defense || null;
    } catch {
      defense = null;
    }
  }
  const storms = (stormsPayload.storms || []).map(compactStorm).filter(Boolean);
  const sources = [
    { fields: '台风位置、强度、气压、风圈、路径预报', name: document.source || '浙江省水利厅台风路径公开接口', url: document.sourceUrl },
    { fields: '代表坐标10米模式预报风速、风力等级、风向', name: document.cityWindSource || 'MET Norway Locationforecast 2.0 模式预报', url: 'https://api.met.no/weatherapi/locationforecast/2.0/compact' },
  ];
  const claims = buildClaims(question, cityWind, defense, storms, sources);
  const landfall = buildLandfallStatus(question, storms);
  return {
    queryTimeBeijing: toBeijingTime(new Date().toISOString()),
    timeZone: 'Asia/Shanghai',
    intent, question, place, placeResolution: placeResult.resolution,
    cityWind, defense, storms, claims,
    landfall,
    document: {
      runAt: document.runAt, modifiedAt: document.modifiedAt, stale: document.stale,
    },
    sources,
    requiredAnswer: buildRequiredAnswer(question, intent, cityWind, defense, storms, sources, landfall),
    deliveryGuide: buildDeliveryGuide(question, intent, defense),
    answerRules: [
      ...(intent === 'location'
        ? [
            '位置问题必须用一到两句短答；第一句直接回答台风在哪里。',
            '除非观众继续追问，否则不要附带风速、气压、风圈、整段路径或安全建议。',
            '优先复述上游 locationDescription；没有城市字段时明确说当前信源没有可核实城市，禁止猜测或反向地理编码。',
          ]
        : []),
      '先直接回答数字和结论，再说明数据时次与口径。',
      '不得把台风中心风力当作当地风力。',
      '不得把路径预报点说成已确认登陆。',
      'landfall.status=not_provided 只表示本次结果未附带记录，不表示未登陆；禁止据此说“没登陆”或“还在海里”。',
      '当前 locationDescription 与旧对话冲突时，以本次查询的 locationDescription 为准；描述为行政区境内时禁止说台风还在海里。',
      'cityWind 只能称为模式预报，不能称为当地气象站实况。',
      '观众报告当地没风或没雨时，先承认其现场感受，再说明模式参考。',
      'claims 没有对应证据时，禁止声称风眼经过、必经之路、高危区或全省都会受影响。',
    ],
  };
}

async function main() {
  const question = getQuestion(process.argv);
  if (!question) throw new Error('Use --question "上海现在几级风？"');
  const result = await queryTyphoonRadar(question);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}
