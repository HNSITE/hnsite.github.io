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
  Timestamp,
  updateDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  getDownloadURL,
  listAll,
  ref as storageRef
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js";
import { isDeveloper, setCurrentChannelId } from "./channel-context.js";
import { firebaseErrorMessage } from "./error-messages.js";
import { showConfirm } from "./ui-dialog.js";
import { openChannelMemberManagement } from "./channel-members.js";

const REQUEST_PAGE_SIZE = 10;
const CHANNEL_MANAGE_PAGE_SIZE = 6;
const MEMBER_BATCH_SIZE = 400;

let currentUser = null;
let currentProfile = null;
let currentContext = null;
let ownerUsers = [];
let ownerUsersByUid = new Map();
let pendingRequests = [];
let requestPage = 1;
let requestUnsubscribe = null;
let selectedRequestUid = "";
let managedChannels = [];
let channelManageSearch = "";
let channelManageStatus = "all";
let channelManagePage = 1;

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

  let manageButton = document.getElementById("globalChannelManagementButton");
  if (!manageButton) {
    manageButton = document.createElement("button");
    manageButton.id = "globalChannelManagementButton";
    manageButton.className = "topbar-link global-channel-management-button";
    manageButton.type = "button";
    manageButton.textContent = "전체 채널 관리";

    const anchor =
      document.getElementById("openCreateChannelButton") ||
      document.getElementById("globalCreateChannelButton") ||
      nav.querySelector(".topbar-email");
    nav.insertBefore(manageButton, anchor || nav.firstChild);
  }

  const pageCreateButton = document.getElementById("openCreateChannelButton");
  let createButton = document.getElementById("globalCreateChannelButton");
  if (!pageCreateButton && !createButton) {
    createButton = document.createElement("button");
    createButton.id = "globalCreateChannelButton";
    createButton.className = "channel-create-top-button";
    createButton.type = "button";
    createButton.innerHTML = '<span class="channel-create-plus">＋</span><span>채널 생성</span>';
    const email = nav.querySelector(".topbar-email");
    nav.insertBefore(createButton, email || nav.firstChild);
  }

  const pageRequestButton = document.getElementById("openChannelRequestsButton");
  let requestButton = document.getElementById("globalChannelRequestsButton");
  if (!pageRequestButton && !requestButton) {
    requestButton = document.createElement("button");
    requestButton.id = "globalChannelRequestsButton";
    requestButton.className = "channel-request-admin-button";
    requestButton.type = "button";
    requestButton.innerHTML = '채널 신청 <span id="globalChannelRequestBadge" class="channel-request-badge hidden">0</span>';
    const email = nav.querySelector(".topbar-email");
    nav.insertBefore(requestButton, email || nav.firstChild);
  }

  if (!manageButton.dataset.bound) {
    manageButton.dataset.bound = "1";
    manageButton.addEventListener("click", openChannelManagement);
  }

  if (createButton && !createButton.dataset.bound) {
    createButton.dataset.bound = "1";
    createButton.addEventListener("click", () => openCreateModal());
  }

  if (requestButton && !requestButton.dataset.bound) {
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
          <p class="muted">채널 이름, 소유자와 사용할 기능을 지정합니다.</p>
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
        <fieldset class="channel-feature-fieldset">
          <legend>사용 기능</legend>
          <div class="channel-feature-options">
            <label class="channel-feature-option">
              <input id="globalChannelFeatureBingo" type="checkbox" checked />
              <span>빙고</span>
            </label>
            <label class="channel-feature-option">
              <input id="globalChannelFeatureKill" type="checkbox" />
              <span>킬내기</span>
            </label>
          </div>
          <small class="muted">활성 채널은 하나 이상의 기능을 사용해야 하며 두 기능 모두 선택할 수 있습니다.</small>
        </fieldset>
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

function ensureChannelManagementModal() {
  let modal = document.getElementById("globalChannelManagementModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "globalChannelManagementModal";
  modal.className = "admin-modal hidden";
  modal.innerHTML = `
    <div class="admin-modal-backdrop" data-close-global-channel-management></div>
    <section class="admin-modal-dialog global-channel-management-dialog" role="dialog" aria-modal="true" aria-labelledby="globalChannelManagementTitle">
      <div class="admin-modal-header">
        <div>
          <p class="eyebrow">CHANNEL CONTROL</p>
          <h2 id="globalChannelManagementTitle">전체 채널 관리</h2>
          <p class="muted">모든 채널의 이용 상태와 제공 기능을 한 곳에서 관리합니다.</p>
        </div>
        <button class="modal-close-button" data-close-global-channel-management type="button" aria-label="닫기">×</button>
      </div>

      <div class="global-channel-management-toolbar">
        <input id="globalChannelManageSearch" type="search" placeholder="채널 이름 또는 소유자 검색" autocomplete="off" />
        <select id="globalChannelManageStatus" aria-label="채널 상태 필터">
          <option value="all">전체 채널</option>
          <option value="active">활성</option>
          <option value="suspended">비활성</option>
        </select>
        <div id="globalChannelManageStats" class="global-channel-management-stats"></div>
      </div>

      <p id="globalChannelManageMessage" class="message admin-modal-message"></p>
      <div id="globalChannelManageList" class="global-channel-management-list"></div>

      <div id="globalChannelManagePagination" class="channel-pagination global-channel-management-pagination hidden">
        <span id="globalChannelManageSummary" class="channel-page-summary"></span>
        <div class="channel-page-buttons">
          <button id="globalChannelManagePrev" class="secondary" type="button">이전</button>
          <span id="globalChannelManagePage" class="channel-page-number"></span>
          <button id="globalChannelManageNext" class="secondary" type="button">다음</button>
        </div>
      </div>
    </section>`;

  document.body.appendChild(modal);

  modal.querySelectorAll("[data-close-global-channel-management]").forEach((element) => {
    element.addEventListener("click", closeChannelManagement);
  });

  modal.querySelector("#globalChannelManageSearch").addEventListener("input", (event) => {
    channelManageSearch = event.target.value.trim();
    channelManagePage = 1;
    renderChannelManagement();
  });

  modal.querySelector("#globalChannelManageStatus").addEventListener("change", (event) => {
    channelManageStatus = event.target.value;
    channelManagePage = 1;
    renderChannelManagement();
  });

  modal.querySelector("#globalChannelManagePrev").addEventListener("click", () => {
    if (channelManagePage > 1) {
      channelManagePage -= 1;
      renderChannelManagement();
    }
  });

  modal.querySelector("#globalChannelManageNext").addEventListener("click", () => {
    channelManagePage += 1;
    renderChannelManagement();
  });

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
  if (preserveUid && filtered.some((user) => user.uid === preserveUid)) {
    select.value = preserveUid;
  }
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

  modal.querySelector("#globalChannelFeatureBingo").checked = true;
  modal.querySelector("#globalChannelFeatureKill").checked = false;
  modal.classList.remove("hidden");
  document.body.classList.add("modal-open");
  requestAnimationFrame(() => modal.querySelector("#globalChannelName")?.focus());
}

function closeCreateModal() {
  document.getElementById("globalCreateChannelModal")?.classList.add("hidden");
  document.body.classList.remove("modal-open");
  selectedRequestUid = "";
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
  const bingoEnabled = modal.querySelector("#globalChannelFeatureBingo").checked;
  const killEnabled = modal.querySelector("#globalChannelFeatureKill").checked;

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
  if (!bingoEnabled && !killEnabled) {
    message.textContent = "빙고와 킬내기 중 하나 이상을 선택해주세요.";
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
        bingoEnabled,
        killEnabled,
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
        bingoAccess: bingoEnabled ? "write" : "none",
        killSheetAccess: killEnabled ? "write" : "none",
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

      const badges = [
        document.getElementById("globalChannelRequestBadge"),
        document.getElementById("channelRequestBadge")
      ].filter(Boolean);

      badges.forEach((badge) => {
        badge.textContent = pendingRequests.length > 99 ? "99+" : String(pendingRequests.length);
        badge.classList.toggle("hidden", pendingRequests.length === 0);
      });

      if (!document.getElementById("globalChannelRequestsModal")?.classList.contains("hidden")) {
        renderRequests();
      }
    },
    (error) => console.error("채널 생성 신청 실시간 조회 실패", error)
  );
}

async function loadManagedChannels() {
  const snapshot = await getDocs(collection(db, "channels"));
  managedChannels = snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .sort((a, b) => {
      const aStatus = a.status === "active" ? 0 : 1;
      const bStatus = b.status === "active" ? 0 : 1;
      if (aStatus !== bStatus) return aStatus - bStatus;
      return (a.name || "").localeCompare(b.name || "", "ko");
    });
}

function managedOwner(channel) {
  return ownerUsersByUid.get(channel.ownerUid) || null;
}

function managedOwnerLabel(channel) {
  const owner = managedOwner(channel);
  return owner?.name || owner?.email || channel.ownerEmail || "소유자 정보 없음";
}

function filteredManagedChannels() {
  const term = channelManageSearch.toLocaleLowerCase("ko");
  return managedChannels.filter((channel) => {
    if (channelManageStatus !== "all" && channel.status !== channelManageStatus) return false;
    if (!term) return true;
    const owner = managedOwnerLabel(channel);
    return `${channel.name || ""} ${owner} ${channel.ownerEmail || ""}`
      .toLocaleLowerCase("ko")
      .includes(term);
  });
}

function dateInputValue(value) {
  const date = value?.toDate?.();
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function timestampFromDateInput(value) {
  if (!value) return null;
  const date = new Date(`${value}T23:59:59`);
  if (Number.isNaN(date.getTime())) return null;
  return Timestamp.fromDate(date);
}

function syncManagedCardStatus(card) {
  const status = card.querySelector('[data-field="status"]').value;
  const bingo = card.querySelector('[data-field="bingo"]');
  const kill = card.querySelector('[data-field="kill"]');
  const suspended = status === "suspended";

  bingo.disabled = suspended;
  kill.disabled = suspended;
  if (suspended) {
    bingo.checked = false;
    kill.checked = false;
  }

  card.classList.toggle("is-suspended", suspended);
  const statusPill = card.querySelector(".global-channel-status-pill");
  statusPill.textContent = suspended ? "비활성" : "활성";
  statusPill.dataset.status = status;
}

function makeManagedChannelCard(channel) {
  const owner = managedOwnerLabel(channel);
  const card = document.createElement("article");
  card.className = `global-channel-management-card${channel.status === "suspended" ? " is-suspended" : ""}`;
  card.dataset.channelId = channel.id;

  card.innerHTML = `
    <div class="global-channel-management-card-head">
      <div>
        <span class="global-channel-status-pill" data-status="${escapeHtml(channel.status || "active")}">${channel.status === "suspended" ? "비활성" : "활성"}</span>
        <strong>${escapeHtml(channel.name || "HNSITE 채널")}</strong>
        <small>소유자 · ${escapeHtml(owner)}</small>
      </div>
    </div>

    <div class="global-channel-management-fields">
      <label>
        채널 이름
        <input data-field="name" type="text" maxlength="40" value="${escapeHtml(channel.name || "")}" />
      </label>

      <label>
        채널 상태
        <select data-field="status">
          <option value="active"${channel.status === "active" ? " selected" : ""}>활성</option>
          <option value="suspended"${channel.status === "suspended" ? " selected" : ""}>비활성</option>
        </select>
      </label>

      <label>
        이용 상태
        <select data-field="subscription">
          <option value="beta"${channel.subscriptionStatus === "beta" ? " selected" : ""}>베타</option>
          <option value="trial"${channel.subscriptionStatus === "trial" ? " selected" : ""}>체험</option>
          <option value="active"${channel.subscriptionStatus === "active" ? " selected" : ""}>이용 중</option>
          <option value="expired"${channel.subscriptionStatus === "expired" ? " selected" : ""}>기간 만료</option>
        </select>
      </label>

      <label>
        이용 종료일
        <input data-field="ends" type="date" value="${escapeHtml(dateInputValue(channel.subscriptionEndsAt))}" />
      </label>
    </div>

    <fieldset class="global-channel-management-features">
      <legend>사용 기능</legend>
      <label><input data-field="bingo" type="checkbox"${channel.bingoEnabled === true ? " checked" : ""} /> 빙고</label>
      <label><input data-field="kill" type="checkbox"${channel.killEnabled === true ? " checked" : ""} /> 킬내기</label>
      <small>활성 상태에서는 하나 이상 선택해야 합니다. 비활성화하면 모든 기능 사용권이 해제됩니다.</small>
    </fieldset>

    <p class="message global-channel-management-card-message"></p>

    <div class="global-channel-management-actions">
      <button class="save-managed-channel" type="button">저장</button>
      <button class="secondary manage-channel-members" type="button">사용자 관리</button>
      <button class="secondary enter-managed-channel" type="button"${channel.status === "active" ? "" : " disabled"}>채널 들어가기</button>
    </div>`;

  card.querySelector('[data-field="status"]').addEventListener("change", () => syncManagedCardStatus(card));
  card.querySelector(".save-managed-channel").addEventListener("click", () => saveManagedChannel(channel, card));
  card.querySelector(".manage-channel-members").addEventListener("click", () => {
    openChannelMemberManagement(channel, currentProfile);
  });
  card.querySelector(".enter-managed-channel").addEventListener("click", () => {
    if (channel.status !== "active") return;
    setCurrentChannelId(currentUser.uid, channel.id);
    location.href = "./app.html";
  });

  syncManagedCardStatus(card);
  return card;
}

function renderChannelManagement() {
  const modal = ensureChannelManagementModal();
  const list = modal.querySelector("#globalChannelManageList");
  const pagination = modal.querySelector("#globalChannelManagePagination");
  const stats = modal.querySelector("#globalChannelManageStats");
  const channels = filteredManagedChannels();

  const activeCount = managedChannels.filter((channel) => channel.status === "active").length;
  const suspendedCount = managedChannels.filter((channel) => channel.status === "suspended").length;
  stats.innerHTML = `<span>전체 <strong>${managedChannels.length}</strong></span><span>활성 <strong>${activeCount}</strong></span><span>비활성 <strong>${suspendedCount}</strong></span>`;

  list.innerHTML = "";
  if (!channels.length) {
    list.innerHTML = '<div class="channel-request-empty">조건에 맞는 채널이 없습니다.</div>';
    pagination.classList.add("hidden");
    return;
  }

  const totalPages = Math.max(1, Math.ceil(channels.length / CHANNEL_MANAGE_PAGE_SIZE));
  channelManagePage = Math.min(Math.max(1, channelManagePage), totalPages);
  const start = (channelManagePage - 1) * CHANNEL_MANAGE_PAGE_SIZE;
  const items = channels.slice(start, start + CHANNEL_MANAGE_PAGE_SIZE);

  items.forEach((channel) => list.appendChild(makeManagedChannelCard(channel)));

  if (channels.length <= CHANNEL_MANAGE_PAGE_SIZE) {
    pagination.classList.add("hidden");
    return;
  }

  pagination.classList.remove("hidden");
  modal.querySelector("#globalChannelManageSummary").textContent = `총 ${channels.length}개 · ${start + 1}-${start + items.length}개 표시`;
  modal.querySelector("#globalChannelManagePage").textContent = `${channelManagePage} / ${totalPages}`;
  modal.querySelector("#globalChannelManagePrev").disabled = channelManagePage <= 1;
  modal.querySelector("#globalChannelManageNext").disabled = channelManagePage >= totalPages;
}

async function updateMemberAccesses(channelId, channelStatus, bingoEnabled, killEnabled) {
  const snapshot = await getDocs(collection(db, "channels", channelId, "members"));
  const editable = snapshot.docs.filter((memberDoc) =>
    ["approved", "active", "suspended"].includes(memberDoc.data().status)
  );

  for (let start = 0; start < editable.length; start += MEMBER_BATCH_SIZE) {
    const batch = writeBatch(db);
    editable.slice(start, start + MEMBER_BATCH_SIZE).forEach((memberDoc) => {
      const member = memberDoc.data();
      const usable = channelStatus === "active" && ["approved", "active"].includes(member.status);
      batch.update(memberDoc.ref, {
        bingoAccess: usable && bingoEnabled ? "write" : "none",
        killSheetAccess: usable && killEnabled ? "write" : "none",
        updatedAt: serverTimestamp()
      });
    });
    await batch.commit();
  }
}

async function saveManagedChannel(channel, card) {
  if (!isDeveloper(currentProfile)) return;

  const message = card.querySelector(".global-channel-management-card-message");
  const saveButton = card.querySelector(".save-managed-channel");
  const name = card.querySelector('[data-field="name"]').value.trim();
  const status = card.querySelector('[data-field="status"]').value;
  const subscriptionStatus = card.querySelector('[data-field="subscription"]').value;
  const subscriptionEndsAt = timestampFromDateInput(card.querySelector('[data-field="ends"]').value);
  const bingoEnabled = status === "active" && card.querySelector('[data-field="bingo"]').checked;
  const killEnabled = status === "active" && card.querySelector('[data-field="kill"]').checked;

  message.textContent = "";
  message.classList.remove("success");

  if (!name) {
    message.textContent = "채널 이름을 입력해주세요.";
    return;
  }

  if (status === "active" && !bingoEnabled && !killEnabled) {
    message.textContent = "활성 채널은 빙고와 킬내기 중 하나 이상을 선택해야 합니다.";
    return;
  }

  if (channel.status === "active" && status === "suspended") {
    const confirmed = await showConfirm(
      `${channel.name || "선택한 채널"}을 비활성화할까요? 비활성화하면 모든 사용자의 빙고·킬내기 이용이 중지됩니다. 기존 데이터는 삭제되지 않습니다.`,
      {
        title: "채널 비활성화",
        confirmText: "비활성화",
        danger: true
      }
    );
    if (!confirmed) {
      card.querySelector('[data-field="status"]').value = channel.status || "active";
      card.querySelector('[data-field="bingo"]').checked = channel.bingoEnabled === true;
      card.querySelector('[data-field="kill"]').checked = channel.killEnabled === true;
      syncManagedCardStatus(card);
      return;
    }
  }

  saveButton.disabled = true;
  saveButton.textContent = "저장 중...";

  try {
    const channelRef = doc(db, "channels", channel.id);
    const directoryRef = doc(db, "channelDirectory", channel.id);
    const directorySnapshot = await getDoc(directoryRef);
    const ownerName = managedOwnerLabel(channel);
    const batch = writeBatch(db);

    batch.update(channelRef, {
      name,
      status,
      subscriptionStatus,
      bingoEnabled,
      killEnabled,
      subscriptionEndsAt,
      updatedAt: serverTimestamp()
    });

    if (directorySnapshot.exists()) {
      batch.update(directoryRef, {
        name,
        photoURL: channel.photoURL || "",
        ownerName,
        status,
        updatedAt: serverTimestamp()
      });
    } else {
      batch.set(directoryRef, {
        name,
        photoURL: channel.photoURL || "",
        ownerName,
        status,
        createdAt: channel.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }

    await batch.commit();
    await updateMemberAccesses(channel.id, status, bingoEnabled, killEnabled);

    channel.name = name;
    channel.status = status;
    channel.subscriptionStatus = subscriptionStatus;
    channel.subscriptionEndsAt = subscriptionEndsAt;
    channel.bingoEnabled = bingoEnabled;
    channel.killEnabled = killEnabled;

    message.textContent = status === "suspended"
      ? "채널을 비활성화하고 모든 기능 이용을 중지했습니다."
      : "채널 설정을 저장했습니다.";
    message.classList.add("success");

    const enterButton = card.querySelector(".enter-managed-channel");
    enterButton.disabled = status !== "active";

    if (currentContext?.channelId === channel.id) {
      currentContext.channel = { ...currentContext.channel, ...channel };
      setTimeout(() => {
        if (status === "suspended") location.href = "./channels.html";
        else location.reload();
      }, 500);
    } else {
      await loadManagedChannels();
      setTimeout(renderChannelManagement, 250);
    }
  } catch (error) {
    console.error("전체 채널 설정 저장 실패", error);
    message.textContent = firebaseErrorMessage(error, "채널 설정을 저장하지 못했습니다.");
    message.classList.remove("success");
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "저장";
  }
}

async function openChannelManagement() {
  if (!isDeveloper(currentProfile)) return;

  const modal = ensureChannelManagementModal();
  const message = modal.querySelector("#globalChannelManageMessage");
  message.textContent = "채널 정보를 불러오는 중...";
  message.classList.remove("success");
  modal.classList.remove("hidden");
  document.body.classList.add("modal-open");

  try {
    if (!ownerUsers.length) await loadOwnerUsers();
    await loadManagedChannels();
    channelManagePage = 1;
    message.textContent = "";
    renderChannelManagement();
  } catch (error) {
    console.error("전체 채널 조회 실패", error);
    message.textContent = firebaseErrorMessage(error, "전체 채널을 불러오지 못했습니다.");
  }
}

function closeChannelManagement() {
  document.getElementById("globalChannelManagementModal")?.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

export async function initDeveloperChannelTools(user, profile, context = null) {
  currentUser = user;
  currentProfile = profile;
  currentContext = context;
  if (!isDeveloper(currentProfile)) return;

  ensureButtons();
  ensureCreateModal();
  ensureChannelManagementModal();
  ensureRequestsModal();

  // channels.html에는 자체 채널 신청 관리가 있으므로 중복 구독을 만들지 않는다.
  if (document.getElementById("globalChannelRequestsButton")) {
    startRequestWatcher();
  }

  try {
    await loadOwnerUsers();
    renderOwnerOptions();
  } catch (error) {
    console.error("개발자 채널 도구 사용자 목록 조회 실패", error);
  }
}
