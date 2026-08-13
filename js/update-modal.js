import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { showConfirm, showNotice } from "./ui-dialog.js?v=14";
import { firebaseErrorMessage } from "./error-messages.js?v=25";

const UPDATE_BADGE_DAYS = 3;

const fallbackUpdates = [
  {
    id: "fallback-v25",
    date: "2026.08.13",
    title: "빙고방 기록과 편의 기능이 추가됐어요",
    items: [
      "빙고가 끝나면 방을 종료해 결과를 보관하고 나중에 다시 확인할 수 있습니다.",
      "치킨 수량 변경 기록에서 누가 언제 변경했는지 확인하고 잘못된 기록은 취소할 수 있습니다.",
      "현재 입장 중인 참가자에게 방장을 위임할 수 있습니다.",
      "알파벳 직접 지정에서 한번에 입력, 자동 채우기, 섞기를 사용할 수 있습니다."
    ],
    published: true,
    fallback: true
  },
  {
    id: "fallback-alphabet",
    date: "2026.08.13",
    title: "알파벳 빙고가 추가됐어요",
    items: [
      "빙고방 생성 시 숫자 빙고와 알파벳 빙고를 선택할 수 있습니다.",
      "알파벳은 무작위 배치 또는 직접 지정할 수 있으며, 직접 지정할 때 같은 알파벳을 여러 번 사용할 수 있습니다."
    ],
    published: true,
    fallback: true
  },
  {
    id: "fallback-progress",
    date: "2026.08.13",
    title: "빙고가 더 편리해졌어요",
    items: [
      "빙고판에서 전체 선택과 전체 해제를 사용할 수 있습니다.",
      "체크된 칸, 남은 칸, 완성된 빙고 수를 한눈에 확인할 수 있습니다.",
      "먹은 치킨 수량을 기록하고 총 치킨 수를 확인할 수 있습니다."
    ],
    published: true,
    fallback: true
  },
  {
    id: "fallback-room",
    date: "2026.08.11",
    title: "빙고방 이용 기능이 개선됐어요",
    items: [
      "체크한 빙고 칸은 새로고침하거나 다시 접속해도 그대로 유지됩니다.",
      "방장은 참가자를 추가하거나 제외할 수 있으며 검색과 페이지 이동으로 쉽게 찾을 수 있습니다.",
      "빙고판은 최대 10 × 10까지 만들 수 있습니다."
    ],
    published: true,
    fallback: true
  }
];

let currentProfile = null;
let managedUpdates = [];
let visibleUpdates = [...fallbackUpdates];
let initialized = false;
let editingUpdateId = null;

const isManager = () => ["admin", "super_admin"].includes(currentProfile?.role) && currentProfile?.status === "approved";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  if (/^\d{4}\.\d{2}\.\d{2}$/.test(text)) return text;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text.replaceAll("-", ".");
  return "";
}

function inputDate(value) {
  return normalizeDate(value).replaceAll(".", "-");
}

function parseUpdateDate(value) {
  const parts = normalizeDate(value).split(".").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  const [year, month, day] = parts;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function updateSortValue(update) {
  return parseUpdateDate(update.date)?.getTime?.() || 0;
}

function rebuildVisibleUpdates() {
  const publishedManaged = managedUpdates.filter((item) => item.published !== false);
  visibleUpdates = [...publishedManaged, ...fallbackUpdates]
    .sort((a, b) => updateSortValue(b) - updateSortValue(a));
}

function isLatestUpdateInBadgeWindow() {
  const latestDate = parseUpdateDate(visibleUpdates[0]?.date);
  if (!latestDate) return false;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const expiresAt = new Date(latestDate);
  expiresAt.setDate(expiresAt.getDate() + UPDATE_BADGE_DAYS);
  return today >= latestDate && today < expiresAt;
}

function createUpdateButton() {
  const topbarUser = document.querySelector(".topbar-user");
  if (!topbarUser || document.getElementById("updateNewsButton")) return document.getElementById("updateNewsButton");

  const button = document.createElement("button");
  button.id = "updateNewsButton";
  button.className = "update-news-button";
  button.type = "button";
  button.innerHTML = `
    <span class="update-news-label">업데이트</span>
    <span id="updateUnreadBadge" class="update-unread-badge hidden">NEW</span>
  `;

  const logoutButton = topbarUser.querySelector("#logoutButton");
  if (logoutButton) topbarUser.insertBefore(button, logoutButton);
  else topbarUser.appendChild(button);
  return button;
}

function createUpdateModal() {
  if (document.getElementById("updateNewsModal")) return document.getElementById("updateNewsModal");

  const modal = document.createElement("div");
  modal.id = "updateNewsModal";
  modal.className = "update-news-modal hidden";
  modal.innerHTML = `
    <div class="update-news-backdrop" data-close-update-modal></div>
    <section class="update-news-dialog" role="dialog" aria-modal="true" aria-labelledby="updateNewsTitle">
      <div class="update-news-header">
        <div>
          <p class="eyebrow">WHAT'S NEW</p>
          <h2 id="updateNewsTitle">업데이트 소식</h2>
          <p>사용에 필요한 주요 변경사항만 안내합니다.</p>
        </div>
        <div class="update-news-header-actions">
          <button id="updateManageButton" class="secondary compact-button hidden" type="button">업데이트 관리</button>
          <button class="modal-close-button" type="button" aria-label="업데이트 창 닫기" data-close-update-modal>×</button>
        </div>
      </div>
      <div id="updateNewsView" class="update-news-list"></div>
      <div id="updateManageView" class="update-manage-view hidden">
        <form id="updateManageForm" class="update-manage-form">
          <input id="updateEditId" type="hidden" />
          <label>업데이트 날짜<input id="updateManageDate" type="date" required /></label>
          <label>제목<input id="updateManageTitle" type="text" maxlength="80" required placeholder="사용자에게 보여줄 제목" /></label>
          <label class="update-items-field">내용<textarea id="updateManageItems" rows="5" maxlength="1000" required placeholder="한 줄에 한 항목씩 입력"></textarea></label>
          <label class="update-publish-check"><input id="updateManagePublished" type="checkbox" checked /> 사용자에게 공개</label>
          <div class="update-manage-actions">
            <button id="updateManageSave" type="submit">등록</button>
            <button id="updateManageCancel" class="secondary hidden" type="button">수정 취소</button>
            <button id="updateManageBack" class="secondary" type="button">소식 보기</button>
          </div>
          <p id="updateManageMessage" class="message"></p>
        </form>
        <div id="updateManageList" class="update-manage-list"></div>
      </div>
    </section>
  `;

  document.body.appendChild(modal);
  return modal;
}

function setUnreadBadgeVisible(visible) {
  document.getElementById("updateUnreadBadge")?.classList.toggle("hidden", !visible);
}

function renderUpdateList() {
  const container = document.getElementById("updateNewsView");
  if (!container) return;
  if (!visibleUpdates.length) {
    container.innerHTML = '<div class="update-news-empty">아직 등록된 업데이트 소식이 없습니다.</div>';
    return;
  }

  container.innerHTML = visibleUpdates.map((update, index) => `
    <article class="update-news-item${index === 0 ? " latest" : ""}">
      <div class="update-news-item-head">
        <time>${escapeHtml(update.date)}</time>
        ${index === 0 ? '<span class="update-latest-pill">최신</span>' : ""}
      </div>
      <h3>${escapeHtml(update.title)}</h3>
      <ul>${(update.items || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </article>
  `).join("");
}

function renderManageList() {
  const container = document.getElementById("updateManageList");
  if (!container) return;
  if (!managedUpdates.length) {
    container.innerHTML = '<div class="update-manage-empty">관리 화면에서 등록한 업데이트가 없습니다.<br>기존 기본 업데이트는 소식 보기에서 계속 표시됩니다.</div>';
    return;
  }

  const sorted = [...managedUpdates].sort((a, b) => updateSortValue(b) - updateSortValue(a));
  container.innerHTML = "";
  sorted.forEach((update) => {
    const item = document.createElement("article");
    item.className = "update-manage-item";
    item.innerHTML = `
      <div class="update-manage-item-main">
        <div class="update-manage-meta">
          <time>${escapeHtml(update.date)}</time>
          <span class="${update.published === false ? "update-draft-pill" : "update-published-pill"}">${update.published === false ? "비공개" : "공개"}</span>
        </div>
        <strong>${escapeHtml(update.title)}</strong>
        <p>${escapeHtml((update.items || []).join(" · "))}</p>
      </div>
      <div class="update-manage-item-actions"></div>
    `;
    const actions = item.querySelector(".update-manage-item-actions");
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "secondary compact-button";
    edit.textContent = "수정";
    edit.addEventListener("click", () => beginEditUpdate(update));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger-outline compact-button";
    remove.textContent = "삭제";
    remove.addEventListener("click", () => removeManagedUpdate(update));
    actions.append(edit, remove);
    container.appendChild(item);
  });
}

function resetManageForm() {
  editingUpdateId = null;
  document.getElementById("updateEditId").value = "";
  document.getElementById("updateManageForm").reset();
  const now = new Date();
  const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  document.getElementById("updateManageDate").value = localDate;
  document.getElementById("updateManagePublished").checked = true;
  document.getElementById("updateManageSave").textContent = "등록";
  document.getElementById("updateManageCancel").classList.add("hidden");
  const message = document.getElementById("updateManageMessage");
  message.textContent = "";
  message.classList.remove("success");
}

function beginEditUpdate(update) {
  editingUpdateId = update.id;
  document.getElementById("updateEditId").value = update.id;
  document.getElementById("updateManageDate").value = inputDate(update.date);
  document.getElementById("updateManageTitle").value = update.title || "";
  document.getElementById("updateManageItems").value = (update.items || []).join("\n");
  document.getElementById("updateManagePublished").checked = update.published !== false;
  document.getElementById("updateManageSave").textContent = "수정 저장";
  document.getElementById("updateManageCancel").classList.remove("hidden");
  document.getElementById("updateManageForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function writeUpdateAudit(action, update, detail) {
  try {
    await addDoc(collection(db, "adminAuditLogs"), {
      actorUid: currentProfile.uid || "",
      actorName: currentProfile.name || currentProfile.email || "관리자",
      actorEmail: currentProfile.email || "",
      action,
      targetUid: "",
      targetName: update.title || "업데이트",
      targetEmail: "",
      detail: String(detail || "").slice(0, 500),
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.error("업데이트 관리 이력 저장 실패", error);
  }
}

async function saveManagedUpdate(event) {
  event.preventDefault();
  if (!isManager()) return;
  const message = document.getElementById("updateManageMessage");
  const date = normalizeDate(document.getElementById("updateManageDate").value);
  const title = document.getElementById("updateManageTitle").value.trim();
  const items = document.getElementById("updateManageItems").value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
  const published = document.getElementById("updateManagePublished").checked;

  if (!date || !title || !items.length) {
    message.textContent = "날짜, 제목, 업데이트 내용을 모두 입력해주세요.";
    return;
  }

  const payload = { date, title, items, published, updatedAt: serverTimestamp() };
  try {
    if (editingUpdateId) {
      await updateDoc(doc(db, "appUpdates", editingUpdateId), payload);
      await writeUpdateAudit("update_edit", { title }, `${date} · ${published ? "공개" : "비공개"}`);
      message.textContent = "업데이트 내용을 수정했습니다.";
    } else {
      await addDoc(collection(db, "appUpdates"), { ...payload, createdAt: serverTimestamp() });
      await writeUpdateAudit("update_create", { title }, `${date} · ${published ? "공개" : "비공개"}`);
      message.textContent = "업데이트를 등록했습니다.";
    }
    message.classList.add("success");
    await loadUpdates();
    resetManageForm();
    renderManageList();
  } catch (error) {
    console.error(error);
    message.classList.remove("success");
    message.textContent = firebaseErrorMessage(error, "업데이트 저장에 실패했습니다.");
  }
}

async function removeManagedUpdate(update) {
  if (!isManager()) return;
  const confirmed = await showConfirm(
    `${update.title} 업데이트를 삭제할까요?`,
    { title: "업데이트 삭제", confirmText: "삭제", danger: true }
  );
  if (!confirmed) return;

  try {
    await deleteDoc(doc(db, "appUpdates", update.id));
    await writeUpdateAudit("update_delete", update, `${update.date} 업데이트 삭제`);
    await loadUpdates();
    renderManageList();
  } catch (error) {
    console.error(error);
    await showNotice(firebaseErrorMessage(error, "업데이트 삭제에 실패했습니다."));
  }
}

async function loadUpdates() {
  if (!currentProfile) return;
  try {
    const ref = collection(db, "appUpdates");
    const snap = isManager()
      ? await getDocs(ref)
      : await getDocs(query(ref, where("published", "==", true)));
    managedUpdates = snap.docs.map((item) => ({ id: item.id, ...item.data() }));
  } catch (error) {
    console.error("업데이트 조회 실패", error);
    managedUpdates = [];
  }
  rebuildVisibleUpdates();
  renderUpdateList();
  setUnreadBadgeVisible(isLatestUpdateInBadgeWindow());
  if (isManager()) renderManageList();
}

function openUpdateModal() {
  const modal = createUpdateModal();
  document.getElementById("updateNewsView")?.classList.remove("hidden");
  document.getElementById("updateManageView")?.classList.add("hidden");
  modal.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function closeUpdateModal() {
  const modal = document.getElementById("updateNewsModal");
  if (!modal) return;
  modal.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

function openManageView() {
  if (!isManager()) return;
  document.getElementById("updateNewsView").classList.add("hidden");
  document.getElementById("updateManageView").classList.remove("hidden");
  if (!editingUpdateId) resetManageForm();
  renderManageList();
}

function openNewsView() {
  document.getElementById("updateManageView").classList.add("hidden");
  document.getElementById("updateNewsView").classList.remove("hidden");
  resetManageForm();
}

function bindUi() {
  if (initialized) return;
  const button = createUpdateButton();
  const modal = createUpdateModal();
  if (!button || !modal) return;

  button.addEventListener("click", openUpdateModal);
  modal.querySelectorAll("[data-close-update-modal]").forEach((element) => element.addEventListener("click", closeUpdateModal));
  document.getElementById("updateManageButton").addEventListener("click", openManageView);
  document.getElementById("updateManageBack").addEventListener("click", openNewsView);
  document.getElementById("updateManageCancel").addEventListener("click", resetManageForm);
  document.getElementById("updateManageForm").addEventListener("submit", saveManagedUpdate);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.classList.contains("hidden")) closeUpdateModal();
  });
  initialized = true;
}

bindUi();

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  try {
    const profileSnap = await getDoc(doc(db, "users", user.uid));
    currentProfile = profileSnap.exists() ? { uid: user.uid, ...profileSnap.data() } : null;
    document.getElementById("updateManageButton")?.classList.toggle("hidden", !isManager());
    await loadUpdates();
  } catch (error) {
    console.error("업데이트 초기화 실패", error);
    currentProfile = null;
    managedUpdates = [];
    rebuildVisibleUpdates();
    renderUpdateList();
    setUnreadBadgeVisible(isLatestUpdateInBadgeWindow());
  }
});
