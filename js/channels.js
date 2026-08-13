import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { loadPlatformProfile, isDeveloper, setCurrentChannelId, channelRoleLabel } from "./channel-context.js?v=28";
import { initUserManagementModal } from "./admin-modal.js?v=28";
import { showConfirm, showNotice } from "./ui-dialog.js?v=28";
import { firebaseErrorMessage } from "./error-messages.js?v=28";

const loadingPanel = document.getElementById("loadingPanel");
const channelContent = document.getElementById("channelContent");
const channelList = document.getElementById("channelList");
const channelMessage = document.getElementById("channelMessage");
const developerCreatePanel = document.getElementById("developerCreatePanel");
const channelOwnerSelect = document.getElementById("channelOwner");
const memberModal = document.getElementById("channelMemberModal");
const memberList = document.getElementById("channelMemberList");
const memberMessage = document.getElementById("channelMemberMessage");

let currentUser = null;
let currentProfile = null;
let memberships = [];
let currentMemberChannel = null;
let approvedUsersByUid = new Map();

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function setMessage(text, success = false) {
  channelMessage.textContent = text;
  channelMessage.classList.toggle("success", success);
}

async function loadMemberships() {
  const snap = await getDocs(collection(db, "users", currentUser.uid, "memberships"));
  const raw = snap.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => item.status === "active");
  const enriched = await Promise.all(raw.map(async (item) => {
    try {
      const channelSnap = await getDoc(doc(db, "channels", item.id));
      if (!channelSnap.exists()) return null;
      const channel = { id: channelSnap.id, ...channelSnap.data() };
      if (channel.status !== "active") return null;
      return { ...item, channel };
    } catch (error) {
      console.error("채널 조회 실패", item.id, error);
      return null;
    }
  }));
  memberships = enriched.filter(Boolean).sort((a, b) => (a.channelName || a.channel.name || "").localeCompare(b.channelName || b.channel.name || "", "ko"));
}

function renderChannels() {
  channelList.innerHTML = "";
  if (!memberships.length) {
    channelList.innerHTML = `<div class="panel channel-empty"><strong>현재 이용할 수 있는 채널이 없습니다.</strong><span>채널 소유자에게 초대 링크를 받거나 개발자에게 채널 생성을 요청해주세요.</span></div>`;
    return;
  }

  memberships.forEach((membership) => {
    const channel = membership.channel;
    const card = document.createElement("article");
    card.className = "panel channel-card";
    const manager = ["owner", "admin"].includes(membership.role);
    const billingText = channel.subscriptionStatus === "expired" ? "이용 만료" : channel.subscriptionStatus === "trial" ? "테스트" : channel.subscriptionStatus === "beta" ? "베타" : "이용 중";
    card.innerHTML = `
      <div class="channel-card-head">
        <div>
          <span class="room-state-badge">${escapeHtml(channelRoleLabel(membership.role))}</span>
          <h2>${escapeHtml(channel.name || membership.channelName || "HNSITE 채널")}</h2>
          <p class="muted">${channel.bingoEnabled === true ? "빙고 사용 가능" : "빙고 미사용"} · ${escapeHtml(billingText)}</p>
        </div>
      </div>
      <div class="channel-card-actions">
        <button class="select-channel-button" type="button">이 채널 사용</button>
        ${manager ? '<button class="secondary invite-channel-button" type="button">멤버 초대</button><button class="secondary manage-channel-members-button" type="button">멤버 관리</button>' : ""}
      </div>`;

    card.querySelector(".select-channel-button").addEventListener("click", () => {
      setCurrentChannelId(currentUser.uid, channel.id);
      location.href = "./app.html";
    });
    card.querySelector(".invite-channel-button")?.addEventListener("click", () => createInvite(channel, membership));
    card.querySelector(".manage-channel-members-button")?.addEventListener("click", () => openMemberManager(channel, membership));
    channelList.appendChild(card);
  });
}

async function loadApprovedUsersForDeveloper() {
  if (!isDeveloper(currentProfile)) return;
  developerCreatePanel.classList.remove("hidden");
  const snap = await getDocs(collection(db, "users"));
  const users = snap.docs
    .map((item) => ({ uid: item.id, ...item.data() }))
    .filter((item) => item.status === "approved")
    .sort((a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || "", "ko"));
  approvedUsersByUid = new Map(users.map((user) => [user.uid, user]));
  channelOwnerSelect.innerHTML = users.map((user) => `<option value="${escapeHtml(user.uid)}">${escapeHtml(user.name || user.email || "사용자")} · ${escapeHtml(user.email || "")}</option>`).join("");
  await loadDeveloperChannelAdmin();
}

async function loadDeveloperChannelAdmin() {
  if (!isDeveloper(currentProfile)) return;
  const container = document.getElementById("developerChannelAdminList");
  if (!container) return;
  const snap = await getDocs(collection(db, "channels"));
  const channels = snap.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => (a.name || "").localeCompare(b.name || "", "ko"));
  if (!channels.length) {
    container.innerHTML = '<div class="participant-manage-empty">아직 생성된 채널이 없습니다.</div>';
    return;
  }
  container.innerHTML = "";
  channels.forEach((channel) => {
    const owner = approvedUsersByUid.get(channel.ownerUid);
    const row = document.createElement("div");
    row.className = "developer-channel-admin-row";
    const endDate = channel.subscriptionEndsAt?.toDate?.();
    const endValue = endDate ? `${endDate.getFullYear()}-${String(endDate.getMonth()+1).padStart(2,"0")}-${String(endDate.getDate()).padStart(2,"0")}` : "";
    row.innerHTML = `
      <div class="developer-channel-admin-info"><strong>${escapeHtml(channel.name || "HNSITE 채널")}</strong><small>소유자 ${escapeHtml(owner?.name || owner?.email || channel.ownerUid || "-")}</small></div>
      <select class="developer-subscription-status" aria-label="이용 상태">
        <option value="beta" ${channel.subscriptionStatus === "beta" ? "selected" : ""}>베타</option>
        <option value="trial" ${channel.subscriptionStatus === "trial" ? "selected" : ""}>체험</option>
        <option value="active" ${channel.subscriptionStatus === "active" ? "selected" : ""}>유료 사용</option>
        <option value="expired" ${channel.subscriptionStatus === "expired" ? "selected" : ""}>만료</option>
      </select>
      <input class="developer-subscription-end" type="date" value="${endValue}" aria-label="이용 종료일" />
      <label class="developer-feature-check"><input class="developer-bingo-enabled" type="checkbox" ${channel.bingoEnabled === true ? "checked" : ""} /> 빙고</label>
      <button class="secondary compact-button developer-channel-save" type="button">저장</button>`;
    row.querySelector(".developer-channel-save").addEventListener("click", async () => {
      const status = row.querySelector(".developer-subscription-status").value;
      const endText = row.querySelector(".developer-subscription-end").value;
      let subscriptionEndsAt = null;
      if (endText) {
        const end = new Date(`${endText}T23:59:59`);
        if (!Number.isFinite(end.getTime())) return;
        subscriptionEndsAt = Timestamp.fromDate(end);
      }
      const startedAt = channel.subscriptionStartedAt || (status === "active" || status === "trial" ? Timestamp.fromDate(new Date()) : null);
      try {
        await updateDoc(doc(db, "channels", channel.id), {
          subscriptionStatus: status,
          subscriptionStartedAt: startedAt,
          subscriptionEndsAt,
          bingoEnabled: row.querySelector(".developer-bingo-enabled").checked,
          updatedAt: serverTimestamp()
        });
        setMessage(`${channel.name} 이용권 설정을 저장했습니다.`, true);
        await loadMemberships();
        renderChannels();
        await loadDeveloperChannelAdmin();
      } catch (error) {
        console.error(error);
        setMessage(firebaseErrorMessage(error, "채널 이용권 설정 저장에 실패했습니다."));
      }
    });
    container.appendChild(row);
  });
}

async function createChannel(event) {
  event.preventDefault();
  if (!isDeveloper(currentProfile)) return;
  const name = document.getElementById("channelName").value.trim();
  const ownerUid = channelOwnerSelect.value;
  if (!name || !ownerUid) return;

  const ownerSnap = await getDoc(doc(db, "users", ownerUid));
  if (!ownerSnap.exists() || ownerSnap.data().status !== "approved") {
    setMessage("승인된 사용자를 채널 소유자로 선택해주세요.");
    return;
  }
  const owner = ownerSnap.data();
  const channelRef = doc(collection(db, "channels"));
  const memberRef = doc(db, "channels", channelRef.id, "members", ownerUid);
  const mirrorRef = doc(db, "users", ownerUid, "memberships", channelRef.id);

  try {
    await runTransaction(db, async (transaction) => {
      transaction.set(channelRef, {
        name,
        ownerUid,
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
        status: "active",
        bingoAccess: "write",
        killSheetAccess: "none",
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      transaction.set(mirrorRef, {
        channelId: channelRef.id,
        channelName: name,
        role: "owner",
        status: "active",
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    });
    document.getElementById("createChannelForm").reset();
    setMessage(`${name} 채널을 생성했습니다.`, true);
    if (ownerUid === currentUser.uid) {
      setCurrentChannelId(currentUser.uid, channelRef.id);
    }
    await loadMemberships();
    renderChannels();
  } catch (error) {
    console.error(error);
    setMessage(firebaseErrorMessage(error, "채널 생성에 실패했습니다."));
  }
}

async function createInvite(channel, membership) {
  if (!["owner", "admin"].includes(membership.role)) return;
  const inviteRef = doc(collection(db, "channels", channel.id, "invites"));
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  try {
    await runTransaction(db, async (transaction) => {
      transaction.set(inviteRef, {
        role: "member",
        channelName: channel.name || "HNSITE 채널",
        bingoAccess: channel.bingoEnabled === true ? "write" : "none",
        killSheetAccess: channel.killEnabled === true ? "write" : "none",
        active: true,
        createdByUid: currentUser.uid,
        createdAt: serverTimestamp(),
        expiresAt: Timestamp.fromDate(expires)
      });
    });
    const url = new URL("./channels.html", location.href);
    url.hash = `invite=${channel.id}:${inviteRef.id}`;
    try {
      await navigator.clipboard.writeText(url.toString());
      await showNotice("1회용 채널 초대 링크를 복사했습니다. 링크는 7일 동안 유효합니다.", "초대 링크 생성");
    } catch (_) {
      await showNotice(`아래 초대 링크를 전달해주세요.\n\n${url}`, "초대 링크 생성");
    }
  } catch (error) {
    console.error(error);
    await showNotice(firebaseErrorMessage(error, "초대 링크를 만들지 못했습니다."));
  }
}

async function acceptInviteFromHash() {
  const match = location.hash.match(/^#invite=([^:]+):([A-Za-z0-9_-]+)$/);
  if (!match) return;
  const [, channelId, inviteId] = match;
  history.replaceState(null, "", location.pathname);

  const inviteRef = doc(db, "channels", channelId, "invites", inviteId);
  const memberRef = doc(db, "channels", channelId, "members", currentUser.uid);
  const mirrorRef = doc(db, "users", currentUser.uid, "memberships", channelId);

  try {
    await runTransaction(db, async (transaction) => {
      const [inviteSnap, memberSnap] = await Promise.all([
        transaction.get(inviteRef),
        transaction.get(memberRef)
      ]);
      if (!inviteSnap.exists()) throw new Error("INVITE_NOT_FOUND");
      const invite = inviteSnap.data();
      if (invite.active !== true || !invite.expiresAt?.toMillis || invite.expiresAt.toMillis() <= Date.now()) throw new Error("INVITE_EXPIRED");
      if (memberSnap.exists()) return;
      const role = invite.role === "admin" ? "admin" : "member";
      transaction.set(memberRef, {
        uid: currentUser.uid,
        name: currentProfile.name || currentUser.displayName || currentUser.email || "사용자",
        email: currentUser.email || "",
        role,
        status: "active",
        bingoAccess: ["none", "read", "write"].includes(invite.bingoAccess) ? invite.bingoAccess : "none",
        killSheetAccess: ["none", "read", "write"].includes(invite.killSheetAccess) ? invite.killSheetAccess : "none",
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        inviteId
      });
      transaction.set(mirrorRef, {
        channelId,
        channelName: invite.channelName || "HNSITE 채널",
        role,
        status: "active",
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      transaction.delete(inviteRef);
    });
    setCurrentChannelId(currentUser.uid, channelId);
    await showNotice("채널 초대가 완료되었습니다.", "채널 가입 완료");
    location.href = "./app.html";
  } catch (error) {
    console.error(error);
    const text = error.message === "INVITE_NOT_FOUND" || error.message === "INVITE_EXPIRED"
      ? "사용할 수 없거나 만료된 초대 링크입니다. 새 초대 링크를 받아주세요."
      : firebaseErrorMessage(error, "채널 초대를 처리하지 못했습니다.");
    setMessage(text);
  }
}

async function openMemberManager(channel, membership) {
  currentMemberChannel = { channel, membership };
  memberModal.classList.remove("hidden");
  document.body.classList.add("modal-open");
  document.getElementById("channelMemberTitle").textContent = `${channel.name} 멤버`;
  memberMessage.textContent = "불러오는 중...";
  try {
    await renderMemberManager();
    memberMessage.textContent = "";
  } catch (error) {
    console.error(error);
    memberMessage.textContent = firebaseErrorMessage(error, "채널 멤버를 불러오지 못했습니다.");
  }
}

async function renderMemberManager() {
  const { channel, membership: myMembership } = currentMemberChannel;
  const snap = await getDocs(collection(db, "channels", channel.id, "members"));
  const members = snap.docs.map((item) => ({ uid: item.id, ...item.data() })).sort((a, b) => {
    const rank = { owner: 0, admin: 1, member: 2 };
    return (rank[a.role] ?? 9) - (rank[b.role] ?? 9) || (a.name || a.email || "").localeCompare(b.name || b.email || "", "ko");
  });
  memberList.innerHTML = "";
  const ownerCanChangeRole = myMembership.role === "owner";
  const canManageAccess = ["owner", "admin"].includes(myMembership.role);

  members.forEach((member) => {
    const row = document.createElement("div");
    row.className = "channel-member-row";
    const fixed = member.role === "owner";
    row.innerHTML = `
      <div class="channel-member-info"><strong>${escapeHtml(member.name || member.email || "사용자")}</strong><small>${escapeHtml(member.email || "")}</small></div>
      <div class="channel-member-controls">
        <select class="member-role-select" aria-label="채널 역할" ${!ownerCanChangeRole || fixed ? "disabled" : ""}>
          <option value="member" ${member.role === "member" ? "selected" : ""}>멤버</option>
          <option value="admin" ${member.role === "admin" ? "selected" : ""}>관리자</option>
          ${fixed ? '<option value="owner" selected>소유자</option>' : ""}
        </select>
        <select class="member-bingo-select" aria-label="빙고 권한" ${!canManageAccess || fixed || member.role === "admin" ? "disabled" : ""}>
          <option value="none" ${member.bingoAccess === "none" ? "selected" : ""}>빙고 없음</option>
          <option value="read" ${member.bingoAccess === "read" ? "selected" : ""}>빙고 보기</option>
          <option value="write" ${member.bingoAccess === "write" ? "selected" : ""}>빙고 사용</option>
        </select>
        ${!fixed && canManageAccess && (myMembership.role === "owner" || member.role === "member") ? '<button class="danger-outline compact-button remove-channel-member" type="button">제외</button>' : ""}
      </div>`;

    const roleSelect = row.querySelector(".member-role-select");
    roleSelect?.addEventListener("change", async () => {
      const previous = member.role;
      const next = roleSelect.value;
      try {
        await updateMemberAndMirror(channel.id, member.uid, { role: next, bingoAccess: next === "admin" ? "write" : member.bingoAccess });
        member.role = next;
        if (next === "admin") member.bingoAccess = "write";
        await renderMemberManager();
      } catch (error) {
        console.error(error);
        roleSelect.value = previous;
        memberMessage.textContent = firebaseErrorMessage(error, "역할 변경에 실패했습니다.");
      }
    });

    const accessSelect = row.querySelector(".member-bingo-select");
    accessSelect?.addEventListener("change", async () => {
      const previous = member.bingoAccess || "none";
      try {
        await updateMemberAndMirror(channel.id, member.uid, { bingoAccess: accessSelect.value });
        member.bingoAccess = accessSelect.value;
      } catch (error) {
        console.error(error);
        accessSelect.value = previous;
        memberMessage.textContent = firebaseErrorMessage(error, "빙고 권한 변경에 실패했습니다.");
      }
    });

    row.querySelector(".remove-channel-member")?.addEventListener("click", () => removeChannelMember(channel, member));
    memberList.appendChild(row);
  });
}

async function updateMemberAndMirror(channelId, uid, changes) {
  const batch = writeBatch(db);
  batch.update(doc(db, "channels", channelId, "members", uid), { ...changes, updatedAt: serverTimestamp() });
  const mirrorChanges = { updatedAt: serverTimestamp() };
  if (changes.role) mirrorChanges.role = changes.role;
  batch.update(doc(db, "users", uid, "memberships", channelId), mirrorChanges);
  await batch.commit();
}

async function removeChannelMember(channel, member) {
  const confirmed = await showConfirm(`${member.name || member.email || "선택한 멤버"}님을 채널에서 제외할까요?`, { title: "채널 멤버 제외", confirmText: "제외", danger: true });
  if (!confirmed) return;
  try {
    const ownedRooms = await getDocs(query(collection(db, "channels", channel.id, "bingoRooms"), where("ownerUid", "==", member.uid)));
    if (!ownedRooms.empty) {
      await showNotice("이 사용자가 소유한 빙고방이 있습니다. 방을 다른 관리자에게 위임하거나 삭제한 뒤 채널에서 제외해주세요.");
      return;
    }
    const invitedRooms = await getDocs(query(collection(db, "channels", channel.id, "bingoRooms"), where("participantUids", "array-contains", member.uid)));
    for (const roomDoc of invitedRooms.docs) {
      const data = roomDoc.data();
      await updateDoc(roomDoc.ref, {
        participantUids: (data.participantUids || []).filter((uid) => uid !== member.uid),
        updatedAt: serverTimestamp()
      });
    }
    const batch = writeBatch(db);
    batch.delete(doc(db, "channels", channel.id, "members", member.uid));
    batch.delete(doc(db, "users", member.uid, "memberships", channel.id));
    await batch.commit();
    await renderMemberManager();
  } catch (error) {
    console.error(error);
    memberMessage.textContent = firebaseErrorMessage(error, "채널 멤버 제외에 실패했습니다.");
  }
}

function closeMemberModal() {
  memberModal.classList.add("hidden");
  document.body.classList.remove("modal-open");
  currentMemberChannel = null;
}

memberModal.querySelectorAll("[data-close-channel-members]").forEach((item) => item.addEventListener("click", closeMemberModal));
document.getElementById("createChannelForm").addEventListener("submit", createChannel);
document.getElementById("logoutButton").addEventListener("click", async () => {
  await signOut(auth);
  location.replace("./index.html");
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.replace("./index.html");
    return;
  }
  try {
    currentUser = user;
    currentProfile = await loadPlatformProfile(user);
    document.getElementById("userEmail").textContent = user.email || "";
    document.getElementById("platformRoleBadge").textContent = isDeveloper(currentProfile) ? "개발자" : "사용자";
    if (isDeveloper(currentProfile)) initUserManagementModal(currentProfile);
    await loadMemberships();
    renderChannels();
    await loadApprovedUsersForDeveloper();
    loadingPanel.classList.add("hidden");
    channelContent.classList.remove("hidden");
    await acceptInviteFromHash();
  } catch (error) {
    console.error(error);
    loadingPanel.innerHTML = `<h2>채널 정보를 불러올 수 없습니다.</h2><p>${escapeHtml(firebaseErrorMessage(error, error.message || "채널 정보를 불러오지 못했습니다."))}</p><button id="channelBackLogin" type="button">로그인 화면으로</button>`;
    document.getElementById("channelBackLogin")?.addEventListener("click", async () => { await signOut(auth); location.replace("./index.html"); });
  }
});
