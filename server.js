import http from "node:http";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const desktopLaunch = process.argv.includes("--desktop");
const PORT = desktopLaunch ? 0 : Number(process.env.PORT || 5173);
const ENV_BASE = "https://water-pub.env.go.jp";
const ZIP_BASE = `${ENV_BASE}/water-pub/mizu-site/zip_create`;

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const allowedTables = new Set([
  "p_kosui_y01",
  "p_kosui_y02",
  "p_kosui_y03",
  "p_kosui_y04",
  "p_kosui_y08",
  "p_kosui_k01",
  "p_kosui_k02",
  "p_kosui_k03",
  "p_kosui_k04",
  "p_kosui_k08",
  "p_kosui_location",
  "p_koiki_01",
  "t_suiyoku"
]);

const directFiles = {
  bottom: "kouiki/bottom_2023.xlsx",
  benthos: "kouiki/benthos_2023.xlsx",
  phytoplankton: "kouiki/plankton_2023.xlsx",
  zooplankton: "kouiki/zooplankton_2015.xlsx"
};

const visualAreas = {
  "tokyo-bay": { label: "東京湾", wan: "01", bbox: [139.55, 34.9, 140.18, 35.78] },
  "ise-bay": { label: "伊勢湾", wan: "02", bbox: [136.25, 34.25, 137.55, 35.2] },
  "osaka-bay": { label: "大阪湾", wan: "03", bbox: [134.85, 34.15, 135.75, 34.9] },
  seto: { label: "瀬戸内海", wan: "04", bbox: [130.65, 32.35, 135.85, 35.45] }
};

const visualMetrics = {
  COD: {
    label: "COD",
    koiki: { service: "KOIKI_01", layer: 6, valueField: "cod2" },
    kosui: { service: "KOSUI_02", layer: 18, valueField: "cod" }
  },
  DO: {
    label: "DO",
    koiki: { service: "KOIKI_01", layer: 4, valueField: "do_2" },
    kosui: { service: "KOSUI_02", layer: 9, valueField: "do_" }
  },
  TN: {
    label: "全窒素",
    koiki: { service: "KOIKI_01", layer: 11, valueField: "tn2" },
    kosui: { service: "KOSUI_03", layer: 3, valueField: "tn" }
  },
  TP: {
    label: "全燐",
    koiki: { service: "KOIKI_01", layer: 14, valueField: "tp2" },
    kosui: { service: "KOSUI_03", layer: 6, valueField: "tp" }
  }
};

const externalSources = [
  {
    id: "tokyo-metropolitan",
    name: "東京都環境局 公共用水域水質測定結果",
    owner: "東京都",
    area: "東京都内河川・湖沼・東京湾内湾・運河",
    formats: ["CSV", "Excel", "PDF"],
    integration: "CSVコネクタ候補",
    processingLevel: "L3",
    priority: "high",
    url: "https://www.kankyo.metro.tokyo.lg.jp/water/tokyo_bay/measurements/measurements",
    note: "年度別に河川・湖沼・内湾・運河の測定結果 CSV が公開されています。"
  },
  {
    id: "tokyo-bay-council",
    name: "東京湾岸自治体環境保全会議 東京湾水質調査",
    owner: "東京湾岸自治体環境保全会議",
    area: "東京湾広域",
    formats: ["CSV", "PDF"],
    integration: "広域比較の優先候補",
    processingLevel: "L3",
    priority: "high",
    url: "https://www.kankyo.metro.tokyo.lg.jp/water/tokyo_bay/partnership/conference",
    note: "自治体横断の東京湾水質調査報告書と水質データ CSV が公開されています。"
  },
  {
    id: "chiba-prefecture",
    name: "千葉県 公共用水域地点別水質測定結果",
    owner: "千葉県",
    area: "東京湾内湾・東京湾内房・河川・湖沼・海域",
    formats: ["CSV", "Excel", "PDF"],
    integration: "CSVコネクタ候補",
    processingLevel: "L3",
    priority: "high",
    url: "https://www.pref.chiba.lg.jp/suiho/kasentou/koukyouyousui/data/data_1.html",
    note: "測定水域ごとの水質測定結果、環境基準達成状況、年平均値が公開されています。"
  },
  {
    id: "kanagawa-prefecture",
    name: "神奈川県 公共用水域及び地下水の水質測定結果",
    owner: "神奈川県",
    area: "東京湾・相模湾・河川・湖沼・地下水",
    formats: ["Excel", "HTML"],
    integration: "Excelコネクタ候補",
    processingLevel: "L3",
    priority: "medium",
    url: "https://catalog.opendata.pref.kanagawa.jp/dataset/723ebc6e9be9a2a781e4b0ca1dc5975a",
    note: "県オープンデータカタログに年1回更新のデータセットがあります。"
  },
  {
    id: "yokohama-city",
    name: "横浜市オープンデータ 公共用水域水質測定結果",
    owner: "横浜市",
    area: "横浜市内公共用水域",
    formats: ["CSV", "XLSX"],
    integration: "CSVコネクタ候補",
    processingLevel: "L3",
    priority: "medium",
    url: "https://data.city.yokohama.lg.jp/dataset/seisaku_15",
    note: "pH、BOD/COD、DO、SS、健康項目などが CSV/XLSX で公開されています。"
  },
  {
    id: "mlit-river",
    name: "国土交通省 水文水質データベース",
    owner: "国土交通省",
    area: "全国の河川・ダム等の観測所",
    formats: ["HTML"],
    integration: "観測所検索コネクタ候補",
    processingLevel: "L2",
    priority: "medium",
    url: "https://www1.river.go.jp/contents.html",
    note: "水質、底質、地下水質、海象などの観測データが公開されています。"
  },
  {
    id: "nies-igreen",
    name: "国立環境研究所 環境数値データベース",
    owner: "国立環境研究所",
    area: "全国の公共用水域",
    formats: ["HTML"],
    integration: "検証・補完候補",
    processingLevel: "L3",
    priority: "low",
    url: "https://www.nies.go.jp/igreen/md_disp.html",
    note: "公共用水域水質年間値データを条件指定で閲覧できます。"
  },
  {
    id: "jamstec-darwin",
    name: "JAMSTEC DARWIN 航海・潜航データ",
    owner: "海洋研究開発機構（JAMSTEC）",
    area: "JAMSTEC船舶・潜水船の観測海域",
    formats: ["メタデータ", "観測データ", "サンプル情報", "DOI"],
    integration: "研究航海レイヤー候補",
    processingLevel: "L2",
    priority: "medium",
    url: "https://www.godac.jamstec.go.jp/darwin/ja/",
    note: "航海・潜航単位の観測データやサンプル情報を公開。DOIは航海単位で付与され、論文引用に使えます。"
  },
  {
    id: "jma-vessel-obs",
    name: "気象庁 海洋気象観測船 観測資料",
    owner: "気象庁",
    area: "日本近海・北西太平洋・主要観測定線",
    formats: [".SUM", ".STN", ".E", ".CTD", ".XCT", ".WAT", ".WAY", ".FLT", ".TRB", ".OHM"],
    integration: "観測航海・断面・鉛直プロファイル候補",
    processingLevel: "L2",
    priority: "high",
    url: "https://www.data.jma.go.jp/kaiyou/db/vessel_obs/data-report/html/ship/ship.html",
    note: "気象庁観測船による海洋・海上気象、CTD、採水、酸素、栄養塩、温室効果ガス、海洋汚染物質等の観測資料です。"
  },
  {
    id: "argo-gdac",
    name: "Argo GDAC プロファイルデータ",
    owner: "International Argo Program / Argo GDAC",
    area: "全球海洋・日本近海・北西太平洋",
    formats: ["NetCDF", "ERDDAP", "THREDDS", "CSV selection"],
    integration: "全球鉛直プロファイル・BGC補完候補",
    processingLevel: "L2",
    priority: "high",
    url: "https://argo.ucsd.edu/data/data-from-gdacs/",
    note: "Argo フロートの水温・塩分・圧力、BGC Argo の酸素・硝酸・pH・クロロフィル等を含む公式プロファイルデータです。"
  }
];

function sendJson(res, status, payload) {
  res.writeHead(status, jsonHeaders);
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 64_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body ? JSON.parse(body) : {}));
    req.on("error", reject);
  });
}

function validateCreationPayload(payload) {
  const featureClassName = String(payload.featureClassName || "");
  const whereClause = String(payload.whereClause || "");
  const extension = String(payload.extension || "");

  if (!allowedTables.has(featureClassName)) {
    throw new Error("未対応のデータ種別です。");
  }
  if (!["csv", "shp", "gml"].includes(extension)) {
    throw new Error("ファイル形式は csv / shp / gml のいずれかを指定してください。");
  }
  if (!/^[\w\s='<>.()-]+$/.test(whereClause) || whereClause.length > 240) {
    throw new Error("抽出条件の形式が不正です。");
  }
  return { featureClassName, whereClause, extension };
}

async function postAsmx(method, payload) {
  const response = await fetch(`${ZIP_BASE}/WebService.asmx/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`環境省サイトからエラーが返りました: ${response.status}`);
  }

  try {
    return JSON.parse(text).d;
  } catch {
    throw new Error("環境省サイトの応答を読み取れませんでした。");
  }
}

async function queryArcGis({ service, layer, where, geometry }) {
  const params = new URLSearchParams({
    f: "json",
    where,
    outFields: "*",
    returnGeometry: "true",
    outSR: "4326",
    resultRecordCount: "2000"
  });
  if (geometry) {
    params.set("geometry", geometry.join(","));
    params.set("geometryType", "esriGeometryEnvelope");
    params.set("inSR", "4326");
    params.set("spatialRel", "esriSpatialRelIntersects");
  }

  const response = await fetch(`${ENV_BASE}/gis/rest/services/${service}/MapServer/${layer}/query?${params}`);
  if (!response.ok) {
    throw new Error(`ArcGIS サービスからエラーが返りました: ${response.status}`);
  }
  const data = await response.json();
  if (data.error) {
    throw new Error(data.error.message || "ArcGIS サービスの問い合わせに失敗しました。");
  }
  return data.features || [];
}

function seasonFromMonth(month) {
  if (!month) return "年度値";
  if ([3, 4, 5].includes(month)) return "春";
  if ([6, 7, 8].includes(month)) return "夏";
  if ([9, 10, 11].includes(month)) return "秋";
  return "冬";
}

function normalizeFeatures(features, source, valueField) {
  return features.map((feature) => {
    const geometry = feature.geometry || {};
    const attrs = Object.fromEntries(
      Object.entries(feature.attributes || {}).map(([key, value]) => [key.toLowerCase(), value])
    );
    const value = Number(attrs[valueField.toLowerCase()]);
    const longitude = Number(attrs.longitude != null ? attrs.longitude : geometry.x);
    const latitude = Number(attrs.latitude != null ? attrs.latitude : geometry.y);
    return {
      source,
      id: attrs.uniqueid || attrs.zettaicode || attrs.objectid,
      name: attrs.locationname || attrs.water || "地点",
      nendo: attrs.nendo,
      month: attrs.surveymonth || null,
      season: seasonFromMonth(attrs.surveymonth),
      value,
      longitude,
      latitude
    };
  }).filter((item) =>
    Number.isFinite(item.value) &&
    Number.isFinite(item.longitude) &&
    Number.isFinite(item.latitude)
  );
}

function summarizeVisualData(points, mode) {
  const groups = new Map();
  for (const point of points) {
    const key = mode === "separate" ? point.source : "統合";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(point);
  }
  return Array.from(groups, ([label, items]) => {
    const values = items.map((item) => item.value);
    return {
      label,
      count: values.length,
      average: values.reduce((sum, value) => sum + value, 0) / values.length,
      min: Math.min(...values),
      max: Math.max(...values)
    };
  });
}

function summarizeSeasonal(points, mode) {
  const groups = new Map();
  for (const point of points) {
    const key = `${mode === "separate" ? point.source : "統合"}:${point.season}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(point);
  }
  return Array.from(groups, ([key, items]) => {
    const [source, season] = key.split(":");
    const values = items.map((item) => item.value);
    return {
      source,
      season,
      count: values.length,
      average: values.reduce((sum, value) => sum + value, 0) / values.length
    };
  });
}

async function handleVisualData(res, url) {
  const areaKey = String(url.searchParams.get("area") || "tokyo-bay");
  const metricKey = String(url.searchParams.get("metric") || "COD");
  const mode = String(url.searchParams.get("mode") || "unified");
  const year = Number(url.searchParams.get("year") || "2023");
  const include = String(url.searchParams.get("include") || "both");
  const area = visualAreas[areaKey];
  const metric = visualMetrics[metricKey];
  if (!area || !metric || !Number.isInteger(year)) {
    sendJson(res, 400, { error: "表示条件が不正です。" });
    return;
  }

  const datasets = [];
  if (include === "both" || include === "koiki") {
    const koiki = await queryArcGis({
      ...metric.koiki,
      where: `nendo=${year} AND wancode='${area.wan}'`
    });
    datasets.push(...normalizeFeatures(koiki, "広域総合", metric.koiki.valueField));
  }
  if (include === "both" || include === "kosui") {
    const kosui = await queryArcGis({
      ...metric.kosui,
      where: `nendo=${year}`,
      geometry: area.bbox
    });
    datasets.push(...normalizeFeatures(kosui, "公共用水域", metric.kosui.valueField));
  }

  sendJson(res, 200, {
    area: area.label,
    metric: metric.label,
    year,
    mode,
    count: datasets.length,
    points: datasets.slice(0, 1200),
    summary: summarizeVisualData(datasets, mode),
    seasonal: summarizeSeasonal(datasets, mode)
  });
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { application: "aqua-level-lab" });
    return;
  }
  try {
    if (req.method === "POST" && url.pathname === "/api/start") {
      const payload = validateCreationPayload(await readBody(req));
      const id = await postAsmx("StartCreation", payload);
      sendJson(res, 200, { id });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/status") {
      const { resultFileName } = await readBody(req);
      if (!/^[a-z0-9.]+$/i.test(String(resultFileName || ""))) {
        throw new Error("結果ファイル ID が不正です。");
      }
      const status = await postAsmx("GetThreadStatus", { resultFileName });
      sendJson(res, 200, { status });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/download") {
      const id = String(url.searchParams.get("id") || "");
      if (!/^[a-z0-9.]+$/i.test(id)) {
        throw new Error("ダウンロード ID が不正です。");
      }
      await proxyFile(res, `${ZIP_BASE}/download.aspx?id=${encodeURIComponent(id)}`);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/direct") {
      const kind = String(url.searchParams.get("kind") || "");
      const file = directFiles[kind];
      if (!file) {
        throw new Error("対象データを選択してください。");
      }
      await proxyFile(res, `${ENV_BASE}/water-pub/mizu-site/mizu/download/${file}`);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/visual-data") {
      await handleVisualData(res, url);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/external-sources") {
      sendJson(res, 200, { sources: externalSources });
      return;
    }

    sendJson(res, 404, { error: "API が見つかりません。" });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

async function proxyFile(res, remoteUrl) {
  const upstream = await fetch(remoteUrl);
  if (!upstream.ok || !upstream.body) {
    sendJson(res, upstream.status || 502, { error: "ファイルを取得できませんでした。" });
    return;
  }

  const headers = {
    "content-type": upstream.headers.get("content-type") || "application/octet-stream",
    "cache-control": "no-store"
  };
  const disposition = upstream.headers.get("content-disposition");
  if (disposition) {
    headers["content-disposition"] = disposition;
  }
  res.writeHead(200, headers);
  for await (const chunk of upstream.body) {
    res.write(chunk);
  }
  res.end();
}

async function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const fullPath = path.normalize(path.join(publicDir, requested));
  if (!fullPath.startsWith(publicDir) || !existsSync(fullPath)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const ext = path.extname(fullPath).toLowerCase();
  res.writeHead(200, { "content-type": mimeTypes[ext] || "application/octet-stream" });
  createReadStream(fullPath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    await handleApi(req, res, url);
    return;
  }
  await serveStatic(req, res, url);
});

server.listen(PORT, desktopLaunch ? "127.0.0.1" : process.env.HOST || undefined, () => {
  if (desktopLaunch) {
    console.log(JSON.stringify({ type: "aqua-ready", port: server.address().port }));
  }
  const appUrl = `http://localhost:${server.address().port}`;
  console.log(`Aqua Level Lab is running at ${appUrl}`);
  console.log("Keep this window open while using the app. Press Ctrl+C to stop.");

  if (process.platform === "win32" && process.argv.includes("--open")) {
    const browser = spawn("explorer.exe", [appUrl], {
      stdio: "ignore",
      windowsHide: true
    });
    browser.on("error", () => {
      console.log(`Open this address in your browser: ${appUrl}`);
    });
    browser.unref();
  }
});
