let dialogRoot = null;
let resolveDialog = null;

function ensureDialog() {
  if (dialogRoot) return dialogRoot;

  dialogRoot = document.createElement("div");
  dialogRoot.id = "churangDialog";
  dialogRoot.className = "ui-dialog hidden";
  dialogRoot.innerHTML = `
    <div class="ui-dialog-backdrop" data-ui-dialog-close></div>
    <section class="ui-dialog-card" role="dialog" aria-modal="true" aria-labelledby="uiDialogTitle">
      <div class="ui-dialog-icon" aria-hidden="true">!</div>
      <h2 id="uiDialogTitle"></h2>
      <p id="uiDialogMessage"></p>
      <div class="ui-dialog-actions">
        <button id="uiDialogCancel" class="secondary" type="button">취소</button>
        <button id="uiDialogConfirm" type="button">확인</button>
      </div>
    </section>
  `;
  document.body.appendChild(dialogRoot);

  const finish = (value) => {
    if (dialogRoot.classList.contains("hidden")) return;
    dialogRoot.classList.add("hidden");
    document.body.classList.remove("modal-open");
    const resolver = resolveDialog;
    resolveDialog = null;
    resolver?.(value);
  };

  dialogRoot.querySelector("[data-ui-dialog-close]").addEventListener("click", () => finish(false));
  dialogRoot.querySelector("#uiDialogCancel").addEventListener("click", () => finish(false));
  dialogRoot.querySelector("#uiDialogConfirm").addEventListener("click", () => finish(true));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !dialogRoot.classList.contains("hidden")) finish(false);
  });

  dialogRoot._finish = finish;
  return dialogRoot;
}

export function showDialog({
  title = "알림",
  message = "",
  confirmText = "확인",
  cancelText = "취소",
  showCancel = false,
  danger = false,
  icon = "!"
} = {}) {
  const root = ensureDialog();
  if (resolveDialog) root._finish(false);

  root.querySelector("#uiDialogTitle").textContent = title;
  root.querySelector("#uiDialogMessage").textContent = message;
  root.querySelector(".ui-dialog-icon").textContent = icon;

  const cancel = root.querySelector("#uiDialogCancel");
  const confirm = root.querySelector("#uiDialogConfirm");
  cancel.textContent = cancelText;
  cancel.classList.toggle("hidden", !showCancel);
  confirm.textContent = confirmText;
  confirm.classList.toggle("danger", danger);

  root.classList.remove("hidden");
  document.body.classList.add("modal-open");
  requestAnimationFrame(() => confirm.focus());

  return new Promise((resolve) => {
    resolveDialog = resolve;
  });
}

export function showNotice(message, title = "알림") {
  return showDialog({ title, message, confirmText: "확인", showCancel: false, icon: "✓" });
}

export function showConfirm(message, {
  title = "확인해주세요",
  confirmText = "확인",
  cancelText = "취소",
  danger = false
} = {}) {
  return showDialog({ title, message, confirmText, cancelText, showCancel: true, danger, icon: danger ? "!" : "?" });
}
