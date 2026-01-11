const DEFAULT_API_BASE = "https://adikara.online/api/v1";
const DEFAULT_API_TOKEN = "ctfd_827b6a8edfe7faaab222608eae401c8ab0b8854c06f763b19abba3cc290a4813";
const DEFAULT_EVENT_TIMES = {
  start: Date.parse("2026-01-12T08:00:00+07:00"),
  end: Date.parse("2026-01-12T14:00:00+07:00"),
  freeze: Date.parse("2026-01-12T13:00:00+07:00"),
};
const REFRESH_SECONDS = 30;
const FIRST_BLOOD_COOLDOWN_MS = 5000;

const state = {
  apiBase: DEFAULT_API_BASE,
  apiToken: DEFAULT_API_TOKEN,
  scoreboard: [],
  awards: [],
  notifications: [],
  distribution: [],
  seenAwards: new Set(),
  lastUpdated: null,
  demoMode: false,
  eventTimes: {
    start: DEFAULT_EVENT_TIMES.start,
    end: DEFAULT_EVENT_TIMES.end,
    freeze: DEFAULT_EVENT_TIMES.freeze,
  },
  freezeActive: false,
  lastFirstBloodTs: 0,
  lastPopupAt: 0,
};

const elements = {
  statusDot: document.getElementById("status-dot"),
  statusText: document.getElementById("status-text"),
  lastUpdate: document.getElementById("last-update"),
  refreshTimer: document.getElementById("refresh-timer"),
  refreshBtn: document.getElementById("refresh-btn"),
  demoBtn: document.getElementById("demo-btn"),
  toggleMode: document.getElementById("toggle-mode"),
  fullscreenBtn: document.getElementById("fullscreen-btn"),
  apiBase: document.getElementById("api-base"),
  apiToken: document.getElementById("api-token"),
  saveApi: document.getElementById("save-api"),
  podium: document.getElementById("podium"),
  scoreboardBody: document.getElementById("scoreboard-body"),
  scoreboardFoot: document.getElementById("scoreboard-foot"),
  scoreboardTable: document.getElementById("scoreboard-table"),
  statTeams: document.getElementById("stat-teams"),
  statTopScore: document.getElementById("stat-top-score"),
  statTopTeam: document.getElementById("stat-top-team"),
  statTotal: document.getElementById("stat-total"),
  search: document.getElementById("search"),
  limitSelect: document.getElementById("limit-select"),
  firstBloodList: document.getElementById("first-blood-list"),
  activityList: document.getElementById("activity-list"),
  distribution: document.getElementById("score-distribution"),
  firstBloodOverlay: document.getElementById("first-blood-overlay"),
  firstBloodTitle: document.getElementById("first-blood-title"),
  firstBloodDesc: document.getElementById("first-blood-desc"),
  firstBloodMeta: document.getElementById("first-blood-meta"),
  firstBloodAudio: document.getElementById("first-blood-audio"),
  eventLabel: document.getElementById("event-label"),
  eventCountdown: document.getElementById("event-countdown"),
  eventFreeze: document.getElementById("event-freeze"),
};

function sanitizeBaseUrl(input) {
  if (!input) return DEFAULT_API_BASE;
  let clean = input.trim();
  if (!clean) return DEFAULT_API_BASE;
  if (clean.endsWith("/")) clean = clean.slice(0, -1);
  return clean;
}

function setStatus(text, ok) {
  elements.statusText.textContent = text;
  elements.statusDot.style.background = ok ? "#6EF2C5" : "#F36A6A";
  elements.statusDot.style.boxShadow = ok
    ? "0 0 12px rgba(110, 242, 197, 0.6)"
    : "0 0 12px rgba(243, 106, 106, 0.6)";
}

function buildAuthHeader(token) {
  if (!token) return null;
  if (/^(Token|Bearer)\\s/i.test(token)) return token;
  return `Token ${token}`;
}

async function fetchJson(path) {
  const url = `${state.apiBase}${path}`;
  const headers = {
    Accept: "application/json",
  };
  const auth = buildAuthHeader(state.apiToken);
  if (auth) {
    headers.Authorization = auth;
  }
  const response = await fetch(url, {
    headers,
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

function extractArray(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.scoreboard)) return payload.scoreboard;
  if (Array.isArray(payload.results)) return payload.results;
  return [];
}

function extractConfigValue(payload) {
  if (!payload) return null;
  if (payload.data && typeof payload.data === "object") {
    return payload.data.value ?? payload.data;
  }
  if (typeof payload.value !== "undefined") return payload.value;
  return null;
}

function findConfigValue(list, keys) {
  for (const key of keys) {
    const match = list.find((item) => item.key === key);
    if (match && typeof match.value !== "undefined") return match.value;
  }
  return null;
}

function parseTimeValue(value) {
  if (value === null || typeof value === "undefined") return null;
  if (typeof value === "number") return value;
  const text = String(value).trim();
  if (!text) return null;
  if (/^\\d+$/.test(text)) {
    const num = Number(text);
    if (text.length <= 10) return num * 1000;
    return num;
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date.getTime();
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value) => String(value).padStart(2, "0");
  if (days > 0) {
    return `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function isFrozenNow() {
  const freeze = state.eventTimes.freeze;
  if (!freeze) return false;
  return Date.now() >= freeze;
}

function updateEventCountdown() {
  if (!elements.eventCountdown || !elements.eventLabel) return;
  const { start, end, freeze } = state.eventTimes;
  if (!start && !end) {
    elements.eventLabel.textContent = "Event";
    elements.eventCountdown.textContent = "--:--:--";
    if (elements.eventFreeze) elements.eventFreeze.textContent = "";
    return;
  }
  const now = Date.now();
  if (start && now < start) {
    elements.eventLabel.textContent = "Starts In";
    elements.eventCountdown.textContent = formatDuration(start - now);
  } else if (end && now < end) {
    elements.eventLabel.textContent = "Ends In";
    elements.eventCountdown.textContent = formatDuration(end - now);
  } else if (end && now >= end) {
    elements.eventLabel.textContent = "Ended";
    elements.eventCountdown.textContent = "00:00:00";
  } else {
    elements.eventLabel.textContent = "Live";
    elements.eventCountdown.textContent = "--:--:--";
  }

  if (!elements.eventFreeze) return;
  if (!freeze) {
    elements.eventFreeze.textContent = "";
    elements.eventFreeze.classList.remove("is-frozen");
    return;
  }
  if (now < freeze) {
    elements.eventFreeze.textContent = `Freeze In ${formatDuration(freeze - now)}`;
    elements.eventFreeze.classList.remove("is-frozen");
    return;
  }
  elements.eventFreeze.textContent = "Scoreboard Frozen";
  elements.eventFreeze.classList.add("is-frozen");
}

async function loadEventTimes() {
  let startValue = null;
  let endValue = null;
  let freezeValue = null;
  const configs = await fetchJson("/configs").catch(() => null);
  if (configs) {
    const list = extractArray(configs);
    startValue = findConfigValue(list, ["start", "ctf_start", "start_time", "event_start"]);
    endValue = findConfigValue(list, ["end", "ctf_end", "end_time", "event_end"]);
    freezeValue = findConfigValue(list, ["freeze", "freeze_time", "scoreboard_freeze"]);
  }
  if (!startValue) {
    const payload = await fetchJson("/configs/start").catch(() => null);
    startValue = extractConfigValue(payload);
  }
  if (!endValue) {
    const payload = await fetchJson("/configs/end").catch(() => null);
    endValue = extractConfigValue(payload);
  }
  if (!freezeValue) {
    const payload = await fetchJson("/configs/freeze").catch(() => null);
    freezeValue = extractConfigValue(payload);
  }

  state.eventTimes = {
    start: parseTimeValue(startValue) ?? DEFAULT_EVENT_TIMES.start,
    end: parseTimeValue(endValue) ?? DEFAULT_EVENT_TIMES.end,
    freeze: parseTimeValue(freezeValue) ?? DEFAULT_EVENT_TIMES.freeze,
  };
  updateEventCountdown();
  return state.eventTimes;
}

let demoTick = 0;

function seededRandom(seed) {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => (value = (value * 16807) % 2147483647) / 2147483647;
}

function buildDemoData() {
  demoTick += 1;
  const rng = seededRandom(5321 + demoTick * 7);
  const count = 42;
  const now = Date.now();
  const participants = Array.from({ length: count }, (_, i) => {
    const base = (count - i) * 120;
    const score = Math.max(0, Math.round(base + rng() * 90));
    const lastSolve = new Date(now - rng() * 1000 * 60 * 90).toISOString();
    return {
      id: i + 1,
      name: `Participant ${String(i + 1).padStart(2, "0")}`,
      score,
      rank: i + 1,
      lastSolve,
    };
  }).sort((a, b) => b.score - a.score);

  participants.forEach((entry, index) => {
    entry.rank = index + 1;
  });

  const awards = [
    {
      id: 101 + demoTick,
      name: "First Blood: Crypto 1",
      description: `${participants[0].name} cracked the first flag`,
      value: 150,
      date: new Date(now - 1000 * 60 * 8).toISOString(),
      type: "first_blood",
    },
    {
      id: 102 + demoTick,
      name: "First Blood: Web 1",
      description: `${participants[1].name} claimed early web solve`,
      value: 120,
      date: new Date(now - 1000 * 60 * 18).toISOString(),
      type: "first_blood",
    },
    {
      id: 103 + demoTick,
      name: "First Blood: Forensics 1",
      description: `${participants[2].name} got first forensic proof`,
      value: 140,
      date: new Date(now - 1000 * 60 * 28).toISOString(),
      type: "first_blood",
    },
  ];

  const notifications = [
    {
      id: 301 + demoTick,
      title: "Speed Solve",
      content: `${participants[3].name} solved Rev 2`,
      date: new Date(now - 1000 * 60 * 4).toISOString(),
    },
    {
      id: 302 + demoTick,
      title: "New Leader",
      content: `${participants[0].name} takes the lead`,
      date: new Date(now - 1000 * 60 * 12).toISOString(),
    },
    {
      id: 303 + demoTick,
      title: "Steady Climb",
      content: `${participants[6].name} jumps +3 ranks`,
      date: new Date(now - 1000 * 60 * 20).toISOString(),
    },
  ];

  const maxScore = Math.max(...participants.map((entry) => entry.score), 1);
  const buckets = 8;
  const step = Math.ceil(maxScore / buckets) || 1;
  const counts = Array.from({ length: buckets }, () => 0);
  participants.forEach((entry) => {
    const bucket = Math.min(buckets - 1, Math.floor(entry.score / step));
    counts[bucket] += 1;
  });
  const distribution = counts.map((count, index) => ({
    score: index * step,
    count,
  }));

  const eventTimes = {
    start: now - 1000 * 60 * 15,
    freeze: now + 1000 * 60 * 30,
    end: now + 1000 * 60 * 60 * 2,
  };

  return { participants, awards, notifications, distribution, eventTimes };
}

function setDemoMode(enabled) {
  state.demoMode = enabled;
  localStorage.setItem("demoMode", String(enabled));
  elements.demoBtn.classList.toggle("active", enabled);
  elements.demoBtn.textContent = enabled ? "Demo Data: On" : "Demo Data";
  if (!enabled) {
    showWaitingState("Waiting for API...");
  }
  state.lastFirstBloodTs = 0;
  state.lastPopupAt = 0;
  refreshAll();
}

function initDemoMode() {
  state.demoMode = localStorage.getItem("demoMode") === "true";
  elements.demoBtn.classList.toggle("active", state.demoMode);
  elements.demoBtn.textContent = state.demoMode ? "Demo Data: On" : "Demo Data";
}

function normalizeScoreboard(list) {
  return list.map((entry, index) => {
    const name =
      entry.name ||
      entry.team ||
      entry.account_name ||
      entry.team_name ||
      entry.user ||
      entry.username ||
      "Unknown";
    const score =
      entry.score ||
      entry.points ||
      entry.value ||
      entry.total ||
      entry.place_score ||
      0;
    const rank = entry.pos || entry.rank || entry.place || index + 1;
    const lastSolve =
      entry.last_solve || entry.lastSolve || entry.date || entry.last_solve_time || null;
    return {
      id: entry.account_id || entry.team_id || entry.user_id || entry.id || index,
      name,
      score: Number(score) || 0,
      rank: Number(rank) || index + 1,
      lastSolve,
    };
  });
}

function formatScore(value) {
  if (typeof value !== "number") return "0";
  return value.toLocaleString("en-US");
}

function formatDateTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
  });
}

function timeAgo(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  const diff = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function renderPodium(entries) {
  elements.podium.innerHTML = "";
  if (!entries.length) {
    elements.podium.innerHTML = "<p class=\"panel-foot\">No data yet.</p>";
    return;
  }

  const top = [...entries].sort((a, b) => b.score - a.score).slice(0, 3);

  top.forEach((entry, index) => {
    const card = document.createElement("div");
    card.className = "podium-card";
    card.innerHTML = `
      <div class="podium-rank">Rank ${index + 1}</div>
      <h3 class="podium-team">${entry.name}</h3>
      <p class="podium-score">${formatScore(entry.score)}</p>
      <div class="highlight-meta">Last solve ${formatDateTime(entry.lastSolve)}</div>
    `;
    elements.podium.appendChild(card);
  });
}

function renderScoreboard(entries) {
  const searchValue = elements.search.value.trim().toLowerCase();
  const limitValue = Number(elements.limitSelect.value);

  let filtered = entries;
  if (searchValue) {
    filtered = filtered.filter((entry) => entry.name.toLowerCase().includes(searchValue));
  }

  const sorted = [...filtered].sort((a, b) => b.score - a.score);
  const limited = limitValue > 0 ? sorted.slice(0, limitValue) : sorted;

  elements.scoreboardBody.innerHTML = "";

  if (!limited.length) {
    const row = document.createElement("tr");
    row.innerHTML = "<td colspan=\"4\">No participants yet.</td>";
    elements.scoreboardBody.appendChild(row);
    elements.scoreboardFoot.textContent = "No participants yet.";
    return;
  }

  if (elements.scoreboardTable) {
    elements.scoreboardTable.scrollTop = 0;
  }

  limited.forEach((entry, index) => {
    const row = document.createElement("tr");
    if (index === 0) row.classList.add("top-1");
    if (index === 1) row.classList.add("top-2");
    if (index === 2) row.classList.add("top-3");
    row.innerHTML = `
      <td><span class="rank-badge">${index + 1}</span></td>
      <td>${entry.name}</td>
      <td>${formatScore(entry.score)}</td>
      <td>${formatDateTime(entry.lastSolve)}</td>
    `;
    elements.scoreboardBody.appendChild(row);
  });

  elements.scoreboardFoot.textContent = `Showing ${limited.length} of ${entries.length} participants.`;
}

function renderStats(entries) {
  const totalTeams = entries.length;
  const totalPoints = entries.reduce((sum, entry) => sum + entry.score, 0);
  const top = [...entries].sort((a, b) => b.score - a.score)[0];

  elements.statTeams.textContent = totalTeams.toLocaleString("en-US");
  elements.statTotal.textContent = formatScore(totalPoints);
  if (top) {
    elements.statTopScore.textContent = formatScore(top.score);
    elements.statTopTeam.textContent = top.name;
  } else {
    elements.statTopScore.textContent = "0";
    elements.statTopTeam.textContent = "--";
  }
}

function renderAwards(awards) {
  elements.firstBloodList.innerHTML = "";
  const firstBlood = awards
    .filter((award) => {
      const text = `${award.name || ""} ${award.description || ""} ${award.type || ""}`;
      return /first|blood/i.test(text);
    })
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  if (!firstBlood.length) {
    elements.firstBloodList.innerHTML = "<p class=\"panel-foot\">First blood belum muncul.</p>";
    return;
  }

  maybeTriggerFirstBloodPopup(firstBlood[0]);

  firstBlood.slice(0, 6).forEach((award) => {
    const key = `${award.id}-${award.date || ""}`;
    const item = document.createElement("div");
    item.className = "highlight-item";
    if (!state.seenAwards.has(key)) {
      item.classList.add("is-new");
      state.seenAwards.add(key);
    }

    item.innerHTML = `
      <div class="highlight-title">${award.name || "First Blood"}</div>
      <div>${award.description || "Highlight unlocked"}</div>
      <div class="highlight-meta">${timeAgo(award.date)} | +${award.value || 0} pts</div>
    `;
    elements.firstBloodList.appendChild(item);
  });
}

function renderActivity(notifications) {
  elements.activityList.innerHTML = "";
  const items = [...notifications]
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    .slice(0, 6);
  if (!items.length) {
    elements.activityList.innerHTML = "<p class=\"panel-foot\">No activity yet.</p>";
    return;
  }

  items.forEach((note) => {
    const item = document.createElement("div");
    item.className = "highlight-item";
    item.innerHTML = `
      <div class="highlight-title">${note.title || "Update"}</div>
      <div>${note.content || "--"}</div>
      <div class="highlight-meta">${timeAgo(note.date)}</div>
    `;
    elements.activityList.appendChild(item);
  });
}

function normalizeDistribution(payload) {
  if (!payload) return [];
  const raw = payload.data || payload;
  if (Array.isArray(raw)) {
    return raw.map((entry) => ({
      score: entry.score || entry.value || entry.label || "0",
      count: entry.count || entry.total || entry.value || 0,
    })).sort((a, b) => Number(a.score) - Number(b.score));
  }
  if (typeof raw === "object") {
    return Object.entries(raw).map(([score, count]) => ({
      score,
      count: Number(count) || 0,
    })).sort((a, b) => Number(a.score) - Number(b.score));
  }
  return [];
}

function renderDistribution(list) {
  elements.distribution.innerHTML = "";
  if (!list.length) {
    elements.distribution.innerHTML = "<p class=\"panel-foot\">No data yet.</p>";
    return;
  }

  const max = Math.max(...list.map((item) => item.count));
  list.slice(0, 8).forEach((item) => {
    const row = document.createElement("div");
    row.className = "chart-row";
    const width = max > 0 ? Math.round((item.count / max) * 100) : 0;
    row.innerHTML = `
      <span>${item.score}</span>
      <div class="chart-bar" style="width: ${width}%"></div>
      <span>${item.count}</span>
    `;
    elements.distribution.appendChild(row);
  });
}

function showWaitingState(message) {
  const text = message || "Waiting for API...";
  state.scoreboard = [];
  state.awards = [];
  state.notifications = [];
  state.distribution = [];
  state.seenAwards = new Set();
  state.lastUpdated = null;
  state.lastFirstBloodTs = 0;
  state.lastPopupAt = 0;

  if (elements.scoreboardBody) {
    elements.scoreboardBody.innerHTML = `<tr><td colspan="4">${text}</td></tr>`;
  }
  if (elements.scoreboardFoot) {
    elements.scoreboardFoot.textContent = text;
  }
  if (elements.podium) {
    elements.podium.innerHTML = `<p class="panel-foot">${text}</p>`;
  }
  if (elements.firstBloodList) {
    elements.firstBloodList.innerHTML = `<p class="panel-foot">${text}</p>`;
  }
  if (elements.activityList) {
    elements.activityList.innerHTML = `<p class="panel-foot">${text}</p>`;
  }
  if (elements.distribution) {
    elements.distribution.innerHTML = `<p class="panel-foot">${text}</p>`;
  }
  if (elements.statTeams) elements.statTeams.textContent = "0";
  if (elements.statTopScore) elements.statTopScore.textContent = "0";
  if (elements.statTopTeam) elements.statTopTeam.textContent = "--";
  if (elements.statTotal) elements.statTotal.textContent = "0";
  if (elements.lastUpdate) elements.lastUpdate.textContent = "--:--";

  hideFirstBloodOverlay();
}

function updateLastUpdated() {
  if (!state.lastUpdated) return;
  elements.lastUpdate.textContent = state.lastUpdated.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function loadScoreboard() {
  try {
    const data = await fetchJson("/scoreboard");
    return extractArray(data);
  } catch (error) {
    const fallback = await fetchJson("/scoreboard/top/50");
    return extractArray(fallback);
  }
}

async function refreshAll() {
  setStatus("Syncing...", true);
  elements.scoreboardFoot.textContent = "Syncing scoreboard...";

  if (state.demoMode) {
    const demo = buildDemoData();
    if (!state.eventTimes.start) {
      state.eventTimes = demo.eventTimes;
    }
    const freezeNow = isFrozenNow();
    const shouldUpdate = !freezeNow || !state.freezeActive;
    if (shouldUpdate) {
      state.scoreboard = demo.participants;
      state.awards = demo.awards;
      state.notifications = demo.notifications;
      state.distribution = demo.distribution;
      state.lastUpdated = new Date();
      renderPodium(state.scoreboard);
      renderScoreboard(state.scoreboard);
      renderStats(state.scoreboard);
      renderAwards(state.awards);
      renderActivity(state.notifications);
      renderDistribution(state.distribution);
      updateLastUpdated();
    }
    state.freezeActive = freezeNow;
    updateEventCountdown();
    setStatus(freezeNow ? "Demo (Frozen)" : "Demo", true);
    elements.scoreboardFoot.textContent = freezeNow
      ? "Scoreboard frozen."
      : "Demo data loaded.";
    return;
  }

  try {
    const [scoreboardRaw, awardsRaw, notificationsRaw, distributionRaw] = await Promise.all([
      loadScoreboard(),
      fetchJson("/awards").catch(() => null),
      fetchJson("/notifications").catch(() => null),
      fetchJson("/statistics/scores/distribution").catch(() => null),
    ]);

    await loadEventTimes();
    const freezeNow = isFrozenNow();
    const shouldUpdate = !freezeNow || !state.freezeActive;
    if (shouldUpdate) {
      state.scoreboard = normalizeScoreboard(scoreboardRaw);
      state.awards = extractArray(awardsRaw);
      state.notifications = extractArray(notificationsRaw);
      state.distribution = normalizeDistribution(distributionRaw);
      state.lastUpdated = new Date();

      renderPodium(state.scoreboard);
      renderScoreboard(state.scoreboard);
      renderStats(state.scoreboard);
      renderAwards(state.awards);
      renderActivity(state.notifications);
      renderDistribution(state.distribution);
      updateLastUpdated();
    }
    state.freezeActive = freezeNow;
    setStatus(freezeNow ? "Frozen" : "Live", true);
    elements.scoreboardFoot.textContent = freezeNow
      ? "Scoreboard frozen."
      : "Live data loaded.";
  } catch (error) {
    updateEventCountdown();
    setStatus("Offline", false);
    showWaitingState("Waiting for API...");
  }
}

function startRefreshTimer() {
  let remaining = REFRESH_SECONDS;
  elements.refreshTimer.textContent = String(remaining);
  setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      remaining = REFRESH_SECONDS;
      refreshAll();
    }
    elements.refreshTimer.textContent = String(remaining);
  }, 1000);
}

function initApiBase() {
  const stored = localStorage.getItem("apiBase");
  const storedToken = localStorage.getItem("apiToken");
  const urlParam = new URLSearchParams(window.location.search).get("api");
  const urlToken = new URLSearchParams(window.location.search).get("token");
  state.apiBase = sanitizeBaseUrl(urlParam || stored || DEFAULT_API_BASE);
  elements.apiBase.value = state.apiBase;
  state.apiToken = (urlToken || storedToken || DEFAULT_API_TOKEN || "").trim();
  if (state.apiToken) {
    elements.apiToken.value = state.apiToken;
  }
}

function bindEvents() {
  elements.refreshBtn.addEventListener("click", () => refreshAll());
  elements.demoBtn.addEventListener("click", () => setDemoMode(!state.demoMode));
  elements.saveApi.addEventListener("click", () => {
    state.apiBase = sanitizeBaseUrl(elements.apiBase.value);
    state.apiToken = elements.apiToken.value.trim();
    localStorage.setItem("apiBase", state.apiBase);
    if (state.apiToken) {
      localStorage.setItem("apiToken", state.apiToken);
    } else {
      localStorage.removeItem("apiToken");
    }
    refreshAll();
  });
  elements.toggleMode.addEventListener("click", () => toggleDisplayMode());
  elements.fullscreenBtn.addEventListener("click", () => requestFullscreen());
  elements.firstBloodOverlay.addEventListener("click", () => hideFirstBloodOverlay());
  elements.search.addEventListener("input", () => renderScoreboard(state.scoreboard));
  elements.limitSelect.addEventListener("change", () => renderScoreboard(state.scoreboard));
}

function applyDisplayMode(mode) {
  const clean = mode === "dashboard" ? "dashboard" : "broadcast";
  document.body.classList.toggle("broadcast", clean === "broadcast");
  elements.toggleMode.textContent =
    clean === "broadcast" ? "Switch to Dashboard" : "Switch to Broadcast";
  localStorage.setItem("displayMode", clean);
  startAutoScroll();
  if (clean !== "broadcast") {
    hideFirstBloodOverlay();
  } else {
    showNextFirstBlood();
  }
}

function toggleDisplayMode() {
  const current = document.body.classList.contains("broadcast") ? "broadcast" : "dashboard";
  applyDisplayMode(current === "broadcast" ? "dashboard" : "broadcast");
}

function requestFullscreen() {
  if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
    return;
  }
  if (document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
}

let autoScrollTimer = null;
let popupTimer = null;
let popupActive = false;
const popupQueue = [];

function startAutoScroll() {
  if (autoScrollTimer) {
    clearInterval(autoScrollTimer);
    autoScrollTimer = null;
  }
  if (!document.body.classList.contains("broadcast")) return;
  if (!elements.scoreboardTable) return;

  let direction = 1;
  autoScrollTimer = setInterval(() => {
    const wrapper = elements.scoreboardTable;
    if (wrapper.scrollHeight <= wrapper.clientHeight) return;
    wrapper.scrollTop += direction;
    if (wrapper.scrollTop + wrapper.clientHeight >= wrapper.scrollHeight) {
      direction = -1;
    } else if (wrapper.scrollTop <= 0) {
      direction = 1;
    }
  }, 45);
}

function enqueueFirstBlood(award) {
  if (!award) return;
  popupQueue.push(award);
  showNextFirstBlood();
}

function maybeTriggerFirstBloodPopup(award) {
  if (!award) return;
  if (!document.body.classList.contains("broadcast")) return;
  const ts = new Date(award.date || 0).getTime();
  if (Number.isNaN(ts)) return;
  if (ts <= state.lastFirstBloodTs) return;
  const now = Date.now();
  if (now - state.lastPopupAt < FIRST_BLOOD_COOLDOWN_MS) {
    state.lastFirstBloodTs = ts;
    return;
  }
  state.lastFirstBloodTs = ts;
  state.lastPopupAt = now;
  enqueueFirstBlood(award);
}

function hideFirstBloodOverlay() {
  if (!elements.firstBloodOverlay) return;
  elements.firstBloodOverlay.classList.remove("active");
}

function showNextFirstBlood() {
  if (!document.body.classList.contains("broadcast")) return;
  if (popupActive) return;
  const next = popupQueue.shift();
  if (!next) return;

  popupActive = true;
  elements.firstBloodTitle.textContent = next.name || "First Blood!";
  elements.firstBloodDesc.textContent = next.description || "";
  elements.firstBloodMeta.textContent = `+${next.value || 0} pts • ${formatDateTime(next.date)}`;
  elements.firstBloodOverlay.classList.add("active");
  if (elements.firstBloodAudio) {
    elements.firstBloodAudio.currentTime = 0;
    elements.firstBloodAudio.play().catch(() => {});
  }

  clearTimeout(popupTimer);
  popupTimer = setTimeout(() => {
    elements.firstBloodOverlay.classList.remove("active");
    popupTimer = setTimeout(() => {
      popupActive = false;
      showNextFirstBlood();
    }, 600);
  }, 4200);
}

initApiBase();
applyDisplayMode(localStorage.getItem("displayMode") || "broadcast");
initDemoMode();
bindEvents();
refreshAll();
startRefreshTimer();
setInterval(updateEventCountdown, 1000);
