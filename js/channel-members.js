import { db } from "./firebase-config.js";
import {
  arrayRemove,
  collection,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { firebaseErrorMessage } from "./error-messages.js";
import { showConfirm } from "./ui-dialog.js";
import {
  isChannelManager,
  normalizeMemberStatus
} from "./channel-context.js";

const PAGE_SIZE = 10;

let defaultContext = null;
let activeContext = null;
let members = [];
let activeTab = "pending";
let page = 1;
let badgeUnsubscribe = null;
let modalUnsubscribe = null;

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
  if (!isChannelManager(defaultContext)) return null;

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

function updateModalCounts() {
  const pending = pendingMembers().length;
  const approved = approvedMembers().length;
  const pendingCount = document.getElementById("channelPendingTabCount");
  const approvedCount = document.getElementById("channelApprovedTabCount");
  if (pendingCount) pendingCount.textContent = String(pending);
  if (approvedCount) approvedCount.textContent = String(approved);
}

function setTopbarBadge(count) {
  const badge = document.getElementById("channelMemberPendingBadge");
  if (!badge) return;
  badge.textContent = count > 99 ? "99+" : String(count);
  badge.classList.toggle("hidden", count === 0);
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


function canKickMember(member) {
  if (!member || member.role === "owner") return false;
  if (activeContext?.profile?.platformRole === "developer" || activeContext?.profile?.role === "developer") return true;
  if (activeContext?.member?.role === "owner") return true;
  return activeContext?.member?.role === "admin" && member.role === "member";
}

function renderApprovedItem(member) {
  const item = document.createElement("article");
  item.className = "channel-request-item channel-approved-member-item";

  const owner = member.role === "owner";
  const kickable = canKickMember(member);
  item.innerHTML = `
    <div class="channel-request-info">
      <strong>${escapeHtml(member.name || member.email || "사용자")}</strong>
    </div>
    <div class="channel-request-actions">
      <span class="channel-member-status-pill">${owner ? "소유자" : "사용 중"}</span>
      ${kickable ? '<button class="danger-outline kick-channel-member-button" type="button">추방</button>' : ""}
    </div>`;

  const kickButton = item.querySelector(".kick-channel-member-button");
  if (kickButton) {
    kickButton.addEventListener("click", async () => {
      const name = member.name || member.email || "선택한 사용자";
      const confirmed = await showConfirm(
        `${name}님을 이 채널에서 추방할까요? 진행 중인 빙고방의 방장이라면 해당 방은 자동 종료됩니다.`,
        {
          title: "채널 사용자 추방",
          confirmText: "추방",
          danger: true
        }
      );

      if (!confirmed) return;

      kickButton.disabled = true;
      kickButton.textContent = "추방 중...";

      try {
        await kickMember(member);
        const message = document.getElementById("channelMemberApprovalMessage");
        message.textContent = `${name}님을 채널에서 추방했습니다.`;
        message.classList.add("success");
      } catch (error) {
        console.error("채널 사용자 추방 실패", error);
        const message = document.getElementById("channelMemberApprovalMessage");
        message.textContent = firebaseErrorMessage(
          error,
          error?.message || "채널 사용자 추방에 실패했습니다."
        );
        message.classList.remove("success");
        kickButton.disabled = false;
        kickButton.textContent = "추방";
      }
    });
  }

  return item;
}

function render() {
  const list = document.getElementById("channelMemberApprovalList");
  const pagination = document.getElementById("channelMemberApprovalPagination");
  if (!list || !pagination) return;

  updateModalCounts();
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

async function kickMember(member) {
  if (!canKickMember(member)) {
    throw new Error("이 사용자를 추방할 권한이 없습니다.");
  }

  const channelId = activeContext.channelId;
  const actorUid = activeContext.profile?.uid || activeContext.member?.uid || "";
  const roomsSnapshot = await getDocs(
    collection(db, "channels", channelId, "bingoRooms")
  );

  const memberRef = doc(db, "channels", channelId, "members", member.uid);
  const mirrorRef = doc(db, "users", member.uid, "memberships", channelId);
  const batch = writeBatch(db);

  roomsSnapshot.docs.forEach((roomDoc) => {
    const room = roomDoc.data();
    const updates = {};

    if (room.ownerUid === member.uid && room.status !== "closed") {
      updates.status = "closed";
      updates.closedAt = serverTimestamp();
      updates.closedByUid = actorUid;
      updates.updatedAt = serverTimestamp();

      if (room.ownerSlot) {
        batch.delete(
          doc(
            db,
            "channels",
            channelId,
            "bingoRoomOwners",
            member.uid,
            "slots",
            String(room.ownerSlot)
          )
        );
      }
    }

    // 종료된 방은 과거 기록이므로 참가자 목록을 수정하지 않는다.
    if (
      room.status !== "closed" &&
      room.ownerUid !== member.uid &&
      (room.participantUids || []).includes(member.uid)
    ) {
      updates.participantUids = arrayRemove(member.uid);
      updates.updatedAt = serverTimestamp();
    }

    if (Object.keys(updates).length) {
      batch.update(roomDoc.ref, updates);
    }
  });

  batch.delete(memberRef);
  batch.delete(mirrorRef);
  await batch.commit();
}

async function approveMember(member) {
  const channelId = activeContext.channelId;
  const memberRef = doc(db, "channels", channelId, "members", member.uid);
  const mirrorRef = doc(db, "users", member.uid, "memberships", channelId);
  const batch = writeBatch(db);

  batch.update(memberRef, {
    status: "approved",
    bingoAccess: activeContext.channel.bingoEnabled === true ? "write" : "none",
    killSheetAccess: activeContext.channel.killEnabled === true ? "write" : "none",
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

function stopModalWatcher() {
  if (!modalUnsubscribe) return;
  modalUnsubscribe();
  modalUnsubscribe = null;
}

function startModalWatcher(context) {
  stopModalWatcher();
  activeContext = context;

  modalUnsubscribe = onSnapshot(
    collection(db, "channels", context.channelId, "members"),
    (snapshot) => {
      members = snapshot.docs
        .map((item) => ({
          uid: item.id,
          ...item.data(),
          status: normalizeMemberStatus(item.data().status)
        }))
        .filter((member) => ["pending", "approved"].includes(member.status))
        .sort((a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || "", "ko"));

      render();
    },
    (error) => console.error("채널 사용자 조회 실패", error)
  );
}

function openModalForContext(context) {
  if (!isChannelManager(context)) return;

  const modal = ensureModal();
  activeContext = context;
  activeTab = "pending";
  page = 1;
  renderTabs();

  const channelName = context.channel?.name || "채널";
  document.getElementById("channelMemberApprovalTitle").textContent = `${channelName} · 사용자 관리`;
  const message = document.getElementById("channelMemberApprovalMessage");
  message.textContent = "";
  message.classList.remove("success");

  members = [];
  modal.classList.remove("hidden");
  document.body.classList.add("modal-open");
  render();
  startModalWatcher(context);
}

function closeModal() {
  document.getElementById("channelMemberApprovalModal")?.classList.add("hidden");
  stopModalWatcher();
  activeContext = defaultContext;

  const globalManagement =
    document.getElementById("globalChannelManagementModal");

  document.body.classList.toggle(
    "modal-open",
    Boolean(
      globalManagement &&
      !globalManagement.classList.contains("hidden")
    )
  );
}

function startDefaultBadgeWatcher() {
  if (badgeUnsubscribe || !isChannelManager(defaultContext)) return;

  badgeUnsubscribe = onSnapshot(
    collection(db, "channels", defaultContext.channelId, "members"),
    (snapshot) => {
      const pending = snapshot.docs.filter(
        (item) => normalizeMemberStatus(item.data().status) === "pending"
      ).length;
      setTopbarBadge(pending);
    },
    (error) => console.error("채널 가입 대기 조회 실패", error)
  );
}

export function initChannelMemberApproval(context) {
  defaultContext = context;
  activeContext = context;
  if (!isChannelManager(defaultContext)) return;

  const button = ensureButton();
  if (button && !button.dataset.bound) {
    button.dataset.bound = "1";
    button.addEventListener("click", () => openModalForContext(defaultContext));
  }

  ensureModal();
  startDefaultBadgeWatcher();
}

export function openChannelMemberManagement(channel, profile) {
  if (!channel?.id || !profile) return;

  const context = {
    profile,
    channelId: channel.id,
    channel,
    member: {
      uid: profile.uid || "",
      role: "developer",
      status: "approved",
      bingoAccess: "write",
      killSheetAccess: "write",
      virtualDeveloper: true
    }
  };

  openModalForContext(context);
}
