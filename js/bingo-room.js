import { auth, db, storage } from "./firebase-config.js?v=7";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  collection,
  onSnapshot,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  deleteObject,
  getDownloadURL,
  ref as storageRef
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js";

const params = new URLSearchParams(location.search);
const roomId = params.get("id");
const boardImageRef = roomId ? storageRef(storage, `bingoImages/${roomId}/board.webp`) : null;

const loadingPanel = document.getElementById("loadingPanel");
const roomContent = document.getElementById("roomContent");
const bingoBoard = document.getElementById("bingoBoard");
const roomActions = document.getElementById("roomActions");
const roomMessage = document.getElementById("roomMessage");
const participantManagePanel = document.getElementById("participantManagePanel");
const manageParticipantList = document.getElementById("manageParticipantList");

let currentUser = null;
let currentProfile = null;
let membership = null;
let roomData = null;
let boardData = null;
let boardImageUrl = "";
let access = "none";
let allUsers = [];
let roomUnsubscribe = null;
let boardUnsubscribe = null;
let membershipUnsubscribe = null;

const roleLabel = (value) => ({
  super_admin: "최고관리자",
  admin: "관리자",
  user: "일반사용자"
}[value] || value);

const isManager = (profile) => ["super_admin", "admin"].includes(profile?.role);
const isOwner = () => roomData?.ownerUid === currentUser?.uid && membership?.role === "owner";
const canWriteBoard = () => access === "write";

function setMessage(text, success = false) {
  roomMessage.textContent = text;
  roomMessage.classList.toggle("success", success);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadProfile(user) {
  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) throw new Error("등록되지 않은 계정입니다.");

  const profile = snap.data();
  if (profile.status !== "approved") throw new Error("승인되지 않았거나 사용중지된 계정입니다.");

  const resolvedAccess = isManager(profile) ? "write" : (profile.bingoAccess || "none");
  if (resolvedAccess === "none") throw new Error("빙고에 접근할 권한이 없습니다.");

  return { uid: user.uid, ...profile, resolvedAccess };
}

async function loadRoomAndMembership() {
  if (!roomId) throw new Error("빙고방 주소가 올바르지 않습니다.");

  const membershipSnap = await getDoc(doc(db, "bingoMemberships", currentUser.uid));
  if (!membershipSnap.exists() || membershipSnap.data().roomId !== roomId) {
    throw new Error("현재 참가 중인 빙고방이 아닙니다. 빙고 목록에서 먼저 참가해주세요.");
  }
  membership = membershipSnap.data();

  const roomSnap = await getDoc(doc(db, "bingoRooms", roomId));
  if (!roomSnap.exists()) throw new Error("삭제되었거나 존재하지 않는 빙고방입니다.");
  roomData = { id: roomSnap.id, ...roomSnap.data() };

  const allowed = roomData.ownerUid === currentUser.uid
    || (roomData.participantUids || []).includes(currentUser.uid);
  if (!allowed) throw new Error("이 빙고방의 참가자가 아닙니다.");

  const boardSnap = await getDoc(doc(db, "bingoBoards", roomId));
  if (!boardSnap.exists()) throw new Error("빙고판 정보를 찾을 수 없습니다.");
  boardData = boardSnap.data();
}


async function loadBoardImage() {
  boardImageUrl = "";
  if (!boardImageRef) return;

  try {
    boardImageUrl = await getDownloadURL(boardImageRef);
  } catch (error) {
    if (error?.code === "storage/object-not-found") return;
    console.error(error);
    setMessage("빙고 사진을 불러오지 못했습니다. 체크 상태는 계속 사용할 수 있습니다.");
  }
}

function renderRoomHeader() {
  document.getElementById("roomTitle").textContent = roomData.name || "빙고";
  document.getElementById("roomMeta").textContent = `${roomData.size} × ${roomData.size} · 방장 ${roomData.ownerName || "-"}`;
  document.getElementById("boardPermission").textContent = access === "write" ? "쓰기" : "읽기";
  document.getElementById("boardHelp").textContent = access === "write"
    ? "칸을 눌러 체크하거나 해제할 수 있습니다. 사진이 있는 방은 체크한 칸에 해당 사진 조각이 보입니다."
    : "읽기 권한입니다. 다른 사용자가 체크한 상태만 볼 수 있습니다.";

  roomActions.innerHTML = "";

  if (isOwner()) {
    if (access === "write") {
      const manageButton = document.createElement("button");
      manageButton.type = "button";
      manageButton.className = "secondary";
      manageButton.textContent = "참가자 관리";
      manageButton.addEventListener("click", () => {
        participantManagePanel.classList.toggle("hidden");
        if (!participantManagePanel.classList.contains("hidden")) {
          participantManagePanel.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
      roomActions.appendChild(manageButton);
    }

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "danger";
    deleteButton.textContent = "방 삭제";
    deleteButton.addEventListener("click", deleteRoom);
    roomActions.appendChild(deleteButton);
  } else {
    const leaveButton = document.createElement("button");
    leaveButton.type = "button";
    leaveButton.className = "danger-outline";
    leaveButton.textContent = "방 나가기";
    leaveButton.addEventListener("click", leaveRoom);
    roomActions.appendChild(leaveButton);
  }
}

function getCellBackgroundPosition(index, size) {
  const row = Math.floor(index / size);
  const col = index % size;
  const x = size <= 1 ? 0 : (col / (size - 1)) * 100;
  const y = size <= 1 ? 0 : (row / (size - 1)) * 100;
  return `${x}% ${y}%`;
}

function renderBoard() {
  if (!roomData || !boardData) return;

  const size = Number(roomData.size) || 5;
  const total = size * size;
  const checkedCells = boardData.checkedCells || {};
  const minCell = size >= 50 ? 24 : size >= 20 ? 30 : size >= 10 ? 42 : 72;

  bingoBoard.innerHTML = "";
  bingoBoard.style.setProperty("--bingo-size", size);
  bingoBoard.style.setProperty("--bingo-cell-size", `${minCell}px`);

  const fragment = document.createDocumentFragment();

  for (let index = 0; index < total; index += 1) {
    const checked = checkedCells[String(index)] === true;
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = `bingo-cell${checked ? " checked" : ""}`;
    cell.dataset.index = String(index);
    cell.setAttribute("aria-pressed", checked ? "true" : "false");
    cell.disabled = !canWriteBoard();

    if (checked && boardImageUrl) {
      cell.classList.add("has-image");
      cell.style.backgroundImage = `url("${boardImageUrl}")`;
      cell.style.backgroundSize = `${size * 100}% ${size * 100}%`;
      cell.style.backgroundPosition = getCellBackgroundPosition(index, size);
      cell.textContent = "";
    } else {
      cell.innerHTML = checked
        ? `<span class="cell-check-mark">✓</span>`
        : `<span class="cell-number">${index + 1}</span>`;
    }

    if (canWriteBoard()) {
      cell.addEventListener("click", () => toggleCell(index, checked));
    }

    fragment.appendChild(cell);
  }

  bingoBoard.appendChild(fragment);
}

async function toggleCell(index, checked) {
  if (!canWriteBoard()) return;

  const field = `checkedCells.${index}`;
  try {
    await updateDoc(doc(db, "bingoBoards", roomId), {
      [field]: !checked,
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error(error);
    setMessage("빙고 체크 상태를 저장하지 못했습니다.");
  }
}

async function loadManageUsers() {
  if (!isOwner() || access !== "write") return;

  const snap = await getDocs(collection(db, "users"));
  allUsers = snap.docs
    .map((item) => ({ uid: item.id, ...item.data() }))
    .filter((user) => {
      if (user.uid === currentUser.uid || user.status !== "approved") return false;
      if (["super_admin", "admin"].includes(user.role)) return true;
      return ["read", "write"].includes(user.bingoAccess);
    })
    .sort((a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || "", "ko"));

  renderManageUsers();
}

function renderManageUsers() {
  manageParticipantList.innerHTML = "";

  if (!allUsers.length) {
    manageParticipantList.textContent = "선택할 수 있는 사용자가 없습니다.";
    return;
  }

  const selected = new Set(roomData.participantUids || []);
  allUsers.forEach((user) => {
    const label = document.createElement("label");
    label.className = "participant-option";
    label.innerHTML = `
      <input type="checkbox" name="manageParticipantUid" value="${escapeHtml(user.uid)}" ${selected.has(user.uid) ? "checked" : ""} />
      <span>
        <strong>${escapeHtml(user.name || user.email || "사용자")}</strong>
        <small>${escapeHtml(user.email || "")}</small>
      </span>
    `;
    manageParticipantList.appendChild(label);
  });
}

async function saveParticipants() {
  if (!isOwner() || access !== "write") return;

  const nextUids = [...document.querySelectorAll('input[name="manageParticipantUid"]:checked')]
    .map((item) => item.value);
  const previousUids = roomData.participantUids || [];
  const removedUids = previousUids.filter((uid) => !nextUids.includes(uid));

  const saveButton = document.getElementById("saveParticipantsButton");
  saveButton.disabled = true;
  saveButton.textContent = "저장 중...";
  setMessage("");

  try {
    // 현재 이 방에 들어와 있는 제외 대상은 방장이 먼저 퇴장 처리할 수 있습니다.
    for (const uid of removedUids) {
      const membershipRef = doc(db, "bingoMemberships", uid);
      const membershipSnap = await getDoc(membershipRef);
      if (membershipSnap.exists()) {
        const data = membershipSnap.data();
        if (data.roomId === roomId && data.role === "participant") {
          await deleteDoc(membershipRef);
        }
      }
    }

    await updateDoc(doc(db, "bingoRooms", roomId), {
      participantUids: nextUids,
      updatedAt: serverTimestamp()
    });

    setMessage("참가자 목록을 변경했습니다.", true);
  } catch (error) {
    console.error(error);
    setMessage("참가자 변경에 실패했습니다.");
    renderManageUsers();
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "참가자 저장";
  }
}

async function leaveRoom() {
  if (isOwner()) return;
  if (!confirm("현재 빙고방에서 나갈까요?\n나간 뒤에는 다른 빙고방에 참가할 수 있습니다.")) return;

  try {
    await deleteDoc(doc(db, "bingoMemberships", currentUser.uid));
    location.replace("./bingo.html");
  } catch (error) {
    console.error(error);
    setMessage("방 나가기에 실패했습니다.");
  }
}

async function deleteRoom() {
  if (!isOwner()) return;
  if (!confirm("이 빙고방을 삭제할까요?\n참가자들의 현재 참가 상태와 빙고 데이터도 함께 정리됩니다.")) return;

  setMessage("방을 삭제하고 있습니다...");

  try {
    try {
      if (boardImageRef) await deleteObject(boardImageRef);
    } catch (storageError) {
      if (storageError?.code !== "storage/object-not-found") throw storageError;
    }

    for (const uid of roomData.participantUids || []) {
      const membershipRef = doc(db, "bingoMemberships", uid);
      const membershipSnap = await getDoc(membershipRef);
      if (membershipSnap.exists()) {
        const data = membershipSnap.data();
        if (data.roomId === roomId && data.role === "participant") {
          await deleteDoc(membershipRef);
        }
      }
    }

    await deleteDoc(doc(db, "bingoBoards", roomId));
    await deleteDoc(doc(db, "bingoRooms", roomId));
    await deleteDoc(doc(db, "bingoMemberships", currentUser.uid));

    location.replace("./bingo.html");
  } catch (error) {
    console.error(error);
    setMessage("방 삭제 중 오류가 발생했습니다. 다시 시도해주세요.");
  }
}

function startRealtimeListeners() {
  roomUnsubscribe = onSnapshot(doc(db, "bingoRooms", roomId), async (snap) => {
    if (!snap.exists()) {
      location.replace("./bingo.html");
      return;
    }

    roomData = { id: snap.id, ...snap.data() };
    const allowed = roomData.ownerUid === currentUser.uid
      || (roomData.participantUids || []).includes(currentUser.uid);

    if (!allowed) {
      alert("방장이 참가자 목록에서 제외하여 빙고방에서 나갑니다.");
      location.replace("./bingo.html");
      return;
    }

    renderRoomHeader();
    if (isOwner() && access === "write") {
      await loadManageUsers();
    } else {
      participantManagePanel.classList.add("hidden");
    }
    renderBoard();
  });

  boardUnsubscribe = onSnapshot(doc(db, "bingoBoards", roomId), (snap) => {
    if (!snap.exists()) return;
    boardData = snap.data();
    renderBoard();
  });

  membershipUnsubscribe = onSnapshot(doc(db, "bingoMemberships", currentUser.uid), (snap) => {
    if (!snap.exists()) {
      location.replace("./bingo.html");
      return;
    }
    const data = snap.data();
    if (data.roomId !== roomId) location.replace("./bingo.html");
  });
}

document.getElementById("saveParticipantsButton").addEventListener("click", saveParticipants);

document.getElementById("logoutButton").addEventListener("click", async () => {
  roomUnsubscribe?.();
  boardUnsubscribe?.();
  membershipUnsubscribe?.();
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
    access = currentProfile.resolvedAccess;

    document.getElementById("userEmail").textContent = user.email || "";
    document.getElementById("roleBadge").textContent = roleLabel(currentProfile.role);

    await loadRoomAndMembership();
    await loadBoardImage();
    renderRoomHeader();
    renderBoard();

    if (isOwner() && access === "write") {
      await loadManageUsers();
    }

    loadingPanel.classList.add("hidden");
    roomContent.classList.remove("hidden");
    startRealtimeListeners();
  } catch (error) {
    console.error(error);
    loadingPanel.innerHTML = `
      <h2>빙고방에 들어갈 수 없습니다.</h2>
      <p>${escapeHtml(error.message)}</p>
      <a class="service-button inline-button" href="./bingo.html">빙고 목록으로 돌아가기</a>
    `;
  }
});
