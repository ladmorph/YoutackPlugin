(function initializePercentileCharts(global) {
  const AREA_DEFINITIONS = Object.freeze([
    Object.freeze(["p99", "#ff6870", "rgba(255,104,112,.16)"]),
    Object.freeze(["p95", "#ffb454", "rgba(255,180,84,.15)"]),
    Object.freeze(["p75", "#60a5fa", "rgba(96,165,250,.14)"]),
    Object.freeze(["p50", "#43d9c7", "rgba(67,217,199,.15)"])
  ]);

  const AREA_LAYOUT = Object.freeze({
    width: 1000,
    height: 250,
    left: 82,
    right: 980,
    top: 24,
    bottom: 196
  });

  function moscowTime(value) {
    return new Date(value).toLocaleTimeString("ru-RU", {
      timeZone: "Europe/Moscow",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function pointAttributes(label, escapeText, first = false) {
    const escaped = escapeText(label);
    return `data-chart-point data-chart-tooltip="${escaped}" aria-label="${escaped}" role="graphics-symbol" tabindex="${first ? 0 : -1}"`;
  }

  function distribution(row, maximum, percentileKeys, escapeText) {
    const x = (value) => 8 + (Number(value) / Math.max(1, maximum)) * 204;
    const present = percentileKeys.filter((key) => row[key] !== null);
    const start = present.length ? x(row[present[0]]) : 8;
    const end = present.length ? x(row[present[present.length - 1]]) : 8;
    const dots = present.map((key, index) => {
      const label = escapeText(global.PercentileFormat.durationWithUnit(row[key]));
      return `<circle class="percentile-dot ${key}" ${pointAttributes(`${key.toUpperCase()}: ${global.PercentileFormat.durationWithUnit(row[key])}`, escapeText, index === 0)} cx="${x(row[key]).toFixed(1)}" cy="12" r="4"><title>${key.toUpperCase()}: ${label}</title></circle>`;
    }).join("");
    return `<svg class="percentile-chart" viewBox="0 0 220 24" role="group" aria-label="Распределение duration; стрелки переключают точки"><line class="percentile-axis" x1="8" y1="12" x2="212" y2="12"/><line class="percentile-span" x1="${start.toFixed(1)}" y1="12" x2="${end.toFixed(1)}" y2="12"/>${dots}</svg>`;
  }

  function bars(row, maximum, percentileKeys, escapeText) {
    const width = (value) => Math.max(0, Math.min(204, Number(value) / Math.max(1, maximum) * 204));
    const rectangles = percentileKeys.map((key, index) => {
      if (row[key] === null) return "";
      const label = escapeText(global.PercentileFormat.durationWithUnit(row[key]));
      return `<rect class="percentile-bar ${key}" ${pointAttributes(`${key.toUpperCase()}: ${global.PercentileFormat.durationWithUnit(row[key])}`, escapeText, key === percentileKeys.find((item) => row[item] !== null))} x="8" y="${2 + index * 9}" width="${width(row[key]).toFixed(1)}" height="6" rx="2"><title>${key.toUpperCase()}: ${label}</title></rect>`;
    }).join("");
    return `<svg class="percentile-chart percentile-bars" viewBox="0 0 220 36" role="group" aria-label="Столбцы процентилей; стрелки переключают точки">
      ${rectangles}
    </svg>`;
  }

  function areaLayer(points, key, stroke, fill, x, y, escapeText) {
    const coordinates = points.map((row, index) => `${x(index).toFixed(1)},${y(row[key]).toFixed(1)}`);
    const areaPath = `M ${x(0).toFixed(1)} ${AREA_LAYOUT.bottom} L ${coordinates.join(" L ")} L ${x(points.length - 1).toFixed(1)} ${AREA_LAYOUT.bottom} Z`;
    const linePath = `M ${coordinates.join(" L ")}`;
    const dots = points.map((row, index) => {
      const time = escapeText(moscowTime(row.time));
      const duration = escapeText(global.PercentileFormat.durationWithUnit(row[key]));
      return `<circle ${pointAttributes(`${new Date(row.time).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК · ${key.toUpperCase()}: ${global.PercentileFormat.durationWithUnit(row[key])}`, escapeText, index === 0)} cx="${x(index).toFixed(1)}" cy="${y(row[key]).toFixed(1)}" r="3.5" fill="${stroke}"><title>${time} · ${key.toUpperCase()}: ${duration}</title></circle>`;
    }).join("");
    return `<g data-chart-series="${key}"><path d="${areaPath}" fill="${fill}"/><path d="${linePath}" fill="none" stroke="${stroke}" stroke-width="2"/>${dots}</g>`;
  }

  function areaTicks(maximum, escapeText) {
    return [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
      const y = AREA_LAYOUT.bottom - ratio * (AREA_LAYOUT.bottom - AREA_LAYOUT.top);
      const label = escapeText(global.PercentileFormat.durationWithUnit(maximum * ratio));
      return `<line class="chart-grid" x1="${AREA_LAYOUT.left}" y1="${y.toFixed(1)}" x2="${AREA_LAYOUT.right}" y2="${y.toFixed(1)}"/><text class="chart-label" x="${AREA_LAYOUT.left - 8}" y="${(y + 3).toFixed(1)}" text-anchor="end">${label}</text>`;
    }).join("");
  }

  function areaTimeLabels(points, x, escapeText) {
    const indexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
    return indexes.map((index) => {
      const anchor = index === 0 ? "start" : index === points.length - 1 ? "end" : "middle";
      return `<text class="chart-label" x="${x(index).toFixed(1)}" y="222" text-anchor="${anchor}">${escapeText(moscowTime(points[index].time))}</text>`;
    }).join("");
  }

  function areaCard(uri, points, percentileKeys, escapeText, collapsedUris) {
    const maximum = Math.max(1, ...points.flatMap((row) => percentileKeys.map((key) => row[key] ?? 0)));
    const x = (index) => points.length === 1
      ? (AREA_LAYOUT.left + AREA_LAYOUT.right) / 2
      : AREA_LAYOUT.left + index * (AREA_LAYOUT.right - AREA_LAYOUT.left) / (points.length - 1);
    const y = (value) => AREA_LAYOUT.bottom - Number(value || 0) / maximum * (AREA_LAYOUT.bottom - AREA_LAYOUT.top);
    const layers = AREA_DEFINITIONS
      .map(([key, stroke, fill]) => areaLayer(points, key, stroke, fill, x, y, escapeText))
      .join("");
    const title = escapeText(uri);
    const legend = AREA_DEFINITIONS.slice().reverse().map(([key, stroke]) => `<button type="button" data-chart-toggle="${key}" aria-pressed="true" title="Показать или скрыть ряд; шкала сохраняется"><i style="background:${stroke}" aria-hidden="true"></i>${key.toUpperCase()}</button>`).join("");
    return `<details class="percentile-time-card" data-chart-scope data-percentile-uri="${title}"${collapsedUris?.has(uri) ? "" : " open"}><summary>${title}</summary><svg viewBox="0 0 ${AREA_LAYOUT.width} ${AREA_LAYOUT.height}" role="group" aria-label="Процентили ${title} по времени; стрелки переключают точки"><text class="chart-axis-title" x="${AREA_LAYOUT.left}" y="12">duration, мс</text>${areaTicks(maximum, escapeText)}${layers}${areaTimeLabels(points, x, escapeText)}</svg><div class="percentile-area-legend" aria-label="Видимость рядов">${legend}</div></details>`;
  }

  function area(plotted, percentileKeys, escapeText, collapsedUris = new Set()) {
    const charts = plotted
      .map(({ uri, points }) => areaCard(uri, points, percentileKeys, escapeText, collapsedUris))
      .join("");
    return charts;
  }

  global.PercentileCharts = Object.freeze({ distribution, bars, area });
})(globalThis);
