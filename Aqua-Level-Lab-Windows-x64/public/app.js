import { ContourMap } from "./contour-map.js";

const prefs = [
  ["99", "全国"], ["01", "北海道"], ["02", "青森県"], ["03", "岩手県"], ["04", "宮城県"],
  ["05", "秋田県"], ["06", "山形県"], ["07", "福島県"], ["08", "茨城県"], ["09", "栃木県"],
  ["10", "群馬県"], ["11", "埼玉県"], ["12", "千葉県"], ["13", "東京都"], ["14", "神奈川県"],
  ["15", "新潟県"], ["16", "富山県"], ["17", "石川県"], ["18", "福井県"], ["19", "山梨県"],
  ["20", "長野県"], ["21", "岐阜県"], ["22", "静岡県"], ["23", "愛知県"], ["24", "三重県"],
  ["25", "滋賀県"], ["26", "京都府"], ["27", "大阪府"], ["28", "兵庫県"], ["29", "奈良県"],
  ["30", "和歌山県"], ["31", "鳥取県"], ["32", "島根県"], ["33", "岡山県"], ["34", "広島県"],
  ["35", "山口県"], ["36", "徳島県"], ["37", "香川県"], ["38", "愛媛県"], ["39", "高知県"],
  ["40", "福岡県"], ["41", "佐賀県"], ["42", "長崎県"], ["43", "熊本県"], ["44", "大分県"],
  ["45", "宮崎県"], ["46", "鹿児島県"], ["47", "沖縄県"]
];

const itemLabels = [
  ["01", "健康項目"],
  ["02", "生活環境項目"],
  ["03", "全燐・全窒素"],
  ["04", "トリハロメタン生成能"],
  ["08", "ダイオキシン"]
];

const datasetNames = {
  kosui: "L3 整理済みデータ",
  koiki: "L3 広域水域データ",
  suiyoku: "L2/L3 沿岸観測データ",
  direct: "文献・累計表データ"
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const dataset = $("#dataset");
const kosuiType = $("#kosui-type");
const pref = $("#pref");
const item = $("#kosui-item");
const log = $("#log");
const statusPill = $("#status-pill");
const downloadBox = $("#download-box");
const downloadLink = $("#download-link");
const runButton = $("#run-button");
const modeLabel = $("#mode-label");
const previewTitle = $("#preview-title");
const previewChips = $("#preview-chips");
const queryPreview = $("#query-preview");
const researchPlan = $("#research-plan");
const installButton = $("#install-button");
const installButtonBottom = $("#install-button-bottom");
const installSheet = $("#install-sheet");
const demoButton = $("#demo-button");
const visualizeButton = $("#visualize-button");
const visualization = $("#visualization");
const contourView = $("#contour-view");
const contourMap = new ContourMap(contourView);
const averageChart = $("#average-chart");
const vizTitle = $("#viz-title");
const vizCount = $("#viz-count");
const demoNote = $("#demo-note");
const sourceList = $("#source-list");
let deferredInstallPrompt = null;

const analysisLabels = {
  bayAverage: "湾・灘別の平均",
  cumulativeAverage: "累計ごとの平均",
  seasonalAverage: "季別の平均",
  contour: "コンター表示用データ"
};

const areaLabels = {
  "tokyo-bay": "東京湾",
  "ise-bay": "伊勢湾",
  "osaka-bay": "大阪湾",
  seto: "瀬戸内海"
};

function fillOptions(select, options, selected) {
  select.innerHTML = "";
  for (const [value, label] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = value === selected;
    select.append(option);
  }
}

function optionLabel(select) {
  return select.options[select.selectedIndex]?.textContent || "";
}

function setRadio(name, value) {
  const radio = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (radio) radio.checked = true;
}

async function installApp() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installButton.hidden = true;
  installSheet.classList.remove("is-visible");
}

function setDataset(value) {
  dataset.value = value;
  updateMode();
  updatePreview();
}

function addRun(message, state = "info") {
  const empty = log.querySelector(".empty-run");
  if (empty) log.innerHTML = "";

  const li = document.createElement("li");
  li.dataset.state = state;
  li.innerHTML = `
    <div class="run-meta">${new Date().toLocaleTimeString("ja-JP")} / ${datasetNames[dataset.value]}</div>
    <div class="run-message">${message}</div>
  `;
  log.prepend(li);
}

function setStatus(text, busy = false, state = "idle") {
  statusPill.textContent = text;
  statusPill.dataset.busy = String(busy);
  statusPill.dataset.state = state;
  runButton.disabled = busy;
}

function selectedFormat() {
  return document.querySelector("input[name='format']:checked").value;
}

function buildKosuiPayload() {
  const type = kosuiType.value;
  const year = $("#kosui-year").value;
  const prefCode = pref.value;
  const area = $("#water-area").value;
  const extension = selectedFormat();
  let featureClassName = "p_kosui_location";
  let whereClause = `nendo=${year}`;

  if (type === "md" || type === "mk") {
    featureClassName = `p_kosui_${type === "md" ? "y" : "k"}${item.value}`;
    if (area === "1") whereClause += " and suiikicode < '500'";
    if (area === "2") whereClause += " and '500' <= suiikicode and suiikicode < '600'";
    if (area === "3") whereClause += " and '600' <= suiikicode";
  }
  if (prefCode !== "99") {
    whereClause += ` and prefcode='${prefCode}'`;
  }
  return { featureClassName, whereClause, extension };
}

function buildPayload() {
  if (dataset.value === "kosui") return buildKosuiPayload();
  if (dataset.value === "koiki") {
    return {
      featureClassName: "p_koiki_01",
      whereClause: `nendo=${$("#koiki-year").value} and wancode='${$("#wan").value}'`,
      extension: selectedFormat()
    };
  }
  return {
    featureClassName: "t_suiyoku",
    whereClause: `nendo=${$("#suiyoku-year").value} and seasonflag=${$("#season").value}`,
    extension: "csv"
  };
}

function previewState() {
  if (dataset.value === "direct") {
    return {
      title: datasetNames.direct,
      chips: [optionLabel($("#direct-kind")), "Excel"],
      query: `direct file: ${$("#direct-kind").value}`
    };
  }

  const payload = buildPayload();
  const chips = [`形式 ${payload.extension.toUpperCase()}`];

  if (dataset.value === "kosui") {
    chips.push(optionLabel(kosuiType), `${$("#kosui-year").value}年度`, optionLabel(pref));
    if (kosuiType.value !== "mm") chips.push(optionLabel($("#water-area")), optionLabel(item));
  }
  if (dataset.value === "koiki") {
    chips.push(`${$("#koiki-year").value}年度`, optionLabel($("#wan")));
  }
  if (dataset.value === "suiyoku") {
    chips.push(`${$("#suiyoku-year").value}年度`, optionLabel($("#season")));
  }

  return {
    title: datasetNames[dataset.value],
    chips,
    query: `${payload.featureClassName}\n${payload.whereClause}`
  };
}

function selectedAnalyses() {
  return $$('input[name="analysis"]:checked').map((input) => input.value);
}

function researchMode() {
  return document.querySelector('input[name="process-mode"]:checked').value;
}

function buildResearchPlan() {
  const mode = researchMode();
  const analyses = selectedAnalyses();
  const area = areaLabels[$("#research-area").value];
  const metric = $("#research-metric").value;
  const current = previewState();
  const sourcePolicy = mode === "unified"
    ? "L2/L3 ソースを同じ水域キーと時空間キーに正規化"
    : "ソース、観測方式、処理レベルを別系列として保持";

  if (!analyses.length) {
    return [{
      title: "研究計画なし",
      detail: "平均・季別・コンターのいずれかを選ぶと、必要な取得と処理単位を整理します。"
    }];
  }

  return analyses.map((analysis) => {
    if (analysis === "bayAverage") {
      return {
        title: `${area} / ${metric} / 平均`,
        detail: `${sourcePolicy}。地点別値を水域で束ね、年度単位の平均・件数・欠測数を出す設計です。`
      };
    }
    if (analysis === "cumulativeAverage") {
      return {
        title: `${area} / ${metric} / 累計平均`,
        detail: `${sourcePolicy}。複数年度を同じ指標で連結し、期間平均と年度別平均との差を確認する設計です。`
      };
    }
    if (analysis === "seasonalAverage") {
      return {
        title: `${area} / ${metric} / 季別平均`,
        detail: `${sourcePolicy}。月または測定時期を春夏秋冬へ寄せ、季節差を比較できる表にします。`
      };
    }
    return {
      title: `${area} / ${metric} / コンター`,
      detail: `${sourcePolicy}。緯度経度つき地点値を抽出し、GIS や Python で等値線化しやすい点データにします。`
    };
  }).concat({
    title: "現在の取得条件",
    detail: `${current.title} / ${current.chips.join(" / ")}`
  });
}

function updatePreview() {
  const preview = previewState();
  previewTitle.textContent = preview.title;
  previewChips.innerHTML = "";
  for (const chip of preview.chips) {
    const span = document.createElement("span");
    span.textContent = chip;
    previewChips.append(span);
  }
  queryPreview.textContent = preview.query;
  renderResearchPlan();
}

function renderResearchPlan() {
  researchPlan.innerHTML = "";
  for (const item of buildResearchPlan()) {
    const card = document.createElement("div");
    card.className = "plan-card";
    card.innerHTML = `<strong>${item.title}</strong><span>${item.detail}</span>`;
    researchPlan.append(card);
  }
}

function renderContour(data) {
  return contourMap.render(data);
}

function renderAverageChart(data) {
  averageChart.innerHTML = "";
  const rows = data.summary.filter((item) => item.count > 0);
  if (!rows.length) {
    averageChart.textContent = "平均を計算できるデータがありません。";
    return;
  }
  const maxAverage = Math.max(...rows.map((row) => row.average));
  for (const row of rows) {
    const bar = document.createElement("div");
    bar.className = "bar-row";
    bar.innerHTML = `
      <div class="bar-label">${row.label}<span>${row.count}件</span></div>
      <div class="bar-track"><span style="width:${Math.max(4, (row.average / maxAverage) * 100)}%"></span></div>
      <strong>${row.average.toFixed(2)}</strong>
    `;
    averageChart.append(bar);
  }

  const seasonal = data.seasonal.filter((item) => item.season !== "年度値");
  if (seasonal.length) {
    const block = document.createElement("div");
    block.className = "season-grid";
    block.innerHTML = seasonal.map((item) => (
      `<span>${item.source} ${item.season}: <strong>${item.average.toFixed(2)}</strong></span>`
    )).join("");
    averageChart.append(block);
  }
}

function makeDemoData() {
  const demoPoints = [
    { source: "L3 沿岸モニタリング", name: "東京湾奥 A", latitude: 35.62, longitude: 139.82, value: 3.1, season: "春" },
    { source: "L3 沿岸モニタリング", name: "東京湾奥 B", latitude: 35.55, longitude: 139.90, value: 3.8, season: "夏" },
    { source: "L3 沿岸モニタリング", name: "東京湾中央", latitude: 35.42, longitude: 139.82, value: 2.6, season: "秋" },
    { source: "L3 沿岸モニタリング", name: "湾口", latitude: 35.22, longitude: 139.74, value: 1.8, season: "冬" },
    { source: "L2 気象庁観測船", name: "観測定線 JMA-01", latitude: 35.05, longitude: 139.62, value: 1.4, season: "春" },
    { source: "L2 気象庁観測船", name: "観測定線 JMA-02", latitude: 34.90, longitude: 139.45, value: 1.2, season: "夏" },
    { source: "L2 Argo", name: "Argo profile offshore", latitude: 34.72, longitude: 139.95, value: 0.9, season: "秋" },
    { source: "L2 Argo", name: "BGC Argo oxygen/nitrate", latitude: 34.58, longitude: 140.20, value: 1.1, season: "冬" },
    { source: "L2 JAMSTEC", name: "cruise station 01", latitude: 35.12, longitude: 139.95, value: 1.6, season: "春" },
    { source: "L2 JAMSTEC", name: "cruise station 02", latitude: 34.82, longitude: 140.18, value: 1.0, season: "夏" }
  ];
  const groups = new Map();
  const seasonalGroups = new Map();
  for (const point of demoPoints) {
    if (!groups.has(point.source)) groups.set(point.source, []);
    groups.get(point.source).push(point);
    const seasonKey = `${point.source}:${point.season}`;
    if (!seasonalGroups.has(seasonKey)) seasonalGroups.set(seasonKey, []);
    seasonalGroups.get(seasonKey).push(point);
  }
  const summary = Array.from(groups, ([label, points]) => {
    const values = points.map((point) => point.value);
    return {
      label,
      count: values.length,
      average: values.reduce((sum, value) => sum + value, 0) / values.length,
      min: Math.min(...values),
      max: Math.max(...values)
    };
  });
  const seasonal = Array.from(seasonalGroups, ([key, points]) => {
    const [source, season] = key.split(":");
    const values = points.map((point) => point.value);
    return {
      source,
      season,
      count: values.length,
      average: values.reduce((sum, value) => sum + value, 0) / values.length
    };
  });
  return {
    area: "東京湾から外洋",
    metric: "COD相当デモ指標",
    year: "L2/L3/L4",
    mode: "demo",
    count: demoPoints.length,
    points: demoPoints,
    summary,
    seasonal
  };
}

async function showDemoProduct() {
  const data = makeDemoData();
  visualization.hidden = false;
  demoNote.hidden = false;
  demoNote.innerHTML = `
    <strong>L2/L3/L4 統合デモ</strong>
    <span>L2: Argo・気象庁観測船・JAMSTEC航海観測、L3: 沿岸モニタリング、L4: 平均・季節・コンター風プロダクト。</span>
  `;
  vizTitle.textContent = `${data.area} ${data.metric}`;
  vizCount.textContent = `${data.count}点`;
  await renderContour(data);
  renderAverageChart(data);
  addRun("デモ表示: L2/L3/L4 の統合プロダクトを描画しました。", "done");
  setStatus("デモ表示", false, "done");
}

async function showVisualization() {
  setStatus("表示中", true);
  visualizeButton.disabled = true;
  try {
    const params = new URLSearchParams({
      area: $("#research-area").value,
      metric: $("#research-metric").value,
      mode: researchMode(),
      year: dataset.value === "koiki" ? $("#koiki-year").value : $("#kosui-year").value,
      include: "both"
    });
    const response = await fetch(`/api/visual-data?${params}`);
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || "表示データを取得できませんでした。");
    visualization.hidden = false;
    demoNote.hidden = true;
    vizTitle.textContent = `${data.area} ${data.metric}`;
    vizCount.textContent = `${data.count}地点`;
    await renderContour(data);
    renderAverageChart(data);
    addRun(`画面表示: ${data.area} / ${data.metric} / ${data.count}地点`, "done");
    setStatus("表示完了", false, "done");
  } catch (error) {
    addRun(error.message, "error");
    setStatus("エラー", false, "error");
  } finally {
    visualizeButton.disabled = false;
    runButton.disabled = false;
  }
}

function priorityLabel(priority) {
  if (priority === "high") return "優先";
  if (priority === "medium") return "候補";
  return "補完";
}

function levelLabel(level) {
  if (level === "L2") return "L2 観測";
  if (level === "L3") return "L3 集約";
  if (level === "L4") return "L4 解析";
  return "未分類";
}

async function loadExternalSources() {
  try {
    const response = await fetch("/api/external-sources");
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || "外部ソースを読み込めませんでした。");
    sourceList.innerHTML = "";
    for (const source of data.sources) {
      const card = document.createElement("article");
      card.className = `source-card priority-${source.priority}`;
      card.innerHTML = `
        <div class="source-card-head">
          <strong>${source.name}</strong>
          <span>${levelLabel(source.processingLevel)}</span>
        </div>
        <p>${source.note}</p>
        <dl>
          <div><dt>機関</dt><dd>${source.owner}</dd></div>
          <div><dt>対象</dt><dd>${source.area}</dd></div>
          <div><dt>形式</dt><dd>${source.formats.join(" / ")}</dd></div>
          <div><dt>統合</dt><dd>${source.integration}</dd></div>
          <div><dt>優先</dt><dd>${priorityLabel(source.priority)}</dd></div>
        </dl>
        <a href="${source.url}" target="_blank" rel="noreferrer">データ元を開く</a>
      `;
      sourceList.append(card);
    }
  } catch (error) {
    sourceList.innerHTML = `<div class="empty-run">${error.message}</div>`;
  }
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error || "処理に失敗しました。");
  }
  return data;
}

async function waitForFile(id) {
  for (let i = 0; i < 90; i += 1) {
    const { status } = await postJson("/api/status", { resultFileName: id });
    if (status === "Stopped") return true;
    if (status !== "Running") throw new Error(`作成処理が停止しました: ${status}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("作成完了を確認できませんでした。時間を置いて再実行してください。");
}

async function runExtraction(event) {
  event.preventDefault();
  downloadBox.hidden = true;
  setStatus("処理中", true);

  try {
    if (dataset.value === "direct") {
      const kind = $("#direct-kind").value;
      downloadLink.href = `/api/direct?kind=${encodeURIComponent(kind)}`;
      downloadLink.download = "";
      downloadBox.hidden = false;
      addRun(`${optionLabel($("#direct-kind"))} のダウンロードリンクを作成しました。`, "done");
      setStatus("完了", false, "done");
      return;
    }

    const payload = buildPayload();
    addRun(`作成開始: ${payload.featureClassName}`, "running");
    const { id } = await postJson("/api/start", payload);
    if (id === "RecordNotFound") throw new Error("指定条件のデータファイルはありません。");
    if (id === "BadRequest") throw new Error("提供元サイトで不正なリクエストとして扱われました。");

    addRun(`作成 ID: ${id}`, "running");
    await waitForFile(id);
    downloadLink.href = `/api/download?id=${encodeURIComponent(id)}`;
    downloadLink.download = "";
    downloadBox.hidden = false;
    addRun(`準備完了: ${previewState().chips.join(" / ")}`, "done");
    setStatus("完了", false, "done");
  } catch (error) {
    addRun(error.message, "error");
    setStatus("エラー", false, "error");
  } finally {
    runButton.disabled = false;
  }
}

function updateMode() {
  const value = dataset.value;
  $$(".conditional").forEach((node) => {
    node.hidden = node.dataset.for !== value;
  });
  $$(".dataset-card").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.dataset === value);
  });
  $("#format-row").hidden = value === "direct" || value === "suiyoku";
  modeLabel.textContent = datasetNames[value];
  updateKosuiType();
}

function updateKosuiType() {
  const isPoint = kosuiType.value === "mm";
  $("#water-area-row").hidden = isPoint;
  $("#item-row").hidden = isPoint;
}

function applyPreset(name) {
  if (name === "tokyo-health") {
    setDataset("kosui");
    kosuiType.value = "md";
    $("#kosui-year").value = "2024";
    pref.value = "13";
    $("#water-area").value = "0";
    item.value = "01";
    setRadio("format", "csv");
  }
  if (name === "tokyo-bay") {
    setDataset("koiki");
    $("#koiki-year").value = "2023";
    $("#wan").value = "01";
    setRadio("format", "shp");
  }
  if (name === "beach") {
    setDataset("suiyoku");
    $("#suiyoku-year").value = "2025";
    $("#season").value = "0";
  }
  updateMode();
  updatePreview();
}

fillOptions(pref, prefs, "99");
fillOptions(item, itemLabels, "01");

dataset.addEventListener("change", () => {
  updateMode();
  updatePreview();
});

$$(".dataset-card").forEach((button) => {
  button.addEventListener("click", () => setDataset(button.dataset.dataset));
});

$$("[data-preset]").forEach((button) => {
  button.addEventListener("click", () => applyPreset(button.dataset.preset));
});

$$("select, input").forEach((control) => {
  control.addEventListener("input", () => {
    updateKosuiType();
    updatePreview();
  });
  control.addEventListener("change", () => {
    updateKosuiType();
    updatePreview();
  });
});

$("#extract-form").addEventListener("submit", runExtraction);
demoButton.addEventListener("click", showDemoProduct);
visualizeButton.addEventListener("click", showVisualization);
$("#reset-log").addEventListener("click", () => {
  log.innerHTML = '<li class="empty-run">処理を開始すると、ここに結果が積み上がります。</li>';
  downloadBox.hidden = true;
  visualization.hidden = true;
  contourMap.clear();
  demoNote.hidden = true;
  setStatus("待機中");
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installButton.hidden = false;
  installSheet.classList.add("is-visible");
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  installButton.hidden = true;
  installSheet.classList.remove("is-visible");
});

installButton.addEventListener("click", installApp);
installButtonBottom.addEventListener("click", installApp);

if (!document.querySelector("#aqua-offline-map") && /^https?:$/.test(location.protocol) && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js");
  });
}

updateMode();
updatePreview();
if (document.querySelector("#aqua-offline-map")) {
  showDemoProduct().then(() => {
    demoNote.querySelector("span").textContent = "サンプルデータによる表示です。実データの新規取得は Windows 版で利用できます。";
  });
} else {
  loadExternalSources();
}
