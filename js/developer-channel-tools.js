import { db, storage } from "./firebase-config.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  getDownloadURL,
  listAll,
  ref as storageRef
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js";
import { isDeveloper } from "./channel-context.js?v=34";
import { firebaseErrorMessage } from "./error-messages.js?v=34";
import { showConfirm } from "./ui-dialog.js?v=34";

const REQUEST_PAGE_SIZE = 10;

let currentUser = null;
let currentProfile = null;
let ownerUsers = [];
let ownerUsersByUid = new Map();
let pendingRequests = [];
let requestPage = 1;
let requestUnsubscribe = null;
let selectedRequestUid = "";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function ensureButtons() {
  if (!isDeveloper(currentProfile)) return;
  const nav = document.querySelector(".topbar-user");
  if (!nav) return;

  let createButton = document.getElementById("globalCreateChannelButton");
  if (!createButton) {
    createButton = document.createElement("button");
    createButton.id = "globalCreateChannelButton";
    createButton.className = "channel-create-top-button";
    createButton.type = "button";
    createButton.innerHTML = '<span class="channel-create-plus">＋</span><span>채널 생성</span>';
    const email = nav.querySelector(".topbar-email");
    nav.insertBefore(createButton, email || nav.firstChild);
  }

  let requestButton = document.getElementById("globalChannelRequestsButton");
  if (!requestButton) {
    requestButton = document.createElement("button");
    requestButton.id = "globalChannelRequestsButton";
    requestButton.className = "channel-request-admin-button";
    requestButton.type = "button";
    requestButton.innerHTML = '채널 신청 <span id="globalChannelRequestBadge" class="channel-request-badge hidden">0</span>';
    const email = nav.querySelector(".topbar-email");
    nav.insertBefore(requestButton, email || nav.firstChild);
  }

  if (!createButton.dataset.bound) {
    createButton.dataset.bound = "1";
    createButton.addEventListener("click", () => openCreateModal());
  }

  if (!requestButton.dataset.bound) {
    requestButton.dataset.bound = "1";
    requestButton.addEventListener("click", openRequestsModal);
  }
}

function ensureCreateModal() {
  let modal = document.getElementById("globalCreateChannelModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "globalCreateChannelModal";
  modal.className = "admin-modal hidden";
  modal.innerHTML = `
    <div class="admin-modal-backdrop" data-close-global-create></div>
    <section class="admin-modal-dialog channel-create-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="globalCreateChannelTitle">
      <div class="admin-modal-header">
        <div>
          <p class="eyebrow">DEVELOPER</p>
          <h2 id="globalCreateChannelTitle">새 채널 생성</h2>
          <p class="muted">채널 이름과 소유자를 지정합니다.</p>
        </div>
        <button class="modal-close-button" data-close-global-create type="button" aria-label="닫기">×</button>
      </div>
      <form id="globalCreateChannelForm" class="channel-create-modal-form">
        <label>
          채널 이름
          <input id="globalChannelName" type="text" maxlength="40" placeholder="예: 훈냥" required />
        </label>
        <div class="channel-owner-field">
          <label for="globalChannelOwnerSearch">채널 소유자 검색</label>
          <input id="globalChannelOwnerSearch" type="search" placeholder="이름 또는 이메일 검색" autocomplete="off" />
          <label for="globalChannelOwner">채널 소유자</label>
          <select id="globalChannelOwner" required></select>
          <small id="globalChannelOwnerSearchResult" class="muted"></small>
        </div>
        <p id="globalCreateChannelMessage" class="message"></p>
        <div class="channel-modal-actions">
          <button class="secondary" data-close-global-create type="button">취소</button>
          <button id="globalCreateChannelSubmit" type="submit">채널 생성</button>
        </div>
      </form>
    </section>`;

  document.body.appendChild(modal);
  modal.querySelectorAll("[data-close-global-create]").forEach((element) => {
    element.addEventListener("click", closeCreateModal);
  });
  modal.querySelector("#globalChannelOwnerSearch").addEventListener("input", () => renderOwnerOptions());
  modal.querySelector("#globalCreateChannelForm").addEventListener("submit", createChannel);
  return modal;
}

function ensureRequestsModal() {
  let modal = document.getElementById("globalChannelRequestsModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "globalChannelRequestsModal";
  modal.className = "admin-modal hidden";
  modal.innerHTML = `
    <div class="admin-modal-backdrop" data-close-global-requests></div>
    <section class="admin-modal-dialog channel-request-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="globalRequestsTitle">
      <div class="admin-modal-header">
        <div>
          <p class="eyebrow">CHANNEL REQUEST</p>
          <h2 id="globalRequestsTitle">채널 생성 신청</h2>
          <p class="muted">채널 생성을 요청한 사용자를 확인합니다.</p>
        </div>
        <button class="modal-close-button" data-close-global-requests type="button" aria-label="닫기">×</button>
      </div>
      <p id="globalRequestsMessage" class="message admin-modal-message"></p>
      <div id="globalRequestsList" class="channel-request-list"></div>
      <div id="globalRequestsPagination" class="channel-pagination channel-request-pagination hidden">
        <span id="globalRequestsSummary" class="channel-page-summary"></span>
        <div class="channel-page-buttons">
          <button id="globalRequestsPrev" class="secondary" type="button">이전</button>
          <span id="globalRequestsPage" class="channel-page-number"></span>
          <button id="globalRequestsNext" class="secondary" type="button">다음</button>
        </div>
      </div>
    </section>`;

  document.body.appendChild(modal);
  modal.querySelectorAll("[data-close-global-requests]").forEach((element) => {
    element.addEventListener("click", closeRequestsModal);
  });
  modal.querySelector("#globalRequestsPrev").addEventListener("click", () => {
    if (requestPage > 1) {
      requestPage -= 1;
      renderRequests();
    }
  });
  modal.querySelector("#globalRequestsNext").addEventListener("click", () => {
    requestPage += 1;
    renderRequests();
  });
  return modal;
}

async function loadOwnerUsers() {
  const snapshot = await getDocs(collection(db, "users"));
  ownerUsers = snapshot.docs
    .map((item) => ({ uid: item.id, ...item.data() }))
    .filter((user) => !isDeveloper(user))
    .sort((a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || "", "ko"));
  ownerUsersByUid = new Map(ownerUsers.map((user) => [user.uid, user]));
}

function renderOwnerOptions(preserveUid = "") {
  const modal = ensureCreateModal();
  const search = modal.querySelector("#globalChannelOwnerSearch");
  const select = modal.querySelector("#globalChannelOwner");
  const result = modal.querySelector("#globalChannelOwnerSearchResult");
  const term = String(search.value || "").trim().toLocaleLowerCase("ko");
  const filtered = ownerUsers.filter((user) => {
    if (!term) return true;
    return `${user.name || ""} ${user.email || ""}`.toLocaleLowerCase("ko").includes(term);
  });

  select.innerHTML = "";
  if (!filtered.length) {
    select.innerHTML = '<option value="">검색 결과가 없습니다.</option>';
    result.textContent = "검색 결과 0명";
    return;
  }

  filtered.forEach((user) => {
    const option = document.createElement("option");
    option.value = user.uid;
    option.textContent = `${user.name || user.email || "사용자"} · ${user.email || ""}`;
    select.appendChild(option);
  });
  result.textContent = `검색 결과 ${filtered.length}명`;
  if (preserveUid && filtered.some((user) => user.uid === preserveUid)) select.value = preserveUid;
}

async function openCreateModal(ownerUid = "") {
  if (!isDeveloper(currentProfile)) return;
  const modal = ensureCreateModal();
  const message = modal.querySelector("#globalCreateChannelMessage");
  const search = modal.querySelector("#globalChannelOwnerSearch");
  message.textContent = "";

  if (!ownerUsers.length) {
    try {
      await loadOwnerUsers();
    } catch (error) {
      console.error("채널 소유자 목록 조회 실패", error);
      message.textContent = firebaseErrorMessage(error, "채널 소유자 목록을 불러오지 못했습니다.");
    }
  }

  if (ownerUid && ownerUsersByUid.has(ownerUid)) {
    const owner = ownerUsersByUid.get(ownerUid);
    search.value = owner.name || owner.email || "";
    renderOwnerOptions(ownerUid);
  } else {
    search.value = "";
    renderOwnerOptions();
  }

  modal.classList.remove("hidden");
  document.body.classList.add("modal-open");
  requestAnimationFrame(() => modal.querySelector("#globalChannelName")?.focus());
}

function closeCreateModal() {
  document.getElementById("globalCreateChannelModal")?.classList.add("hidden");
  document.body.classList.remove("modal-open");
  selectedRequestUid = "";
}

function openRequestsModal() {
  if (!isDeveloper(currentProfile)) return;
  requestPage = 1;
  ensureRequestsModal().classList.remove("hidden");
  document.body.classList.add("modal-open");
  renderRequests();
}

function closeRequestsModal() {
  document.getElementById("globalChannelRequestsModal")?.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

async function getRandomChannelPhoto() {
  const result = await listAll(storageRef(storage, "channel-defaults"));
  const images = result.items.filter((item) => /\.(jpg|jpeg|png|webp)$/i.test(item.name));
  if (!images.length) return "";
  const random = images[Math.floor(Math.random() * images.length)];
  return getDownloadURL(random);
}

async function createChannel(event) {
  event.preventDefault();
  if (!isDeveloper(currentProfile) || !currentUser) return;

  const modal = ensureCreateModal();
  const nameInput = modal.querySelector("#globalChannelName");
  const ownerSelect = modal.querySelector("#globalChannelOwner");
  const message = modal.querySelector("#globalCreateChannelMessage");
  const submit = modal.querySelector("#globalCreateChannelSubmit");
  const name = nameInput.value.trim();
  const ownerUid = ownerSelect.value;
  const owner = ownerUsersByUid.get(ownerUid);

  message.textContent = "";
  message.classList.remove("success");

  if (!name) {
    message.textContent = "채널 이름을 입력해주세요.";
    nameInput.focus();
    return;
  }
  if (!owner) {
    message.textContent = "채널 소유자를 선택해주세요.";
    return;
  }

  submit.disabled = true;
  submit.textContent = "생성 중...";

  try {
    let photoURL = "";
    try {
      photoURL = await getRandomChannelPhoto();
    } catch (error) {
      console.warn("기본 대표사진 선택 실패", error);
    }

    const channelRef = doc(collection(db, "channels"));
    const memberRef = doc(db, "channels", channelRef.id, "members", ownerUid);
    const mirrorRef = doc(db, "users", ownerUid, "memberships", channelRef.id);
    const directoryRef = doc(db, "channelDirectory", channelRef.id);
    const requestRef = selectedRequestUid ? doc(db, "channelCreationRequests", selectedRequestUid) : null;

    await runTransaction(db, async (transaction) => {
      transaction.set(channelRef, {
        name,
        photoURL,
        ownerUid,
        ownerEmail: owner.email || "",
        createdBy: currentUser.uid,
        status: "active",
        subscriptionStatus: "beta",
        bingoEnabled: true,
        killEnabled: false,
        killPlan: "none",
        maxActiveBingoRoomsPerManager: 5,
        subscriptionStartedAt: null,
        subscriptionEndsAt: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      transaction.set(memberRef, {
        uid: ownerUid,
        name: owner.name || owner.email || "소유자",
        email: owner.email || "",
        role: "owner",
        status: "approved",
        bingoAccess: "write",
        killSheetAccess: "none",
        requestedAt: null,
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      transaction.set(mirrorRef, {
        channelId: channelRef.id,
        channelName: name,
        role: "owner",
        status: "approved",
        requestedAt: null,
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      transaction.set(directoryRef, {
        name,
        photoURL,
        ownerName: owner.name || owner.email || "소유자",
        status: "active",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      if (requestRef && selectedRequestUid === ownerUid) {
        transaction.update(requestRef, {
          status: "approved",
          channelId: channelRef.id,
          approvedAt: serverTimestamp(),
          approvedByUid: currentUser.uid,
          rejectedAt: null,
          rejectedByUid: "",
          updatedAt: serverTimestamp()
        });
      }
    });

    modal.querySelector("#globalCreateChannelForm").reset();
    selectedRequestUid = "";
    closeCreateModal();
  } catch (error) {
    console.error("채널 생성 실패", error);
    message.textContent = firebaseErrorMessage(error, "채널 생성에 실패했습니다.");
  } finally {
    submit.disabled = false;
    submit.textContent = "채널 생성";
  }
}

function formatRequestDate(value) {
  const date = value?.toDate?.();
  if (!date) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function renderRequests() {
  const modal = ensureRequestsModal();
  const list = modal.querySelector("#globalRequestsList");
  const pagination = modal.querySelector("#globalRequestsPagination");
  const message = modal.querySelector("#globalRequestsMessage");
  list.innerHTML = "";

  if (!pendingRequests.length) {
    list.innerHTML = '<div class="channel-request-empty">현재 대기 중인 채널 생성 신청이 없습니다.</div>';
    pagination.classList.add("hidden");
    return;
  }

  const totalPages = Math.max(1, Math.ceil(pendingRequests.length / REQUEST_PAGE_SIZE));
  requestPage = Math.min(Math.max(1, requestPage), totalPages);
  const start = (requestPage - 1) * REQUEST_PAGE_SIZE;
  const items = pendingRequests.slice(start, start + REQUEST_PAGE_SIZE);

  items.forEach((request) => {
    const item = document.createElement("article");
    item.className = "channel-request-item";
    item.innerHTML = `
      <div class="channel-request-info">
        <strong>${escapeHtml(request.requesterName || request.requesterEmail || "사용자")}</strong>
        <span>${escapeHtml(request.requesterEmail || "")}</span>
        <small>신청 ${escapeHtml(formatRequestDate(request.createdAt))}</small>
      </div>
      <div class="channel-request-actions">
        <button class="secondary create-request-channel" type="button">이 사용자로 채널 생성</button>
        <button class="danger-outline reject-request-channel" type="button">거절</button>
      </div>`;

    item.querySelector(".create-request-channel").addEventListener("click", async () => {
      if (!ownerUsers.length) {
        try {
          await loadOwnerUsers();
        } catch (error) {
          console.error(error);
        }
      }
      if (!ownerUsersByUid.has(request.requesterUid)) {
        message.textContent = "신청 사용자를 채널 소유자 목록에서 찾을 수 없습니다.";
        return;
      }
      selectedRequestUid = request.requesterUid;
      closeRequestsModal();
      await openCreateModal(request.requesterUid);
    });

    item.querySelector(".reject-request-channel").addEventListener("click", async () => {
      const confirmed = await showConfirm(
        `${request.requesterName || request.requesterEmail || "선택한 사용자"}님의 채널 생성 신청을 거절할까요?`,
        { title: "채널 생성 신청 거절", confirmText: "거절", danger: true }
      );
      if (!confirmed) return;
      try {
        await updateDoc(doc(db, "channelCreationRequests", request.id), {
          status: "rejected",
          rejectedAt: serverTimestamp(),
          rejectedByUid: currentUser.uid,
          approvedAt: null,
          approvedByUid: "",
          channelId: "",
          updatedAt: serverTimestamp()
        });
        message.textContent = "채널 생성 신청을 거절했습니다.";
        message.classList.add("success");
      } catch (error) {
        console.error("채널 생성 신청 거절 실패", error);
        message.textContent = firebaseErrorMessage(error, "채널 생성 신청 거절에 실패했습니다.");
        message.classList.remove("success");
      }
    });

    list.appendChild(item);
  });

  if (pendingRequests.length <= REQUEST_PAGE_SIZE) {
    pagination.classList.add("hidden");
    return;
  }

  pagination.classList.remove("hidden");
  modal.querySelector("#globalRequestsSummary").textContent = `총 ${pendingRequests.length}건 · ${start + 1}-${start + items.length}건 표시`;
  modal.querySelector("#globalRequestsPage").textContent = `${requestPage} / ${totalPages}`;
  modal.querySelector("#globalRequestsPrev").disabled = requestPage <= 1;
  modal.querySelector("#globalRequestsNext").disabled = requestPage >= totalPages;
}

function startRequestWatcher() {
  if (requestUnsubscribe || !isDeveloper(currentProfile)) return;
  requestUnsubscribe = onSnapshot(
    query(collection(db, "channelCreationRequests"), where("status", "==", "pending")),
    (snapshot) => {
      pendingRequests = snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      const badge = document.getElementById("globalChannelRequestBadge");
      if (badge) {
        badge.textContent = pendingRequests.length > 99 ? "99+" : String(pendingRequests.length);
        badge.classList.toggle("hidden", pendingRequests.length === 0);
      }
      if (!document.getElementById("globalChannelRequestsModal")?.classList.contains("hidden")) renderRequests();
    },
    (error) => console.error("채널 생성 신청 실시간 조회 실패", error)
  );
}

export async function initDeveloperChannelTools(user, profile) {
  currentUser = user;
  currentProfile = profile;
  if (!isDeveloper(currentProfile)) return;
  ensureButtons();
  ensureCreateModal();
  ensureRequestsModal();
  startRequestWatcher();
  try {
    await loadOwnerUsers();
    renderOwnerOptions();
  } catch (error) {
    console.error("개발자 채널 도구 사용자 목록 조회 실패", error);
  }
}
