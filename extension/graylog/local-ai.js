(function initializeLocalAiController(root) {
  "use strict";

  const analysis = root.LocalAiAnalysis;
  if (!analysis || typeof document === "undefined") return;

  const form = document.querySelector("#local-ai-form");
  const provider = document.querySelector("#local-ai-provider");
  const endpoint = document.querySelector("#local-ai-endpoint");
  const model = document.querySelector("#local-ai-model");
  const testButton = document.querySelector("#local-ai-test");
  const analyzeButton = document.querySelector("#local-ai-analyze");
  const status = document.querySelector("#local-ai-status");
  const preview = document.querySelector("#local-ai-payload-preview");
  const result = document.querySelector("#local-ai-result");
  if (!form || !provider || !endpoint || !model || !testButton || !analyzeButton || !status || !preview || !result) return;

  let tracePayload = null;
  let activeRequest = null;

  function settings() {
    return { provider: provider.value, endpoint: endpoint.value, model: model.value };
  }

  function setStatus(message, kind = "neutral") {
    status.textContent = message;
    status.dataset.kind = kind;
  }

  function setBusy(busy) {
    testButton.disabled = busy;
    analyzeButton.disabled = busy || !tracePayload;
  }

  function cancelActiveRequest(reason) {
    if (!activeRequest) return;
    activeRequest.abort(reason);
    activeRequest = null;
    setBusy(false);
  }

  async function runWithTimeout(task, timeoutMs) {
    if (activeRequest) {
      const error = new Error("Предыдущий запрос к локальному ИИ ещё выполняется.");
      error.busy = true;
      throw error;
    }
    const controller = new AbortController();
    activeRequest = controller;
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort("timeout");
    }, timeoutMs);
    setBusy(true);
    try {
      return await task(controller.signal);
    } catch (error) {
      if (timedOut) throw new Error("Локальный ИИ не ответил вовремя.");
      if (controller.signal.aborted) {
        const cancelled = new Error("Запрос к локальному ИИ отменён.");
        cancelled.cancelled = true;
        throw cancelled;
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
      if (activeRequest === controller) {
        activeRequest = null;
        setBusy(false);
      }
    }
  }

  function setTraceDiagram(diagram) {
    cancelActiveRequest("trace-changed");
    const review = root.TraceReview?.analyze?.(diagram);
    tracePayload = analysis.buildTracePayload(diagram, review, root.ErrorReference?.entries);
    preview.textContent = JSON.stringify(tracePayload, null, 2);
    result.textContent = "Анализ ещё не запускался.";
    analyzeButton.disabled = false;
    setStatus(`Подготовлена обезличенная сводка: ${tracePayload.spanCount} span, ${tracePayload.serviceCount} сервисов.`);
  }

  function clearTrace() {
    cancelActiveRequest("trace-cleared");
    tracePayload = null;
    preview.textContent = "Трейс ещё не разобран.";
    result.textContent = "Анализ ещё не запускался.";
    analyzeButton.disabled = true;
    setStatus("Сначала выполните поиск по traceId.");
  }

  testButton.addEventListener("click", async () => {
    if (activeRequest) return;
    setStatus("Проверяю локальное подключение…");
    try {
      await runWithTimeout((signal) => analysis.testConnection(settings(), fetch, signal), 15_000);
      setStatus("Локальный сервер доступен.", "success");
    } catch (error) {
      if (error?.cancelled) return;
      setStatus(error?.message || String(error), "error");
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!tracePayload || activeRequest) return;
    setStatus("Локальная модель анализирует обезличенную сводку…");
    try {
      const text = await runWithTimeout((signal) => analysis.analyze(settings(), tracePayload, fetch, signal), 60_000);
      result.textContent = text;
      setStatus("Анализ завершён.", "success");
    } catch (error) {
      if (error?.cancelled) return;
      setStatus(error?.message || String(error), "error");
    }
  });

  provider.addEventListener("change", () => {
    if (provider.value === "openai") {
      endpoint.value = "http://127.0.0.1:1234";
      model.value = "local-model";
    } else {
      endpoint.value = "http://127.0.0.1:11434";
      model.value = "qwen2.5:7b";
    }
  });

  root.LocalAiController = Object.freeze({ setTraceDiagram, clearTrace });
})(globalThis);
