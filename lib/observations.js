import { areas, metrics, sources, seasons } from "./catalog.js";
import { density, pressureFromDepth } from "./seawater.js";
import { getProfiles } from './profiles.js';

export function parseNumber(value, censorPolicy = "exclude") {
  if (value === null || value === undefined || typeof value === "boolean") return { value: null, reason: "missing" };
  const text = String(value).trim().normalize("NFKC");
  const censored = text.match(/^(?:<|<=|≤)\s*([+\-]?\d*\.?\d+(?:e[+\-]?\d+)?)$/i);
  if (censored) return { value: censorPolicy === "half" ? Number(censored[1]) / 2 : null, reason: "censored" };
  if (!/^[+\-]?(?:\d+\.?\d*|\.\d+)(?:e[+\-]?\d+)?$/i.test(text)) return { value: null, reason: "missing" };
  const number = Number(text);
  return Number.isFinite(number) && ![-9999, -999, 9999, 99999].includes(number)
    ? { value: number, reason: null } : { value: null, reason: "missing" };
}

function numberOption(params, key, fallback, min, max, integer = false) {
  const raw = params.get(key);
  const value = raw === null ? fallback : Number(raw);
  if (raw === "" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error(`${key} の指定が不正です。`);
  return value;
}

export function parseQuery(params) {
  const yearMax = new Date().getFullYear();
  const q = {
    area: params.get("area") || "tokyo-bay", metric: params.get("metric") || "TEMP",
    start: numberOption(params, "start", 2010, 1978, yearMax, true),
    end: numberOption(params, "end", 2018, 1978, yearMax, true),
    basis: params.get("basis") || "calendar", season: params.get("season") || "all",
    sources: (params.get("sources") || "koiki").split(","),
    aggregation: params.get("aggregation") || "equal-year", censor: params.get("censor") || "exclude",
    depthMin: numberOption(params, "depthMin", 0, 0, 12000), depthMax: numberOption(params, "depthMax", 1, 0, 12000),
    spatialBin: numberOption(params,'spatialBin',.25,.05,2), argoMode:params.get('argoMode')||'adjusted', cruise:params.get('cruise')||''
  };
  if (!areas[q.area] || !metrics[q.metric] || !seasons[q.season] || q.start > q.end || q.end - q.start > 49 || q.depthMin > q.depthMax ||
      !["calendar", "fiscal"].includes(q.basis) || !["equal-year", "sample"].includes(q.aggregation) || !["exclude", "half"].includes(q.censor) ||
      q.sources.some((source) => !sources[source]) || new Set(q.sources).size !== q.sources.length) throw new Error("表示条件が不正です。");
  if(!['adjusted','delayed','all'].includes(q.argoMode)||!/^[A-Za-z0-9_-]{0,40}$/.test(q.cruise))throw new Error('Argoモードまたは航海番号の指定が不正です。');
  q.bbox = q.area==='custom'?[numberOption(params,'west',140,120,155),numberOption(params,'south',30,20,47),numberOption(params,'east',144,120,155),numberOption(params,'north',35,20,47)]:areas[q.area].bbox;
  if(q.bbox[0]>=q.bbox[2]||q.bbox[1]>=q.bbox[3])throw new Error('範囲は西端<東端、南端<北端で指定してください。');
  const chosen = params.get("months");
  q.months = chosen === null ? seasons[q.season] : chosen.split(",").map(Number);
  if (!q.months.length || q.months.some((month) => !Number.isInteger(month) || month < 1 || month > 12)) throw new Error("月を1つ以上選択してください。");
  q.months = [...new Set(q.months)].filter((month) => seasons[q.season].includes(month)).sort((a, b) => a - b);
  if (!q.months.length) throw new Error("季節と指定月が重なっていません。");
  return q;
}

export function normalize(records, source, query, diagnostics) {
  const spec = metrics[query.metric];
  const out = [];
  for (const record of records) {
    const a = Object.fromEntries(Object.entries(record.attributes).map(([key, value]) => [key.toLowerCase(), value]));
    const lon = parseNumber(a.longitude ?? record.geometry?.x).value;
    const lat = parseNumber(a.latitude ?? record.geometry?.y).value;
    if (lon === null || lat === null || lon < 120 || lon > 155 || lat < 20 || lat > 47) { diagnostics.invalidLocation++; continue; }
    const fiscal = parseNumber(a.nendo).value;
    const year = source === "koiki" && query.basis === "calendar" ? parseNumber(a.surveyyear).value : fiscal;
    const month = source === "koiki" ? parseNumber(a.surveymonth).value : null;
    if (!Number.isInteger(year) || year < query.start || year > query.end || (source === "koiki" && !query.months.includes(month))) continue;
    const depth = source === "koiki" ? parseNumber(a.saisuidepth).value : null;
    if (source === "koiki" && (depth === null || depth < query.depthMin || depth > query.depthMax)) { diagnostics.depthExcluded++; continue; }
    let result;
    if (spec.derived) {
      const salt = parseNumber(a.salt).value;
      const temperature = parseNumber(a.wtemp).value;
      if (query.metric === "PRESSURE") result = { value: depth === null ? null : pressureFromDepth(depth, lat) };
      else if (salt === null || temperature === null || salt < 0 || salt > 42 || temperature < -2 || temperature > 40 || depth === null) result = { value: null };
      else {
        const p = query.metric === "RHO" ? pressureFromDepth(depth, lat) : 0;
        result = { value: density(salt, temperature, p) - (query.metric === "SIGMAT" ? 1000 : 0) };
      }
    } else result = parseNumber(a[source === "koiki" ? spec.field : spec.annual.field], query.censor);
    if (result.reason === "censored") diagnostics.censored++;
    if (result.value === null || !Number.isFinite(result.value)) { diagnostics.missing++; continue; }
    if ((spec.min !== undefined && result.value < spec.min) || (spec.max !== undefined && result.value > spec.max)) { diagnostics.invalidValue++; continue; }
    out.push({ source, station: String(a.zettaicode || a.locationname || `${lon.toFixed(5)},${lat.toFixed(5)}`),
      recordId: String(a.uniqueid || a.objectid), name: a.locationname || "観測点", longitude: lon, latitude: lat,
      year, fiscalYear: fiscal, month, depth, value: result.value, qualified: result.reason === "censored" });
  }
  return out;
}

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const groupBy = (values, key) => {
  const groups = new Map();
  for (const item of values) { const k = key(item); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(item); }
  return groups;
};

export function average(records, method) {
  if (!records.length) return null;
  if (method === "sample") return mean(records.map((record) => record.value));
  return mean([...groupBy(records, (record) => record.year).values()].map((year) =>
    mean([...groupBy(year, (record) => record.month || 0).values()].map((month) => mean(month.map((record) => record.value))))));
}

export function aggregate(records, query, diagnostics = {}) {
  const points = [...groupBy(records, (record) => `${record.source}:${record.station}`).values()].map((items) => ({
    source: items[0].source, station: items[0].station, name: items[0].name,
    longitude: mean(items.map((item) => item.longitude)), latitude: mean(items.map((item) => item.latitude)),
    value: average(items, query.aggregation), count: items.length,
    platforms:[...new Set(items.map((item)=>item.platform).filter(Boolean))],
    profileCount:items.filter((item)=>item.profile).length, sampleCount:items.reduce((sum,item)=>sum+(item.sampleCount||1),0),
    years: [...new Set(items.map((item) => item.year))].sort(), months: [...new Set(items.map((item) => item.month).filter(Boolean))].sort((a,b)=>a-b)
  }));
  const years = [...new Set(records.map((item) => item.year))].sort();
  const requestedYears = Array.from({ length: query.end - query.start + 1 }, (_, i) => query.start + i);
  const perGroup = (items) => {
    const stations = groupBy(items, (item) => `${item.source}:${item.station}`);
    return { average: query.aggregation === "sample" ? average(items, "sample") : mean([...stations.values()].map((group) => average(group, "equal-year"))), count: items.length, stations: stations.size };
  };
  return {
    area: areas[query.area].label, areaKey: query.area, metric: metrics[query.metric].label, metricKey: query.metric, unit: metrics[query.metric].unit,
    query, points, count: records.length, stationCount: points.length, years,
    missingYears: requestedYears.filter((year) => !years.includes(year)), diagnostics,
    summary: [...groupBy(records, (item) => item.source)].map(([source, items]) => ({ source, label: sources[source].label, ...perGroup(items) })),
    yearly: [...groupBy(records, (item) => item.year)].map(([year, items]) => ({ year, ...perGroup(items) })).sort((a,b)=>a.year-b.year),
    monthly: [...groupBy(records.filter((item) => item.month !== null), (item) => item.month)].map(([month, items]) => ({ month, ...perGroup(items) })).sort((a,b)=>a.month-b.month),
    coverage: [...groupBy(records, (item) => `${item.year}:${item.month || 0}`)].map(([key, items]) => { const [year, month] = key.split(":").map(Number); return { year, month, count: items.length }; })
  };
}

const cache = new Map();
const API = "https://water-pub.env.go.jp/gis/rest/services";
export async function queryArcGIS(service, layer, where, bbox, fetcher = fetch) {
  const key = JSON.stringify([service, layer, where, bbox]);
  const previous = cache.get(key);
  if (previous && previous.expires > Date.now()) return previous.promise;
  const promise = (async () => {
    const params = new URLSearchParams({ f: "json", where, outFields: "*", returnGeometry: "true", outSR: "4326", resultRecordCount: "2000", orderByFields: "objectid ASC" });
    if (bbox) { params.set("geometry", bbox.join(",")); params.set("geometryType", "esriGeometryEnvelope"); params.set("inSR", "4326"); params.set("spatialRel", "esriSpatialRelIntersects"); }
    const result = [];
    const ids = new Set();
    for (let offset = 0; offset < 100000; offset += 2000) {
      params.set("resultOffset", String(offset));
      const response = await fetcher(`${API}/${service}/MapServer/${layer}/query?${params}`, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`提供元APIが応答できませんでした（${response.status}）。`);
      const page = await response.json();
      if (page.error) throw new Error(`提供元API: ${page.error.message}`);
      if (!Array.isArray(page.features)) throw new Error("提供元APIの応答形式が不正です。");
      for (const feature of page.features) {
        const a = feature.attributes;
        const id = a.objectid ?? a.OBJECTID ?? a.uniqueid ?? a.UNIQUEID;
        if (id === undefined || ids.has(id)) throw new Error("ページ分割の整合性を確認できませんでした。結果は表示しません。");
        ids.add(id); result.push(feature);
      }
      if (!page.exceededTransferLimit && page.features.length < 2000) return { records: result, retrievedAt: new Date().toISOString(), url: `${API}/${service}/MapServer/${layer}`, where };
      if (!page.features.length) throw new Error("提供元APIが途中で空のページを返しました。");
    }
    throw new Error("10万件を超えています。期間・水域を狭めてください。");
  })();
  if (cache.size >= 12) cache.delete(cache.keys().next().value);
  cache.set(key, { promise, expires: Date.now() + 3600000 });
  try { return await promise; } catch (error) { cache.delete(key); throw error; }
}

export async function getObservations(query, loader = queryArcGIS, profileLoader = getProfiles) {
  const spec = metrics[query.metric];
  const area = areas[query.area];
  const warnings = [];
  const provenance = [];
  const diagnostics = { missing: 0, censored: 0, invalidValue: 0, invalidLocation: 0, depthExcluded: 0, qcRejected:0, duplicates:0, profileLevels:0 };
  const sourceStatus=[];
  const records = [];
  for (const source of query.sources) {
    if (!spec.sources.includes(source)) { warnings.push(`${sources[source].label}には指定項目がありません。`); continue; }
    if(sources[source].cadence==='profile') {
      try {
        const fetched=await profileLoader(source,query,diagnostics);records.push(...fetched.records);provenance.push(fetched.provenance);
        sourceStatus.push({source,state:fetched.records.length?'ok':'empty',count:fetched.records.length});
        if(!fetched.records.length)warnings.push(`${sources[source].label}: 指定範囲・年月・深度・品質条件に有効な観測がありません。湾内や0〜1mにはArgoがない場合があります。`);
      } catch(error) {sourceStatus.push({source,state:'error',error:error.message});warnings.push(`${sources[source].label} 取得失敗: ${error.message}`);}
      continue;
    }
    if (source === "kosui" && (query.basis !== "fiscal" || query.months.length !== 12)) {
      warnings.push("公共用水域の年間値は月・季節・暦年に分解できないため除外しました。年度・全月を指定すると利用できます。"); continue;
    }
    const yearField = source === "koiki" && query.basis === "calendar" ? "surveyyear" : "nendo";
    const where = `${yearField} >= ${query.start} AND ${yearField} <= ${query.end}` + (source === "koiki" && area.wan ? ` AND wancode='${area.wan}'` : "");
    const fetched = await loader(source === "koiki" ? "KOIKI_01" : spec.annual.service, source === "koiki" ? 0 : spec.annual.layer, where, source === "koiki" && area.wan ? null : query.bbox || area.bbox);
    const normalized = normalize(fetched.records, source, query, diagnostics);
    records.push(...normalized);
    sourceStatus.push({source,state:normalized.length?'ok':'empty',count:normalized.length});
    provenance.push({ source, label: sources[source].label, url: fetched.url, where: fetched.where, retrievedAt: fetched.retrievedAt, fetchedCount: fetched.records.length, usedCount: normalized.length });
    if (source === "kosui") warnings.push("公共用水域は年間集約値です。採水深度による絞り込みは適用できません。広域総合と測定点・観測が重複する可能性があります。");
  }
  if (!provenance.length) throw new Error(warnings.join(" ") || "この条件で利用できるデータソースがありません。");
  if (spec.derived) warnings.push(query.metric === "PRESSURE" ? "広域総合の海圧は深度・緯度から推定、Argo・船舶CTDは観測海圧です。" : "密度は EOS-80 による派生値です。塩分を PSS-78、水温を ITS-90 として扱います。広域総合の海圧は深度から推定、プロファイルは観測海圧を用います。σt はポテンシャル密度偏差 σ0 ではありません。");
  if(query.sources.some((source)=>sources[source].cadence==='profile'))warnings.push(`外部プロファイルは選択深度内の有効層を先に平均し、${query.spatialBin}度区画ごとに年月集約しています。位置は有効プロファイルの平均位置です。固定測点と区画は空間的な代表範囲が異なります。外部の年月はUTCです。`);
  if(query.sources.includes('cchdo'))warnings.push('CCHDOは収録済み船舶CTDのみです。DARWINや気象庁の全航海を含むものではありません。登録航海の出典・EXPocodeを解析記録に保持します。');
  const result = aggregate(records, query, diagnostics);
  result.bySource = Object.fromEntries(query.sources.map((source) => [source, aggregate(records.filter((r) => r.source === source), query)]));
  return { ...result, warnings, provenance, sourceStatus, partial:sourceStatus.some((s)=>s.state==='error'), method: { aggregation: query.aggregation, equalYearDefinition: "観測（外部は深度内プロファイル平均）→測点/区画年月平均→年平均→期間平均。水域平均は測点/区画均等。欠測年・月は分母に含めない。", density: "EOS-80 (UNESCO 1983); observed pressure for profiles, estimated pressure for coastal observations" } };
}
