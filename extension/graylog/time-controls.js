(function exposeGraylogTimeControls(root) {
  function localDateTimeValue(date) {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
  }

  function shiftedValue(value, deltaSeconds, nowMs = Date.now()) {
    const parsed = new Date(value).getTime();
    const base = Number.isFinite(parsed) ? parsed : nowMs;
    return localDateTimeValue(new Date(base + Number(deltaSeconds) * 1000));
  }

  function emitInput(input) {
    const EventConstructor = input?.ownerDocument?.defaultView?.Event || root.Event;
    input.dispatchEvent(new EventConstructor("input", { bubbles: true }));
  }

  function openPicker(input) {
    try {
      if (typeof input.showPicker === "function") input.showPicker();
      else {
        input.focus();
        input.click();
      }
    } catch {
      input.focus();
    }
  }

  function bind(documentObject = root.document) {
    if (!documentObject || documentObject.documentElement?.dataset.timeControlsBound === "true") return;
    if (documentObject.documentElement) documentObject.documentElement.dataset.timeControlsBound = "true";
    documentObject.addEventListener("click", (event) => {
      const pickerButton = event.target.closest?.("[data-time-picker]");
      if (pickerButton) {
        const input = documentObject.getElementById(pickerButton.dataset.timePicker);
        if (input) openPicker(input);
        return;
      }

      const shiftButton = event.target.closest?.("[data-time-shift][data-time-target]");
      if (!shiftButton) return;
      const input = documentObject.getElementById(shiftButton.dataset.timeTarget);
      if (!input) return;
      input.value = shiftedValue(input.value, shiftButton.dataset.timeShift);
      emitInput(input);
    });
  }

  const api = { bind, localDateTimeValue, shiftedValue };
  root.GraylogTimeControls = api;
  bind();
})(globalThis);
