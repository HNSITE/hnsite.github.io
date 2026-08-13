import { db, storage } from "./firebase-config.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  deleteObject,
  ref as storageRef
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js";
import { showConfirm, showNotice } from "./ui-dialog.js?v=14";
import { firebaseErrorMessage } from "./error-messages.js?v=25";

const PAGE_SIZE = 10;
const AUDIT_PAGE_SIZE = 20;

let currentProfile = null;
let allUsers = [];
let activeTab = "pending";
let initialized = false;
let pendingUsersUnsubscribe = null;
let auditLogs = [];
let auditPage = 1;

const tabState = {
  pending: { search: "", sortKey: "name", sortDir: "asc", page: 1 },
  approved: { search: "", sortKey: "name", sortDir: "asc", page: 1 }
};

const accessLabel = (value) => ({ none: "권한 없음", read: "읽기", write: "쓰기" }[value] || "권한 없음");
const roleLabel = (value) => ({ super_admin: "최고관리자", admin: "관리자", user: "일반사용자" }[value] || value);
const statusLabel = (value) => ({ pending: "승인대기", approved: "승인", suspended: "사용중지" }[value] || value);
const isManager = () => ["super_admin", "admin"].includes(currentProfile?.role);

function currentTabState() {
  return tabState[activeTab];
}

function ensureModal() {
  if (document.getElementById("userManagementModal")) return;

  const modal = document.createElement("div");
  modal.id = "userManagementModal";
  modal.className = "admin-modal hidden";
  modal.innerHTML = `
    <div class="admin-modal-backdrop" data-close-admin-modal></div>
    <section class="admin-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="adminModalTitle">
      <div class="admin-modal-header">
        <div>
          <p class="eyebrow">ADMIN</p>
          <h2 id="adminModalTitle">사용자 관리</h2>
          <p class="muted">승인 요청, 서비스 권한, 관리자 변경 이력을 관리합니다.</p>
        </div>
        <div class="admin-modal-header-actions">
          <button id="adminRefreshUsers" class="secondary compact-button" type="button">새로고침</button>
          <button id="adminModalClose" class="modal-close-button" type="button" aria-label="사용자 관리 닫기">×</button>
        </div>
      </div>

      <div class="admin-tabs" role="tablist" aria-label="사용자 상태 구분">
        <button id="pendingUsersTab" class="admin-tab active" type="button" role="tab" aria-selected="true" data-admin-tab="pending">
          승인 대기 <span id="pendingUsersCount" class="tab-count">0</span>
        </button>
        <button id="approvedUsersTab" class="admin-tab" type="button" role="tab" aria-selected="false" data-admin-tab="approved">
          승인 완료 <span id="approvedUsersCount" class="tab-count">0</span>
        </button>
        <button id="auditLogsTab" class="admin-tab" type="button" role="tab" aria-selected="false" data-admin-tab="audit">
          관리 이력
        </button>
      </div>

      <div id="adminUserToolbar" class="admin-user-toolbar">
        <div class="admin-user-search-wrap">
          <label for="adminUserSearch">사용자 검색</label>
          <input id="adminUserSearch" type="search" placeholder="이름 또는 이메일 검색" autocomplete="off" />
        </div>
        <div class="admin-user-sort-wrap">
          <label for="adminUserSort">정렬</label>
          <select id="adminUserSort">
            <option value="name">이름</option>
            <option value="role">구분</option>
            <option value="status">상태</option>
          </select>
          <button id="adminUserSortDirection" class="secondary admin-sort-direction" type="button">오름차순 ↑</button>
        </div>
      </div>

      <p id="adminModalMessage" class="message admin-modal-message"></p>

      <div id="adminUserTableWrap" class="table-wrap admin-modal-table-wrap">
        <table class="admin-user-table">
          <thead>
            <tr>
              <th>이름</th>
              <th>이메일</th>
              <th>구분</th>
              <th>상태</th>
              <th>빙고</th>
              <th>킬내기</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody id="adminUsersBody"></tbody>
        </table>
      </div>
      <div id="adminUsersEmpty" class="admin-users-empty hidden"></div>

      <div id="adminUsersPagination" class="admin-users-pagination hidden">
        <span id="adminUsersPageSummary" class="admin-page-summary"></span>
        <div class="admin-page-buttons">
          <button id="adminUsersPrev" class="secondary" type="button">이전</button>
          <span id="adminUsersPageNumber" class="admin-page-number"></span>
          <button id="adminUsersNext" class="secondary" type="button">다음</button>
        </div>
      </div>

      <div id="adminAuditPanel" class="admin-audit-panel hidden">
        <div class="table-wrap admin-audit-table-wrap">
          <table class="admin-audit-table">
            <thead><tr><th>시간</th><th>관리자</th><th>작업</th><th>대상</th><th>내용</th></tr></thead>
            <tbody id="adminAuditBody"></tbody>
          </table>
        </div>
        <div id="adminAuditEmpty" class="admin-users-empty hidden">관리 이력이 없습니다.</div>
        <div id="adminAuditPagination" class="admin-users-pagination hidden">
          <span id="adminAuditSummary" class="admin-page-summary"></span>
          <div class="admin-page-buttons">
            <button id="adminAuditPrev" class="secondary" type="button">이전</button>
            <span id="adminAuditPageNumber" class="admin-page-number"></span>
            <button id="adminAuditNext" class="secondary" type="button">다음</button>
          </div>
        </div>
      </div>
    </section>
  `;
  document.body.appendChild(modal);

  document.getElementById("adminModalClose").addEventListener("click", closeUserManagementModal);
  modal.querySelector("[data-close-admin-modal]").addEventListener("click", closeUserManagementModal);
  document.getElementById("adminRefreshUsers").addEventListener("click", async () => {
    if (activeTab === "audit") await loadAuditLogs();
    else await loadUsers();
  });

  modal.querySelectorAll("[data-admin-tab]").forEach((button) => {
    button.addEventListener("click", async () => {
      activeTab = button.dataset.adminTab;
      renderTabs();
      if (activeTab === "audit") {
        await loadAuditLogs();
      } else {
        syncControlsFromState();
        renderUsers();
      }
    });
  });

  document.getElementById("adminUserSearch").addEventListener("input", (event) => {
    const state = currentTabState();
    state.search = event.target.value;
    state.page = 1;
    renderUsers();
  });

  document.getElementById("adminUserSort").addEventListener("change", (event) => {
    const state = currentTabState();
    state.sortKey = event.target.value;
    state.page = 1;
    renderUsers();
  });

  document.getElementById("adminUserSortDirection").addEventListener("click", () => {
    const state = currentTabState();
    state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
    state.page = 1;
    syncControlsFromState();
    renderUsers();
  });

  document.getElementById("adminUsersPrev").addEventListener("click", () => {
    const state = currentTabState();
    if (state.page <= 1) return;
    state.page -= 1;
    renderUsers();
  });

  document.getElementById("adminUsersNext").addEventListener("click", () => {
    const state = currentTabState();
    state.page += 1;
    renderUsers();
  });

  document.getElementById("adminAuditPrev").addEventListener("click", () => {
    if (auditPage <= 1) return;
    auditPage -= 1;
    renderAuditLogs();
  });

  document.getElementById("adminAuditNext").addEventListener("click", () => {
    auditPage += 1;
    renderAuditLogs();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.classList.contains("hidden")) {
      closeUserManagementModal();
    }
  });
}

function ensurePendingRequestBadge(button) {
  let badge = button.querySelector("#userManagePendingBadge");
  if (badge) return badge;

  const label = document.createElement("span");
  label.textContent = "사용자 관리";

  badge = document.createElement("span");
  badge.id = "userManagePendingBadge";
  badge.className = "admin-pending-badge hidden";
  badge.textContent = "0";
  badge.setAttribute("aria-label", "승인 대기 0명");

  button.replaceChildren(label, badge);
  return badge;
}

function ensureManageButton() {
  if (!isManager()) return null;

  let button = document.getElementById("userManageButton");
  if (button) {
    ensurePendingRequestBadge(button);
    return button;
  }

  const nav = document.querySelector(".topbar-user");
  if (!nav) return null;

  button = document.createElement("button");
  button.id = "userManageButton";
  button.type = "button";
  button.className = "topbar-link admin-manage-button";
  ensurePendingRequestBadge(button);

  const email = nav.querySelector(".topbar-email");
  nav.insertBefore(button, email || nav.firstChild);
  return button;
}

function setPendingRequestBadge(count) {
  const badge = document.getElementById("userManagePendingBadge");
  if (!badge) return;

  const safeCount = Math.max(0, Number(count) || 0);
  badge.textContent = safeCount > 99 ? "99+" : String(safeCount);
  badge.classList.toggle("hidden", safeCount === 0);
  badge.setAttribute("aria-label", `승인 대기 ${safeCount}명`);
}

function startPendingUsersWatcher() {
  if (pendingUsersUnsubscribe || !isManager()) return;

  const pendingQuery = query(collection(db, "users"), where("status", "==", "pending"));
  pendingUsersUnsubscribe = onSnapshot(
    pendingQuery,
    (snapshot) => setPendingRequestBadge(snapshot.size),
    (error) => {
      console.error("Failed to watch pending users.", error);
      setPendingRequestBadge(0);
    }
  );
}

export function initUserManagementModal(profile) {
  currentProfile = profile;
  if (!isManager()) return { open: () => {} };

  ensureModal();
  const button = ensureManageButton();
  if (button && !button.dataset.adminModalBound) {
    button.dataset.adminModalBound = "true";
    button.addEventListener("click", openUserManagementModal);
  }

  startPendingUsersWatcher();
  initialized = true;
  return { open: openUserManagementModal };
}

export async function openUserManagementModal() {
  if (!initialized || !isManager()) return;
  ensureModal();
  const modal = document.getElementById("userManagementModal");
  modal.classList.remove("hidden");
  document.body.classList.add("modal-open");
  activeTab = "pending";
  syncControlsFromState();
  renderTabs();
  await loadUsers();
}

export function closeUserManagementModal() {
  const modal = document.getElementById("userManagementModal");
  if (!modal) return;
  modal.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

async function loadUsers() {
  const message = document.getElementById("adminModalMessage");
  if (!message) return;
  message.textContent = "불러오는 중...";

  try {
    const snap = await getDocs(collection(db, "users"));
    allUsers = snap.docs.map((item) => ({ uid: item.id, ...item.data() }));

    const pendingCount = allUsers.filter((user) => user.status === "pending").length;
    document.getElementById("pendingUsersCount").textContent = String(pendingCount);
    setPendingRequestBadge(pendingCount);
    document.getElementById("approvedUsersCount").textContent = String(allUsers.filter((user) => user.status !== "pending").length);
    message.textContent = "";
    renderTabs();
    syncControlsFromState();
    renderUsers();
  } catch (error) {
    console.error(error);
    message.textContent = firebaseErrorMessage(error, "사용자 목록을 불러오지 못했습니다.");
  }
}

function renderTabs() {
  document.querySelectorAll("[data-admin-tab]").forEach((button) => {
    const selected = button.dataset.adminTab === activeTab;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", selected ? "true" : "false");
  });

  const audit = activeTab === "audit";
  document.getElementById("adminUserToolbar")?.classList.toggle("hidden", audit);
  document.getElementById("adminUserTableWrap")?.classList.toggle("hidden", audit);
  document.getElementById("adminUsersEmpty")?.classList.toggle("admin-view-hidden", audit);
  document.getElementById("adminUsersPagination")?.classList.toggle("admin-view-hidden", audit);
  document.getElementById("adminAuditPanel")?.classList.toggle("hidden", !audit);
}

function syncControlsFromState() {
  const state = currentTabState();
  const search = document.getElementById("adminUserSearch");
  const sort = document.getElementById("adminUserSort");
  const direction = document.getElementById("adminUserSortDirection");
  if (!search || !sort || !direction) return;

  search.value = state.search;
  sort.value = state.sortKey;
  direction.textContent = state.sortDir === "asc" ? "오름차순 ↑" : "내림차순 ↓";
}

function filteredSortedUsers() {
  const state = currentTabState();
  const query = state.search.trim().toLocaleLowerCase("ko");

  const users = allUsers.filter((user) => {
    const inTab = activeTab === "pending"
      ? user.status === "pending"
      : user.status !== "pending";
    if (!inTab) return false;
    if (!query) return true;

    const haystack = `${user.name || ""} ${user.email || ""}`.toLocaleLowerCase("ko");
    return haystack.includes(query);
  });

  const roleRank = { super_admin: 0, admin: 1, user: 2 };
  const statusRank = { pending: 0, approved: 1, suspended: 2 };

  users.sort((a, b) => {
    let result = 0;
    if (state.sortKey === "role") {
      result = (roleRank[a.role] ?? 9) - (roleRank[b.role] ?? 9);
    } else if (state.sortKey === "status") {
      result = (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9);
    } else {
      result = (a.name || a.email || "").localeCompare(b.name || b.email || "", "ko");
    }

    if (result === 0) {
      result = (a.name || a.email || "").localeCompare(b.name || b.email || "", "ko");
    }
    return state.sortDir === "asc" ? result : -result;
  });

  return users;
}

function formatAuditTime(value) {
  const date = value?.toDate?.();
  if (!date) return "방금 전";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

const auditActionLabel = (action) => ({
  user_approve: "사용자 승인",
  user_suspend: "사용중지",
  user_resume: "사용재개",
  permission_change: "권한 변경",
  user_delete: "사용자 삭제",
  admin_promote: "관리자 지정",
  admin_demote: "관리자 해제",
  update_create: "업데이트 등록",
  update_edit: "업데이트 수정",
  update_delete: "업데이트 삭제"
}[action] || action || "관리 작업");

async function writeAudit(action, target = {}, detail = "") {
  if (!isManager()) return;
  try {
    await addDoc(collection(db, "adminAuditLogs"), {
      actorUid: currentProfile.uid || "",
      actorName: currentProfile.name || currentProfile.email || "관리자",
      actorEmail: currentProfile.email || "",
      action,
      targetUid: target.uid || "",
      targetName: target.name || target.email || target.title || "",
      targetEmail: target.email || "",
      detail: String(detail || "").slice(0, 500),
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.error("관리 이력 저장 실패", error);
  }
}

async function loadAuditLogs() {
  const message = document.getElementById("adminModalMessage");
  if (message) message.textContent = "관리 이력을 불러오는 중...";
  try {
    const snap = await getDocs(collection(db, "adminAuditLogs"));
    auditLogs = snap.docs.map((item) => ({ id: item.id, ...item.data() }));
    auditLogs.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    auditPage = Math.min(auditPage, Math.max(1, Math.ceil(auditLogs.length / AUDIT_PAGE_SIZE)));
    if (message) message.textContent = "";
    renderAuditLogs();
  } catch (error) {
    console.error(error);
    if (message) message.textContent = firebaseErrorMessage(error, "관리 이력을 불러오지 못했습니다.");
  }
}

function renderAuditLogs() {
  const body = document.getElementById("adminAuditBody");
  const empty = document.getElementById("adminAuditEmpty");
  const pagination = document.getElementById("adminAuditPagination");
  if (!body || !empty || !pagination) return;

  const totalPages = Math.max(1, Math.ceil(auditLogs.length / AUDIT_PAGE_SIZE));
  auditPage = Math.min(Math.max(1, auditPage), totalPages);
  const start = (auditPage - 1) * AUDIT_PAGE_SIZE;
  const page = auditLogs.slice(start, start + AUDIT_PAGE_SIZE);
  body.innerHTML = "";
  empty.classList.toggle("hidden", auditLogs.length > 0);
  pagination.classList.toggle("hidden", auditLogs.length === 0);

  page.forEach((log) => {
    const row = document.createElement("tr");
    addCell(row, formatAuditTime(log.createdAt));
    addCell(row, log.actorName || log.actorEmail || "관리자");
    addCell(row, auditActionLabel(log.action));
    addCell(row, log.targetName || log.targetEmail || "-");
    addCell(row, log.detail || "-");
    body.appendChild(row);
  });

  if (auditLogs.length) {
    const end = Math.min(start + page.length, auditLogs.length);
    document.getElementById("adminAuditSummary").textContent = `총 ${auditLogs.length}건 · ${start + 1}-${end}건 표시`;
    document.getElementById("adminAuditPageNumber").textContent = `${auditPage} / ${totalPages}`;
    document.getElementById("adminAuditPrev").disabled = auditPage <= 1;
    document.getElementById("adminAuditNext").disabled = auditPage >= totalPages;
  }
}

function makeAccessSelect(user, field, editable) {
  const select = document.createElement("select");
  ["none", "read", "write"].forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = accessLabel(value);
    option.selected = user[field] === value;
    select.appendChild(option);
  });
  select.disabled = !editable;

  if (editable) {
    select.addEventListener("change", async () => {
      const previous = user[field] || "none";
      try {
        await updateDoc(doc(db, "users", user.uid), { [field]: select.value });
        user[field] = select.value;
        await writeAudit("permission_change", user, `${field === "bingoAccess" ? "빙고" : "킬내기"}: ${accessLabel(previous)} → ${accessLabel(select.value)}`);
      } catch (error) {
        console.error(error);
        await showNotice(firebaseErrorMessage(error, "권한 변경에 실패했습니다."));
        select.value = previous;
      }
    });
  }
  return select;
}

function makeButton(text, onClick, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  if (className) button.className = className;
  button.addEventListener("click", onClick);
  return button;
}

function addCell(row, content) {
  const cell = document.createElement("td");
  if (content instanceof Node) cell.appendChild(content);
  else cell.textContent = content;
  row.appendChild(cell);
}

async function deleteRoomImageForAdmin(roomId) {
  try {
    await deleteObject(storageRef(storage, `bingoImages/${roomId}/board.webp`));
  } catch (error) {
    if (error?.code !== "storage/object-not-found") throw error;
  }
}

async function deleteActiveMembershipIfMatches(uid, roomId) {
  const membershipRef = doc(db, "bingoMemberships", uid);
  const snap = await getDoc(membershipRef);
  if (!snap.exists()) return;
  if (snap.data().roomId === roomId) await deleteDoc(membershipRef);
}

async function deleteChickenLogsForAdmin(roomId) {
  const snap = await getDocs(collection(db, "bingoRooms", roomId, "chickenLogs"));
  const items = [...snap.docs];
  for (let start = 0; start < items.length; start += 400) {
    const batch = writeBatch(db);
    items.slice(start, start + 400).forEach((item) => batch.delete(item.ref));
    await batch.commit();
  }
}

async function cascadeDeleteManagedUser(user) {
  const roomsRef = collection(db, "bingoRooms");
  const [ownedSnap, invitedSnap] = await Promise.all([
    getDocs(query(roomsRef, where("ownerUid", "==", user.uid))),
    getDocs(query(roomsRef, where("participantUids", "array-contains", user.uid)))
  ]);

  const ownedRooms = ownedSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const ownedRoomIds = new Set(ownedRooms.map((room) => room.id));
  const invitedRooms = invitedSnap.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((room) => !ownedRoomIds.has(room.id));

  // 삭제 대상이 방장인 방은 사진, 참가상태, 빙고판, 방 순서로 정리합니다.
  for (const room of ownedRooms) {
    await deleteRoomImageForAdmin(room.id);
    await deleteChickenLogsForAdmin(room.id);

    for (const participantUid of room.participantUids || []) {
      await deleteActiveMembershipIfMatches(participantUid, room.id);
    }

    await deleteDoc(doc(db, "bingoBoards", room.id));
    await deleteDoc(doc(db, "bingoRooms", room.id));
  }

  // 다른 방에 초대만 되어 있던 기록도 참가자 목록에서 제거합니다.
  for (const room of invitedRooms) {
    const nextParticipants = (room.participantUids || []).filter((uid) => uid !== user.uid);
    await updateDoc(doc(db, "bingoRooms", room.id), {
      participantUids: nextParticipants,
      updatedAt: serverTimestamp()
    });
  }

  // 대상 사용자의 현재 참가 상태는 방장/참가자 여부와 관계없이 마지막에 정리합니다.
  await deleteDoc(doc(db, "bingoMemberships", user.uid));
  await deleteDoc(doc(db, "users", user.uid));
}

async function deleteManagedUser(user) {
  if (user.role !== "user") {
    await showNotice("일반 사용자만 삭제할 수 있습니다.");
    return;
  }

  const label = user.name || user.email || "선택한 사용자";
  const confirmed = await showConfirm(
    `${label} 사용자를 삭제할까요?\n\n해당 사용자가 만든 빙고방, 빙고판, 사진, 참가정보와 다른 방의 초대 기록까지 함께 삭제됩니다.`,
    { title: "사용자 및 연동 데이터 삭제", confirmText: "전체 삭제", danger: true }
  );
  if (!confirmed) return;

  try {
    await cascadeDeleteManagedUser(user);
    await writeAudit("user_delete", user, "사용자와 연동된 빙고 데이터를 삭제");
    await loadUsers();
    await showNotice("사용자와 연동된 빙고 데이터를 모두 삭제했습니다.");
  } catch (error) {
    console.error(error);
    await showNotice(firebaseErrorMessage(error, "사용자 연동 데이터 삭제에 실패했습니다."));
  }
}

function renderUsers() {
  const body = document.getElementById("adminUsersBody");
  const empty = document.getElementById("adminUsersEmpty");
  const pagination = document.getElementById("adminUsersPagination");
  if (!body || !empty || !pagination) return;

  const state = currentTabState();
  const users = filteredSortedUsers();
  const totalPages = Math.max(1, Math.ceil(users.length / PAGE_SIZE));
  if (state.page > totalPages) state.page = totalPages;
  if (state.page < 1) state.page = 1;

  const start = (state.page - 1) * PAGE_SIZE;
  const pageUsers = users.slice(start, start + PAGE_SIZE);

  body.innerHTML = "";
  empty.classList.toggle("hidden", users.length > 0);
  pagination.classList.toggle("hidden", users.length === 0);

  if (!users.length) {
    empty.textContent = state.search.trim()
      ? "검색 조건에 맞는 사용자가 없습니다."
      : activeTab === "pending"
        ? "승인을 기다리는 사용자가 없습니다."
        : "승인이 완료된 사용자가 없습니다.";
    return;
  }

  pageUsers.forEach((user) => {
    const row = document.createElement("tr");
    addCell(row, user.name || "-");
    addCell(row, user.email || "-");
    addCell(row, roleLabel(user.role));
    addCell(row, statusLabel(user.status));

    const editableUser = user.role === "user" && isManager();
    addCell(row, makeAccessSelect(user, "bingoAccess", editableUser));
    addCell(row, makeAccessSelect(user, "killSheetAccess", editableUser));

    const actions = document.createElement("div");
    actions.className = "row-actions";

    if (user.role === "super_admin") {
      actions.textContent = "변경 불가";
    } else if (currentProfile.role === "admin" && user.role !== "user") {
      actions.textContent = "관리자 변경 불가";
    } else if (user.role === "user") {
      if (user.status === "pending") {
        actions.appendChild(makeButton("승인", async () => {
          try {
            await updateDoc(doc(db, "users", user.uid), { status: "approved" });
            await writeAudit(user.status === "pending" ? "user_approve" : "user_resume", user, user.status === "pending" ? "사용 승인" : "사용 재개");
            await loadUsers();
          } catch (error) {
            console.error(error);
            await showNotice(firebaseErrorMessage(error, "승인에 실패했습니다."));
          }
        }));
      } else if (user.status === "approved") {
        actions.appendChild(makeButton("사용중지", async () => {
          try {
            await updateDoc(doc(db, "users", user.uid), { status: "suspended" });
            await writeAudit("user_suspend", user, "사용중지");
            await loadUsers();
          } catch (error) {
            console.error(error);
            await showNotice(firebaseErrorMessage(error, "사용중지에 실패했습니다."));
          }
        }, "danger"));
      } else if (user.status === "suspended") {
        actions.appendChild(makeButton("사용재개", async () => {
          try {
            await updateDoc(doc(db, "users", user.uid), { status: "approved" });
            await writeAudit(user.status === "pending" ? "user_approve" : "user_resume", user, user.status === "pending" ? "사용 승인" : "사용 재개");
            await loadUsers();
          } catch (error) {
            console.error(error);
            await showNotice(firebaseErrorMessage(error, "사용재개에 실패했습니다."));
          }
        }));
      }

      if (currentProfile.role === "super_admin" && user.status === "approved") {
        actions.appendChild(makeButton("관리자로 지정", async () => {
          if (!await showConfirm(`${user.name || user.email} 사용자를 관리자로 지정할까요?`, { title: "관리자 지정", confirmText: "지정" })) return;
          try {
            await updateDoc(doc(db, "users", user.uid), { role: "admin" });
            await writeAudit("admin_promote", user, "일반사용자를 관리자로 지정");
            await loadUsers();
          } catch (error) {
            console.error(error);
            await showNotice(firebaseErrorMessage(error, "관리자 지정에 실패했습니다."));
          }
        }));
      }

      actions.appendChild(makeButton("삭제", () => deleteManagedUser(user), "danger admin-delete-user"));
    } else if (user.role === "admin" && currentProfile.role === "super_admin") {
      actions.appendChild(makeButton("일반사용자로 변경", async () => {
        if (!await showConfirm(`${user.name || user.email} 관리자를 일반사용자로 변경할까요?`, { title: "관리자 해제", confirmText: "변경" })) return;
        try {
          await updateDoc(doc(db, "users", user.uid), {
            role: "user",
            bingoAccess: "write",
            killSheetAccess: "write"
          });
          await writeAudit("admin_demote", user, "관리자를 일반사용자로 변경");
          await loadUsers();
        } catch (error) {
          console.error(error);
          await showNotice(firebaseErrorMessage(error, "관리자 해제에 실패했습니다."));
        }
      }));
    }

    addCell(row, actions);
    body.appendChild(row);
  });

  const end = Math.min(start + pageUsers.length, users.length);
  document.getElementById("adminUsersPageSummary").textContent = `총 ${users.length}명 · ${start + 1}-${end}명 표시`;
  document.getElementById("adminUsersPageNumber").textContent = `${state.page} / ${totalPages}`;
  document.getElementById("adminUsersPrev").disabled = state.page <= 1;
  document.getElementById("adminUsersNext").disabled = state.page >= totalPages;
}
