(function initializeChartInteractions(global) {
  "use strict";

  // One delegated controller for all charts, including cards rendered after a query.
  // Loaded data stays in the DOM; toggling a legend never starts a request.
  function visiblePoints(scope) {
    return Array.from(scope.querySelectorAll("[data-chart-point]"))
      .filter((point) => !point.closest('[data-chart-hidden="true"]'));
  }

  function setSeriesVisible(scope, key, visible) {
    for (const series of scope.querySelectorAll("[data-chart-series]")) {
      if (series.dataset.chartSeries !== key) continue;
      series.dataset.chartHidden = String(!visible);
      series.setAttribute("aria-hidden", String(!visible));
    }
    for (const button of scope.querySelectorAll("[data-chart-toggle]")) {
      if (button.dataset.chartToggle === key) button.setAttribute("aria-pressed", String(visible));
    }
    const points = visiblePoints(scope);
    for (const point of scope.querySelectorAll("[data-chart-point]")) point.setAttribute("tabindex", "-1");
    if (points.length) points[0].setAttribute("tabindex", "0");
  }

  global.ChartInteractions = Object.freeze({ visiblePoints, setSeriesVisible });
  if (!global.document) return;
  const document = global.document;
  let tooltip;
  let activePoint;

  function hideTooltip() {
    if (tooltip) tooltip.hidden = true;
    if (activePoint) activePoint.removeAttribute("aria-describedby");
    activePoint = null;
  }

  function showTooltip(point) {
    if (!point || point.closest('[data-chart-hidden="true"]')) return;
    hideTooltip();
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.id = "chart-point-tooltip";
      tooltip.className = "chart-point-tooltip";
      tooltip.setAttribute("role", "tooltip");
      document.body.append(tooltip);
    }
    activePoint = point;
    tooltip.textContent = point.dataset.chartTooltip;
    tooltip.hidden = false;
    point.setAttribute("aria-describedby", tooltip.id);
    const bounds = point.getBoundingClientRect();
    const size = tooltip.getBoundingClientRect();
    tooltip.style.left = `${Math.max(8, Math.min(global.innerWidth - size.width - 8, bounds.left + bounds.width / 2 - size.width / 2))}px`;
    tooltip.style.top = `${Math.max(8, bounds.top >= size.height + 16 ? bounds.top - size.height - 10 : Math.min(global.innerHeight - size.height - 8, bounds.bottom + 10))}px`;
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-chart-toggle]");
    const scope = button?.closest("[data-chart-scope]");
    if (!scope) { if (!event.target.closest?.("[data-chart-point]")) hideTooltip(); return; }
    hideTooltip();
    setSeriesVisible(scope, button.dataset.chartToggle, button.getAttribute("aria-pressed") !== "true");
  });
  document.addEventListener("pointerover", (event) => showTooltip(event.target.closest?.("[data-chart-point]")));
  document.addEventListener("pointerout", (event) => {
    if (event.target.closest?.("[data-chart-point]")) hideTooltip();
  });
  document.addEventListener("focusin", (event) => showTooltip(event.target.closest?.("[data-chart-point]")));
  document.addEventListener("focusout", hideTooltip);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { hideTooltip(); return; }
    const point = event.target.closest?.("[data-chart-point]");
    if (!point || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const points = visiblePoints(point.closest("svg"));
    const current = points.indexOf(point);
    const index = event.key === "Home" ? 0 : event.key === "End" ? points.length - 1
      : (current + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1) + points.length) % points.length;
    event.preventDefault();
    point.setAttribute("tabindex", "-1");
    points[index]?.setAttribute("tabindex", "0");
    points[index]?.focus();
  });
  global.addEventListener("resize", hideTooltip);
  document.addEventListener("scroll", hideTooltip, true);
})(globalThis);
