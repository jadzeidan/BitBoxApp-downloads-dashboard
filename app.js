const REPO_OWNER = "BitBoxSwiss";
const REPO_NAME = "bitbox-wallet-app";
const API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases?per_page=100&page=`;

const PLATFORM_CONFIG = [
  { key: "Windows", color: "#2563eb" },
  { key: "macOS", color: "#ea580c" },
  { key: "Linux", color: "#0f766e" },
  { key: "Android APK", color: "#65a30d" },
];

const elements = {
  statsGrid: document.querySelector("#statsGrid"),
  groupsGrid: document.querySelector("#groupsGrid"),
  platformBarChart: document.querySelector("#platformBarChart"),
  osChart: document.querySelector("#osChart"),
  versionChart: document.querySelector("#versionChart"),
  startDate: document.querySelector("#startDate"),
  endDate: document.querySelector("#endDate"),
  presetRow: document.querySelector("#presetRow"),
  rangeNote: document.querySelector("#rangeNote"),
  releaseCount: document.querySelector("#releaseCount"),
  emptyStateTemplate: document.querySelector("#emptyStateTemplate"),
};

const state = {
  entries: [],
  bounds: null,
  preset: "all",
  hiddenSeries: {
    os: new Set(),
    version: new Set(),
  },
};

initialize();

async function initialize() {
  renderLoadingState();

  try {
    const releases = await fetchAllReleases();
    const entries = releases.flatMap(mapReleaseToEntries).sort((a, b) => {
      return new Date(a.publishedAt) - new Date(b.publishedAt);
    });

    if (!entries.length) {
      throw new Error("No matching BitBoxApp release assets were found.");
    }

    state.entries = entries;
    state.bounds = getDateBounds(entries);

    setupControls();
    applyPreset("all");
  } catch (error) {
    renderErrorState(error);
  }
}

async function fetchAllReleases() {
  const releases = [];

  for (let page = 1; page <= 10; page += 1) {
    const response = await fetch(`${API_URL}${page}`, {
      headers: {
        Accept: "application/vnd.github+json",
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API request failed with status ${response.status}.`);
    }

    const batch = await response.json();
    releases.push(...batch.filter((release) => !release.draft && !release.prerelease));

    if (batch.length < 100) {
      break;
    }
  }

  return releases;
}

function mapReleaseToEntries(release) {
  return release.assets
    .map((asset) => {
      const platform = classifyAsset(asset.name);
      if (!platform) {
        return null;
      }

      return {
        id: asset.id,
        name: asset.name,
        version: normalizeVersion(release.tag_name),
        platform,
        downloads: asset.download_count,
        url: asset.browser_download_url,
        publishedAt: release.published_at,
        releaseName: release.name || release.tag_name,
      };
    })
    .filter(Boolean);
}

function classifyAsset(name) {
  const lowerName = name.toLowerCase();

  if (
    lowerName.endsWith(".asc") ||
    lowerName.includes("sha256") ||
    lowerName.includes("checksum") ||
    lowerName.endsWith(".sig") ||
    lowerName.endsWith(".txt")
  ) {
    return null;
  }

  if (lowerName.endsWith(".apk")) {
    return "Android APK";
  }

  if (lowerName.endsWith(".exe") || lowerName.endsWith(".msi")) {
    return "Windows";
  }

  if (lowerName.endsWith(".dmg") || lowerName.endsWith("-macos.zip")) {
    return "macOS";
  }

  if (
    lowerName.endsWith(".appimage") ||
    lowerName.endsWith(".deb") ||
    lowerName.endsWith(".rpm") ||
    lowerName.endsWith(".tar.gz")
  ) {
    return "Linux";
  }

  return null;
}

function normalizeVersion(tagName) {
  return tagName.replace(/^v/i, "");
}

function getDateBounds(entries) {
  const timestamps = entries.map((entry) => new Date(entry.publishedAt).getTime());
  return {
    start: new Date(Math.min(...timestamps)),
    end: new Date(),
  };
}

function setupControls() {
  elements.startDate.min = formatInputDate(state.bounds.start);
  elements.startDate.max = formatInputDate(state.bounds.end);
  elements.endDate.min = formatInputDate(state.bounds.start);
  elements.endDate.max = formatInputDate(state.bounds.end);

  elements.startDate.addEventListener("input", () => {
    state.preset = "custom";
    syncPresetButtons();
    render();
  });

  elements.endDate.addEventListener("input", () => {
    state.preset = "custom";
    syncPresetButtons();
    render();
  });

  elements.presetRow.addEventListener("click", (event) => {
    const button = event.target.closest("[data-preset]");
    if (!button) {
      return;
    }

    applyPreset(button.dataset.preset);
  });
}

function applyPreset(preset) {
  state.preset = preset;

  const end = new Date(state.bounds.end);
  let start = new Date(state.bounds.start);

  if (preset !== "all") {
    const days = Number.parseInt(preset, 10);
    start = new Date(end);
    start.setDate(end.getDate() - days);

    if (start < state.bounds.start) {
      start = new Date(state.bounds.start);
    }
  }

  elements.startDate.value = formatInputDate(start);
  elements.endDate.value = formatInputDate(end);
  syncPresetButtons();
  render();
}

function syncPresetButtons() {
  elements.presetRow.querySelectorAll("[data-preset]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.preset === state.preset);
  });
}

function render() {
  const range = getSelectedRange();
  const filteredEntries = state.entries.filter((entry) => isEntryInRange(entry, range));
  const byPlatform = groupByPlatform(filteredEntries);
  const versionSeries = buildVersionSeries(filteredEntries);
  pruneHiddenSeries("os", byPlatform.map((group) => group.platform));
  pruneHiddenSeries("version", versionSeries.map((series) => series.label));

  elements.rangeNote.textContent = `Showing release assets published between ${formatLongDate(range.start)} and ${formatLongDate(range.end)}. Default start date is ${formatLongDate(state.bounds.start)}.`;
  elements.releaseCount.textContent = `${filteredEntries.length} installer assets across ${versionSeries.length} app version${versionSeries.length === 1 ? "" : "s"}.`;

  renderStats(byPlatform, filteredEntries);
  renderGroups(byPlatform);
  renderPlatformBarChart(elements.platformBarChart, byPlatform);
  renderLineChart(elements.osChart, buildPlatformSeries(byPlatform), {
    chartKey: "os",
    multiSeries: true,
    emptyMessage: "No platform downloads in this timeframe.",
  });
  renderLineChart(elements.versionChart, versionSeries, {
    chartKey: "version",
    multiSeries: true,
    emptyMessage: "No version data in this timeframe.",
    valueFormatter: (point, seriesLabel) => `${seriesLabel}: ${formatNumber(point.value)} downloads`,
    pointShapeAccessor: (point) => point.platformShape,
  });
}

function getSelectedRange() {
  const start = clampDate(new Date(elements.startDate.value), state.bounds.start, state.bounds.end);
  const end = clampDate(new Date(elements.endDate.value), state.bounds.start, state.bounds.end);

  if (start > end) {
    elements.endDate.value = formatInputDate(start);
    return { start, end: start };
  }

  return { start, end };
}

function clampDate(date, min, max) {
  if (Number.isNaN(date.getTime())) {
    return new Date(min);
  }
  if (date < min) {
    return new Date(min);
  }
  if (date > max) {
    return new Date(max);
  }
  return date;
}

function isEntryInRange(entry, range) {
  const published = new Date(entry.publishedAt);
  const normalizedStart = startOfDay(range.start);
  const normalizedEnd = endOfDay(range.end);
  return published >= normalizedStart && published <= normalizedEnd;
}

function groupByPlatform(entries) {
  return PLATFORM_CONFIG.map(({ key, color }) => {
    const items = entries
      .filter((entry) => entry.platform === key)
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    return {
      platform: key,
      color,
      items,
      totalDownloads: items.reduce((sum, item) => sum + item.downloads, 0),
    };
  });
}

function buildPlatformSeries(groups) {
  return groups.map((group) => ({
    label: group.platform,
    color: group.color,
    points: group.items
      .slice()
      .sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt))
      .map((item) => ({
        x: new Date(item.publishedAt),
        y: item.downloads,
        value: item.downloads,
        label: `${group.platform} ${item.version}`,
      })),
  }));
}

function buildVersionSeries(entries) {
  const versionMap = new Map();

  entries.forEach((entry) => {
    if (!versionMap.has(entry.version)) {
      versionMap.set(entry.version, {
        label: entry.version,
        points: [],
        totalDownloads: 0,
      });
    }

    const series = versionMap.get(entry.version);
    series.totalDownloads += entry.downloads;
    series.points.push({
      x: new Date(entry.publishedAt),
      y: entry.downloads,
      value: entry.downloads,
      label: entry.name,
      platformShape: shapeForEntry(entry),
    });
  });

  return [...versionMap.values()]
    .sort((a, b) => {
      const aDate = Math.min(...a.points.map((point) => point.x.getTime()));
      const bDate = Math.min(...b.points.map((point) => point.x.getTime()));
      return aDate - bDate;
    })
    .map((series, index) => ({
      label: series.label,
      color: colorForIndex(index),
      points: series.points.sort((a, b) => a.x - b.x),
      totalDownloads: series.totalDownloads,
    }));
}

function renderStats(groups, entries) {
  const totalDownloads = entries.reduce((sum, entry) => sum + entry.downloads, 0);
  const totals = [
    ...groups,
    {
      platform: "Total",
      color: "#1f2933",
      totalDownloads,
      items: entries,
    },
  ];

  elements.statsGrid.innerHTML = totals
    .map(
      (group) => `
        <article class="stat-card" style="--accent: ${group.color}">
          <p class="group-label">${group.platform}</p>
          <h2>${group.platform === "Total" ? "All matching installers" : "Installer downloads"}</h2>
          <div class="stat-total">${formatNumber(group.totalDownloads)}</div>
          <p class="group-meta">${group.items.length} asset${group.items.length === 1 ? "" : "s"} in range</p>
        </article>
      `,
    )
    .join("");
}

function renderGroups(groups) {
  elements.groupsGrid.innerHTML = groups
    .map((group) => {
      const content = group.items.length
        ? `
          <div class="release-list">
            ${group.items
              .map(
                (item) => `
                  <article class="release-item">
                    <div>
                      <p class="release-title">
                        <a href="${item.url}" target="_blank" rel="noreferrer">${item.version}</a>
                      </p>
                      <div class="release-meta">${item.name}</div>
                      <div class="release-date">${formatLongDate(item.publishedAt)}</div>
                    </div>
                    <div class="release-downloads">${formatNumber(item.downloads)}</div>
                  </article>
                `,
              )
              .join("")}
          </div>
        `
        : elements.emptyStateTemplate.innerHTML;

      return `
        <section class="group-card">
          <p class="group-label">${group.platform}</p>
          <h3>${formatNumber(group.totalDownloads)} downloads</h3>
          <p class="group-meta">${group.items.length} installer asset${group.items.length === 1 ? "" : "s"} shown</p>
          ${content}
        </section>
      `;
    })
    .join("");
}

function renderLineChart(container, series, options) {
  const hidden = state.hiddenSeries[options.chartKey] || new Set();
  const visibleSeries = series.filter((entry) => entry.points.length && !hidden.has(entry.label));

  if (!visibleSeries.length) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>${options.emptyMessage}</h3>
        <p>Choose a wider timeframe to bring more release data into view.</p>
      </div>
    `;
    return;
  }

  const width = 760;
  const height = 320;
  const margin = { top: 18, right: 18, bottom: 44, left: 58 };
  const allPoints = visibleSeries.flatMap((entry) => entry.points);
  const xValues = allPoints.map((point) => point.x.getTime());
  const yMax = Math.max(...allPoints.map((point) => point.y), 0);
  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const tickCount = 4;

  const xScale = (value) => {
    if (xMin === xMax) {
      return margin.left + chartWidth / 2;
    }
    return margin.left + ((value - xMin) / (xMax - xMin)) * chartWidth;
  };

  const yScale = (value) => margin.top + chartHeight - (value / (yMax || 1)) * chartHeight;

  const yTicks = Array.from({ length: tickCount + 1 }, (_, index) => {
    return Math.round((yMax / tickCount) * index);
  }).reverse();

  const lines = visibleSeries
    .map((entry) => {
      const path = entry.points
        .map((point, index) => {
          const command = index === 0 ? "M" : "L";
          return `${command}${xScale(point.x.getTime()).toFixed(2)},${yScale(point.y).toFixed(2)}`;
        })
        .join(" ");

      const circles = entry.points
        .map((point) => {
          const title = options.valueFormatter
            ? options.valueFormatter(point, entry.label)
            : `${entry.label} ${formatLongDate(point.x)}: ${formatNumber(point.value)} downloads`;
          const shape = options.pointShapeAccessor ? options.pointShapeAccessor(point, entry.label) : "circle";

          return `
            ${renderMarkerShape(shape, xScale(point.x.getTime()), yScale(point.y), entry.color, title)}
          `;
        })
        .join("");

      const lonePointSegment =
        entry.points.length === 1
          ? (() => {
              const x = xScale(entry.points[0].x.getTime()).toFixed(2);
              const y = yScale(entry.points[0].y).toFixed(2);
              return `<line x1="${Math.max(margin.left, Number(x) - 10)}" y1="${y}" x2="${Math.min(margin.left + chartWidth, Number(x) + 10)}" y2="${y}" stroke="${entry.color}" stroke-linecap="round" stroke-width="3"></line>`;
            })()
          : "";

      return `
        <path d="${path}" fill="none" stroke="${entry.color}" stroke-linecap="round" stroke-linejoin="round" stroke-width="3"></path>
        ${lonePointSegment}
        ${circles}
      `;
    })
    .join("");

  const xTickLabels = buildDateTicks(xMin, xMax).map((tick) => {
    const x = xScale(tick.getTime()).toFixed(2);
    return `
      <line class="grid-line" x1="${x}" y1="${margin.top}" x2="${x}" y2="${margin.top + chartHeight}"></line>
      <text class="tick-label" x="${x}" y="${height - 16}" text-anchor="middle">${formatShortDate(tick)}</text>
    `;
  });

  const yTickLabels = yTicks.map((tick) => {
    const y = yScale(tick).toFixed(2);
    return `
      <line class="grid-line" x1="${margin.left}" y1="${y}" x2="${margin.left + chartWidth}" y2="${y}"></line>
      <text class="tick-label" x="${margin.left - 10}" y="${Number(y) + 4}" text-anchor="end">${formatCompactNumber(tick)}</text>
    `;
  });

  const legend = series
    .filter((entry) => entry.points.length)
    .map(
      (entry) => `
        <button class="legend-item ${hidden.has(entry.label) ? "is-inactive" : ""}" type="button" data-chart-key="${options.chartKey}" data-series-label="${escapeHtml(entry.label)}" aria-pressed="${hidden.has(entry.label) ? "false" : "true"}">
          <span class="${options.chartKey === "version" ? "legend-shape" : "legend-swatch"}">
            ${
              options.chartKey === "version"
                ? renderLegendShape(dominantShape(entry.points), entry.color)
                : `<span class="legend-swatch" style="background:${entry.color}"></span>`
            }
          </span>
          ${entry.label}
        </button>
      `,
    )
    .join("");

  const shapeKey =
    options.chartKey === "version"
      ? `
        <div class="legend is-key" aria-label="Platform marker key">
          <span class="legend-item"><span class="legend-shape">${renderLegendShape("circle", "#637381")}</span>Windows</span>
          <span class="legend-item"><span class="legend-shape">${renderLegendShape("diamond", "#637381")}</span>macOS</span>
          <span class="legend-item"><span class="legend-shape">${renderLegendShape("triangle", "#637381")}</span>Linux AppImage</span>
          <span class="legend-item"><span class="legend-shape">${renderLegendShape("square", "#637381")}</span>Linux DEB</span>
          <span class="legend-item"><span class="legend-shape">${renderLegendShape("hexagon", "#637381")}</span>Linux RPM</span>
          <span class="legend-item"><span class="legend-shape">${renderLegendShape("cross", "#637381")}</span>Android APK</span>
        </div>
      `
      : "";

  container.innerHTML = `
    <svg class="chart-svg" viewBox="0 0 ${width} ${height}" aria-hidden="true">
      ${yTickLabels.join("")}
      ${xTickLabels.join("")}
      <line class="axis-line" x1="${margin.left}" y1="${margin.top + chartHeight}" x2="${margin.left + chartWidth}" y2="${margin.top + chartHeight}"></line>
      <line class="axis-line" x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + chartHeight}"></line>
      ${lines}
      <text class="axis-label" x="${margin.left}" y="${margin.top - 4}">Downloads</text>
    </svg>
    <div class="legend">${legend}</div>
    ${shapeKey}
  `;

  container.querySelectorAll(".legend-item").forEach((button) => {
    button.addEventListener("click", () => {
      toggleSeries(button.dataset.chartKey, button.dataset.seriesLabel);
    });
  });
}

function renderPlatformBarChart(container, groups) {
  const items = groups.filter((group) => group.totalDownloads > 0);

  if (!items.length) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No platform totals in this timeframe</h3>
        <p>Choose a wider timeframe to bring more release data into view.</p>
      </div>
    `;
    return;
  }

  const width = 760;
  const height = 320;
  const margin = { top: 20, right: 20, bottom: 54, left: 58 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const yMax = Math.max(...items.map((group) => group.totalDownloads), 0);
  const slotWidth = chartWidth / items.length;
  const barWidth = Math.min(92, slotWidth * 0.58);
  const yScale = (value) => margin.top + chartHeight - (value / (yMax || 1)) * chartHeight;
  const yTicks = Array.from({ length: 5 }, (_, index) => Math.round((yMax / 4) * index)).reverse();

  const bars = items
    .map((group, index) => {
      const x = margin.left + slotWidth * index + (slotWidth - barWidth) / 2;
      const y = yScale(group.totalDownloads);
      const barHeight = margin.top + chartHeight - y;

      return `
        <g>
          <rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${barHeight.toFixed(2)}" rx="14" fill="${group.color}"></rect>
          <title>${escapeHtml(`${group.platform}: ${formatNumber(group.totalDownloads)} downloads`)}</title>
          <text class="tick-label" x="${(x + barWidth / 2).toFixed(2)}" y="${(y - 10).toFixed(2)}" text-anchor="middle">${formatCompactNumber(group.totalDownloads)}</text>
          <text class="tick-label" x="${(x + barWidth / 2).toFixed(2)}" y="${height - 18}" text-anchor="middle">${escapeHtml(group.platform)}</text>
        </g>
      `;
    })
    .join("");

  const yAxis = yTicks
    .map((tick) => {
      const y = yScale(tick).toFixed(2);
      return `
        <line class="grid-line" x1="${margin.left}" y1="${y}" x2="${margin.left + chartWidth}" y2="${y}"></line>
        <text class="tick-label" x="${margin.left - 10}" y="${Number(y) + 4}" text-anchor="end">${formatCompactNumber(tick)}</text>
      `;
    })
    .join("");

  container.innerHTML = `
    <svg class="chart-svg" viewBox="0 0 ${width} ${height}" aria-hidden="true">
      ${yAxis}
      <line class="axis-line" x1="${margin.left}" y1="${margin.top + chartHeight}" x2="${margin.left + chartWidth}" y2="${margin.top + chartHeight}"></line>
      <line class="axis-line" x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + chartHeight}"></line>
      ${bars}
      <text class="axis-label" x="${margin.left}" y="${margin.top - 4}">Downloads</text>
    </svg>
  `;
}

function buildDateTicks(startMs, endMs) {
  if (startMs === endMs) {
    return [new Date(startMs)];
  }

  const tickCount = 4;
  return Array.from({ length: tickCount + 1 }, (_, index) => {
    const ratio = index / tickCount;
    return new Date(startMs + (endMs - startMs) * ratio);
  });
}

function renderLoadingState() {
  elements.statsGrid.innerHTML = `
    <div class="stat-card">
      <p class="group-label">Loading</p>
      <h2>Fetching GitHub release assets</h2>
      <div class="stat-total">...</div>
      <p class="group-meta">Preparing dashboard data</p>
    </div>
  `;

  elements.platformBarChart.innerHTML = `<div class="loading-state">Loading release download history…</div>`;
  elements.osChart.innerHTML = `<div class="loading-state">Loading release download history…</div>`;
  elements.versionChart.innerHTML = `<div class="loading-state">Loading release download history…</div>`;
  elements.groupsGrid.innerHTML = "";
  elements.rangeNote.textContent = "Connecting to the GitHub releases API.";
  elements.releaseCount.textContent = "";
}

function renderErrorState(error) {
  const message = escapeHtml(error.message || "Something went wrong while loading the dashboard.");
  const errorMarkup = `
    <div class="error-state">
      <h3>Unable to load release data</h3>
      <p>${message}</p>
      <button type="button" id="retryButton">Retry</button>
    </div>
  `;

  elements.statsGrid.innerHTML = errorMarkup;
  elements.platformBarChart.innerHTML = errorMarkup;
  elements.osChart.innerHTML = errorMarkup;
  elements.versionChart.innerHTML = errorMarkup;
  elements.groupsGrid.innerHTML = "";
  elements.rangeNote.textContent = "The dashboard needs GitHub API access from the browser.";
  elements.releaseCount.textContent = "";

  document.querySelectorAll("#retryButton").forEach((button) => {
    button.addEventListener("click", () => initialize());
  });
}

function formatInputDate(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function formatLongDate(value) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
  }).format(new Date(value));
}

function formatShortDate(value) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "2-digit",
  }).format(new Date(value));
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatCompactNumber(value) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function colorForIndex(index) {
  const hue = (index * 43) % 360;
  return `hsl(${hue} 68% 46%)`;
}

function shapeForEntry(entry) {
  if (entry.platform === "Windows") {
    return "circle";
  }
  if (entry.platform === "macOS") {
    return "diamond";
  }
  if (entry.platform === "Android APK") {
    return "cross";
  }

  const lowerName = entry.name.toLowerCase();
  if (lowerName.endsWith(".appimage")) {
    return "triangle";
  }
  if (lowerName.endsWith(".deb")) {
    return "square";
  }
  if (lowerName.endsWith(".rpm")) {
    return "hexagon";
  }
  return "circle";
}

function dominantShape(points) {
  return points[0]?.platformShape || "circle";
}

function renderMarkerShape(shape, x, y, color, title) {
  const xPos = Number(x).toFixed(2);
  const yPos = Number(y).toFixed(2);
  const safeTitle = title ? `<title>${escapeHtml(title)}</title>` : "";

  if (shape === "diamond") {
    return `<polygon points="${xPos},${(y - 6).toFixed(2)} ${(x + 6).toFixed(2)},${yPos} ${xPos},${(y + 6).toFixed(2)} ${(x - 6).toFixed(2)},${yPos}" fill="${color}">${safeTitle}</polygon>`;
  }
  if (shape === "triangle") {
    return `<polygon points="${xPos},${(y - 6).toFixed(2)} ${(x + 6).toFixed(2)},${(y + 5).toFixed(2)} ${(x - 6).toFixed(2)},${(y + 5).toFixed(2)}" fill="${color}">${safeTitle}</polygon>`;
  }
  if (shape === "square") {
    return `<rect x="${(x - 5).toFixed(2)}" y="${(y - 5).toFixed(2)}" width="10" height="10" fill="${color}">${safeTitle}</rect>`;
  }
  if (shape === "hexagon") {
    return `<polygon points="${(x - 6).toFixed(2)},${yPos} ${(x - 3).toFixed(2)},${(y - 5).toFixed(2)} ${(x + 3).toFixed(2)},${(y - 5).toFixed(2)} ${(x + 6).toFixed(2)},${yPos} ${(x + 3).toFixed(2)},${(y + 5).toFixed(2)} ${(x - 3).toFixed(2)},${(y + 5).toFixed(2)}" fill="${color}">${safeTitle}</polygon>`;
  }
  if (shape === "cross") {
    return `
      <g stroke="${color}" stroke-width="3" stroke-linecap="round">
        <line x1="${(x - 5).toFixed(2)}" y1="${(y - 5).toFixed(2)}" x2="${(x + 5).toFixed(2)}" y2="${(y + 5).toFixed(2)}"></line>
        <line x1="${(x + 5).toFixed(2)}" y1="${(y - 5).toFixed(2)}" x2="${(x - 5).toFixed(2)}" y2="${(y + 5).toFixed(2)}"></line>
        ${safeTitle}
      </g>
    `;
  }
  return `<circle cx="${xPos}" cy="${yPos}" r="4.5" fill="${color}">${safeTitle}</circle>`;
}

function renderLegendShape(shape, color) {
  const size = 14;
  const center = size / 2;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">${renderMarkerShape(shape, center, center, color, "")}</svg>`;
}

function toggleSeries(chartKey, label) {
  const hidden = state.hiddenSeries[chartKey];
  if (!hidden) {
    return;
  }

  if (hidden.has(label)) {
    hidden.delete(label);
  } else {
    hidden.add(label);
  }

  render();
}

function pruneHiddenSeries(chartKey, labels) {
  const hidden = state.hiddenSeries[chartKey];
  if (!hidden) {
    return;
  }

  [...hidden].forEach((label) => {
    if (!labels.includes(label)) {
      hidden.delete(label);
    }
  });
}

function startOfDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfDay(value) {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
