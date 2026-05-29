import {decodeFlowBinary, decodeIlceVoteBinary} from "./flow-binary.js";
import {decodeSharePayload, encodeSharePayload} from "./share-state.js";

const DATA = JSON.parse(document.getElementById('ei-data').textContent);
const flowPromises = {};
const provinceFlowPromises = {};
const ilceVotePromises = {};
let ilceGeometryPromise = null;
let ilGeometryPromise = null;
const DEFAULT_MODEL_PRIORITY = [
  "balanced_forward_bayes",
  "balanced_forward_bayes_2023_mv_cb",
  "joint_margin_balanced",
  "province_penalty_reciprocal_prior",
  "province_penalty",
  "joint_bidirectional",
];
let renderSeq = 0;
let lastDragEndedAt = 0;
let activeMapContext = null;
let activeMapData = null;
let activeMapMetric = "count";
let pendingShareMapState = null;
const $ = id => document.getElementById(id);
const fmt = new Intl.NumberFormat('en-US', {maximumFractionDigits: 0});
const pct = x => "%" + (100*x).toFixed(1);
const million = x => (x / 1000000).toFixed(1) + "M";
const text = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const attr = value => text(value).replaceAll('"', "&quot;");
const desktopHoverMedia = window.matchMedia("(hover: hover) and (pointer: fine)");
const hoverLine = (message, mapContext = null) => {
  const el = $('hoverInfo');
  activeMapContext = mapContext;
  if (!el) return;
  if (!message) {
    el.textContent = "";
    return;
  }
  el.innerHTML = `<span class="hover-text">${text(message)}</span>${mapContext ? '<button id="openMap" type="button" class="ghost-button hover-map">Harita</button>' : ''}`;
};
function svgMessage(message, detail = "") {
  const svg = $('chart');
  if (!svg) return;
  const width = Math.max(svg.clientWidth || 980, 320);
  const height = Math.max(svg.clientHeight || 680, 320);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.innerHTML = `<text class="chart-message" x="${width / 2}" y="${height / 2}" text-anchor="middle">${text(message)}</text>${detail ? `<text class="chart-message-detail" x="${width / 2}" y="${height / 2 + 24}" text-anchor="middle">${text(detail)}</text>` : ""}`;
}
function setLoading(loading) {
  const svg = $('chart');
  if (!svg) return;
  svg.toggleAttribute('aria-busy', loading);
}
function dataUnavailable(message) {
  const error = new Error(message);
  error.dataUnavailable = true;
  return error;
}
const DEFAULT_COLORS = {
  ak_parti: "#f7931e",
  chp: "#df2027",
  mhp: "#000046",
  bbp: "#4242f0",
  iyi_parti: "#4aa3df",
  iyi: "#4aa3df",
  zafer_partisi: "#155179",
  memleket: "#d83a34",
  dem_star: "#74489C",
  kemal_kilicdaroglu: "#df2027",
  sinan_ogan: "#6f42c1",
  recep_tayyip_erdogan: "#f7931e",
  muharrem_ince: "#d83a34",
  tip: "#b91c1c",
  refah: "#009400",
  refah_partisi: "#009400",
  fazilet: "#009400",
  fazilet_partisi: "#009400",
  saadet: "#009400",
  yeniden_refah: "#b1ab06",
  deva_partisi: "#2563eb",
  gelecek_partisi: "#0e7490",
  diger: "#9e9e9e",
};
const PALETTE_ORDER = [
  "recep_tayyip_erdogan",
  "iyi_parti",
  "ak_parti",
  "kemal_kilicdaroglu",
  "sinan_ogan",
  "memleket",
  "chp",
  "mhp",
  "dem_star",
  "tip",
  "yeniden_refah",
  "diger",
];
let uid = 0;
let dragStage = null;
let dragStageInsert = null;
let dragNode = null;
let selectedStageId = null;
let selectedNode = null;
let selectedLinkKey = null;
const undoStack = [];
let urlTimer = null;
let resizeTimer = null;
const DEFAULT_MIN_BOX = 0;
const DEFAULT_MIN_RIBBON = 0;
const DEFAULT_DIGER_BUCKETS = 1;
const DEFAULT_SHOW_BALANCE = false;
const state = {
  stages: [],
  rows: {},
  sortMode: "vote",
  colors: {},
};
function generatedColor(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const value = (0x444444 + (h % 0xbbbbbb)) & 0xffffff;
  return `#${value.toString(16).padStart(6, "0")}`;
}
function hexToRgb(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
function safeColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : null;
}
function rgbToHex(rgb) {
  return `#${rgb.map(value => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")).join("")}`;
}
function partyForLabel(label) {
  return Object.keys(DEFAULT_COLORS).find(party => labelFor(party) === label) || null;
}
function averagedColor(colors) {
  const rgbs = colors.map(hexToRgb).filter(Boolean);
  if (!rgbs.length) return null;
  const sum = rgbs.reduce((acc, rgb) => acc.map((value, index) => value + rgb[index]), [0, 0, 0]);
  return rgbToHex(sum.map(value => value / rgbs.length));
}
function groupColorFor(token) {
  if (!token.includes("+")) return null;
  const parties = token.split("+").map(label => partyForLabel(label)).filter(Boolean);
  if (parties.length < 2) return null;
  return averagedColor(parties.map(party => colorFor(party)));
}
const colorFor = s => {
  if (/^diger_\d+$/.test(s)) return safeColor(state.colors.diger) || DEFAULT_COLORS.diger;
  const customColor = safeColor(state.colors[s]);
  if (customColor) return customColor;
  const groupColor = groupColorFor(s);
  if (groupColor) return groupColor;
  return safeColor(state.colors[s]) || DEFAULT_COLORS[s] || generatedColor(s);
};
function labelFor(party) {
  const digerMatch = /^diger_(\d+)$/.exec(party);
  if (digerMatch) return `Diğer ${digerMatch[1]}`;
  const labels = {
    ak_parti: "AKP",
    chp: "CHP",
    mhp: "MHP",
    bbp: "BBP",
    buyuk_birlik: "BBP",
    cumhur_ittifaki: "Cumhur",
    has_parti: "HAS",
    iyi_parti: "İYİ",
    dem_star: "DEM*",
    bdp: "DEM*",
    hdp: "DEM*",
    yesil_sol_parti: "DEM*",
    dem_parti: "DEM*",
    tip: "TIP",
    zafer_partisi: "Zafer",
    memleket: "Memleket",
    refah: "Refah",
    refah_partisi: "Refah",
    fazilet: "Fazilet",
    fazilet_partisi: "Fazilet",
    yeniden_refah: "YRP",
    saadet: "SP",
    deva_partisi: "DEVA",
    gelecek_partisi: "GP",
    huda_par: "HUDA",
    demokrat_parti: "DP",
    dp: "DP",
    dsp: "DSP",
    anavatan: "ANAP",
    anavatan_partisi: "ANAP",
    dtp: "DEM*",
    ekmeleddin_mehmet_ihsanoglu: "Ihsanoglu",
    ekmeleddin_ihsanoglu: "Ihsanoglu",
    selahattin_demirtas: "Demirtas",
    meral_aksener: "Aksener",
    temel_karamollaoglu: "TK",
    evet: "Evet",
    hayir: "Hayır",
    kemal_kilicdaroglu: "KK",
    sinan_ogan: "Oğan",
    recep_tayyip_erdogan: "RTE",
    muharrem_ince: "İnce",
    diger: "Diğer",
    dengeleme_kaynak: "Katılım",
    dengeleme_hedef: "Katılım",
  };
  return labels[party] || party.replaceAll("_", " ");
}
function shortStageLabel(stageId) {
  const stage = state.stages.find(item => item.id === stageId);
  if (!stage) return "";
  return DATA.manifest.config.nodes[stage.key].label;
}
function stageLabel(key) {
  const labels = {
    "2009_bm": "2009 Bld. Meclisi",
    "2014_bm": "2014 Bld. Meclisi",
    "2015_jun_mv": "2015 Haz. MV",
    "2015_nov_mv": "2015 Kas. MV",
    "2017_ref": "2017 Ref.",
    "2019_bm": "2019 Bld. Meclisi",
    "2019_ist_bbb": "2019 İst. BBB",
    "2024_bm": "2024 Bld. Meclisi",
  };
  return labels[key] || DATA.manifest.config.nodes[key].label;
}
function shortStageCode(key) {
  const labels = {
    "2009_bm": "09BM",
    "2009_bb": "09BB",
    "2009_bbb": "09BBB",
    "2009_igm": "09İGM",
    "2010_ref": "10Rf",
    "2011_mv": "11MV",
    "2014_bm": "14BM",
    "2014_bb": "14BB",
    "2014_bbb": "14BBB",
    "2014_igm": "14İGM",
    "2014_cb": "14CB",
    "2015_jun_mv": "15HMV",
    "2015_nov_mv": "15KMV",
    "2017_ref": "17Rf",
    "2018_mv": "18MV",
    "2018_cb": "18CB",
    "2019_bm": "19BM",
    "2019_bb": "19BB",
    "2019_bbb": "19BBB",
    "2019_igm": "19İGM",
    "2019_ist_bbb": "19İst",
    "2023_mv": "23MV",
    "2023_cb": "23CB",
    "2023_cb2": "23CB2",
    "2024_bm": "24BM",
    "2024_bb": "24BB",
    "2024_bbb": "24BBB",
    "2024_igm": "24İGM",
    "2024_yenileme_bm": "24YBM",
    "2024_yenileme_bb": "24YBB",
  };
  return labels[key] || stageLabel(key).replace(/^20/, "").replace(/^19/, "").replace("Bld. Meclisi", "BM").replace("Ref.", "Rf");
}
function stageLabelSvg(key, x, y, h) {
  const label = shortStageCode(key);
  return `<g><rect class="stage-label-box" x="${x}" y="${y}" width="30" height="${h}" rx="5"></rect><text class="stage-label" transform="translate(${x + 15} ${y + h / 2}) rotate(-90)" x="0" y="0">${text(label)}</text></g>`;
}
function isNonDustLink(link) {
  return (+link.estimated_flow_votes || 0) >= 1;
}
function isMobileLayout() {
  return window.matchMedia('(max-width: 860px)').matches;
}
function defaultStageKeys() {
  if (DATA.manifest.config.nodes["2024_bb"]) return ["2024_bb"];
  const defaults = DATA.manifest.config.default_chain || Object.keys(DATA.manifest.config.nodes).slice(0, 1);
  return defaults.slice(0, 1);
}
function init() {
  if (isMobileLayout()) {
    document.body.classList.add('sidebar-collapsed');
  }
  const defaults = defaultStageKeys();
  state.stages = defaults.map(key => newStage(key));
  selectedStageId = state.stages[0]?.id || null;
  renderProvinceOptions();
  setDefaultControls();
  loadSharedView();
  $('addStage').addEventListener('click', () => {
    pushUndo();
    const last = state.stages[state.stages.length - 1];
    const nodeKeys = Object.keys(DATA.manifest.config.nodes);
    const nextKey = availableTargets(last?.key).find(key => key !== last?.key)
      || nodeKeys.find(key => key !== last?.key)
      || nodeKeys[0];
    state.stages.push(newStage(nextKey));
    selectedStageId = state.stages[state.stages.length - 1].id;
    render();
  });
  $('undo').addEventListener('click', undo);
  $('resetView').addEventListener('click', resetView);
  $('sortMode').addEventListener('click', () => {
    pushUndo();
    state.sortMode = state.sortMode === "vote" ? "flow" : "vote";
    Object.values(state.rows).forEach(row => {
      row.order = [];
    });
    render();
  });
  $('minBox').addEventListener('input', render);
  $('minRibbon').addEventListener('input', render);
  $('digerBuckets').addEventListener('input', render);
  $('showBalance').addEventListener('input', render);
  $('showVotes').addEventListener('input', render);
  $('provinceFilter').addEventListener('input', render);
  $('shareView').addEventListener('click', shareView);
  $('hoverInfo').addEventListener('click', event => {
    if (event.target.closest('#openMap')) openMap(activeMapContext);
  });
  $('closeMap').addEventListener('click', closeMap);
  $('mapMetric').addEventListener('click', event => {
    const button = event.target.closest('button[data-metric]');
    if (!button || !activeMapData) return;
    activeMapMetric = button.dataset.metric;
    updateMapMetricControls(activeMapData.context);
    renderMap(
      activeMapData.context,
      activeMapData.geometry,
      activeMapData.provinceGeometry,
      mapRowsForContext(activeMapData.context, activeMapData.votes, activeMapData.provinceRows, activeMapMetric),
      activeMapMetric,
    );
    updateUrlState();
  });
  $('mapModal').addEventListener('click', event => {
    if (event.target === $('mapModal')) closeMap();
  });
  window.addEventListener('keydown', event => {
    if (event.key === "Escape" && !$('mapModal').hidden) closeMap();
  });
  $('chart').addEventListener('contextmenu', event => event.preventDefault());
  $('chart').addEventListener('selectstart', event => event.preventDefault());
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      render();
      if (activeMapData && !$('mapModal').hidden) {
        renderMap(
          activeMapData.context,
          activeMapData.geometry,
          activeMapData.provinceGeometry,
          mapRowsForContext(activeMapData.context, activeMapData.votes, activeMapData.provinceRows, activeMapMetric),
          activeMapMetric,
        );
      }
    }, 120);
  });
  $('collapseSidebar').addEventListener('click', () => {
    document.body.classList.toggle('sidebar-collapsed');
    $('collapseSidebar').title = document.body.classList.contains('sidebar-collapsed') ? 'Menüyü aç' : 'Menüyü daralt';
    $('collapseSidebar').setAttribute('aria-label', $('collapseSidebar').title);
    render();
  });
  render();
}
function renderProvinceOptions() {
  const provinces = DATA.provinces || [];
  $('provinceFilter').innerHTML = `<option value="">Türkiye</option>${provinces.map(il => `<option value="${attr(il)}">${text(il)}</option>`).join("")}`;
}
function newStage(key) {
  const id = `stage_${++uid}`;
  state.rows[id] = {
    hidden: [],
    groups: [],
    order: [],
  };
  return {id, key};
}
function rowState(id) {
  if (!state.rows[id]) {
    state.rows[id] = {
      hidden: [],
      groups: [],
      order: [],
    };
  }
  return state.rows[id];
}
function emptyRowState() {
  return {
    hidden: [],
    groups: [],
    order: [],
  };
}
function setDefaultControls() {
  $('minBox').value = DEFAULT_MIN_BOX;
  $('minRibbon').value = DEFAULT_MIN_RIBBON;
  $('digerBuckets').value = DEFAULT_DIGER_BUCKETS;
  $('showBalance').checked = DEFAULT_SHOW_BALANCE;
  $('showVotes').checked = false;
  $('provinceFilter').value = "";
}
function pushUndo() {
  undoStack.push(JSON.stringify({stages: state.stages, rows: state.rows, sortMode: state.sortMode, colors: state.colors, selectedStageId}));
  if (undoStack.length > 80) undoStack.shift();
}
function undo() {
  const item = undoStack.pop();
  if (!item) return;
  const old = JSON.parse(item);
  state.stages = old.stages;
  for (const key of Object.keys(state.rows)) delete state.rows[key];
  Object.assign(state.rows, old.rows);
  state.sortMode = old.sortMode || "vote";
  state.colors = old.colors || {};
  selectedStageId = old.selectedStageId;
  render();
}
function resetView() {
  pushUndo();
  const stageIds = new Set(state.stages.map(stage => stage.id));
  for (const key of Object.keys(state.rows)) {
    if (!stageIds.has(key)) delete state.rows[key];
  }
  state.stages.forEach(stage => {
    state.rows[stage.id] = emptyRowState();
  });
  state.sortMode = "vote";
  state.colors = {};
  selectedNode = null;
  selectedLinkKey = null;
  if (!stageIds.has(selectedStageId)) selectedStageId = state.stages[0]?.id || null;
  setDefaultControls();
  render();
}
function encodeShareState() {
  const rows = state.stages.map(stage => {
    const row = rowState(stage.id);
    return {
      h: row.hidden || [],
      g: row.groups || [],
      o: row.order || [],
    };
  });
  const payload = {
    v: 1,
    s: state.stages.map(stage => stage.key),
    r: rows,
    m: state.sortMode,
    b: +$('minBox').value || 0,
    a: +$('minRibbon').value || 0,
    d: +$('digerBuckets').value || 1,
    bal: $('showBalance').checked,
    votes: $('showVotes').checked,
    il: $('provinceFilter').value || "",
    c: state.colors,
    map: encodeMapShareState(),
  };
  return encodeSharePayload(payload);
}
function stageIndexForId(stageId) {
  return state.stages.findIndex(stage => stage.id === stageId);
}
function encodeMapShareState() {
  const context = activeMapData?.context || activeMapContext;
  const map = {
    o: !$('mapModal')?.hidden,
    metric: activeMapMetric,
  };
  if (!context) return map;
  if (context.kind === "flow") {
    map.ctx = {
      k: "flow",
      si: stageIndexForId(context.sourceStageId),
      ti: stageIndexForId(context.targetStageId),
      sp: context.sourceToken,
      tp: context.targetToken,
    };
  } else if (context.kind === "party") {
    map.ctx = {
      k: "party",
      si: stageIndexForId(context.stageId),
      p: context.partyToken,
    };
  }
  if (map.ctx && Object.values(map.ctx).some(value => value === undefined || value === null || value === -1)) {
    delete map.ctx;
  }
  return map;
}
function currentShareUrl() {
  const url = new URL(window.location.href);
  url.hash = `v=${encodeShareState()}`;
  return url.toString();
}
function updateUrlState() {
  if (!state.stages.length) return;
  window.clearTimeout(urlTimer);
  urlTimer = window.setTimeout(() => {
    try {
      history.replaceState(null, "", currentShareUrl());
    } catch (error) {
      console.warn(error);
    }
  }, 180);
}
async function shareView() {
  const url = currentShareUrl();
  try {
    await navigator.clipboard.writeText(url);
    $('shareView').textContent = "Kopyalandı";
    window.setTimeout(() => $('shareView').textContent = "Paylaş", 1200);
  } catch (error) {
    window.prompt("Paylaşım bağlantısı", url);
  }
}
function loadSharedView() {
  const token = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("v");
  if (!token) return false;
  try {
    const payload = decodeSharePayload(token);
    const keys = Array.isArray(payload.s) ? payload.s.filter(key => DATA.manifest.config.nodes[key]) : [];
    if (keys.length >= 1) {
      state.stages.forEach(stage => delete state.rows[stage.id]);
      state.stages = keys.map(key => newStage(key));
      (payload.r || []).forEach((row, index) => {
        const stage = state.stages[index];
        if (!stage) return;
        state.rows[stage.id] = {
          hidden: Array.isArray(row.h) ? row.h : [],
          groups: Array.isArray(row.g) ? row.g : [],
          order: Array.isArray(row.o) ? row.o : [],
        };
      });
      selectedStageId = state.stages[Math.min(1, state.stages.length - 1)]?.id || null;
    }
    state.sortMode = payload.m === "flow" ? "flow" : "vote";
    if (Number.isFinite(+payload.b)) $('minBox').value = +payload.b;
    if (Number.isFinite(+payload.a)) $('minRibbon').value = +payload.a;
    if (Number.isFinite(+payload.d)) $('digerBuckets').value = Math.max(1, Math.min(6, +payload.d));
    $('showBalance').checked = "bal" in payload ? !!payload.bal : DEFAULT_SHOW_BALANCE;
    $('showVotes').checked = !!payload.votes;
    state.colors = payload.c && typeof payload.c === "object" ? payload.c : {};
    if (payload.il && (DATA.provinces || []).includes(payload.il)) $('provinceFilter').value = payload.il;
    pendingShareMapState = payload.map && typeof payload.map === "object" ? payload.map : null;
    return true;
  } catch (error) {
    console.warn(error);
    return false;
  }
}
function nodeOptions(selected) {
  return Object.keys(DATA.manifest.config.nodes).map(key => `<option value="${attr(key)}" ${key === selected ? 'selected' : ''}>${text(stageLabel(key))}</option>`).join('');
}
function currentStages() {
  return state.stages.map(stage => stage.key);
}
function hasPair(source, target) {
  return DATA.manifest.pairs.some(pair => pair.pair_key === `${source}__to__${target}`);
}
function availableTargets(source) {
  if (!source) return [];
  return DATA.manifest.pairs.filter(pair => pair.source.key === source).map(pair => pair.target.key);
}
function availableSources(target) {
  if (!target) return [];
  return DATA.manifest.pairs.filter(pair => pair.target.key === target).map(pair => pair.source.key);
}
function adjacentPairForStage(stageKey) {
  return DATA.manifest.pairs
    .filter(pair => bestModelForPair(pair.pair_key) && (pair.source.key === stageKey || pair.target.key === stageKey))
    .sort((a, b) => pairStageValidVotes(b, stageKey) - pairStageValidVotes(a, stageKey))[0] || null;
}
function pairStageValidVotes(pair, stageKey) {
  if (pair.source.key === stageKey) return +pair.source_valid_votes || 0;
  if (pair.target.key === stageKey) return +pair.target_valid_votes || 0;
  return 0;
}
function repairChainAround(index) {
  for (let i = index; i < state.stages.length - 1; i++) {
    if (hasPair(state.stages[i].key, state.stages[i + 1].key)) continue;
    const replacement = availableTargets(state.stages[i].key)[0];
    if (!replacement) break;
    state.stages[i + 1].key = replacement;
  }
  for (let i = index - 1; i >= 0; i--) {
    if (hasPair(state.stages[i].key, state.stages[i + 1].key)) continue;
    const replacement = availableSources(state.stages[i + 1].key)[0];
    if (!replacement) break;
    state.stages[i].key = replacement;
  }
}
function hiddenChips(stage) {
  const row = rowState(stage.id);
  if (!row.hidden.length) return "";
  const tokens = [];
  const used = new Set();
  row.groups.forEach(group => {
    const hiddenMembers = group.members.filter(member => row.hidden.includes(member));
    if (!hiddenMembers.length) return;
    hiddenMembers.forEach(member => used.add(member));
    tokens.push({token: groupName(group), label: labelFor(groupName(group)), members: hiddenMembers});
  });
  row.hidden.filter(member => !used.has(member)).forEach(member => {
    tokens.push({token: member, label: labelFor(member), members: [member]});
  });
  return `<div class="hidden-chips">${tokens.map(item => `<button type="button" class="hidden-chip" data-stage-id="${attr(stage.id)}" data-members="${attr(item.members.join(","))}" title="Geri getir">${text(item.label)} x</button>`).join("")}</div>`;
}
function colorPaletteParties(nodes = []) {
  const visible = new Set(nodes.map(node => node.party).filter(Boolean));
  const byLabel = new Map();
  [...visible].forEach(party => {
    const label = labelFor(party);
    const existing = byLabel.get(label);
    if (!existing || colorPaletteRank(party) < colorPaletteRank(existing)) byLabel.set(label, party);
  });
  return [...byLabel.values()]
    .sort((a, b) => {
      const ai = colorPaletteRank(a);
      const bi = colorPaletteRank(b);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 10000 : ai) - (bi === -1 ? 10000 : bi);
      return labelFor(a).localeCompare(labelFor(b));
    });
}
function colorPaletteRank(party) {
  return PALETTE_ORDER.indexOf(party);
}
function renderColorPalette(nodes = []) {
  const palette = $('colorPalette');
  if (!palette) return;
  const parties = colorPaletteParties(nodes);
  palette.innerHTML = parties.map(party => `<label class="color-item" title="${attr(labelFor(party))}"><input type="color" value="${attr(colorFor(party))}" data-party="${attr(party)}" aria-label="${attr(labelFor(party))} rengi"><span>${text(labelFor(party))}</span></label>`).join("");
  [...palette.querySelectorAll('input[type="color"]')].forEach(input => {
    input.addEventListener('input', () => {
      state.colors[input.dataset.party] = input.value;
    });
    input.addEventListener('change', () => {
      state.colors[input.dataset.party] = input.value;
      render();
    });
  });
}
function clearStageDropHints() {
  document.querySelectorAll('.stage-drop-before,.stage-drop-after').forEach(item => {
    item.classList.remove('stage-drop-before', 'stage-drop-after');
  });
}
function stageInsertFromPoint(event) {
  const item = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.stage-item');
  if (!item) return dragStage;
  const index = +item.dataset.index;
  const rect = item.getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? index : index + 1;
}
function showStageDropHint(event) {
  clearStageDropHints();
  if (dragStage === null) return;
  const item = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.stage-item');
  if (!item) {
    dragStageInsert = dragStage;
    return;
  }
  const index = +item.dataset.index;
  const rect = item.getBoundingClientRect();
  const after = event.clientY >= rect.top + rect.height / 2;
  dragStageInsert = after ? index + 1 : index;
  item.classList.add(after ? 'stage-drop-after' : 'stage-drop-before');
}
function renderStages() {
  $('sortMode').textContent = state.sortMode === "flow" ? "Oya göre sırala" : "Akışa göre sırala";
  $('stageList').innerHTML = state.stages.map((stage, index) => `<div class="stage-item" data-stage-id="${attr(stage.id)}" data-index="${index}"><div class="stage-row ${stage.id === selectedStageId ? 'selected' : ''}" data-stage-id="${attr(stage.id)}" data-index="${index}"><span class="drag-handle">≡</span><select class="stage-select">${nodeOptions(stage.key)}</select><button type="button" class="remove-stage" data-index="${index}" title="Seçimi kaldır">x</button></div>${hiddenChips(stage)}</div>`).join('');
  [...document.querySelectorAll('.stage-row')].forEach(row => {
    row.addEventListener('click', event => {
      if (event.target.closest('select,button,.drag-handle')) return;
      selectedStageId = row.dataset.stageId;
      render();
    });
    pointerDrag(row.querySelector('.drag-handle'), {
      start: () => {
        dragStage = +row.dataset.index;
        dragStageInsert = dragStage;
        row.classList.add('dragging');
      },
      move: event => {
        showStageDropHint(event);
      },
      end: event => {
        row.classList.remove('dragging');
        showStageDropHint(event);
        const from = dragStage;
        const insert = dragStageInsert ?? stageInsertFromPoint(event);
        clearStageDropHints();
        dragStage = null;
        dragStageInsert = null;
        if (from === null || insert === from || insert === from + 1) return;
        pushUndo();
        const [moved] = state.stages.splice(from, 1);
        const to = insert > from ? insert - 1 : insert;
        state.stages.splice(to, 0, moved);
        render();
      },
    });
  });
  [...document.querySelectorAll('.stage-select')].forEach(select => select.addEventListener('input', () => {
    const row = select.closest('.stage-row');
    const stage = state.stages.find(item => item.id === row.dataset.stageId);
    if (!stage) return;
    pushUndo();
    stage.key = select.value;
    selectedStageId = stage.id;
    repairChainAround(+row.dataset.index);
    render();
  }));
  [...document.querySelectorAll('.stage-select')].forEach(select => {
    select.addEventListener('click', event => event.stopPropagation());
    select.addEventListener('pointerdown', event => event.stopPropagation());
  });
  [...document.querySelectorAll('.remove-stage')].forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    if (state.stages.length <= 1) return;
    pushUndo();
    const [removed] = state.stages.splice(+button.dataset.index, 1);
    delete state.rows[removed.id];
    selectedStageId = state.stages[Math.max(0, +button.dataset.index - 1)]?.id || state.stages[0]?.id || null;
    render();
  }));
  [...document.querySelectorAll('.remove-stage')].forEach(button => {
    button.addEventListener('pointerdown', event => event.stopPropagation());
  });
  [...document.querySelectorAll('.hidden-chip')].forEach(button => {
    button.addEventListener('pointerdown', event => event.stopPropagation());
    button.addEventListener('click', event => {
      event.stopPropagation();
      const row = rowState(button.dataset.stageId);
      const members = (button.dataset.members || '').split(',').filter(Boolean);
      if (!members.length) return;
      pushUndo();
      row.hidden = row.hidden.filter(member => !members.includes(member));
      selectedStageId = button.dataset.stageId;
      render();
    });
  });
}
function pairLinks(pairKey, model) {
  return (DATA.flows[pairKey] && DATA.flows[pairKey][model]) ? DATA.flows[pairKey][model] : [];
}
function provincePairLinks(pairKey, model, province) {
  const rows = (DATA.province_flows[pairKey] && DATA.province_flows[pairKey][model]) ? DATA.province_flows[pairKey][model] : [];
  return province ? rows.filter(row => row.il === province) : rows;
}
async function loadFlowRows(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`failed to load ${path}`);
  if (path.endsWith(".eif")) return decodeFlowBinary(await response.arrayBuffer(), DATA.provinces || []);
  return response.json();
}
async function ensurePairModel(pairKey, model) {
  if (DATA.flows[pairKey]?.[model]) return;
  const path = DATA.flow_files?.[pairKey]?.[model];
  if (!path) throw dataUnavailable(`missing data for ${pairKey} (${model})`);
  const promiseKey = `${pairKey}::${model}`;
  if (!flowPromises[promiseKey]) {
    flowPromises[promiseKey] = loadFlowRows(path).then(rows => {
      DATA.flows[pairKey] = DATA.flows[pairKey] || {};
      DATA.flows[pairKey][model] = rows;
      return rows;
    }).catch(error => {
      console.error(error);
      delete flowPromises[promiseKey];
      throw error;
    });
  }
  await flowPromises[promiseKey];
}
async function ensureProvincePairModel(pairKey, model) {
  if (DATA.province_flows[pairKey]?.[model]) return;
  const path = DATA.province_flow_files?.[pairKey]?.[model];
  if (!path) throw dataUnavailable(`missing province data for ${pairKey} (${model})`);
  const promiseKey = `${pairKey}::${model}`;
  if (!provinceFlowPromises[promiseKey]) {
    provinceFlowPromises[promiseKey] = loadFlowRows(path).then(rows => {
      DATA.province_flows[pairKey] = DATA.province_flows[pairKey] || {};
      DATA.province_flows[pairKey][model] = rows;
      return rows;
    }).catch(error => {
      console.error(error);
      delete provinceFlowPromises[promiseKey];
      throw error;
    });
  }
  await provinceFlowPromises[promiseKey];
}
async function loadIlceVotes(pairKey, model) {
  const cached = DATA.ilce_votes?.[pairKey]?.[model];
  if (cached) return cached;
  const path = DATA.ilce_vote_files?.[pairKey]?.[model];
  if (!path) throw dataUnavailable(`missing district vote data for ${pairKey} (${model})`);
  const promiseKey = `${pairKey}::${model}`;
  if (!ilceVotePromises[promiseKey]) {
    ilceVotePromises[promiseKey] = fetch(path).then(async response => {
      if (!response.ok) throw new Error(`failed to load ${path}`);
      const decoded = decodeIlceVoteBinary(await response.arrayBuffer());
      DATA.ilce_votes = DATA.ilce_votes || {};
      DATA.ilce_votes[pairKey] = DATA.ilce_votes[pairKey] || {};
      DATA.ilce_votes[pairKey][model] = decoded;
      return decoded;
    }).catch(error => {
      delete ilceVotePromises[promiseKey];
      throw error;
    });
  }
  return ilceVotePromises[promiseKey];
}
async function loadIlceGeometry() {
  if (!DATA.maps?.ilce) throw dataUnavailable("missing district map geometry");
  if (!ilceGeometryPromise) {
    ilceGeometryPromise = fetch(DATA.maps.ilce).then(async response => {
      if (!response.ok) throw new Error(`failed to load ${DATA.maps.ilce}`);
      return response.json();
    });
  }
  return ilceGeometryPromise;
}
async function loadIlGeometry() {
  if (!DATA.maps?.il) return null;
  if (!ilGeometryPromise) {
    ilGeometryPromise = fetch(DATA.maps.il).then(async response => {
      if (!response.ok) throw new Error(`failed to load ${DATA.maps.il}`);
      return response.json();
    });
  }
  return ilGeometryPromise;
}
function bestModelForPair(pairKey) {
  const summary = DATA.cv_summaries[pairKey] || [];
  const model = summary[0]?.model;
  const files = DATA.flow_files?.[pairKey] || {};
  for (const priorityModel of DATA.model_priority || DEFAULT_MODEL_PRIORITY) {
    if (files[priorityModel]) return priorityModel;
  }
  if (model && files[model]) return model;
  if (files.hierarchical_dm) return "hierarchical_dm";
  return Object.keys(files)[0] || "province_penalty";
}
function pointerDrag(element, handlers) {
  if (!element) return;
  let active = false;
  let startX = 0;
  let startY = 0;
  let moved = false;
  element.addEventListener('pointerdown', event => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    active = true;
    moved = false;
    startX = event.clientX;
    startY = event.clientY;
    document.body.classList.add('drag-active');
    element.setPointerCapture?.(event.pointerId);
    handlers.start?.(event);
  });
  element.addEventListener('pointermove', event => {
    if (!active) return;
    if (Math.abs(event.clientX - startX) + Math.abs(event.clientY - startY) > 6) {
      moved = true;
      event.preventDefault();
    }
    handlers.move?.(event);
  });
  const finish = event => {
    if (!active) return;
    active = false;
    document.body.classList.remove('drag-active');
    element.releasePointerCapture?.(event.pointerId);
    handlers.end?.(event, {moved});
    if (moved) lastDragEndedAt = performance.now();
  };
  element.addEventListener('pointerup', finish);
  element.addEventListener('pointercancel', finish);
}
async function chainLinks() {
  let out = [];
  const province = $('provinceFilter').value || "";
  for (let i=0; i<state.stages.length-1; i++) {
    const sourceStage = state.stages[i];
    const targetStage = state.stages[i + 1];
    const key = `${sourceStage.key}__to__${targetStage.key}`;
    const model = bestModelForPair(key);
    if (province) await ensureProvincePairModel(key, model);
    else await ensurePairModel(key, model);
    const rows = province ? provincePairLinks(key, model, province) : pairLinks(key, model);
    out = out.concat(rows.map(d => ({
      ...d,
      stage:i,
      source_stage_id: sourceStage.id,
      target_stage_id: targetStage.id,
    })));
  }
  return out;
}
function singleStageDigerBucketMap(stage, totals, includeHidden = false) {
  const count = Math.max(1, Math.min(6, Math.round(+$('digerBuckets').value || 1)));
  const min = +$('minBox').value || 0;
  if (count <= 1 || min <= 0) return new Map();
  const row = rowState(stage.id);
  const items = [...totals.entries()]
    .map(([key, total]) => ({party: key.split("::")[1], total}))
    .filter(item => !isBalanceParty(item.party) && (includeHidden || !row.hidden.includes(item.party)) && !row.groups.find(group => group.members.includes(item.party)) && item.total < min)
    .sort((a, b) => partyFlowRank(a.party) - partyFlowRank(b.party) || b.total - a.total || a.party.localeCompare(b.party));
  const out = new Map();
  const total = items.reduce((sum, item) => sum + item.total, 0) || 1;
  let cursor = 0;
  items.forEach(item => {
    const midpoint = cursor + item.total / 2;
    const bucket = Math.min(count - 1, Math.floor(midpoint / total * count));
    out.set(`${stage.id}::${item.party}`, `diger_${bucket + 1}`);
    cursor += item.total;
  });
  return out;
}
async function singleStageNodes() {
  if (state.stages.length !== 1) return [];
  const stage = state.stages[0];
  const pair = adjacentPairForStage(stage.key);
  if (!pair) return [];
  const pairKey = pair.pair_key;
  const model = bestModelForPair(pairKey);
  const province = $('provinceFilter').value || "";
  if (province) await ensureProvincePairModel(pairKey, model);
  else await ensurePairModel(pairKey, model);
  const rows = province ? provincePairLinks(pairKey, model, province) : pairLinks(pairKey, model);
  const sourceSide = pair.source.key === stage.key;
  const totals = new Map();
  rows.forEach(row => {
    const party = sourceSide ? row.source_party : row.target_party;
    if (!$('showBalance').checked && isBalanceParty(party)) return;
    const value = +(sourceSide ? row.source_observed_votes || row.source_votes : row.target_votes) || 0;
    const key = `${stage.id}::${party}`;
    totals.set(key, Math.max(totals.get(key) || 0, value));
  });
  const buckets = singleStageDigerBucketMap(stage, totals);
  const visible = new Map();
  for (const [key, value] of totals.entries()) {
    const party = key.split("::")[1];
    const token = visibleParty(stage, party, totals, false, buckets);
    if (!token) continue;
    const visibleKey = `${stage.id}::${token}`;
    visible.set(visibleKey, (visible.get(visibleKey) || 0) + value);
  }
  return [...visible.entries()].map(([id, value]) => ({
    id,
    value,
    incoming: value,
    outgoing: value,
    stageId: stage.id,
    party: id.split("::")[1],
  }));
}
function stageIdForKey(key, occurrence = 0) {
  return state.stages.filter(stage => stage.key === key)[occurrence]?.id || state.stages.find(stage => stage.key === key)?.id;
}
function stageByKey(key) {
  return state.stages.find(stage => stage.key === key);
}
function groupName(group) {
  if (group.members.some(isDigerToken)) return "diger";
  const automatic = automaticGroupName(group.members);
  if (!group.name || isAutomaticGroupName(group.name, group.members)) return automatic;
  return group.name;
}
function automaticGroupName(members) {
  return members.some(isDigerToken) ? "diger" : canonicalGroupLabel([...new Set(members.map(labelFor))].join("+"));
}
function isAutomaticGroupName(name, members) {
  return canonicalGroupLabel(name) === automaticGroupName(members);
}
function canonicalGroupLabel(name) {
  return [...new Set(String(name).split("+").map(part => part.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "tr"))
    .join("+");
}
function isDigerToken(token) {
  return token === "diger" || /^diger_\d+$/.test(token);
}
function isBalanceParty(party) {
  return party === "dengeleme_kaynak" || party === "dengeleme_hedef";
}
function partyFlowRank(party) {
  const order = [
    "ak_parti", "recep_tayyip_erdogan", "cumhur_ittifaki", "mhp", "bbp", "yeniden_refah",
    "iyi_parti", "meral_aksener",
    "chp", "kemal_kilicdaroglu", "muharrem_ince",
    "dem_star", "hdp", "bdp", "yesil_sol_parti", "tip",
    "saadet", "deva_partisi", "gelecek_partisi",
    "zafer_partisi", "sinan_ogan",
    "diger",
  ];
  const index = order.indexOf(party);
  if (index !== -1) return index;
  let h = 0;
  for (let i = 0; i < party.length; i++) h = (h * 31 + party.charCodeAt(i)) >>> 0;
  return order.length + (h % 1000) / 1000;
}
function isThresholdCandidate(stage, party, totals, includeHidden) {
  const row = rowState(stage.id);
  if (isBalanceParty(party)) return false;
  if (!includeHidden && row.hidden.includes(party)) return false;
  if (row.groups.find(item => item.members.includes(party))) return false;
  const min = +$('minBox').value || 0;
  return min > 0 && totals && (totals.get(`${stage.id}::${party}`) || 0) < min;
}
function digerBucketMap(rawLinks, totals, includeHidden = false) {
  const count = Math.max(1, Math.min(6, Math.round(+$('digerBuckets').value || 1)));
  const out = new Map();
  if (count <= 1 || !(+$('minBox').value || 0)) return out;
  const stages = new Map(state.stages.map(stage => [stage.id, stage]));
  const candidates = new Map();
  function addCandidate(stage, party) {
    if (!stage || !isThresholdCandidate(stage, party, totals, includeHidden)) return;
    const key = `${stage.id}::${party}`;
    if (!candidates.has(key)) {
      candidates.set(key, {stage, party, total: totals.get(key) || 0, score: 0, weight: 0});
    }
  }
  for (const d of rawLinks) {
    addCandidate(stages.get(d.source_stage_id), d.source_party);
    addCandidate(stages.get(d.target_stage_id), d.target_party);
  }
  for (const d of rawLinks) {
    const flow = +d.estimated_flow_votes || 0;
    const sourceKey = `${d.source_stage_id}::${d.source_party}`;
    const targetKey = `${d.target_stage_id}::${d.target_party}`;
    if (candidates.has(sourceKey) && !candidates.has(targetKey)) {
      const item = candidates.get(sourceKey);
      item.score += partyFlowRank(d.target_party) * flow;
      item.weight += flow;
    }
    if (candidates.has(targetKey) && !candidates.has(sourceKey)) {
      const item = candidates.get(targetKey);
      item.score += partyFlowRank(d.source_party) * flow;
      item.weight += flow;
    }
  }
  state.stages.forEach(stage => {
    const items = [...candidates.values()].filter(item => item.stage.id === stage.id);
    if (!items.length) return;
    items.sort((a, b) => {
      const as = a.weight ? a.score / a.weight : partyFlowRank(a.party);
      const bs = b.weight ? b.score / b.weight : partyFlowRank(b.party);
      return as - bs || b.total - a.total || a.party.localeCompare(b.party);
    });
    const total = items.reduce((sum, item) => sum + item.total, 0) || 1;
    let cursor = 0;
    items.forEach(item => {
      const midpoint = cursor + item.total / 2;
      const bucket = Math.min(count - 1, Math.floor(midpoint / total * count));
      out.set(`${stage.id}::${item.party}`, `diger_${bucket + 1}`);
      cursor += item.total;
    });
  });
  return out;
}
function visibleParty(stage, party, totals = null, includeHidden = false, digerBuckets = null) {
  const row = rowState(stage.id);
  if (!includeHidden && row.hidden.includes(party)) return null;
  const group = row.groups.find(item => item.members.includes(party));
  if (group) return groupName(group);
  const min = +$('minBox').value || 0;
  if (!isBalanceParty(party) && totals && min > 0 && (totals.get(`${stage.id}::${party}`) || 0) < min) {
    return digerBuckets?.get(`${stage.id}::${party}`) || "diger";
  }
  return party;
}
function aggregatedLinks(rawLinks, includeHidden = false) {
  if (!$('showBalance').checked) {
    rawLinks = rawLinks.filter(link => !isBalanceParty(link.source_party) && !isBalanceParty(link.target_party));
  }
  const totals = new Map();
  const sideTotals = new Map();
  for (const d of rawLinks) {
    const sourceStage = state.stages.find(stage => stage.id === d.source_stage_id);
    const targetStage = state.stages.find(stage => stage.id === d.target_stage_id);
    if (sourceStage) sideTotals.set(`${sourceStage.id}::source::${d.source_party}`, (sideTotals.get(`${sourceStage.id}::source::${d.source_party}`) || 0) + (+d.estimated_flow_votes || 0));
    if (targetStage) sideTotals.set(`${targetStage.id}::target::${d.target_party}`, (sideTotals.get(`${targetStage.id}::target::${d.target_party}`) || 0) + (+d.estimated_flow_votes || 0));
  }
  for (const [key, value] of sideTotals.entries()) {
    const [stageId, , party] = key.split("::");
    const totalKey = `${stageId}::${party}`;
    totals.set(totalKey, Math.max(totals.get(totalKey) || 0, value));
  }
  const digerBuckets = digerBucketMap(rawLinks, totals, includeHidden);
  const rows = new Map();
  for (const d of rawLinks) {
    const sourceStage = state.stages.find(stage => stage.id === d.source_stage_id);
    const targetStage = state.stages.find(stage => stage.id === d.target_stage_id);
    if (!sourceStage || !targetStage) continue;
    const sourceParty = visibleParty(sourceStage, d.source_party, totals, includeHidden, digerBuckets);
    const targetParty = visibleParty(targetStage, d.target_party, totals, includeHidden, digerBuckets);
    if (!sourceParty || !targetParty) continue;
    const key = `${sourceStage.id}::${sourceParty}=>${targetStage.id}::${targetParty}`;
    const old = rows.get(key) || {...d, source_stage_id: sourceStage.id, target_stage_id: targetStage.id, source_party: sourceParty, target_party: targetParty, source_node_id: `${sourceStage.id}::${sourceParty}`, target_node_id: `${targetStage.id}::${targetParty}`, estimated_flow_votes: 0, transition_probability: 0, target_share_of_column: 0};
    old.estimated_flow_votes += +d.estimated_flow_votes || 0;
    rows.set(key, old);
  }
  return [...rows.values()];
}
function visibleRibbons(links) {
  const min = +$('minRibbon').value || 0;
  if (min <= 0) return links;
  return links.filter(link => (+link.estimated_flow_votes || 0) >= min);
}
function stageOrders(nodes, links, stageTotals, usableW) {
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const linkedNodeIds = new Set();
  links.forEach(link => {
    linkedNodeIds.add(link.source_node_id);
    linkedNodeIds.add(link.target_node_id);
  });
  const manual = new Map();
  const orders = new Map();
  const gap = 1.5;
  const stageById = new Map(state.stages.map(stage => [stage.id, stage]));
  state.stages.forEach(stage => {
    const rowOrder = rowState(stage.id).order || [];
    const group = nodes.filter(node => node.stageId === stage.id);
    const orderIndex = party => {
      const index = rowOrder.indexOf(party);
      return index === -1 ? 10000 : index;
    };
    group.sort((a, b) => orderIndex(a.party) - orderIndex(b.party) || b.value - a.value);
    if (rowOrder.length) manual.set(stage.id, true);
    orders.set(stage.id, group);
  });
  if (state.sortMode !== "flow") return orders;
  function tokenMembers(stageId, token) {
    if (isDigerToken(token)) return [token];
    const row = rowState(stageId);
    const group = groupForToken(row, token);
    return group ? group.members : [token];
  }
  function memberOverlap(a, b) {
    if (isDigerToken(a.party) || isDigerToken(b.party)) return 0;
    const aMembers = tokenMembers(a.stageId, a.party);
    const bMembers = tokenMembers(b.stageId, b.party);
    const bSet = new Set(bMembers);
    const shared = aMembers.filter(member => bSet.has(member)).length;
    return shared / Math.max(aMembers.length, bMembers.length, 1);
  }
  const continuityPairs = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      if (a.stageId === b.stageId) continue;
      const overlap = memberOverlap(a, b);
      if (!overlap) continue;
      const aStage = stageById.get(a.stageId);
      const bStage = stageById.get(b.stageId);
      const aIndex = state.stages.findIndex(stage => stage.id === a.stageId);
      const bIndex = state.stages.findIndex(stage => stage.id === b.stageId);
      const roundTripBoost = aStage && bStage && aStage.key === bStage.key ? 1.6 : 1;
      const adjacentBoost = Math.abs(aIndex - bIndex) === 1 ? 1.1 : 1;
      continuityPairs.push({
        a: a.id,
        b: b.id,
        weight: Math.sqrt(Math.min(a.value, b.value)) * Math.sqrt(Math.max(a.value, b.value)) * overlap * roundTripBoost * adjacentBoost,
      });
    }
  }
  const neighborPairs = [
    ["ak_parti", "mhp", 0.1],
    ["mhp", "bbp", 0.035],
    ["ak_parti", "yeniden_refah", 0.035],
    ["chp", "iyi_parti", 0.055],
    ["chp", "dem_star", 0.045],
    ["dem_star", "tip", 0.035],
    ["saadet", "deva_partisi", 0.025],
    ["deva_partisi", "gelecek_partisi", 0.025],
  ];
  function containsMember(node, member) {
    return tokenMembers(node.stageId, node.party).includes(member);
  }
  function centersFor(candidateOrders) {
    const centers = new Map();
    state.stages.forEach(stage => {
      const group = candidateOrders.get(stage.id) || [];
      const total = stageTotals.get(stage.id) || group.reduce((sum, node) => sum + node.value, 0) || 1;
      const scale = (usableW - Math.max(0, group.length - 1) * gap) / total;
      const visibleW = group.reduce((sum, node) => sum + Math.max(22, node.value * scale), 0) + Math.max(0, group.length - 1) * gap;
      let cursor = Math.max(0, (usableW - visibleW) / 2);
      group.forEach(node => {
        const boxW = Math.max(22, node.value * scale);
        centers.set(node.id, cursor + boxW / 2);
        cursor += boxW + gap;
      });
    });
    return centers;
  }
  function objective(candidateOrders) {
    const centers = centersFor(candidateOrders);
    const flowScore = links.reduce((sum, link) => {
      if (!centers.has(link.source_node_id) || !centers.has(link.target_node_id)) return sum;
      return sum + (+link.estimated_flow_votes || 0) * Math.abs(centers.get(link.source_node_id) - centers.get(link.target_node_id));
    }, 0);
    const continuityScore = continuityPairs.reduce((sum, pair) => {
      if (!centers.has(pair.a) || !centers.has(pair.b)) return sum;
      return sum + pair.weight * 0.65 * Math.abs(centers.get(pair.a) - centers.get(pair.b));
    }, 0);
    const neighborScore = state.stages.reduce((sum, stage) => {
      const group = candidateOrders.get(stage.id) || [];
      for (const [left, right, weight] of neighborPairs) {
        const a = group.find(node => containsMember(node, left));
        const b = group.find(node => containsMember(node, right));
        if (!a || !b || !centers.has(a.id) || !centers.has(b.id)) continue;
        sum += Math.min(a.value, b.value) * weight * Math.abs(centers.get(a.id) - centers.get(b.id));
      }
      return sum;
    }, 0);
    return flowScore + continuityScore + neighborScore;
  }
  for (let pass = 0; pass < 10; pass++) {
    const stages = pass % 2 ? [...state.stages].reverse() : state.stages;
    for (const stage of stages) {
      if (manual.get(stage.id)) continue;
      const group = orders.get(stage.id) || [];
      const centers = centersFor(orders);
      const weighted = new Map(group.map(node => [node.id, {sum: 0, weight: 0}]));
      group.forEach(node => {
        if (!linkedNodeIds.has(node.id)) return;
        for (const other of nodes) {
          if (other.stageId === node.stageId || !centers.has(other.id)) continue;
          const overlap = memberOverlap(node, other);
          if (!overlap) continue;
          const priorWeight = Math.sqrt(Math.min(node.value, other.value)) * Math.sqrt(Math.max(node.value, other.value)) * 0.65 * overlap;
          const item = weighted.get(node.id);
          item.sum += centers.get(other.id) * priorWeight;
          item.weight += priorWeight;
        }
      });
      links.forEach(link => {
        const source = nodeById.get(link.source_node_id);
        const target = nodeById.get(link.target_node_id);
        if (!source || !target) return;
        const weight = +link.estimated_flow_votes || 0;
        if (source.stageId === stage.id && centers.has(target.id)) {
          const item = weighted.get(source.id);
          item.sum += centers.get(target.id) * weight;
          item.weight += weight;
        }
        if (target.stageId === stage.id && centers.has(source.id)) {
          const item = weighted.get(target.id);
          item.sum += centers.get(source.id) * weight;
          item.weight += weight;
        }
      });
      group.sort((a, b) => {
        const aw = weighted.get(a.id);
        const bw = weighted.get(b.id);
        const as = aw && aw.weight ? aw.sum / aw.weight : Number.POSITIVE_INFINITY;
        const bs = bw && bw.weight ? bw.sum / bw.weight : Number.POSITIVE_INFINITY;
        return as - bs || b.value - a.value;
      });
      orders.set(stage.id, group);
    }
  }
  let best = objective(orders);
  for (const stage of state.stages) {
    if (manual.get(stage.id)) continue;
    const group = orders.get(stage.id) || [];
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < group.length - 1; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const candidate = new Map(orders);
          const nextGroup = group.slice();
          [nextGroup[i], nextGroup[j]] = [nextGroup[j], nextGroup[i]];
          candidate.set(stage.id, nextGroup);
          const score = objective(candidate);
          if (score + 1e-6 < best) {
            group.splice(0, group.length, ...nextGroup);
            orders.set(stage.id, group);
            best = score;
            improved = true;
          }
        }
      }
    }
  }
  return orders;
}
function layoutNodes(links, baselineLinks = links, standaloneNodes = []) {
  const incoming = new Map();
  const outgoing = new Map();
  const sizedBaselineLinks = baselineLinks.filter(isNonDustLink);
  for (const d of sizedBaselineLinks) {
    outgoing.set(d.source_node_id, (outgoing.get(d.source_node_id)||0) + d.estimated_flow_votes);
    incoming.set(d.target_node_id, (incoming.get(d.target_node_id)||0) + d.estimated_flow_votes);
  }
  const ids = new Set([...incoming.keys(), ...outgoing.keys()]);
  const allNodes = [...ids].map(id => {
    const [stageId, party] = id.split('::');
    const value = Math.max(incoming.get(id) || 0, outgoing.get(id) || 0);
    return {id, value, incoming: incoming.get(id) || 0, outgoing: outgoing.get(id) || 0, stageId, party};
  });
  standaloneNodes.forEach(node => {
    if (!ids.has(node.id)) allNodes.push(node);
  });
  const stageTotals = new Map();
  allNodes.forEach(n => stageTotals.set(n.stageId, (stageTotals.get(n.stageId) || 0) + n.value));
  const nodes = allNodes.filter(n => !tokenHidden(n.stageId, n.party));
  const nodeSet = new Set(nodes.map(n => n.id));
  const keptLinks = links.filter(d => isNonDustLink(d) && nodeSet.has(d.source_node_id) && nodeSet.has(d.target_node_id));
  const mobile = isMobileLayout();
  const width = mobile ? Math.max($('chart').clientWidth || 360, 320) : Math.max($('chart').clientWidth || 980, 980);
  const height = Math.max(mobile ? 620 : 700, (mobile ? 180 : 190) * Math.max(3, state.stages.length));
  const labelW = mobile ? 10 : 42;
  const rightPad = mobile ? 16 : 44;
  const top = mobile ? 48 : 56;
  const bottom = mobile ? 28 : 42;
  const rowGap = (height - top - bottom) / Math.max(1, state.stages.length - 1);
  const usableW = width - labelW - rightPad;
  const orders = stageOrders(nodes, keptLinks, stageTotals, usableW);
  const nodeH = mobile ? 104 : 88;
  const pos = new Map();
  state.stages.forEach((stage, si) => {
    const group = orders.get(stage.id) || [];
    const total = stageTotals.get(stage.id) || group.reduce((a,b)=>a+b.value,0) || 1;
    const gap = 1.5;
    const scale = (usableW - Math.max(0, group.length - 1) * gap) / total;
    const minNodeW = mobile
      ? Math.max(8, Math.min(18, (usableW - Math.max(0, group.length - 1) * gap) / Math.max(group.length, 1)))
      : 22;
    const availableNodeW = usableW - Math.max(0, group.length - 1) * gap;
    const rawWidths = group.map(n => Math.max(minNodeW, n.value * scale));
    const rawTotal = rawWidths.reduce((sum, value) => sum + value, 0) || 1;
    const fitScale = Math.min(1, availableNodeW / rawTotal);
    const widths = rawWidths.map(value => value * fitScale);
    const visibleW = widths.reduce((sum, value) => sum + value, 0) + Math.max(0, group.length - 1) * gap;
    let cursor = labelW + Math.max(0, (usableW - visibleW) / 2);
    group.forEach((n, index) => {
      const boxW = widths[index];
      const flowW = Math.min(boxW, Math.max(0, n.value * scale) * fitScale);
      pos.set(n.id, {
        x: cursor,
        flowX: cursor + (boxW - flowW) / 2,
        y: top + si * rowGap - nodeH / 2,
        w: boxW,
        flowW,
        h: nodeH,
        ...n,
      });
      cursor += boxW + gap;
    });
  });
  return {nodes, links: keptLinks, pos, width, height, stageTotals};
}
function groupForToken(row, token) {
  return row.groups.find(group => group.members.includes(token) || groupName(group) === token);
}
function membersForToken(row, token) {
  const group = groupForToken(row, token);
  return group ? group.members : [token];
}
function tokenHidden(stageId, token) {
  const row = rowState(stageId);
  return membersForToken(row, token).every(member => row.hidden.includes(member));
}
function hideToken(stageId, token) {
  const row = rowState(stageId);
  const members = membersForToken(row, token);
  const hidden = new Set(row.hidden);
  members.forEach(member => hidden.add(member));
  row.hidden = [...hidden];
}
function splitToken(stageId, token) {
  const row = rowState(stageId);
  const group = groupForToken(row, token);
  if (!group || group.members.length < 2) return false;
  row.groups = row.groups.filter(item => item !== group);
  selectedStageId = stageId;
  selectedNode = null;
  return true;
}
function combineNodes(source, target) {
  if (!source || !target || source.stageId !== target.stageId || source.party === target.party) return false;
  pushUndo();
  const row = rowState(target.stageId);
  const sourceMembers = membersForToken(row, source.party);
  const targetMembers = membersForToken(row, target.party);
  const groups = row.groups.filter(group =>
    groupName(group) === source.party ||
    groupName(group) === target.party ||
    group.members.some(member => sourceMembers.includes(member) || targetMembers.includes(member))
  );
  const hasDiger = [...targetMembers, ...sourceMembers, ...groups.flatMap(group => group.members)].some(isDigerToken);
  const customName = groups.find(group => group.name && !isAutomaticGroupName(group.name, group.members))?.name;
  if (groups.length) {
    const mergedMembers = [...new Set([...groups.flatMap(group => group.members), ...targetMembers, ...sourceMembers])];
    row.groups = row.groups.filter(group => !groups.includes(group));
    row.groups.push({
      name: hasDiger ? "diger" : customName || automaticGroupName(mergedMembers),
      members: mergedMembers,
    });
  } else {
    const mergedMembers = [...new Set([...targetMembers, ...sourceMembers])];
    row.groups.push({name: automaticGroupName(mergedMembers), members: mergedMembers});
  }
  selectedStageId = target.stageId;
  selectedNode = null;
  render();
  return true;
}
function sortNode(source, target, after) {
  if (!source || !target || source.stageId !== target.stageId || source.party === target.party) return false;
  pushUndo();
  const row = rowState(target.stageId);
  const stageNodes = [...document.querySelectorAll(`.node[data-stage-id="${target.stageId}"]`)].map(item => item.dataset.party);
  const order = row.order.length ? row.order.slice() : stageNodes;
  const without = order.filter(item => item !== source.party);
  const targetIndex = without.indexOf(target.party);
  without.splice(targetIndex + (after ? 1 : 0), 0, source.party);
  row.order = [...new Set(without)];
  selectedStageId = target.stageId;
  selectedNode = source;
  render();
  return true;
}
function clearDropHint() {
  document.querySelectorAll('.drop-join').forEach(item => item.classList.remove('drop-join'));
  document.getElementById('dropSortHint')?.remove();
}
function dropModeFor(target, event) {
  if (!target) return null;
  const rect = target.getBoundingClientRect();
  const ratio = (event.clientX - rect.left) / Math.max(rect.width, 1);
  if (ratio < 0.28) return "before";
  if (ratio > 0.72) return "after";
  return "join";
}
function showDropHint(target, mode) {
  clearDropHint();
  if (!target || !mode) return;
  if (mode === "join") {
    target.classList.add('drop-join');
    return;
  }
  const rect = target.querySelector('rect');
  if (!rect) return;
  const x = +rect.getAttribute('x') + (mode === "after" ? +rect.getAttribute('width') : 0);
  const y0 = +rect.getAttribute('y') - 8;
  const y1 = +rect.getAttribute('y') + +rect.getAttribute('height') + 8;
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('id', 'dropSortHint');
  line.setAttribute('class', 'drop-sort');
  line.setAttribute('x1', x);
  line.setAttribute('x2', x);
  line.setAttribute('y1', y0);
  line.setAttribute('y2', y1);
  $('chart').appendChild(line);
}
function linkKey(d) {
  return `${d.source_node_id}=>${d.target_node_id}`;
}
function describeLink(d, valueText, sourceLabel = labelFor(d.source_party), targetLabel = labelFor(d.target_party)) {
  return `${sourceLabel} -> ${targetLabel}: ${valueText}`;
}
function describeNode(label, votes, share) {
  return `${label}: ${fmt.format(votes)} oy, ${pct(share)}`;
}
function stageForId(stageId) {
  return state.stages.find(stage => stage.id === stageId);
}
function tokenMemberParties(stageId, token, rawLinks = []) {
  const row = rowState(stageId);
  const members = membersForToken(row, token);
  return [...new Set(members.flatMap(member => (
    isDigerToken(member) ? digerMemberParties(stageId, member, rawLinks) : [member]
  )))];
}
function mapPartyTotals(rawLinks) {
  const sideTotals = new Map();
  for (const d of rawLinks) {
    if (d.source_stage_id) {
      sideTotals.set(`${d.source_stage_id}::source::${d.source_party}`, (sideTotals.get(`${d.source_stage_id}::source::${d.source_party}`) || 0) + (+d.estimated_flow_votes || 0));
    }
    if (d.target_stage_id) {
      sideTotals.set(`${d.target_stage_id}::target::${d.target_party}`, (sideTotals.get(`${d.target_stage_id}::target::${d.target_party}`) || 0) + (+d.estimated_flow_votes || 0));
    }
  }
  const totals = new Map();
  for (const [key, value] of sideTotals.entries()) {
    const [stageId, , party] = key.split("::");
    const totalKey = `${stageId}::${party}`;
    totals.set(totalKey, Math.max(totals.get(totalKey) || 0, value));
  }
  return totals;
}
function digerMemberParties(stageId, token, rawLinks) {
  const stage = stageForId(stageId);
  if (!stage || !rawLinks.length) return [];
  const totals = mapPartyTotals(rawLinks);
  const digerBuckets = digerBucketMap(rawLinks, totals);
  const row = rowState(stageId);
  return [...totals.entries()]
    .filter(([key]) => key.startsWith(`${stageId}::`))
    .map(([key]) => key.split("::")[1])
    .filter(party => !isBalanceParty(party))
    .filter(party => !row.hidden.includes(party))
    .filter(party => visibleParty(stage, party, totals, false, digerBuckets) === token);
}
function mapContextForLink(link) {
  const sourceStage = stageForId(link.source_stage_id);
  const targetStage = stageForId(link.target_stage_id);
  if (!sourceStage || !targetStage) return null;
  const pairKey = `${sourceStage.key}__to__${targetStage.key}`;
  const model = bestModelForPair(pairKey);
  if (!DATA.ilce_vote_files?.[pairKey]?.[model] || !DATA.maps?.ilce) return null;
  const rows = pairLinks(pairKey, model).map(row => ({
    ...row,
    source_stage_id: link.source_stage_id,
    target_stage_id: link.target_stage_id,
  }));
  return {
    kind: "flow",
    pairKey,
    model,
    sourceStageId: link.source_stage_id,
    targetStageId: link.target_stage_id,
    sourceToken: link.source_party,
    targetToken: link.target_party,
    sourceParties: tokenMemberParties(link.source_stage_id, link.source_party, rows),
    targetParties: tokenMemberParties(link.target_stage_id, link.target_party, rows),
    title: `${labelFor(link.source_party)} -> ${labelFor(link.target_party)}`,
    subtitle: `${stageLabel(sourceStage.key)} -> ${stageLabel(targetStage.key)}`,
  };
}
function mapContextForNode(node) {
  const stage = stageForId(node.stageId);
  if (!stage) return null;
  const pair = adjacentPairForStage(stage.key);
  if (!pair) return null;
  const model = bestModelForPair(pair.pair_key);
  if (!DATA.ilce_vote_files?.[pair.pair_key]?.[model] || !DATA.maps?.ilce) return null;
  const side = pair.source.key === stage.key ? "source" : "target";
  const sourceStageId = stageIdForKey(pair.source.key) || (side === "source" ? node.stageId : "__map_source");
  const targetStageId = stageIdForKey(pair.target.key) || (side === "target" ? node.stageId : "__map_target");
  const rows = pairLinks(pair.pair_key, model).map(row => ({
    ...row,
    source_stage_id: sourceStageId,
    target_stage_id: targetStageId,
  }));
  return {
    kind: "party",
    pairKey: pair.pair_key,
    model,
    side,
    stageId: node.stageId,
    partyToken: node.party,
    parties: tokenMemberParties(node.stageId, node.party, rows),
    title: labelFor(node.party),
    subtitle: stageLabel(stage.key),
  };
}
function mapContextFromShareState(mapState) {
  const ctx = mapState?.ctx;
  if (!ctx || typeof ctx !== "object") return null;
  if (ctx.k === "flow") {
    const sourceStage = state.stages[+ctx.si];
    const targetStage = state.stages[+ctx.ti];
    if (!sourceStage || !targetStage || typeof ctx.sp !== "string" || typeof ctx.tp !== "string") return null;
    return mapContextForLink({
      source_stage_id: sourceStage.id,
      target_stage_id: targetStage.id,
      source_party: ctx.sp,
      target_party: ctx.tp,
    });
  }
  if (ctx.k === "party") {
    const stage = state.stages[+ctx.si];
    if (!stage || typeof ctx.p !== "string") return null;
    return mapContextForNode({stageId: stage.id, party: ctx.p});
  }
  return null;
}
function restoreSharedMapIfNeeded() {
  if (!pendingShareMapState) return;
  const mapState = pendingShareMapState;
  pendingShareMapState = null;
  const context = mapContextFromShareState(mapState);
  if (!context) return;
  activeMapContext = context;
  if (mapState.o) openMap(context, typeof mapState.metric === "string" ? mapState.metric : null);
}
function districtKey(il, ilce) {
  const ilKey = locationKey(il);
  const ilceKey = locationKey(ilce);
  return `${ilKey}::${ilceKey === ilKey ? "MERKEZ" : ilceKey}`;
}
function locationKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("İ", "I")
    .replaceAll("ı", "I")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}
function districtDisplayName(il, ilce) {
  return locationKey(ilce) === locationKey(il) ? "MERKEZ" : ilce;
}
function transitionAt(provinceRows, province, sourceParty, targetParty) {
  const row = provinceRows.find(item =>
    item.il === province &&
    item.source_party === sourceParty &&
    item.target_party === targetParty
  );
  return +(row?.transition_probability || 0);
}
function nationalFlowTransition(context) {
  const rows = pairLinks(context.pairKey, context.model);
  let numerator = 0;
  let denominator = 0;
  context.sourceParties.forEach(sourceParty => {
    const sourceRows = rows.filter(row => row.source_party === sourceParty);
    const sourceTotal = Math.max(...sourceRows.map(row => +row.source_votes || 0), 0);
    denominator += sourceTotal;
    context.targetParties.forEach(targetParty => {
      const flow = sourceRows.find(row => row.target_party === targetParty);
      numerator += +flow?.estimated_flow_votes || 0;
    });
  });
  return denominator > 0 ? numerator / denominator : 0;
}
function nationalPartyShare(context, votes) {
  const source = context.side === "source";
  let numerator = 0;
  let denominator = 0;
  votes.rows.forEach(row => {
    const voteMap = source ? row.source_votes : row.target_votes;
    numerator += context.parties.reduce((sum, party) => sum + (+voteMap[party] || 0), 0);
    denominator += source ? row.source_total : row.target_total;
  });
  return denominator > 0 ? numerator / denominator : 0;
}
function flowTransitionValue(context, province, provinceRows) {
  let numerator = 0;
  let denominator = 0;
  context.sourceParties.forEach(sourceParty => {
    const sourceRows = provinceRows.filter(row => row.il === province && row.source_party === sourceParty);
    const sourceVotes = sourceRows.length ? Math.max(...sourceRows.map(row => +row.source_votes || 0), 0) : 0;
    denominator += sourceVotes;
    context.targetParties.forEach(targetParty => {
      numerator += sourceVotes * transitionAt(provinceRows, province, sourceParty, targetParty);
    });
  });
  return denominator > 0 ? numerator / denominator : 0;
}
function mapRowsForContext(context, votes, provinceRows = [], metric = "count") {
  const baseline = metric === "share"
    ? nationalPartyShare(context, votes)
    : metric === "transition"
      ? nationalFlowTransition(context)
      : 0;
  return votes.rows.map(row => {
    let value = 0;
    if (context.kind === "party") {
      const source = context.side === "source";
      const voteMap = source ? row.source_votes : row.target_votes;
      const count = context.parties.reduce((sum, party) => sum + (+voteMap[party] || 0), 0);
      const total = source ? row.source_total : row.target_total;
      value = metric === "share" ? count / Math.max(total, 1) : count;
    } else {
      if (metric === "transition") {
        value = flowTransitionValue(context, row.il, provinceRows);
      } else {
        const scale = row.source_total > 0 ? row.target_total / row.source_total : 0;
        context.sourceParties.forEach(sourceParty => {
          const sourceVotes = +row.source_votes[sourceParty] || 0;
          context.targetParties.forEach(targetParty => {
            value += sourceVotes * transitionAt(provinceRows, row.il, sourceParty, targetParty) * scale;
          });
        });
      }
    }
    const colorValue = metric === "share" || metric === "transition" ? value - baseline : value;
    return {...row, value, colorValue, baseline};
  }).filter(row => row.value > 0).sort((a, b) => b.value - a.value);
}
function featureCoordinates(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return geometry.coordinates.flat(1);
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat(2);
  return [];
}
function geoPath(geometry, project) {
  const ringPath = ring => ring.map((point, index) => {
    const [x, y] = project(point);
    return `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ") + " Z";
  if (geometry.type === "Polygon") return geometry.coordinates.map(ringPath).join(" ");
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flatMap(poly => poly.map(ringPath)).join(" ");
  return "";
}
function mapColor(value, maxValue) {
  if (!value || !maxValue) return "#e5e7eb";
  const t = Math.max(0, Math.min(1, Math.log1p(value) / Math.log1p(maxValue)));
  const start = [236, 253, 245];
  const end = [15, 118, 110];
  return rgbToHex(start.map((channel, index) => channel + (end[index] - channel) * t));
}
function mapDivergingColor(value, maxAbs) {
  if (!maxAbs) return "#f8fafc";
  const t = Math.max(0, Math.min(1, Math.abs(value) / maxAbs));
  const neutral = [248, 250, 252];
  const end = value >= 0 ? [22, 163, 74] : [220, 38, 38];
  return rgbToHex(neutral.map((channel, index) => channel + (end[index] - channel) * t));
}
function metricLabel(context, metric) {
  if (metric === "share") return "Oy oranı";
  if (metric === "transition") return "Geçiş oranı";
  return "Oy sayısı";
}
function formatMapValue(context, metric, value) {
  return metric === "share" || metric === "transition" ? pct(value) : fmt.format(value);
}
function formatSignedPct(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${pct(value)}`;
}
function formatSignedPp(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${(100 * value).toFixed(1)} pp`;
}
function mapDisplayRows(context, rows, metric) {
  if (context.kind !== "flow" || metric !== "transition") return rows;
  const byProvince = new Map();
  rows.forEach(row => {
    if (!byProvince.has(row.il)) byProvince.set(row.il, {...row, ilce: ""});
  });
  return [...byProvince.values()].sort((a, b) => b.value - a.value || a.il.localeCompare(b.il, "tr"));
}
function mapRowLabel(row, provinceOnly = false) {
  return provinceOnly ? row.il : `${row.il} / ${row.ilce}`;
}
function mapListKey(row, provinceOnly = false) {
  return provinceOnly ? locationKey(row.il) : districtKey(row.il, row.ilce);
}
function focusMapRow(key) {
  const row = $('mapRows').querySelector(`[data-map-row-key="${CSS.escape(key)}"]`);
  if (!row) return;
  $('mapRows').querySelectorAll('.map-row.selected').forEach(item => item.classList.remove('selected'));
  row.classList.add('selected');
  row.scrollIntoView({block: "center", behavior: "smooth"});
}
function showMapTooltip(message, event) {
  if (!desktopHoverMedia.matches || !message) return;
  const tip = $('mapTooltip');
  if (!tip) return;
  tip.textContent = message;
  tip.hidden = false;
  const margin = 12;
  const box = tip.getBoundingClientRect();
  let x = event.clientX + 14;
  let y = event.clientY + 14;
  if (x + box.width + margin > window.innerWidth) x = event.clientX - box.width - 14;
  if (y + box.height + margin > window.innerHeight) y = event.clientY - box.height - 14;
  tip.style.left = `${Math.max(margin, x)}px`;
  tip.style.top = `${Math.max(margin, y)}px`;
}
function hideMapTooltip() {
  const tip = $('mapTooltip');
  if (tip) tip.hidden = true;
}
function updateMapMetricControls(context) {
  const options = context.kind === "flow"
    ? [["count", "#"], ["transition", "%"]]
    : [["count", "#"], ["share", "%"]];
  if (!options.some(([metric]) => metric === activeMapMetric)) activeMapMetric = "count";
  $('mapMetric').innerHTML = options.map(([metric, label]) => (
    `<button type="button" class="${metric === activeMapMetric ? 'active' : ''}" data-metric="${attr(metric)}">${text(label)}</button>`
  )).join("");
}
function renderMap(context, geometry, provinceGeometry, rows, metric = "count") {
  const svg = $('mapChart');
  const allPoints = geometry.features.flatMap(feature => featureCoordinates(feature.geometry));
  const xs = allPoints.map(point => point[0]);
  const ys = allPoints.map(point => point[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  svg.style.setProperty("--map-aspect", String((maxX - minX) / Math.max(maxY - minY, 0.0001)));
  const box = svg.getBoundingClientRect();
  const width = Math.max(box.width || svg.clientWidth || 760, 320);
  const height = Math.max(box.height || svg.clientHeight || 520, 80);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const pad = 14;
  const scale = Math.min((width - pad * 2) / (maxX - minX), (height - pad * 2) / (maxY - minY));
  const project = point => [
    pad + (point[0] - minX) * scale,
    height - pad - (point[1] - minY) * scale,
  ];
  const values = new Map(rows.map(row => [districtKey(row.il, row.ilce), row.value]));
  const colorValues = new Map(rows.map(row => [districtKey(row.il, row.ilce), row.colorValue]));
  const maxValue = rows[0]?.value || 0;
  const contrast = metric === "share" || metric === "transition";
  const provinceOnly = context.kind === "flow" && metric === "transition";
  const maxAbs = Math.max(...rows.map(row => Math.abs(row.colorValue || 0)), 0);
  const districtPaths = geometry.features.map(feature => {
    const props = feature.properties || {};
    const key = districtKey(props.il, props.ilce);
    const rowKey = provinceOnly ? locationKey(props.il) : key;
    const value = values.get(key) || 0;
    const colorValue = colorValues.get(key) || 0;
    const klass = value ? "map-district" : "map-district empty";
    const fill = contrast ? mapDivergingColor(colorValue, maxAbs) : mapColor(value, maxValue);
    const ilceLabel = districtDisplayName(props.il, props.ilce);
    const title = contrast
      ? `${props.il} / ${ilceLabel}: ${formatMapValue(context, metric, value)} (${formatSignedPp(colorValue)})`
      : `${props.il} / ${ilceLabel}: ${formatMapValue(context, metric, value)}`;
    return `<path class="${klass}" d="${geoPath(feature.geometry, project)}" fill="${fill}" data-map-row-key="${attr(rowKey)}" data-map-tip="${attr(title)}"></path>`;
  }).join("");
  const provincePaths = (provinceGeometry?.features || []).map(feature => (
    `<path class="map-province-border" d="${geoPath(feature.geometry, project)}"></path>`
  )).join("");
  svg.innerHTML = `${districtPaths}${provincePaths}`;
  svg.querySelectorAll('.map-district:not(.empty)').forEach(path => {
    path.addEventListener('click', () => focusMapRow(path.dataset.mapRowKey));
    path.addEventListener('pointerenter', event => showMapTooltip(path.dataset.mapTip, event));
    path.addEventListener('pointermove', event => showMapTooltip(path.dataset.mapTip, event));
    path.addEventListener('pointerleave', hideMapTooltip);
  });
  $('mapTitle').textContent = context.title;
  $('mapSubtitle').textContent = context.subtitle;
  $('mapLegend').textContent = rows.length
    ? contrast
      ? `${metricLabel(context, metric)} - ulusal ${formatMapValue(context, metric, rows[0].baseline || 0)}; kırmızı altı, yeşil üstü`
      : `${metricLabel(context, metric)} - en yüksek: ${rows[0].il} / ${rows[0].ilce} - ${formatMapValue(context, metric, rows[0].value)}`
    : "Veri yok";
  const displayRows = mapDisplayRows(context, rows, metric);
  $('mapRows').innerHTML = displayRows.map(row => (
    `<div class="map-row" data-map-row-key="${attr(mapListKey(row, provinceOnly))}"><span>${text(mapRowLabel(row, provinceOnly))}</span><strong>${formatMapValue(context, metric, row.value)}${contrast ? ` (${formatSignedPp(row.colorValue)})` : ""}</strong></div>`
  )).join("");
}
async function openMap(context, metric = null) {
  if (!context) return;
  $('mapModal').hidden = false;
  $('mapTitle').textContent = context.title;
  $('mapSubtitle').textContent = "Yükleniyor...";
  $('mapChart').innerHTML = "";
  $('mapLegend').textContent = "";
  $('mapRows').textContent = "";
  activeMapMetric = metric || (context.kind === "flow" ? "transition" : "share");
  updateMapMetricControls(context);
  try {
    const loaders = [
      loadIlceVotes(context.pairKey, context.model),
      loadIlceGeometry(),
      loadIlGeometry(),
    ];
    if (context.kind === "flow") {
      loaders.push(ensureProvincePairModel(context.pairKey, context.model));
      loaders.push(ensurePairModel(context.pairKey, context.model));
    }
    const [votes, geometry, provinceGeometry] = await Promise.all(loaders);
    const provinceRows = context.kind === "flow"
      ? provincePairLinks(context.pairKey, context.model, "")
      : [];
    activeMapData = {context, geometry, provinceGeometry, votes, provinceRows};
    renderMap(context, geometry, provinceGeometry, mapRowsForContext(context, votes, provinceRows, activeMapMetric), activeMapMetric);
    updateUrlState();
  } catch (error) {
    console.error(error);
    $('mapSubtitle').textContent = "Harita verisi yüklenemedi.";
  }
}
function closeMap() {
  $('mapModal').hidden = true;
  activeMapData = null;
  hideMapTooltip();
  updateUrlState();
}
function stripePattern(party) {
  const id = `stripe-${party.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  return {
    id,
    markup: `<pattern id="${id}" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)"><rect width="8" height="8" fill="#9ca3af"></rect><rect width="4" height="8" fill="${colorFor(party)}"></rect></pattern>`,
  };
}
function connectedSelection(links, selectedKey) {
  const nodes = new Set(selectedKey ? [selectedKey] : []);
  const linkKeys = new Set();
  if (!selectedKey) return {nodes, linkKeys};
  const incoming = new Map();
  const outgoing = new Map();
  links.forEach(link => {
    if (!incoming.has(link.target_node_id)) incoming.set(link.target_node_id, []);
    incoming.get(link.target_node_id).push(link);
    if (!outgoing.has(link.source_node_id)) outgoing.set(link.source_node_id, []);
    outgoing.get(link.source_node_id).push(link);
  });
  const walk = (start, map, nextKey) => {
    const queue = [start];
    const seen = new Set([start]);
    while (queue.length) {
      const current = queue.shift();
      (map.get(current) || []).forEach(link => {
        const next = nextKey(link);
        linkKeys.add(linkKey(link));
        nodes.add(next);
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      });
    }
  };
  walk(selectedKey, incoming, link => link.source_node_id);
  walk(selectedKey, outgoing, link => link.target_node_id);
  return {nodes, linkKeys};
}
function observedNodeValue(node, links) {
  if (isBalanceParty(node.party)) return node.value;
  const row = rowState(node.stageId);
  if (groupForToken(row, node.party)) return node.value;
  let value = 0;
  links.forEach(link => {
    if (link.source_node_id === node.id || (link.source_stage_id === node.stageId && link.source_party === node.party)) {
      value = Math.max(value, +link.source_observed_votes || +link.source_votes || 0);
    }
    if (link.target_node_id === node.id || (link.target_stage_id === node.stageId && link.target_party === node.party)) {
      value = Math.max(value, +link.target_votes || 0);
    }
  });
  return value || node.value;
}
function draw(rawLinks, baselineLinks = rawLinks, standaloneNodes = []) {
  const g = layoutNodes(rawLinks, baselineLinks, standaloneNodes);
  renderColorPalette(g.nodes);
  const showVotes = $('showVotes').checked;
  const svg = $('chart');
  svg.setAttribute('viewBox', `0 0 ${g.width} ${g.height}`);
  const nodeDisplayValues = new Map();
  const displayStageTotals = new Map();
  [...g.pos.values()].forEach(node => {
    const value = observedNodeValue(node, baselineLinks);
    nodeDisplayValues.set(node.id, value);
    if (isBalanceParty(node.party)) return;
    displayStageTotals.set(node.stageId, (displayStageTotals.get(node.stageId) || 0) + value);
  });
  const stageLabels = state.stages.map(stage => {
    const stageNodes = [...g.pos.values()].filter(n => n.stageId === stage.id);
    if (!stageNodes.length) return "";
    const minX = Math.min(...stageNodes.map(n => n.x));
    const minY = Math.min(...stageNodes.map(n => n.y));
    const maxY = Math.max(...stageNodes.map(n => n.y + n.h));
    return stageLabelSvg(stage.key, minX - 30, minY, maxY - minY);
  }).join('');
  const orderedLinks = g.links.slice().sort((a, b) => {
    const as = g.pos.get(a.source_node_id);
    const bs = g.pos.get(b.source_node_id);
    const at = g.pos.get(a.target_node_id);
    const bt = g.pos.get(b.target_node_id);
    return (as?.y ?? 0) - (bs?.y ?? 0) || (as?.x ?? 0) - (bs?.x ?? 0) || (at?.x ?? 0) - (bt?.x ?? 0);
  });
  const orderedBaselineLinks = baselineLinks.slice().sort((a, b) => {
    const as = g.pos.get(a.source_node_id);
    const bs = g.pos.get(b.source_node_id);
    const at = g.pos.get(a.target_node_id);
    const bt = g.pos.get(b.target_node_id);
    return (as?.y ?? 0) - (bs?.y ?? 0) || (as?.x ?? 0) - (bs?.x ?? 0) || (at?.x ?? 0) - (bt?.x ?? 0);
  });
  if (selectedLinkKey && !orderedLinks.some(link => linkKey(link) === selectedLinkKey)) selectedLinkKey = null;
  const selectedKey = selectedNode ? `${selectedNode.stageId}::${selectedNode.party}` : null;
  const sourceGroups = new Map();
  const targetGroups = new Map();
  orderedBaselineLinks.forEach((d, index) => {
    if (g.pos.has(d.source_node_id)) {
      if (!sourceGroups.has(d.source_node_id)) sourceGroups.set(d.source_node_id, []);
      sourceGroups.get(d.source_node_id).push(index);
    }
    if (g.pos.has(d.target_node_id)) {
      if (!targetGroups.has(d.target_node_id)) targetGroups.set(d.target_node_id, []);
      targetGroups.get(d.target_node_id).push(index);
    }
  });
  const sourceSegments = new Map();
  const targetSegments = new Map();
  function assignSegments(groups, segments, side) {
    for (const [nodeId, indexes] of groups.entries()) {
      const node = g.pos.get(nodeId);
      if (!node) continue;
      const total = indexes.reduce((sum, index) => sum + (+orderedBaselineLinks[index].estimated_flow_votes || 0), 0);
      const flowX = node.flowX ?? node.x;
      const flowW = node.flowW ?? node.w;
      let cursor = flowX;
      indexes.forEach((index, itemIndex) => {
        const link = orderedBaselineLinks[index];
        const width = itemIndex === indexes.length - 1
          ? flowX + flowW - cursor
          : flowW * ((+link.estimated_flow_votes || 0) / Math.max(total, 1));
        segments.set(linkKey(link), {
          x0: cursor,
          x1: cursor + width,
          y: side === "source" ? node.y + node.h : node.y,
        });
        cursor += width;
      });
    }
  }
  assignSegments(sourceGroups, sourceSegments, "source");
  assignSegments(targetGroups, targetSegments, "target");
  const minHighlight = +$('minRibbon').value || 0;
  const highlightedLinks = minHighlight > 0
    ? orderedLinks.filter(link => (+link.estimated_flow_votes || 0) >= minHighlight)
    : orderedLinks;
  const connected = connectedSelection(highlightedLinks, selectedKey);
  const gradientDefs = [];
  const paths = orderedLinks.map((d, index) => {
    const a = g.pos.get(d.source_node_id), b = g.pos.get(d.target_node_id);
    if (!a || !b) return '';
    const source = sourceSegments.get(linkKey(d));
    const target = targetSegments.get(linkKey(d));
    if (!source || !target) return '';
    const ay = source.y, by = target.y;
    const midY = (ay + by) / 2;
    const val = showVotes ? million(d.estimated_flow_votes) : pct(d.estimated_flow_votes / Math.max(g.stageTotals.get(a.stageId) || a.outgoing || a.value, 1));
    const hover = describeLink(d, val);
    const path = [
      `M ${source.x0} ${ay}`,
      `C ${source.x0} ${midY}, ${target.x0} ${midY}, ${target.x0} ${by}`,
      `L ${target.x1} ${by}`,
      `C ${target.x1} ${midY}, ${source.x1} ${midY}, ${source.x1} ${ay}`,
      "Z",
    ].join(" ");
    const key = linkKey(d);
    const selected = selectedLinkKey === key;
    const dim = (selectedKey && !connected.linkKeys.has(key)) || (selectedLinkKey && !selected);
    const gradientId = `flow-gradient-${index}`;
    const sourceMid = (source.x0 + source.x1) / 2;
    const targetMid = (target.x0 + target.x1) / 2;
    gradientDefs.push(`<linearGradient id="${gradientId}" gradientUnits="userSpaceOnUse" x1="${sourceMid}" y1="${ay}" x2="${targetMid}" y2="${by}"><stop offset="0%" stop-color="${colorFor(d.source_party)}"></stop><stop offset="100%" stop-color="${colorFor(d.target_party)}"></stop></linearGradient>`);
    return `<path class="link ${selected ? 'selected' : ''} ${dim ? 'dim' : ''}" d="${path}" fill="url(#${gradientId})" focusable="false" tabindex="-1" data-link-index="${index}" data-link-key="${attr(key)}" data-hover="${attr(hover)}"><title>${text(hover)}</title></path>`;
  }).join('');
  const inflatedParties = new Set();
  const nodes = [...g.pos.values()].map(n => {
    const mobile = isMobileLayout();
    const displayValue = nodeDisplayValues.get(n.id) || n.value;
    const share = displayValue / Math.max(displayStageTotals.get(n.stageId) || g.stageTotals.get(n.stageId) || 0, 1);
    const showValue = share >= (mobile ? 0.012 : 0.018) || n.w >= (mobile ? 30 : 48);
    const val = showValue ? (showVotes ? million(displayValue) : pct(share)) : '';
    const label = labelFor(n.party);
    const hover = describeNode(label, displayValue, share);
    const rotated = n.w < 52;
    const compact = n.w < (mobile ? 44 : 64);
    const showPct = val && !compact && !rotated;
    const labelText = rotated
      ? `<text class="node-label rotated" transform="translate(${n.x + n.w/2} ${n.y + n.h/2}) rotate(-90)" text-anchor="middle">${text(label)}</text>`
      : `<text class="node-label" x="${n.x + n.w/2}" y="${n.y + (showPct ? n.h/2 - 8 : n.h/2 + 6)}" text-anchor="middle">${text(label)}</text>`;
    const pctText = showPct ? `<text class="node-pct" x="${n.x + n.w/2}" y="${n.y + n.h/2 + 17}" text-anchor="middle">${text(val)}</text>` : '';
    const selected = selectedNode && selectedNode.stageId === n.stageId && selectedNode.party === n.party;
    const dim = selectedKey && !connected.nodes.has(n.id);
    const row = rowState(n.stageId);
    const group = groupForToken(row, n.party);
    const inflated = (n.flowW ?? n.w) + 0.5 < n.w;
    if (inflated) inflatedParties.add(n.party);
    const shellFill = inflated ? `url(#${stripePattern(n.party).id})` : colorFor(n.party);
    const fillRect = inflated
      ? `<rect class="node-fill" x="${n.flowX}" y="${n.y}" width="${n.flowW}" height="${n.h}" fill="${colorFor(n.party)}"></rect>`
      : `<rect class="node-fill" x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" fill="${colorFor(n.party)}"></rect>`;
    const showNodeActions = !isMobileLayout() || n.w >= 34;
    const splitButton = showNodeActions && group && group.members.length > 1
      ? `<g class="split-node-action" data-stage-id="${attr(n.stageId)}" data-party="${attr(n.party)}"><rect class="split-hit" x="${n.x + 4}" y="${n.y + 6}" width="20" height="20" rx="3"></rect><text class="split-node" x="${n.x + 14}" y="${n.y + 17}" text-anchor="middle">/</text></g>`
      : '';
    const hideX = Math.max(n.x + 2, n.x + n.w - 24);
    const hideButton = showNodeActions
      ? `<g class="hide-node-action" data-stage-id="${attr(n.stageId)}" data-party="${attr(n.party)}"><rect class="hide-hit" x="${hideX}" y="${n.y + 6}" width="20" height="20" rx="3"></rect><text class="hide-node" x="${hideX + 10}" y="${n.y + 17}" text-anchor="middle">x</text></g>`
      : '';
    return `<g class="node ${inflated ? 'inflated' : ''} ${selected ? 'selected' : ''} ${dim ? 'dim' : ''}" data-stage-id="${attr(n.stageId)}" data-party="${attr(n.party)}" data-hover="${attr(hover)}"><title>${text(hover)}${inflated ? "\nTıklama için genişletildi" : ""}</title><rect class="node-shell" x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" style="fill:${shellFill}"></rect>${fillRect}${labelText}${pctText}${splitButton}${hideButton}</g>`;
  }).join('');
  const defsContent = `${gradientDefs.join("")}${[...inflatedParties].map(party => stripePattern(party).markup).join("")}`;
  const defs = defsContent
    ? `<defs>${defsContent}</defs>`
    : '';
  svg.innerHTML = `${defs}${stageLabels}${paths}${nodes}`;
  [...svg.querySelectorAll('[data-hover]')].forEach(item => {
    const mapContext = () => {
      if (item.classList.contains('link')) return mapContextForLink(orderedLinks[+item.dataset.linkIndex]);
      if (item.classList.contains('node')) return mapContextForNode({
        stageId: item.dataset.stageId,
        party: item.dataset.party,
      });
      return null;
    };
    item.addEventListener('pointerenter', () => {
      if (!desktopHoverMedia.matches) hoverLine(item.dataset.hover, mapContext());
    });
    item.addEventListener('pointerdown', () => hoverLine(item.dataset.hover, mapContext()));
    item.addEventListener('focus', () => hoverLine(item.dataset.hover, mapContext()));
  });
  [...svg.querySelectorAll('.link')].forEach(item => {
    item.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      selectedLinkKey = selectedLinkKey === item.dataset.linkKey ? null : item.dataset.linkKey;
      selectedNode = null;
      render();
    });
  });
  [...svg.querySelectorAll('.split-node-action')].forEach(item => {
    item.addEventListener('pointerdown', event => event.stopPropagation());
    item.addEventListener('pointerup', event => event.stopPropagation());
    item.addEventListener('click', event => {
      event.stopPropagation();
      pushUndo();
      if (splitToken(item.dataset.stageId, item.dataset.party)) render();
    });
  });
  [...svg.querySelectorAll('.hide-node-action')].forEach(item => {
    item.addEventListener('pointerdown', event => event.stopPropagation());
    item.addEventListener('pointerup', event => event.stopPropagation());
    item.addEventListener('click', event => {
      event.stopPropagation();
      pushUndo();
      hideToken(item.dataset.stageId, item.dataset.party);
      selectedStageId = item.dataset.stageId;
      selectedNode = null;
      render();
    });
  });
  [...svg.querySelectorAll('.node')].forEach(item => {
    pointerDrag(item, {
      start: () => {
        dragNode = {stageId: item.dataset.stageId, party: item.dataset.party};
        item.classList.add('dragging');
      },
      move: event => {
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.node');
        const valid = target && dragNode && dragNode.stageId === target.dataset.stageId && dragNode.party !== target.dataset.party;
        showDropHint(valid ? target : null, valid ? dropModeFor(target, event) : null);
      },
      end: event => {
        item.classList.remove('dragging');
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.node');
        const mode = dropModeFor(target, event);
        clearDropHint();
        if (!target || !dragNode || dragNode.stageId !== target.dataset.stageId || dragNode.party === target.dataset.party) {
          dragNode = null;
          return;
        }
        if (mode === "join") combineNodes(dragNode, {stageId: target.dataset.stageId, party: target.dataset.party});
        else sortNode(dragNode, {stageId: target.dataset.stageId, party: target.dataset.party}, mode === "after");
        dragNode = null;
      },
    });
    item.addEventListener('click', event => {
      if (performance.now() - lastDragEndedAt < 80) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.target.closest('.hide-node-action,.split-node-action')) return;
      const current = {stageId: item.dataset.stageId, party: item.dataset.party};
      selectedNode = selectedNode && selectedNode.stageId === current.stageId && selectedNode.party === current.party ? null : current;
      selectedLinkKey = null;
      selectedStageId = current.stageId;
      render();
    });
    item.addEventListener('dblclick', event => {
      event.preventDefault();
      const row = rowState(item.dataset.stageId);
      const group = row.groups.find(itemGroup => groupName(itemGroup) === item.dataset.party || itemGroup.members.includes(item.dataset.party));
      if (!group) return;
      const next = prompt('Grup adı', groupName(group));
      if (!next || next.trim() === groupName(group)) return;
      pushUndo();
      group.name = next.trim();
      selectedStageId = item.dataset.stageId;
      render();
    });
  });
}
async function render() {
  const seq = ++renderSeq;
  updateUrlState();
  setLoading(true);
  svgMessage("Yükleniyor...");
  try {
    const baseLinks = await chainLinks();
    const standaloneNodes = await singleStageNodes();
    if (seq !== renderSeq) return;
    const baselineLinks = state.stages.length === 1 ? [] : aggregatedLinks(baseLinks, true);
    const groupedLinks = state.stages.length === 1 ? [] : aggregatedLinks(baseLinks);
    const links = visibleRibbons(groupedLinks);
    renderStages();
    draw(links, baselineLinks, standaloneNodes);
    restoreSharedMapIfNeeded();
  } catch (error) {
    if (seq !== renderSeq) return;
    console.error(error);
    renderStages();
    if (error.dataUnavailable) {
      svgMessage("Veri yok", "Bu seçim veya model için yayınlanmış veri bulunamadı.");
      hoverLine("Veri yok.");
    } else {
      svgMessage("Veri yüklenemedi", "Tekrar denemek için seçimi veya filtreyi değiştirin.");
      hoverLine("Veri yüklenemedi.");
    }
  } finally {
    if (seq === renderSeq) setLoading(false);
  }
}
init();
