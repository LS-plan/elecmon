let chart = null;
let currentRange = "7d";
let allData = [];

const RANGE_DAYS = { "1d": 1, "3d": 3, "7d": 7, "1m": 30, "3m": 90, "1y": 365 };

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

function renderChart(data) {
  const empty = document.getElementById("chartEmpty");
  if (!data.length) {
    if (chart) chart.clear();
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  const times = data.map(r => r.ts);
  const values = data.map(r => Number(r.remaining));

  if (!chart) {
    chart = echarts.init(document.getElementById("chart"), "dark");
  }

  chart.setOption({
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      formatter: params => {
        const p = params[0];
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
        rotate: 30,
        fontSize: 11,
        color: "#94a3b8",
        formatter: val => val.length > 16 ? val.slice(5, 16) : val,
      },
      axisLine: { lineStyle: { color: "#2a2d3e" } },
    },
    yAxis: {
      type: "value",
      name: "度",
      nameTextStyle: { color: "#94a3b8", fontSize: 11 },
      axisLabel: { color: "#94a3b8", fontSize: 11 },
      splitLine: { lineStyle: { color: "#2a2d3e" } },
    },
    series: [{
      type: "line",
      data: values,
      smooth: true,
      lineStyle: { color: "#3b82f6", width: 2.5 },
      areaStyle: {
        color: {
          type: "linear", x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: "rgba(59,130,246,0.35)" },
            { offset: 1, color: "rgba(59,130,246,0)" },
          ],
        },
      },
      symbol: "circle",
      symbolSize: 5,
      itemStyle: { color: "#60a5fa" },
    }],
  }, true);
}

async function loadData() {
  try {
    const res = await fetch(`./data/history.json?t=${Date.now()}`);
    allData = await res.json();
    updateStatusCard(allData);
    renderChart(filterByRange(allData, RANGE_DAYS[currentRange] || 7));
  } catch (e) {
    console.warn("加载数据失败:", e);
    document.getElementById("chartEmpty").style.display = "block";
  }
}

// 时间范围切换
document.querySelectorAll(".range-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".range-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentRange = btn.dataset.range;
    renderChart(filterByRange(allData, RANGE_DAYS[currentRange] || 7));
  });
});

// AI 分析（浏览器直连 AI API）
document.getElementById("analyzeBtn").addEventListener("click", async () => {
  const baseUrl = document.getElementById("aiBaseUrl").value.trim().replace(/\/$/, "");
  const apiKey = document.getElementById("aiApiKey").value.trim();
  const model = document.getElementById("aiModel").value.trim() || "gpt-4o";

  if (!baseUrl || !apiKey) { alert("请填写 API Base URL 和 API Key"); return; }

  const btn = document.getElementById("analyzeBtn");
  const resultDiv = document.getElementById("aiResult");
  btn.disabled = true;
  btn.textContent = "分析中…";
  resultDiv.style.display = "block";
  resultDiv.textContent = "正在请求 AI 分析，请稍候…";

  try {
    const rangeData = filterByRange(allData, RANGE_DAYS[currentRange] || 7);
    if (!rangeData.length) {
      resultDiv.textContent = "当前时间范围内暂无数据。";
      return;
    }

    const dataText = rangeData.map(r => `${r.ts}  ${Number(r.remaining).toFixed(2)} 度`).join("\n");
    const prompt = ANALYZE_PROMPT
      .replace("{COUNT}", rangeData.length)
      .replace("{DATA}", dataText);

    const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:149.0) Gecko/20100101 Firefox/149.0",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const json = await resp.json();
    if (!resp.ok) {
      resultDiv.textContent = `请求失败 (${resp.status})：${json.error?.message || JSON.stringify(json)}`;
      return;
    }
    resultDiv.textContent = json?.choices?.[0]?.message?.content || JSON.stringify(json, null, 2);
  } catch (e) {
    resultDiv.textContent = `请求出错：${e.message}\n\n提示：部分 API 不支持跨域请求（CORS），请确认服务商是否允许浏览器直连。`;
  } finally {
    btn.disabled = false;
    btn.textContent = "开始 AI 分析";
  }
});

window.addEventListener("resize", () => chart?.resize());

loadData();
setInterval(loadData, 20 * 60 * 1000);

// ─── 立刻采集 ───
const GH_OWNER = "LS-plan";
const GH_REPO  = "elecmon";
const GH_WORKFLOW = "poll.yml";
const PAT_KEY = "elecmon_gh_pat";

function setPollStatus(msg, type = "") {
  const el = document.getElementById("pollStatus");
  el.textContent = msg;
  el.className = "poll-status" + (type ? " " + type : "");
}

// PAT 面板
const patToggleBtn = document.getElementById("patToggleBtn");
const patPanel     = document.getElementById("patPanel");
const ghPatInput   = document.getElementById("ghPat");
const patSaveBtn   = document.getElementById("patSaveBtn");

ghPatInput.value = localStorage.getItem(PAT_KEY) || "";

patToggleBtn.addEventListener("click", () => {
  patPanel.style.display = patPanel.style.display === "none" ? "flex" : "none";
});

patSaveBtn.addEventListener("click", () => {
  const val = ghPatInput.value.trim();
  if (val) {
    localStorage.setItem(PAT_KEY, val);
    setPollStatus("PAT 已保存", "ok");
    patPanel.style.display = "none";
  }
});

// 触发 workflow_dispatch
document.getElementById("pollNowBtn").addEventListener("click", async () => {
  const pat = localStorage.getItem(PAT_KEY);
  if (!pat) {
    patPanel.style.display = "flex";
    setPollStatus("请先填写并保存 GitHub PAT（点击 ⚙ 设置）", "err");
    return;
  }

  const btn = document.getElementById("pollNowBtn");
  btn.disabled = true;
  setPollStatus("正在触发采集…");

  try {
    const resp = await fetch(
      `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${GH_WORKFLOW}/dispatches`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${pat}`,
          "Accept": "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ ref: "main" }),
      }
    );

    if (resp.status === 204) {
      setPollStatus("✓ 已触发，约 2-3 分钟后数据更新…", "ok");
      // 3 分钟后自动刷新数据
      setTimeout(() => { loadData(); setPollStatus(""); }, 3 * 60 * 1000);
    } else {
      const json = await resp.json().catch(() => ({}));
      const msg = json.message || `HTTP ${resp.status}`;
      if (resp.status === 401) {
        setPollStatus(`PAT 无效或已过期，请重新设置（${msg}）`, "err");
        patPanel.style.display = "flex";
      } else {
        setPollStatus(`触发失败：${msg}`, "err");
      }
    }
  } catch (e) {
    setPollStatus(`网络错误：${e.message}`, "err");
  } finally {
    btn.disabled = false;
  }
});
