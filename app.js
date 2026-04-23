let chart = null;
let currentRange = "7d";
let allData = [];
let _dataInitialized = false;

const RANGE_DAYS = { "1d": 1, "3d": 3, "7d": 7, "1m": 30, "3m": 90, "1y": 365 };

const AI_DEFAULTS = {
  baseUrl: "https://www.openclaudecode.cn",
  apiKey:  "sk-oekmYFVpITCc5KcmIfwuz6sJJ7pF9sDVqzsOpXHcNssitINe",
  model:   "gpt-5.4",
};
const AI_UA = "claude-cli/2.0.76 (external, cli)";

const ANALYZE_PROMPT = `你是一个专业的家庭用电分析助手，以下是北邮学生宿舍 10-846 的历史剩余电量数据（格式：时间 剩余电量）。

请依次分析：
1. **用电趋势**：近期消耗速度是加快还是减缓？有无明显用电高峰时段？
2. **日均用电量**：基于数据计算平均每天消耗多少度电
3. **剩余天数预测**：按当前趋势，剩余电量预计还能使用多少天
4. **异常检测**：是否存在异常波动（如电量骤降），如有请指出时间点与可能原因
5. **充值建议**：若剩余电量不足 20 度，请明确提醒需要尽快充值；否则给出建议充值时机

数据如下（共 {COUNT} 条记录）：
{DATA}
`;

// ─── markdown + LaTeX 渲染 ───
function renderContent(raw) {
  const blocks = [];
  const safe = raw
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, m) => { blocks.push({ d: true,  m }); return `\x00MATH${blocks.length - 1}\x00`; })
    .replace(/\\\[([\s\S]*?)\\\]/g,  (_, m) => { blocks.push({ d: true,  m }); return `\x00MATH${blocks.length - 1}\x00`; })
    .replace(/\\\(([\s\S]*?)\\\)/g,  (_, m) => { blocks.push({ d: false, m }); return `\x00MATH${blocks.length - 1}\x00`; })
    .replace(/\$([^\n$]+?)\$/g,      (_, m) => { blocks.push({ d: false, m }); return `\x00MATH${blocks.length - 1}\x00`; })
    .replace(/\n{3,}/g, "\n\n");

  let html = marked.parse(safe);

  html = html.replace(/\x00MATH(\d+)\x00/g, (_, i) => {
    const { d, m } = blocks[+i];
    try {
      return katex.renderToString(m.trim(), { displayMode: d, throwOnError: false, output: "html" });
    } catch (_) {
      return d ? `\\[${m}\\]` : `\\(${m}\\)`;
    }
  });
  return html;
}

// ─── 数据 ───
function filterByRange(data, rangeDays) {
  const cutoff = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);
  return data.filter(r => new Date(r.ts) >= cutoff);
}

function updateStatusCard(data) {
  if (!data.length) return;
  const latest = data[data.length - 1];
  document.getElementById("remaining").textContent = Number(latest.remaining).toFixed(2);
  document.getElementById("gift").textContent = Number(latest.gift).toFixed(2);
  document.getElementById("updateTime").textContent = latest.ts;
}

// 按耗电速率对折线分段着色
// 速率 = 相邻两点的电量差（正值 = 消耗）
// 颜色: 绿(<0.5x平均) / 蓝(正常) / 橙(>1.25x) / 红(>2x) / 紫(充值/回升)
function buildSegmentedSeries(values) {
  const n = values.length;

  // 每段斜率（values[i] - values[i+1]，正 = 消耗）
  const slopes = [];
  for (let i = 0; i < n - 1; i++) slopes.push(values[i] - values[i + 1]);

  const pos = slopes.filter(s => s > 0);
  const avg = pos.length ? pos.reduce((a, b) => a + b, 0) / pos.length : 1;

  function segColor(s) {
    if (s < 0)            return "#a855f7"; // 充值 / 电量回升 → 紫
    if (s < avg * 0.5)    return "#22c55e"; // 极低耗电 → 绿
    if (s < avg * 1.25)   return "#3b82f6"; // 正常 → 蓝
    if (s < avg * 2.0)    return "#f97316"; // 偏高 → 橙
    return "#ef4444";                        // 极高 → 红
  }

  // 合并连续同色段
  const groups = [];
  let i = 0;
  while (i < slopes.length) {
    const c = segColor(slopes[i]);
    let j = i;
    while (j + 1 < slopes.length && segColor(slopes[j + 1]) === c) j++;
    groups.push({ color: c, from: i, to: j + 1 }); // 点下标 from ~ to
    i = j + 1;
  }

  return groups.map(g => {
    const d = new Array(n).fill(null);
    for (let k = g.from; k <= g.to; k++) d[k] = values[k];
    return {
      type: "line",
      data: d,
      smooth: true,
      connectNulls: false,
      lineStyle: { color: g.color, width: 2.5 },
      itemStyle: { color: g.color },
      symbol: "circle",
      symbolSize: 5,
      legendHoverLink: false,
    };
  });
}

function renderChart(data) {
  const empty = document.getElementById("chartEmpty");
  if (!data.length) {
    if (chart) chart.clear();
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  const times  = data.map(r => r.ts);
  const values = data.map(r => { const v = Number(r.remaining); return isNaN(v) ? null : v; });
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const pad    = (maxVal - minVal) * 0.15 || 2;
  const yMin   = Math.max(0, Math.floor(minVal - pad));
  const yMax   = Math.ceil(maxVal + pad);

  if (!chart) chart = echarts.init(document.getElementById("chart"), "dark");

  const series = buildSegmentedSeries(values);

  chart.setOption({
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      formatter: params => {
        const p = params.find(x => x.value != null && !isNaN(Number(x.value)));
        if (!p) return "";
        return `${p.axisValue}<br/><b>剩余电量: ${Number(p.value).toFixed(2)} 度</b>`;
      },
      backgroundColor: "#1a1d2e",
      borderColor: "#2a2d3e",
      textStyle: { color: "#e2e8f0" },
    },
    grid: { left: 58, right: 24, top: 16, bottom: 56 },
    xAxis: {
      type: "category",
      data: times,
      axisLabel: {
        rotate: 30, fontSize: 11, color: "#94a3b8",
        formatter: val => val.length > 16 ? val.slice(5, 16) : val,
      },
      axisLine: { lineStyle: { color: "#2a2d3e" } },
    },
    yAxis: {
      type: "value",
      name: "度",
      min: yMin,
      max: yMax,
      nameTextStyle: { color: "#94a3b8", fontSize: 11 },
      axisLabel: { color: "#94a3b8", fontSize: 11 },
      splitLine: { lineStyle: { color: "#2a2d3e" } },
    },
    series,
  }, true);
}

async function loadData() {
  try {
    const prevTs = allData.length ? allData[allData.length - 1].ts : null;
    const res = await fetch(`./data/history.json?t=${Date.now()}`);
    allData = await res.json();
    updateStatusCard(allData);
    renderChart(filterByRange(allData, RANGE_DAYS[currentRange] || 7));

    const newTs = allData.length ? allData[allData.length - 1].ts : null;
    if (_dataInitialized && newTs && newTs !== prevTs) {
      autoAnalyzeIfNeeded();
    }
    _dataInitialized = true;
  } catch (e) {
    console.warn("加载数据失败:", e);
    document.getElementById("chartEmpty").style.display = "block";
  }
}

// ─── 时间范围切换 ───
document.querySelectorAll(".range-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".range-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentRange = btn.dataset.range;
    renderChart(filterByRange(allData, RANGE_DAYS[currentRange] || 7));
  });
});

// ─── AI 配置持久化 ───
const LS_AI = "elecmon_ai_cfg";
const LS_CUSTOM_PROMPT = "elecmon_custom_prompt";

function loadAiConfig() {
  const saved = JSON.parse(localStorage.getItem(LS_AI) || "{}");
  document.getElementById("aiBaseUrl").value = saved.baseUrl ?? AI_DEFAULTS.baseUrl;
  document.getElementById("aiApiKey").value  = saved.apiKey  ?? AI_DEFAULTS.apiKey;
  document.getElementById("aiModel").value   = saved.model   ?? AI_DEFAULTS.model;
}

function saveAiConfig() {
  localStorage.setItem(LS_AI, JSON.stringify({
    baseUrl: document.getElementById("aiBaseUrl").value.trim(),
    apiKey:  document.getElementById("aiApiKey").value.trim(),
    model:   document.getElementById("aiModel").value.trim(),
  }));
}

["aiBaseUrl", "aiApiKey", "aiModel"].forEach(id =>
  document.getElementById(id).addEventListener("change", saveAiConfig)
);

// ─── 自定义 Prompt ───
function loadCustomPrompt() {
  const saved = JSON.parse(localStorage.getItem(LS_CUSTOM_PROMPT) || "{}");
  document.getElementById("customPromptEnabled").checked = saved.enabled ?? false;
  document.getElementById("customPromptText").value = saved.text ?? "";
  toggleCustomPromptInput();
}

function saveCustomPrompt() {
  localStorage.setItem(LS_CUSTOM_PROMPT, JSON.stringify({
    enabled: document.getElementById("customPromptEnabled").checked,
    text:    document.getElementById("customPromptText").value,
  }));
}

function toggleCustomPromptInput() {
  const enabled = document.getElementById("customPromptEnabled").checked;
  document.getElementById("customPromptText").style.display = enabled ? "block" : "none";
}

document.getElementById("customPromptEnabled").addEventListener("change", () => {
  toggleCustomPromptInput();
  saveCustomPrompt();
});
document.getElementById("customPromptText").addEventListener("input", saveCustomPrompt);

function getExtraPrompt() {
  const enabled = document.getElementById("customPromptEnabled").checked;
  const text = document.getElementById("customPromptText").value.trim();
  return enabled && text ? text : "";
}

// ─── AI 分析核心 ───
async function analyzeAI({ silent = false } = {}) {
  const baseUrl = document.getElementById("aiBaseUrl").value.trim().replace(/\/$/, "");
  const apiKey  = document.getElementById("aiApiKey").value.trim();
  const model   = document.getElementById("aiModel").value.trim() || AI_DEFAULTS.model;

  if (!baseUrl || !apiKey) {
    if (!silent) alert("请填写 API Base URL 和 API Key");
    return;
  }

  const btn = document.getElementById("analyzeBtn");
  const resultDiv = document.getElementById("aiResult");
  btn.disabled = true;
  btn.textContent = "分析中…";
  if (!silent) {
    resultDiv.style.display = "block";
    resultDiv.textContent = "正在请求 AI 分析，请稍候…";
  }

  try {
    const rangeData = filterByRange(allData, RANGE_DAYS[currentRange] || 7);
    if (!rangeData.length) {
      if (!silent) resultDiv.textContent = "当前时间范围内暂无数据。";
      return;
    }

    const dataText = rangeData.map(r => `${r.ts}  ${Number(r.remaining).toFixed(2)} 度`).join("\n");
    let prompt = ANALYZE_PROMPT.replace("{COUNT}", rangeData.length).replace("{DATA}", dataText);
    const extra = getExtraPrompt();
    if (extra) prompt += `\n\n${extra}`;

    const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": AI_UA,
      },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),
    });

    const json = await resp.json();
    if (!resp.ok) {
      if (!silent) resultDiv.textContent = `请求失败 (${resp.status})：${json.error?.message || JSON.stringify(json)}`;
      return;
    }

    const raw = json?.choices?.[0]?.message?.content || JSON.stringify(json, null, 2);
    resultDiv.innerHTML = renderContent(raw);
    resultDiv.style.display = "block";
    fetch("/api/save-analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: raw }),
    }).catch(() => {});
  } catch (e) {
    if (!silent) resultDiv.innerHTML = renderContent(`**请求出错：** ${e.message}\n\n提示：部分 API 不支持跨域请求（CORS），请确认服务商是否允许浏览器直连。`);
  } finally {
    btn.disabled = false;
    btn.textContent = "开始 AI 分析";
  }
}

// 自动分析：若已有 18 分钟内的分析结果则跳过，避免多端重复请求
async function autoAnalyzeIfNeeded() {
  try {
    const res = await fetch(`./data/analysis.json?t=${Date.now()}`);
    if (res.ok) {
      const { ts } = await res.json();
      if (ts && Date.now() - new Date(ts).getTime() < 18 * 60 * 1000) return;
    }
  } catch (_) {}
  analyzeAI({ silent: true });
}

document.getElementById("analyzeBtn").addEventListener("click", () => analyzeAI());

window.addEventListener("resize", () => chart?.resize());

// ─── 上次保存的分析结果 ───
async function loadSavedAnalysis() {
  try {
    const res = await fetch(`./data/analysis.json?t=${Date.now()}`);
    if (!res.ok) return;
    const { ts, content } = await res.json();
    if (!content) return;
    const resultDiv = document.getElementById("aiResult");
    resultDiv.innerHTML = renderContent(content);
    resultDiv.style.display = "block";
    const hint = document.createElement("p");
    hint.style.cssText = "margin-top:0.8em;font-size:0.78rem;color:var(--text-muted);border-top:1px solid var(--border);padding-top:0.6em";
    hint.textContent = `上次分析时间：${ts}`;
    resultDiv.appendChild(hint);
  } catch (_) {}
}

loadAiConfig();
loadCustomPrompt();
loadData();
loadSavedAnalysis();
setInterval(loadData, 20 * 60 * 1000);

// ─── 立刻采集 ───
function setPollStatus(msg, type = "") {
  const el = document.getElementById("pollStatus");
  el.textContent = msg;
  el.className = "poll-status" + (type ? " " + type : "");
}

document.getElementById("pollNowBtn").addEventListener("click", async () => {
  const btn = document.getElementById("pollNowBtn");
  btn.disabled = true;
  setPollStatus("采集中，请稍候…");

  try {
    const resp = await fetch("/api/collect", { method: "POST" });
    const data = await resp.json();

    if (!resp.ok) {
      setPollStatus(`采集失败：${data.error || "HTTP " + resp.status}`, "err");
      return;
    }

    if (data.ts) {
      const exists = allData.some(r => r.ts === data.ts);
      if (!exists) allData.push(data);
      updateStatusCard(allData);
      renderChart(filterByRange(allData, RANGE_DAYS[currentRange] || 7));
    }

    setPollStatus(`✓ ${data.remaining} 度（${data.ts}）`, "ok");
    setTimeout(() => setPollStatus(""), 6000);
  } catch (e) {
    setPollStatus(`错误：${e.message}`, "err");
  } finally {
    btn.disabled = false;
  }
});
