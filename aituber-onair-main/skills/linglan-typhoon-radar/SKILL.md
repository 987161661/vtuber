---
name: linglan-typhoon-radar
description: Query Linglan's local Typhoon Boss Radar for current tropical-cyclone facts, tropical-disturbance and genesis outlooks, regional genesis probability, representative-city wind speed and Beaufort force, regional impact, forecast-track timing, landfall evidence, and source attribution. Use for Chinese live-chat questions such as 台风胚胎在哪里, 下一个台风生成概率多大, 某地几级风, 台风对某省市有什么影响, 什么时候登陆或到达, 当前台风位置强度, and 信息从哪里查到的.
---

# Linglan Typhoon Radar

Use the deterministic query script before answering any current typhoon question:

```powershell
node scripts/query_typhoon_radar.mjs --question "上海现在几级风？"
```

Read the JSON and answer in this order:

1. Give the direct conclusion and numeric fact.
2. State the data time and whether it is observation, model wind, or forecast.
3. Add one relevant impact or safety sentence when needed.
4. Name the source when asked or when sources conflict.

Never replace an available answer with a clarification question. If only province-level or representative-city data exists, answer at that level and state the limitation. Never convert a forecast track point into a confirmed landfall. If `landfall.confirmed` is false, say the source has not published a confirmed landfall time/place and report only the forecast points provided.

For genesis outlook questions, use `outlook` and state its generation time. JTWC LOW/MEDIUM/HIGH is a qualitative near-term potential. NOAA CPC 20/40/60% is the probability of at least one tropical-cyclone genesis event somewhere in the marked week-2/week-3 region; never present it as the probability of one named embryo or the exact geometry-center point.

Treat `cityWind` as representative-coordinate 10 m model wind, not a citywide station average. Treat `defense` as a distance/wind-radius product estimate, not an official warning. Prefer newer timestamps and disclose stale or protected values.

For source definitions and field meanings, read [references/data-contract.md](references/data-contract.md). For response rules and examples, read [references/answer-policy.md](references/answer-policy.md).
