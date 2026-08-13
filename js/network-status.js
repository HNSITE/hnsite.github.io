let hideTimer = null;

function ensureIndicator() {
  let indicator = document.getElementById("networkStatusIndicator");
  if (indicator) return indicator;
  indicator = document.createElement("div");
  indicator.id = "networkStatusIndicator";
  indicator.className = "network-status-indicator hidden";
  indicator.setAttribute("role", "status");
  indicator.setAttribute("aria-live", "polite");
  document.body.appendChild(indicator);
  return indicator;
}

function show(text, state, persistent = false) {
  const indicator = ensureIndicator();
  clearTimeout(hideTimer);
  indicator.textContent = text;
  indicator.dataset.state = state;
  indicator.classList.remove("hidden");
  if (!persistent) hideTimer = setTimeout(() => indicator.classList.add("hidden"), 1800);
}

function syncNetwork() {
  if (navigator.onLine) show("다시 연결되었습니다.", "online");
  else show("인터넷 연결이 끊어졌습니다.", "offline", true);
}

window.addEventListener("offline", syncNetwork);
window.addEventListener("online", syncNetwork);

window.CHURANG_SET_SAVE_STATUS = (state) => {
  if (state === "saving") show("저장 중...", "saving", true);
  else if (state === "saved") show("저장되었습니다.", "saved");
  else if (state === "error") show("저장하지 못했습니다.", "error", true);
  else ensureIndicator().classList.add("hidden");
};

if (!navigator.onLine) syncNetwork();
