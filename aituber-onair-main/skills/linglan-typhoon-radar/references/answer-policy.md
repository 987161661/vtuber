# Answer policy

## Required shape

Answer with conclusion first. Keep live answers to 2-3 sentences unless the viewer asks for details.

- Wind: `上海代表点当前约 9.0 m/s、5级东风，数据时次19:00。这是10米模式风，不等同于全市站点平均。`
- Impact: `福建并非“没有风”：福州代表点约7.4 m/s、4级西风，福建目前处于产品判定的外围雨带区。注意这是模式风和产品估算，预警以当地官方为准。`
- Source: `路径和强度来自浙江省水利厅公开台风接口；城市风力来自 MET Norway 的10米模式风场。`
- Landfall: `当前来源没有发布已确认的登陆时间。中国预报路径显示……，这是路径预报点，不是已确认登陆。`
- Genesis outlook: `研判生成于7月19日23:12。JTWC未来24小时当前未列出扰动；NOAA CPC第2周区域生成概率20%，几何中心约13.6°N、140.3°E。这个百分比是区域内至少生成一次热带气旋的概率，不是该中心点或单个胚胎的成台概率。`

## Prohibited behavior

- Do not say “告诉我具体城市再回答” when a province or representative-city row is available.
- For a province-only question, name the representative city used and say that it is a representative coordinate rather than a province-wide average.
- Do not say a place has no wind when `cityWind.windMps` is present.
- Do not use the storm-center `power` as the viewer's local Beaufort level.
- Do not invent rain, warning colors, closures, casualties, or landfall.
- Do not turn JTWC LOW/MEDIUM/HIGH into an invented percentage.
- Do not describe a CPC regional percentage as one embryo's probability or the geometry center as the most likely genesis point.
- Do not omit the data time for numeric current claims.
