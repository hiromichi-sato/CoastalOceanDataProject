export const areas = {
  "tokyo-bay": { label: "東京湾", wan: "01", bbox: [139.55, 34.9, 140.18, 35.78] },
  "ise-bay": { label: "伊勢湾", wan: "02", bbox: [136.25, 34.25, 137.55, 35.2] },
  "osaka-bay": { label: "大阪湾", wan: "03", bbox: [134.85, 34.15, 135.75, 34.9] },
  seto: { label: "瀬戸内海", wan: "04", bbox: [130.65, 32.35, 135.85, 35.45] },
  'boso-offshore': { label: '房総・伊豆沖', bbox: [138, 28, 145, 36] },
  'kuroshio': { label: '四国・紀伊沖', bbox: [132, 28, 139, 34] },
  'sanriku': { label: '三陸沖', bbox: [141, 36, 148, 42] },
  custom: { label: '範囲指定（日本近海）', bbox: [140, 30, 144, 35] }
};

const metric = (label, unit, field, options = {}) => ({ label, unit, field, sources: ["koiki"], ...options });
export const metrics = {
  TEMP: metric("水温", "degree_Celsius", "wtemp", { group: "基本物理量", min: -3, max: 45 }),
  SAL: metric("実用塩分", "1", "salt", { group: "基本物理量", min: 0, max: 45 }),
  RHO: metric("密度（EOS-80・推定海圧）", "kg m-3", null, { group: "基本物理量", derived: true }),
  RHO0: metric("密度（EOS-80・0 dbar）", "kg m-3", null, { group: "基本物理量", derived: true }),
  SIGMAT: metric("密度偏差 σt（0 dbar）", "kg m-3", null, { group: "基本物理量", derived: true }),
  PRESSURE: metric("海圧（実測／深度換算）", "dbar", null, { group: "基本物理量", derived: true }),
  DEPTH: metric("採水深度", "m", "saisuidepth", { group: "基本物理量", min: 0 }),
  WATER_DEPTH: metric("測点水深", "m", "depth", { group: "基本物理量", min: 0 }),
  PH: metric("pH", "1", "ph", { group: "水質", min: 0, max: 14 }),
  DO: metric("溶存酸素", "mg L-1", "do_", { group: "水質", min: 0, sources: ["koiki", "kosui"], annual: { service: "KOSUI_02", layer: 9, field: "do_" } }),
  COD: metric("COD", "mg L-1", "cod", { group: "水質", min: 0, sources: ["koiki", "kosui"], annual: { service: "KOSUI_02", layer: 18, field: "cod" } }),
  RCOD: metric("溶存態 COD", "mg L-1", "rcod", { group: "水質", min: 0 }),
  CLARITY: metric("透明度", "m", "clearness", { group: "水質", min: 0 }),
  TN: metric("全窒素", "mg L-1", "tn", { group: "栄養塩・有機物", min: 0, sources: ["koiki", "kosui"], annual: { service: "KOSUI_03", layer: 3, field: "tn" } }),
  TP: metric("全リン", "mg L-1", "tp", { group: "栄養塩・有機物", min: 0, sources: ["koiki", "kosui"], annual: { service: "KOSUI_03", layer: 6, field: "tp" } }),
  NH4: metric("アンモニア態窒素 NH4-N", "mg L-1", "nh4n", { group: "栄養塩・有機物", min: 0 }),
  NO2: metric("亜硝酸態窒素 NO2-N", "mg L-1", "no2n", { group: "栄養塩・有機物", min: 0 }),
  NO3: metric("硝酸態窒素 NO3-N", "mg L-1", "no3n", { group: "栄養塩・有機物", min: 0 }),
  PO4: metric("リン酸態リン PO4-P", "mg L-1", "po4p", { group: "栄養塩・有機物", min: 0 }),
  CHLA: metric("クロロフィル a", "ug L-1", "chlorophyl", { group: "栄養塩・有機物", min: 0 }),
  PHEO: metric("フェオフィチン", "ug L-1", "feiochin", { group: "栄養塩・有機物", min: 0 }),
  TOC: metric("全有機炭素 TOC", "mg L-1", "toc", { group: "栄養塩・有機物", min: 0 }),
  DOC: metric("溶存有機炭素 DOC", "mg L-1", "doc", { group: "栄養塩・有機物", min: 0 }),
  BOD: metric("BOD（年間値）", "mg L-1", null, { group: "年間値のみ", min: 0, sources: ["kosui"], annual: { service: "KOSUI_02", layer: 18, field: "bod" } }),
  SS: metric("浮遊物質 SS（年間値）", "mg L-1", null, { group: "年間値のみ", min: 0, sources: ["kosui"], annual: { service: "KOSUI_02", layer: 18, field: "ss" } })
};

export const sources = {
  koiki: { label: "環境省・広域総合（観測値）", cadence: "observation", url: "https://water-pub.env.go.jp/gis/rest/services/KOIKI_01/MapServer/0" },
  kosui: { label: "環境省・公共用水域（年間値）", cadence: "annual", url: "https://water-pub.env.go.jp/water-pub/mizu-site/mizu/download/download.asp" },
  argo: { label: 'Argo（Ifremer・プロファイル）', cadence: 'profile', url: 'https://erddap.ifremer.fr/erddap/tabledap/ArgoFloats.html' },
  cchdo: { label: 'CCHDO / GO-SHIP（船舶CTD）', cadence: 'profile', url: 'https://data.pmel.noaa.gov/generic/erddap/tabledap/cchdo_ctd.html' }
};

for (const key of ['TEMP','SAL','RHO','RHO0','SIGMAT','PRESSURE','DEPTH']) metrics[key].sources.push('argo','cchdo');
metrics.DO.sources.push('cchdo');

export const seasons = { all: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], spring: [3, 4, 5], summer: [6, 7, 8], autumn: [9, 10, 11], winter: [12, 1, 2] };
