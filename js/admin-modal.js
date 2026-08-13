import { db } from "./firebase-config.js";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { showConfirm, showNotice } from "./ui-dialog.js?v=28";
import { firebaseErrorMessage } from "./error-messages.js?v=28";
import { isDeveloper, platformRole } from "./channel-context.js?v=28";

const PAGE_SIZE = 10;
let currentProfile = null;
let allUsers = [];
let activeTab = "pending";
let page = 1;
let searchTerm = "";
let pendingUsersUnsubscribe = null;

function canManagePlatformUsers() {
  return isDeveloper(currentProfile);
}

function roleLabel(user) {
  return platformRole(user) === "developer" ? "개발자" : "사용자";
}

function statusLabel(value) {
  return ({ pending: "승인대기", approved: "승인", suspended: "사용중지" }[value] || value);
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
        <div><p class="eyebrow">PLATFORM</p><h2 id="adminModalTitle">HNSITE 사용자 승인</h2><p class="muted">플랫폼 계정 승인과 사용 상태를 개발자가 관리합니다. 채널 역할은 각 채널에서 관리합니다.</p></div>
        <div class="admin-modal-header-actions"><button id="adminRefreshUsers" class="secondary compact-button" type="button">새로고침</button><button id="adminModalClose" class="modal-close-button" type="button">×</button></div>
      </div>
      <div class="admin-tabs">
        <button class="admin-tab active" data-platform-tab="pending" type="button">승인 대기 <span id="pendingUsersCount" class="tab-count">0</span></button>
        <button class="admin-tab" data-platform-tab="approved" type="button">사용 중 <span id="approvedUsersCount" class="tab-count">0</span></button>
        <button class="admin-tab" data-platform-tab="suspended" type="button">사용중지 <span id="suspendedUsersCount" class="tab-count">0</span></button>
      </div>
      <div class="admin-user-toolbar"><div class="admin-user-search-wrap"><label for="adminUserSearch">사용자 검색</label><input id="adminUserSearch" type="search" placeholder="이름 또는 이메일 검색" autocomplete="off" /></div></div>
      <p id="adminModalMessage" class="message admin-modal-message"></p>
      <div class="table-wrap admin-modal-table-wrap">
        <table class="admin-user-table"><thead><tr><th>이름</th><th>이메일</th><th>플랫폼 구분</th><th>상태</th><th>관리</th></tr></thead><tbody id="adminUsersBody"></tbody></table>
      </div>
      <div id="adminUsersEmpty" class="admin-users-empty hidden"></div>
      <div id="adminUsersPagination" class="admin-users-pagination hidden"><span id="adminUsersPageSummary" class="admin-page-summary"></span><div class="admin-page-buttons"><button id="adminUsersPrev" class="secondary" type="button">이전</button><span id="adminUsersPageNumber" class="admin-page-number"></span><button id="adminUsersNext" class="secondary" type="button">다음</button></div></div>
    </section>`;
  document.body.appendChild(modal);

  modal.querySelector("[data-close-admin-modal]").addEventListener("click", closeUserManagementModal);
  document.getElementById("adminModalClose").addEventListener("click", closeUserManagementModal);
  document.getElementById("adminRefreshUsers").addEventListener("click", loadUsers);
  modal.querySelectorAll("[data-platform-tab]").forEach((button) => button.addEventListener("click", () => {
    activeTab = button.dataset.platformTab;
    page = 1;
    renderTabs();
    renderUsers();
  }));
  document.getElementById("adminUserSearch").addEventListener("input", (event) => {
    searchTerm = event.target.value.trim();
    page = 1;
    renderUsers();
  });
  document.getElementById("adminUsersPrev").addEventListener("click", () => { if (page > 1) { page -= 1; renderUsers(); } });
  document.getElementById("adminUsersNext").addEventListener("click", () => { page += 1; renderUsers(); });
}

function ensureManageButton() {
  if (!canManagePlatformUsers()) return null;
  let button = document.getElementById("userManageButton");
  if (button) return button;
  const nav = document.querySelector(".topbar-user");
  if (!nav) return null;
  button = document.createElement("button");
  button.id = "userManageButton";
  button.className = "topbar-link admin-manage-button";
  button.type = "button";
  button.innerHTML = '사용자 승인 <span id="userManagePendingBadge" class="admin-pending-badge hidden">0</span>';
  const email = nav.querySelector(".topbar-email");
  nav.insertBefore(button, email || nav.firstChild);
  return button;
}

function setPendingBadge(count) {
  const badge = document.getElementById("userManagePendingBadge");
  if (!badge) return;
  badge.textContent = count > 99 ? "99+" : String(count);
  badge.classList.toggle("hidden", count === 0);
}

function startPendingWatcher() {
  if (pendingUsersUnsubscribe || !canManagePlatformUsers()) return;
  pendingUsersUnsubscribe = onSnapshot(query(collection(db, "users"), where("status", "==", "pending")), (snap) => setPendingBadge(snap.size), (error) => console.error("승인 대기 조회 실패", error));
}

export function initUserManagementModal(profile) {
  currentProfile = profile;
  if (!canManagePlatformUsers()) return { open: async () => {} };
  ensureModal();
  const button = ensureManageButton();
  if (button && !button.dataset.bound) {
    button.dataset.bound = "1";
    button.addEventListener("click", openUserManagementModal);
  }
  startPendingWatcher();
  return { open: openUserManagementModal };
}

export async function openUserManagementModal() {
  if (!canManagePlatformUsers()) return;
  ensureModal();
  document.getElementById("userManagementModal").classList.remove("hidden");
  document.body.classList.add("modal-open");
  activeTab = "pending";
  page = 1;
  renderTabs();
  await loadUsers();
}

export function closeUserManagementModal() {
  document.getElementById("userManagementModal")?.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

async function loadUsers() {
  const message = document.getElementById("adminModalMessage");
  message.textContent = "불러오는 중...";
  try {
    const snap = await getDocs(collection(db, "users"));
    allUsers = snap.docs.map((item) => ({ uid: item.id, ...item.data() })).sort((a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || "", "ko"));
    const pending = allUsers.filter((item) => item.status === "pending").length;
    document.getElementById("pendingUsersCount").textContent = String(pending);
    document.getElementById("approvedUsersCount").textContent = String(allUsers.filter((item) => item.status === "approved").length);
    document.getElementById("suspendedUsersCount").textContent = String(allUsers.filter((item) => item.status === "suspended").length);
    setPendingBadge(pending);
    message.textContent = "";
    renderUsers();
  } catch (error) {
    console.error(error);
    message.textContent = firebaseErrorMessage(error, "사용자 목록을 불러오지 못했습니다.");
  }
}

function renderTabs() {
  document.querySelectorAll("[data-platform-tab]").forEach((button) => button.classList.toggle("active", button.dataset.platformTab === activeTab));
}

function makeButton(text, onClick, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  if (className) button.className = className;
  button.addEventListener("click", onClick);
  return button;
}

function addCell(row, value) {
  const td = document.createElement("td");
  if (value instanceof Node) td.appendChild(value);
  else td.textContent = value;
  row.appendChild(td);
}

function filteredUsers() {
  const term = searchTerm.toLocaleLowerCase("ko");
  return allUsers.filter((user) => user.status === activeTab).filter((user) => !term || `${user.name || ""} ${user.email || ""}`.toLocaleLowerCase("ko").includes(term));
}

function renderUsers() {
  const body = document.getElementById("adminUsersBody");
  const empty = document.getElementById("adminUsersEmpty");
  const pagination = document.getElementById("adminUsersPagination");
  const users = filteredUsers();
  const totalPages = Math.max(1, Math.ceil(users.length / PAGE_SIZE));
  page = Math.min(Math.max(1, page), totalPages);
  const start = (page - 1) * PAGE_SIZE;
  const pageUsers = users.slice(start, start + PAGE_SIZE);
  body.innerHTML = "";
  empty.classList.toggle("hidden", users.length > 0);
  pagination.classList.toggle("hidden", users.length === 0);
  if (!users.length) {
    empty.textContent = searchTerm ? "검색 조건에 맞는 사용자가 없습니다." : "해당 상태의 사용자가 없습니다.";
    return;
  }

  pageUsers.forEach((user) => {
    const row = document.createElement("tr");
    addCell(row, user.name || "-");
    addCell(row, user.email || "-");
    addCell(row, roleLabel(user));
    addCell(row, statusLabel(user.status));
    const actions = document.createElement("div");
    actions.className = "row-actions";
    if (platformRole(user) === "developer") {
      actions.textContent = "개발자 계정";
    } else if (user.status === "pending") {
      actions.appendChild(makeButton("승인", () => changeStatus(user, "approved")));
    } else if (user.status === "approved") {
      actions.appendChild(makeButton("사용중지", () => changeStatus(user, "suspended"), "danger"));
      actions.appendChild(makeButton("삭제", () => deletePlatformUser(user), "danger admin-delete-user"));
    } else if (user.status === "suspended") {
      actions.appendChild(makeButton("사용재개", () => changeStatus(user, "approved")));
      actions.appendChild(makeButton("삭제", () => deletePlatformUser(user), "danger admin-delete-user"));
    }
    addCell(row, actions);
    body.appendChild(row);
  });

  const end = Math.min(start + pageUsers.length, users.length);
  document.getElementById("adminUsersPageSummary").textContent = `총 ${users.length}명 · ${start + 1}-${end}명 표시`;
  document.getElementById("adminUsersPageNumber").textContent = `${page} / ${totalPages}`;
  document.getElementById("adminUsersPrev").disabled = page <= 1;
  document.getElementById("adminUsersNext").disabled = page >= totalPages;
}

async function writeAudit(action, target, detail) {
  try {
    const ref = doc(collection(db, "platformAuditLogs"));
    const batch = writeBatch(db);
    batch.set(ref, {
      actorUid: currentProfile.uid,
      actorName: currentProfile.name || currentProfile.email || "개발자",
      action,
      targetUid: target.uid || "",
      targetName: target.name || target.email || "사용자",
      detail,
      createdAt: serverTimestamp()
    });
    await batch.commit();
  } catch (error) {
    console.error("플랫폼 이력 저장 실패", error);
  }
}

async function changeStatus(user, status) {
  try {
    const membershipsSnap = await getDocs(collection(db, "users", user.uid, "memberships"));
    const batch = writeBatch(db);
    batch.update(doc(db, "users", user.uid), { status, updatedAt: serverTimestamp() });
    membershipsSnap.docs.forEach((membershipDoc) => {
      batch.update(doc(db, "channels", membershipDoc.id, "members", user.uid), {
        status: status === "approved" ? "active" : "suspended",
        updatedAt: serverTimestamp()
      });
    });
    await batch.commit();
    await writeAudit(status === "approved" ? "user_approve" : "user_suspend", user, status === "approved" ? "HNSITE 사용 승인/재개" : "HNSITE 사용중지");
    await loadUsers();
  } catch (error) {
    console.error(error);
    await showNotice(firebaseErrorMessage(error, "사용자 상태 변경에 실패했습니다."));
  }
}

async function deletePlatformUser(user) {
  const confirmed = await showConfirm(`${user.name || user.email || "선택한 사용자"} 계정을 삭제할까요?\n채널에 가입된 계정은 데이터 보호를 위해 바로 삭제하지 않고 사용중지를 이용해야 합니다.`, { title: "HNSITE 사용자 삭제", confirmText: "삭제", danger: true });
  if (!confirmed) return;
  try {
    const membershipsSnap = await getDocs(collection(db, "users", user.uid, "memberships"));
    if (!membershipsSnap.empty) {
      await showNotice("가입된 채널이 있는 사용자는 바로 삭제할 수 없습니다. 우선 사용중지하고 각 채널에서 멤버십을 정리해주세요.");
      return;
    }
    await deleteDoc(doc(db, "users", user.uid));
    await writeAudit("user_delete", user, "채널 멤버십이 없는 플랫폼 사용자 삭제");
    await loadUsers();
  } catch (error) {
    console.error(error);
    await showNotice(firebaseErrorMessage(error, "사용자 삭제에 실패했습니다."));
  }
}
