import { db } from "./firebase-config.js";
import {
  collection,
  doc,
  getDocs,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { showConfirm, showNotice } from "./ui-dialog.js?v=14";

let currentProfile = null;
let allUsers = [];
let activeTab = "pending";
let initialized = false;

const accessLabel = (value) => ({ none: "권한 없음", read: "읽기", write: "쓰기" }[value] || "권한 없음");
const roleLabel = (value) => ({ super_admin: "최고관리자", admin: "관리자", user: "일반사용자" }[value] || value);
const statusLabel = (value) => ({ pending: "승인대기", approved: "승인", suspended: "사용중지" }[value] || value);
const isManager = () => ["super_admin", "admin"].includes(currentProfile?.role);

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
          <p class="muted">승인 요청과 빙고·킬내기 권한을 관리합니다.</p>
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
      </div>

      <p id="adminModalMessage" class="message admin-modal-message"></p>

      <div class="table-wrap admin-modal-table-wrap">
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
    </section>
  `;
  document.body.appendChild(modal);

  document.getElementById("adminModalClose").addEventListener("click", closeUserManagementModal);
  modal.querySelector("[data-close-admin-modal]").addEventListener("click", closeUserManagementModal);
  document.getElementById("adminRefreshUsers").addEventListener("click", loadUsers);

  modal.querySelectorAll("[data-admin-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activeTab = button.dataset.adminTab;
      renderTabs();
      renderUsers();
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.classList.contains("hidden")) {
      closeUserManagementModal();
    }
  });
}

function ensureManageButton() {
  if (!isManager()) return null;

  let button = document.getElementById("userManageButton");
  if (button) return button;

  const nav = document.querySelector(".topbar-user");
  if (!nav) return null;

  button = document.createElement("button");
  button.id = "userManageButton";
  button.type = "button";
  button.className = "topbar-link admin-manage-button";
  button.textContent = "사용자 관리";

  const email = nav.querySelector(".topbar-email");
  nav.insertBefore(button, email || nav.firstChild);
  return button;
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
    allUsers.sort((a, b) => {
      const rank = { super_admin: 0, admin: 1, user: 2 };
      return (rank[a.role] ?? 9) - (rank[b.role] ?? 9)
        || (a.name || a.email || "").localeCompare(b.name || b.email || "", "ko");
    });

    document.getElementById("pendingUsersCount").textContent = String(allUsers.filter((user) => user.status === "pending").length);
    document.getElementById("approvedUsersCount").textContent = String(allUsers.filter((user) => user.status !== "pending").length);
    message.textContent = "";
    renderTabs();
    renderUsers();
  } catch (error) {
    console.error(error);
    message.textContent = "사용자 목록을 불러오지 못했습니다.";
  }
}

function renderTabs() {
  document.querySelectorAll("[data-admin-tab]").forEach((button) => {
    const selected = button.dataset.adminTab === activeTab;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", selected ? "true" : "false");
  });
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
      } catch (error) {
        console.error(error);
        await showNotice("권한 변경에 실패했습니다.");
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

function renderUsers() {
  const body = document.getElementById("adminUsersBody");
  const empty = document.getElementById("adminUsersEmpty");
  if (!body || !empty) return;

  const users = activeTab === "pending"
    ? allUsers.filter((user) => user.status === "pending")
    : allUsers.filter((user) => user.status !== "pending");

  body.innerHTML = "";
  empty.classList.toggle("hidden", users.length > 0);
  if (!users.length) {
    empty.textContent = activeTab === "pending"
      ? "승인을 기다리는 사용자가 없습니다."
      : "승인이 완료된 사용자가 없습니다.";
    return;
  }

  users.forEach((user) => {
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
            await loadUsers();
          } catch (error) {
            console.error(error);
            await showNotice("승인에 실패했습니다.");
          }
        }));
      } else if (user.status === "approved") {
        actions.appendChild(makeButton("사용중지", async () => {
          try {
            await updateDoc(doc(db, "users", user.uid), { status: "suspended" });
            await loadUsers();
          } catch (error) {
            console.error(error);
            await showNotice("사용중지에 실패했습니다.");
          }
        }, "danger"));
      } else if (user.status === "suspended") {
        actions.appendChild(makeButton("사용재개", async () => {
          try {
            await updateDoc(doc(db, "users", user.uid), { status: "approved" });
            await loadUsers();
          } catch (error) {
            console.error(error);
            await showNotice("사용재개에 실패했습니다.");
          }
        }));
      }

      if (currentProfile.role === "super_admin" && user.status === "approved") {
        actions.appendChild(makeButton("관리자로 지정", async () => {
          if (!await showConfirm(`${user.name || user.email} 사용자를 관리자로 지정할까요?`, { title: "관리자 지정", confirmText: "지정" })) return;
          try {
            await updateDoc(doc(db, "users", user.uid), { role: "admin" });
            await loadUsers();
          } catch (error) {
            console.error(error);
            await showNotice("관리자 지정에 실패했습니다.");
          }
        }));
      }
    } else if (user.role === "admin" && currentProfile.role === "super_admin") {
      actions.appendChild(makeButton("일반사용자로 변경", async () => {
        if (!await showConfirm(`${user.name || user.email} 관리자를 일반사용자로 변경할까요?`, { title: "관리자 해제", confirmText: "변경" })) return;
        try {
          await updateDoc(doc(db, "users", user.uid), {
            role: "user",
            bingoAccess: "write",
            killSheetAccess: "write"
          });
          await loadUsers();
        } catch (error) {
          console.error(error);
          await showNotice("관리자 해제에 실패했습니다.");
        }
      }));
    }

    addCell(row, actions);
    body.appendChild(row);
  });
}
