import { db } from "./firebase-config.js";
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { firebaseErrorMessage } from "./error-messages.js?v=34";
import {
  channelRoleLabel,
  isChannelManager,
  normalizeMemberStatus
} from "./channel-context.js?v=34";

const PAGE_SIZE = 10;

let currentContext = null;
let members = [];
let activeTab = "pending";
let page = 1;
let unsubscribe = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function pendingMembers() {
  return members.filter((member) => member.status === "pending");
}

function approvedMembers() {
  return members.filter((member) => member.status === "approved");
}

function ensureButton() {
  if (!isChannelManager(currentContext)) return null;
  let button = document.getElementById("channelMemberApprovalButton");
  if (button) return button;

  const nav = document.querySelector(".topbar-user");
  if (!nav) return null;

  button = document.createElement("button");
  button.id = "channelMemberApprovalButton";
  button.className = "topbar-link channel-member-approval-button";
  button.type = "button";
  button.innerHTML = `사용자 관리 <span id="channelMemberPendingBadge" class="admin-pending-badge hidden">0</span>`;

  const email = nav.querySelector(".topbar-email");
  nav.insertBefore(button, email || nav.firstChild);
  return button;
}

function ensureModal() {
  let modal = document.getElementById("channelMemberApprovalModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "channelMemberApprovalModal";
  modal.className = "admin-modal hidden";
  modal.innerHTML = `
    <div class="admin-modal-backdrop" data-close-channel-approval></div>
    <section class="admin-modal-dialog channel-member-approval-dialog" role="dialog" aria-modal="true" aria-labelledby="channelMemberApprovalTitle">
      <div class="admin-modal-header">
        <div>
          <p class="eyebrow">CHANNEL MEMBER</p>
          <h2 id="channelMemberApprovalTitle">채널 사용자 관리</h2>
          <p id="channelMemberApprovalChannelName" class="muted"></p>
        </div>
        <button class="modal-close-button" data-close-channel-approval type="button" aria-label="닫기">×</button>
      </div>

      <div class="admin-tabs channel-member-tabs">
        <button class="admin-tab active" data-channel-member-tab="pending" type="button">
          가입 승인 <span id="channelPendingTabCount" class="tab-count">0</span>
        </button>
        <button class="admin-tab" data-channel-member-tab="approved" type="button">
          사용 중 <span id="channelApprovedTabCount" class="tab-count">0</span>
        </button>
      </div>

      <p id="channelMemberApprovalMessage" class="message admin-modal-message"></p>
      <div id="channelMemberApprovalList" class="channel-request-list"></div>

      <div id="channelMemberApprovalPagination" class="channel-pagination channel-request-pagination hidden">
        <span id="channelMemberApprovalSummary" class="channel-page-summary"></span>
        <div class="channel-page-buttons">
          <button id="channelMemberApprovalPrev" class="secondary" type="button">이전</button>
          <span id="channelMemberApprovalPage" class="channel-page-number"></span>
          <button id="channelMemberApprovalNext" class="secondary" type="button">다음</button>
        </div>
      </div>
    </section>`;

  document.body.appendChild(modal);

  modal.querySelectorAll("[data-close-channel-approval]").forEach((element) => {
    element.addEventListener("click", closeModal);
  });

  modal.querySelectorAll("[data-channel-member-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activeTab = button.dataset.channelMemberTab;
      page = 1;
      renderTabs();
      render();
    });
  });

  modal.querySelector("#channelMemberApprovalPrev").addEventListener("click", () => {
    if (page > 1) {
      page -= 1;
      render();
    }
  });

  modal.querySelector("#channelMemberApprovalNext").addEventListener("click", () => {
    page += 1;
    render();
  });

  return modal;
}

function renderTabs() {
  document.querySelectorAll("[data-channel-member-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.channelMemberTab === activeTab);
  });
}

function setCounts() {
  const pending = pendingMembers().length;
  const approved = approvedMembers().length;

  const badge = document.getElementById("channelMemberPendingBadge");
  if (badge) {
    badge.textContent = pending > 99 ? "99+" : String(pending);
    badge.classList.toggle("hidden", pending === 0);
  }

  const pendingCount = document.getElementById("channelPendingTabCount");
  if (pendingCount) pendingCount.textContent = String(pending);
  const approvedCount = document.getElementById("channelApprovedTabCount");
  if (approvedCount) approvedCount.textContent = String(approved);
}

function openModal() {
  if (!isChannelManager(currentContext)) return;
  const modal = ensureModal();
  activeTab = "pending";
  page = 1;
  renderTabs();
  document.getElementById("channelMemberApprovalChannelName").textContent = `${currentContext.channel?.name || "현재 채널"}의 사용자만 표시됩니다.`;
  document.getElementById("channelMemberApprovalMessage").textContent = "";
  modal.classList.remove("hidden");
  document.body.classList.add("modal-open");
  render();
}

function closeModal() {
  document.getElementById("channelMemberApprovalModal")?.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

function currentItems() {
  return activeTab === "pending" ? pendingMembers() : approvedMembers();
}

function renderPendingItem(member) {
  const item = document.createElement("article");
  item.className = "channel-request-item";
  item.innerHTML = `
    <div class="channel-request-info">
      <strong>${escapeHtml(member.name || member.email || "사용자")}</strong>
      <span>${escapeHtml(member.email || "")}</span>
      <small>채널 가입 승인 대기</small>
    </div>
    <div class="channel-request-actions">
      <button class="approve-channel-member-button" type="button">승인</button>
    </div>`;

  item.querySelector(".approve-channel-member-button").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "승인 중...";
    try {
      await approveMember(member);
      const message = document.getElementById("channelMemberApprovalMessage");
      message.textContent = `${member.name || member.email || "사용자"}님의 가입을 승인했습니다.`;
      message.classList.add("success");
    } catch (error) {
      console.error("채널 가입 승인 실패", error);
      const message = document.getElementById("channelMemberApprovalMessage");
      message.textContent = firebaseErrorMessage(error, "채널 가입 승인에 실패했습니다.");
      message.classList.remove("success");
      button.disabled = false;
      button.textContent = "승인";
    }
  });

  return item;
}

function renderApprovedItem(member) {
  const item = document.createElement("article");
  item.className = "channel-request-item channel-approved-member-item";
  item.innerHTML = `
    <div class="channel-request-info">
      <strong>${escapeHtml(member.name || member.email || "사용자")}</strong>
      <span>${escapeHtml(member.email || "")}</span>
      <small>${escapeHtml(channelRoleLabel(member.role))} · 빙고 ${escapeHtml(member.bingoAccess || "none")}</small>
    </div>
    <div class="channel-request-actions">
      <span class="channel-member-status-pill">사용 중</span>
    </div>`;
  return item;
}

function render() {
  const list = document.getElementById("channelMemberApprovalList");
  const pagination = document.getElementById("channelMemberApprovalPagination");
  if (!list || !pagination) return;

  const items = currentItems();
  list.innerHTML = "";

  if (!items.length) {
    list.innerHTML = `<div class="channel-request-empty">${activeTab === "pending" ? "현재 승인 대기 중인 사용자가 없습니다." : "현재 사용 중인 채널 멤버가 없습니다."}</div>`;
    pagination.classList.add("hidden");
    return;
  }

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  page = Math.min(Math.max(1, page), totalPages);
  const start = (page - 1) * PAGE_SIZE;
  const pageItems = items.slice(start, start + PAGE_SIZE);

  pageItems.forEach((member) => {
    list.appendChild(activeTab === "pending" ? renderPendingItem(member) : renderApprovedItem(member));
  });

  if (items.length <= PAGE_SIZE) {
    pagination.classList.add("hidden");
    return;
  }

  pagination.classList.remove("hidden");
  document.getElementById("channelMemberApprovalSummary").textContent = `총 ${items.length}명 · ${start + 1}-${start + pageItems.length}명 표시`;
  document.getElementById("channelMemberApprovalPage").textContent = `${page} / ${totalPages}`;
  document.getElementById("channelMemberApprovalPrev").disabled = page <= 1;
  document.getElementById("channelMemberApprovalNext").disabled = page >= totalPages;
}

async function approveMember(member) {
  const channelId = currentContext.channelId;
  const memberRef = doc(db, "channels", channelId, "members", member.uid);
  const mirrorRef = doc(db, "users", member.uid, "memberships", channelId);
  const batch = writeBatch(db);

  batch.update(memberRef, {
    status: "approved",
    bingoAccess: currentContext.channel.bingoEnabled === true ? "write" : "none",
    killSheetAccess: "none",
    joinedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  batch.update(mirrorRef, {
    status: "approved",
    joinedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  await batch.commit();
}

function startWatcher() {
  if (unsubscribe || !isChannelManager(currentContext)) return;

  unsubscribe = onSnapshot(
    collection(db, "channels", currentContext.channelId, "members"),
    (snapshot) => {
      members = snapshot.docs
        .map((item) => ({
          uid: item.id,
          ...item.data(),
          status: normalizeMemberStatus(item.data().status)
        }))
        .filter((member) => ["pending", "approved"].includes(member.status))
        .sort((a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || "", "ko"));

      setCounts();
      if (!document.getElementById("channelMemberApprovalModal")?.classList.contains("hidden")) render();
    },
    (error) => console.error("채널 사용자 조회 실패", error)
  );
}

export function initChannelMemberApproval(context) {
  currentContext = context;
  if (!isChannelManager(currentContext)) return;

  const button = ensureButton();
  if (button && !button.dataset.bound) {
    button.dataset.bound = "1";
    button.addEventListener("click", openModal);
  }

  ensureModal();
  startWatcher();
}
