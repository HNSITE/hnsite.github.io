import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const loadingPanel = document.getElementById("loadingPanel");
const bingoContent = document.getElementById("bingoContent");
const currentRoomContent = document.getElementById("currentRoomContent");
const lobbyMessage = document.getElementById("lobbyMessage");
const createPanel = document.getElementById("createPanel");
const joinPanel = document.getElementById("joinPanel");
const participantList = document.getElementById("participantList");
const roomList = document.getElementById("roomList");
const createRoomButton = document.getElementById("createRoomButton");

let currentUser = null;
let currentProfile = null;
let currentMembership = null;
let selectableUsers = [];
let visibleRooms = [];

const roleLabel = (value) => ({
  super_admin: "최고관리자",
  admin: "관리자",
  user: "일반사용자"
}[value] || value);

const isManager = (profile) => ["super_admin", "admin"].includes(profile?.role);
const bingoAccess = () => isManager(currentProfile) ? "write" : (currentProfile?.bingoAccess || "none");
const accessLabel = (value) => ({ none: "권한 없음", read: "읽기", write: "쓰기" }[value] || "권한 없음");

function setMessage(text, success = false) {
  lobbyMessage.textContent = text;
  lobbyMessage.classList.toggle("success", success);
}

async function loadProfile(user) {
  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) throw new Error("등록되지 않은 계정입니다.");

  const profile = snap.data();
  if (profile.status !== "approved") throw new Error("승인되지 않았거나 사용중지된 계정입니다.");

  const access = isManager(profile) ? "write" : (profile.bingoAccess || "none");
  if (access === "none") throw new Error("빙고에 접근할 권한이 없습니다.");

  return { uid: user.uid, ...profile };
}

async function loadMembership() {
  const ref = doc(db, "bingoMemberships", currentUser.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;

  const membership = { id: snap.id, ...snap.data() };
  const roomSnap = await getDoc(doc(db, "bingoRooms", membership.roomId));

  if (!roomSnap.exists()) {
    // 삭제 중 중단 등으로 남은 자신의 고아 참가정보는 다음 진입 때 정리합니다.
    const { deleteDoc } = await import("https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js");
    await deleteDoc(ref);
    return null;
  }

  return membership;
}

async function loadVisibleRooms() {
  const rooms = new Map();
  const roomsRef = collection(db, "bingoRooms");

  const [ownedSnap, invitedSnap] = await Promise.all([
    getDocs(query(roomsRef, where("ownerUid", "==", currentUser.uid))),
    getDocs(query(roomsRef, where("participantUids", "array-contains", currentUser.uid)))
  ]);

  [...ownedSnap.docs, ...invitedSnap.docs].forEach((roomDoc) => {
    rooms.set(roomDoc.id, { id: roomDoc.id, ...roomDoc.data() });
  });

  visibleRooms = [...rooms.values()].sort((a, b) => {
    const aMillis = a.createdAt?.toMillis?.() || 0;
    const bMillis = b.createdAt?.toMillis?.() || 0;
    return bMillis - aMillis;
  });
}

function renderCurrentRoom() {
  if (!currentMembership) {
    currentRoomContent.className = "current-room-empty";
    currentRoomContent.innerHTML = `
      <strong>현재 참여 중인 방이 없습니다.</strong>
      <span>새 방을 만들거나 초대받은 방에 참가할 수 있어요.</span>
    `;
    return;
  }

  const room = visibleRooms.find((item) => item.id === currentMembership.roomId);
  const roleText = currentMembership.role === "owner" ? "방장" : "참가자";

  currentRoomContent.className = "current-room-card";
  currentRoomContent.innerHTML = `
    <div>
      <span class="room-state-badge">${roleText}</span>
      <h3>${escapeHtml(room?.name || "현재 빙고방")}</h3>
      <p>${room?.size || "-"} × ${room?.size || "-"}</p>
    </div>
    <a class="service-button" href="./bingo-room.html?id=${encodeURIComponent(currentMembership.roomId)}">현재 방으로 이동</a>
  `;
}

function renderParticipantList() {
  if (bingoAccess() !== "write") {
    participantList.textContent = "빙고 쓰기 권한이 있어야 방을 생성할 수 있습니다.";
    return;
  }

  if (!selectableUsers.length) {
    participantList.textContent = "선택할 수 있는 승인 사용자가 없습니다.";
    return;
  }

  participantList.innerHTML = "";
  selectableUsers.forEach((user) => {
    const label = document.createElement("label");
    label.className = "participant-option";
    label.innerHTML = `
      <input type="checkbox" name="participantUid" value="${escapeAttribute(user.uid)}" />
      <span>
        <strong>${escapeHtml(user.name || user.email || "사용자")}</strong>
        <small>${escapeHtml(user.email || "")}</small>
      </span>
    `;
    participantList.appendChild(label);
  });
}

function roomStatusText(room) {
  if (room.ownerUid === currentUser.uid) return "내가 만든 방";
  if (currentMembership?.roomId === room.id) return "현재 참가 중";
  return "초대받은 방";
}

function renderRoomList() {
  if (!visibleRooms.length) {
    roomList.innerHTML = `<div class="empty-list-box">현재 참가 가능한 빙고방이 없습니다.</div>`;
    return;
  }

  roomList.innerHTML = "";

  visibleRooms.forEach((room) => {
    const isOwner = room.ownerUid === currentUser.uid;
    const isCurrent = currentMembership?.roomId === room.id;
    const card = document.createElement("article");
    card.className = `bingo-room-item${isCurrent ? " current" : ""}`;

    let actionHtml = "";
    if (isCurrent) {
      actionHtml = `<a class="service-button" href="./bingo-room.html?id=${encodeURIComponent(room.id)}">들어가기</a>`;
    } else if (isOwner) {
      actionHtml = `<span class="room-blocked-text">내 방이지만 현재 상태를 확인해주세요.</span>`;
    } else if (currentMembership) {
      const reason = currentMembership.role === "owner"
        ? "내가 만든 방을 삭제한 후 참가할 수 있습니다."
        : "현재 방에서 나간 후 참가할 수 있습니다.";
      actionHtml = `<button class="secondary" type="button" disabled>${reason}</button>`;
    } else {
      actionHtml = `<button class="join-room-button" data-room-id="${escapeAttribute(room.id)}" type="button">참가하기</button>`;
    }

    card.innerHTML = `
      <div class="bingo-room-item-main">
        <span class="room-state-badge">${roomStatusText(room)}</span>
        <h3>${escapeHtml(room.name)}</h3>
        <p>${room.size} × ${room.size} · 초대 ${room.participantUids?.length || 0}명</p>
      </div>
      <div class="bingo-room-item-action">${actionHtml}</div>
    `;

    roomList.appendChild(card);
  });

  roomList.querySelectorAll(".join-room-button").forEach((button) => {
    button.addEventListener("click", () => joinRoom(button.dataset.roomId));
  });
}

async function loadSelectableUsers() {
  if (bingoAccess() !== "write") {
    selectableUsers = [];
    return;
  }

  const snap = await getDocs(collection(db, "users"));
  selectableUsers = snap.docs
    .map((item) => ({ uid: item.id, ...item.data() }))
    .filter((user) => {
      if (user.uid === currentUser.uid || user.status !== "approved") return false;
      if (["super_admin", "admin"].includes(user.role)) return true;
      return ["read", "write"].includes(user.bingoAccess);
    })
    .sort((a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || "", "ko"));
}

async function refreshAll() {
  currentMembership = await loadMembership();
  await loadVisibleRooms();
  renderCurrentRoom();
  renderRoomList();
}

async function joinRoom(roomId) {
  setMessage("");

  if (currentMembership) {
    setMessage(currentMembership.role === "owner"
      ? "현재 생성한 빙고방을 삭제한 후 다른 방에 참가할 수 있습니다."
      : "현재 참가 중인 빙고방에서 나간 후 다른 방에 참가할 수 있습니다.");
    return;
  }

  const membershipRef = doc(db, "bingoMemberships", currentUser.uid);
  const roomRef = doc(db, "bingoRooms", roomId);

  try {
    await runTransaction(db, async (transaction) => {
      const membershipSnap = await transaction.get(membershipRef);
      if (membershipSnap.exists()) throw new Error("ALREADY_IN_ROOM");

      const roomSnap = await transaction.get(roomRef);
      if (!roomSnap.exists()) throw new Error("ROOM_NOT_FOUND");

      const room = roomSnap.data();
      if (!(room.participantUids || []).includes(currentUser.uid)) {
        throw new Error("NOT_INVITED");
      }

      transaction.set(membershipRef, {
        roomId,
        role: "participant",
        joinedAt: serverTimestamp()
      });
    });

    location.href = `./bingo-room.html?id=${encodeURIComponent(roomId)}`;
  } catch (error) {
    console.error(error);
    if (error.message === "ALREADY_IN_ROOM") {
      setMessage("이미 다른 빙고방에 참가 중입니다.");
    } else if (error.message === "NOT_INVITED") {
      setMessage("현재 이 방의 참가자로 지정되어 있지 않습니다.");
    } else {
      setMessage("방 참가에 실패했습니다. 다시 시도해주세요.");
    }
    await refreshAll();
  }
}

async function createRoom(event) {
  event.preventDefault();
  setMessage("");

  if (bingoAccess() !== "write") {
    setMessage("빙고 쓰기 권한이 있어야 방을 생성할 수 있습니다.");
    return;
  }

  if (currentMembership) {
    setMessage(currentMembership.role === "owner"
      ? "이미 생성한 빙고방이 있습니다. 기존 방을 삭제한 후 새 방을 만들 수 있습니다."
      : "현재 다른 빙고방에 참가 중입니다. 기존 방을 나간 후 새 방을 만들 수 있습니다.");
    return;
  }

  const name = document.getElementById("roomName").value.trim();
  const size = Number(document.getElementById("roomSize").value);
  const participantUids = [...document.querySelectorAll('input[name="participantUid"]:checked')]
    .map((item) => item.value);

  if (!name) {
    setMessage("빙고 이름을 입력해주세요.");
    return;
  }

  const allowedSizes = [3, 4, 5, 10, 20, 50, 100];
  if (!allowedSizes.includes(size)) {
    setMessage("올바른 빙고판 크기를 선택해주세요.");
    return;
  }

  createRoomButton.disabled = true;
  createRoomButton.textContent = "생성 중...";

  const roomRef = doc(collection(db, "bingoRooms"));
  const boardRef = doc(db, "bingoBoards", roomRef.id);
  const membershipRef = doc(db, "bingoMemberships", currentUser.uid);

  try {
    await runTransaction(db, async (transaction) => {
      const membershipSnap = await transaction.get(membershipRef);
      if (membershipSnap.exists()) throw new Error("ALREADY_IN_ROOM");

      transaction.set(membershipRef, {
        roomId: roomRef.id,
        role: "owner",
        joinedAt: serverTimestamp()
      });

      transaction.set(roomRef, {
        name,
        ownerUid: currentUser.uid,
        ownerName: currentProfile.name || currentUser.displayName || currentUser.email || "방장",
        size,
        participantUids,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      transaction.set(boardRef, {
        checkedCells: {},
        imagePath: "",
        updatedAt: serverTimestamp()
      });
    });

    location.href = `./bingo-room.html?id=${encodeURIComponent(roomRef.id)}`;
  } catch (error) {
    console.error(error);
    if (error.message === "ALREADY_IN_ROOM") {
      setMessage("이미 다른 빙고방에 참여 중입니다.");
    } else {
      setMessage("빙고방 생성에 실패했습니다. Firestore 규칙을 확인한 후 다시 시도해주세요.");
    }
  } finally {
    createRoomButton.disabled = false;
    createRoomButton.textContent = "빙고방 생성";
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

document.getElementById("showCreateButton").addEventListener("click", () => {
  setMessage("");
  if (bingoAccess() !== "write") {
    setMessage("빙고 쓰기 권한이 있어야 방을 생성할 수 있습니다.");
    return;
  }
  if (currentMembership) {
    setMessage(currentMembership.role === "owner"
      ? "이미 생성한 방이 있습니다. 기존 방을 삭제한 후 새 방을 만들 수 있습니다."
      : "현재 참가 중인 방에서 나간 후 새 방을 만들 수 있습니다.");
    return;
  }
  createPanel.classList.remove("hidden");
  joinPanel.classList.add("hidden");
  createPanel.scrollIntoView({ behavior: "smooth", block: "start" });
});

document.getElementById("showJoinButton").addEventListener("click", () => {
  setMessage("");
  joinPanel.classList.remove("hidden");
  createPanel.classList.add("hidden");
  joinPanel.scrollIntoView({ behavior: "smooth", block: "start" });
});

document.getElementById("closeCreateButton").addEventListener("click", () => {
  createPanel.classList.add("hidden");
});

document.getElementById("refreshRoomsButton").addEventListener("click", async () => {
  setMessage("");
  try {
    await refreshAll();
  } catch (error) {
    console.error(error);
    setMessage("방 목록을 새로고침하지 못했습니다.");
  }
});

document.getElementById("createRoomForm").addEventListener("submit", createRoom);

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
    currentProfile = await loadProfile(user);

    document.getElementById("userEmail").textContent = user.email || "";
    document.getElementById("roleBadge").textContent = roleLabel(currentProfile.role);
    document.getElementById("bingoPermissionBadge").textContent = `빙고 ${accessLabel(bingoAccess())}`;

    await Promise.all([loadSelectableUsers(), refreshAll()]);
    renderParticipantList();

    loadingPanel.classList.add("hidden");
    bingoContent.classList.remove("hidden");
    joinPanel.classList.remove("hidden");
  } catch (error) {
    console.error(error);
    loadingPanel.innerHTML = `
      <h2>빙고에 접근할 수 없습니다.</h2>
      <p>${escapeHtml(error.message)}</p>
      <a class="service-button inline-button" href="./app.html">메인으로 돌아가기</a>
    `;
  }
});
