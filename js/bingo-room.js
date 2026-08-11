import { auth, db, storage } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  collection,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  deleteObject,
  getDownloadURL,
  ref as storageRef
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js";
import { initUserManagementModal } from "./admin-modal.js?v=17";
import { showConfirm, showNotice } from "./ui-dialog.js?v=14";

// 빙고방 ID는 URL에 노출하지 않고 현재 사용자의 참가정보에서 확인합니다.
// 이전 버전의 ?id=... 주소로 들어와도 화면에 남지 않게 정리합니다.
if (location.search) {
  window.history.replaceState(null, "", location.pathname + location.hash);
}

let roomId = null;
let boardImageRef = null;

const loadingPanel = document.getElementById("loadingPanel");
const roomContent = document.getElementById("roomContent");
const bingoBoard = document.getElementById("bingoBoard");
const roomActions = document.getElementById("roomActions");
const roomMessage = document.getElementById("roomMessage");
const participantManagePanel = document.getElementById("participantManagePanel");
const currentParticipantList = document.getElementById("currentParticipantList");
const availableParticipantList = document.getElementById("availableParticipantList");
const currentParticipantCount = document.getElementById("currentParticipantCount");
const availableParticipantCount = document.getElementById("availableParticipantCount");
const currentParticipantSearch = document.getElementById("currentParticipantSearch");
const availableParticipantSearch = document.getElementById("availableParticipantSearch");
const currentParticipantPagination = document.getElementById("currentParticipantPagination");
const availableParticipantPagination = document.getElementById("availableParticipantPagination");
const completedBingoCount = document.getElementById("completedBingoCount");
const checkedCellCount = document.getElementById("checkedCellCount");
const remainingCellCount = document.getElementById("remainingCellCount");
const chickenCount = document.getElementById("chickenCount");
const selectAllCellsButton = document.getElementById("selectAllCellsButton");
const clearAllCellsButton = document.getElementById("clearAllCellsButton");
const decreaseChickenButton = document.getElementById("decreaseChickenButton");
const increaseChickenButton = document.getElementById("increaseChickenButton");

let currentUser = null;
let currentProfile = null;
let membership = null;
let roomData = null;
let boardData = null;
let boardImageUrl = "";
let access = "none";
let allUsers = [];
let participantDraft = new Set();
let participantDraftDirty = false;
let roomUnsubscribe = null;
let boardUnsubscribe = null;
let membershipUnsubscribe = null;
let currentParticipantSearchTerm = "";
let availableParticipantSearchTerm = "";
let currentParticipantPage = 1;
let availableParticipantPage = 1;
const MANAGE_PAGE_SIZE = 5;

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
  const membershipSnap = await getDoc(doc(db, "bingoMemberships", currentUser.uid));
  if (!membershipSnap.exists()) {
    throw new Error("현재 참가 중인 빙고방이 없습니다. 빙고 목록에서 먼저 참가해주세요.");
  }

  membership = membershipSnap.data();
  roomId = membership.roomId || null;
  if (!roomId) throw new Error("현재 참가정보가 올바르지 않습니다.");
  boardImageRef = storageRef(storage, `bingoImages/${roomId}/board.webp`);

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
  document.getElementById("boardPermission").textContent = `권한: ${access === "write" ? "쓰기" : "읽기"}`;

  roomActions.innerHTML = "";

  if (isOwner()) {
    if (access === "write") {
      const manageButton = document.createElement("button");
      manageButton.type = "button";
      manageButton.className = "secondary";
      manageButton.textContent = "참가자 관리";
      manageButton.addEventListener("click", () => {
        const willOpen = participantManagePanel.classList.contains("hidden");
        participantManagePanel.classList.toggle("hidden");
        manageButton.textContent = willOpen ? "참가자 관리 닫기" : "참가자 관리";
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

function getBoardProgress() {
  const size = Number(roomData?.size) || 0;
  const total = size * size;
  const checkedCells = boardData?.checkedCells || {};
  const checkedIndexes = new Set();

  for (let index = 0; index < total; index += 1) {
    if (checkedCells[String(index)] === true) checkedIndexes.add(index);
  }

  let completed = 0;
  if (size > 0) {
    for (let row = 0; row < size; row += 1) {
      let rowComplete = true;
      for (let col = 0; col < size; col += 1) {
        if (!checkedIndexes.has(row * size + col)) {
          rowComplete = false;
          break;
        }
      }
      if (rowComplete) completed += 1;
    }

    for (let col = 0; col < size; col += 1) {
      let colComplete = true;
      for (let row = 0; row < size; row += 1) {
        if (!checkedIndexes.has(row * size + col)) {
          colComplete = false;
          break;
        }
      }
      if (colComplete) completed += 1;
    }

    let mainDiagonal = true;
    let antiDiagonal = true;
    for (let index = 0; index < size; index += 1) {
      if (!checkedIndexes.has(index * size + index)) mainDiagonal = false;
      if (!checkedIndexes.has(index * size + (size - 1 - index))) antiDiagonal = false;
    }
    if (mainDiagonal) completed += 1;
    if (antiDiagonal) completed += 1;
  }

  const checked = checkedIndexes.size;
  return {
    total,
    checked,
    remaining: Math.max(0, total - checked),
    completed,
    chicken: Math.max(0, Number(boardData?.chickenCount) || 0)
  };
}

function renderBoardStatus() {
  const progress = getBoardProgress();
  completedBingoCount.textContent = String(progress.completed);
  checkedCellCount.textContent = `${progress.checked} / ${progress.total}`;
  remainingCellCount.textContent = String(progress.remaining);
  chickenCount.textContent = String(progress.chicken);

  const disabled = !canWriteBoard();
  selectAllCellsButton.disabled = disabled || progress.total === 0 || progress.checked === progress.total;
  clearAllCellsButton.disabled = disabled || progress.checked === 0;
  decreaseChickenButton.disabled = disabled || progress.chicken <= 0;
  increaseChickenButton.disabled = disabled || progress.chicken >= 999;
}

async function setAllCells(checked) {
  if (!canWriteBoard() || !roomId) return;

  if (!checked) {
    const confirmed = await showConfirm(
      "현재 체크된 모든 칸이 해제됩니다.",
      { title: "빙고판 전체 해제", confirmText: "전체 해제", danger: true }
    );
    if (!confirmed) return;
  }

  const boardRef = doc(db, "bingoBoards", roomId);
  const size = Number(roomData?.size) || 0;
  const total = size * size;
  const nextCheckedCells = {};
  if (checked) {
    for (let index = 0; index < total; index += 1) {
      nextCheckedCells[String(index)] = true;
    }
  }

  try {
    await runTransaction(db, async (transaction) => {
      const boardSnap = await transaction.get(boardRef);
      if (!boardSnap.exists()) throw new Error("빙고판 정보를 찾을 수 없습니다.");
      transaction.update(boardRef, {
        checkedCells: nextCheckedCells,
        updatedAt: serverTimestamp()
      });
    });
  } catch (error) {
    console.error(error);
    setMessage(checked ? "전체 선택에 실패했습니다." : "전체 해제에 실패했습니다.");
  }
}

async function changeChickenCount(delta) {
  if (!canWriteBoard() || !roomId) return;

  const boardRef = doc(db, "bingoBoards", roomId);
  try {
    await runTransaction(db, async (transaction) => {
      const boardSnap = await transaction.get(boardRef);
      if (!boardSnap.exists()) throw new Error("빙고판 정보를 찾을 수 없습니다.");

      const current = Math.max(0, Number(boardSnap.data().chickenCount) || 0);
      const next = Math.min(999, Math.max(0, current + delta));
      transaction.update(boardRef, {
        chickenCount: next,
        updatedAt: serverTimestamp()
      });
    });
  } catch (error) {
    console.error(error);
    setMessage("치킨 수량을 저장하지 못했습니다.");
  }
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
      cell.addEventListener("click", () => toggleCell(index));
    }

    fragment.appendChild(cell);
  }

  bingoBoard.appendChild(fragment);
  renderBoardStatus();
}

async function toggleCell(index) {
  if (!canWriteBoard()) return;

  const boardRef = doc(db, "bingoBoards", roomId);
  const field = `checkedCells.${index}`;

  try {
    await runTransaction(db, async (transaction) => {
      const boardSnap = await transaction.get(boardRef);
      if (!boardSnap.exists()) throw new Error("빙고판 정보를 찾을 수 없습니다.");

      const checkedCells = boardSnap.data().checkedCells || {};
      const currentChecked = checkedCells[String(index)] === true;
      transaction.update(boardRef, {
        [field]: !currentChecked,
        updatedAt: serverTimestamp()
      });
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
    .filter((user) => user.uid !== currentUser.uid)
    .sort((a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || "", "ko"));

  participantDraft = new Set(roomData.participantUids || []);
  participantDraftDirty = false;
  renderManageUsers();
}

function canBeParticipant(user) {
  if (!user || user.status !== "approved") return false;
  if (["super_admin", "admin"].includes(user.role)) return true;
  return ["read", "write"].includes(user.bingoAccess);
}

function participantUser(uid) {
  return allUsers.find((user) => user.uid === uid) || { uid, name: "알 수 없는 사용자", email: uid };
}

function participantStatusText(user) {
  if (user.status !== "approved") return "현재 승인 상태가 아닙니다.";
  if (!canBeParticipant(user)) return "현재 빙고 접근 권한이 없습니다.";
  return user.email || "";
}

function createParticipantManageItem(user, mode) {
  const item = document.createElement("div");
  item.className = "participant-manage-item";

  const info = document.createElement("div");
  info.className = "participant-manage-info";
  info.innerHTML = `
    <strong>${escapeHtml(user.name || user.email || "사용자")}</strong>
    <small>${escapeHtml(participantStatusText(user))}</small>
  `;

  const button = document.createElement("button");
  button.type = "button";
  button.className = mode === "remove"
    ? "danger-outline compact-button"
    : "secondary compact-button";
  button.textContent = mode === "remove" ? "삭제" : "추가";

  if (mode === "remove") {
    button.addEventListener("click", () => {
      participantDraft.delete(user.uid);
      participantDraftDirty = true;
      renderManageUsers();
    });
  } else {
    button.disabled = participantDraft.size >= 20;
    button.addEventListener("click", () => {
      if (participantDraft.size >= 20) {
        setMessage("참가자는 최대 20명까지 지정할 수 있습니다.");
        return;
      }
      participantDraft.add(user.uid);
      participantDraftDirty = true;
      renderManageUsers();
    });
  }

  item.append(info, button);
  return item;
}

function participantMatches(user, term) {
  if (!term) return true;
  const haystack = `${user.name || ""} ${user.email || ""}`.toLocaleLowerCase("ko");
  return haystack.includes(term.toLocaleLowerCase("ko"));
}

function renderManagePagination(container, totalItems, page, onChange) {
  container.innerHTML = "";
  const totalPages = Math.max(1, Math.ceil(totalItems / MANAGE_PAGE_SIZE));
  if (totalItems <= MANAGE_PAGE_SIZE) return;

  const prev = document.createElement("button");
  prev.type = "button";
  prev.className = "pagination-button";
  prev.textContent = "이전";
  prev.disabled = page <= 1;
  prev.addEventListener("click", () => onChange(page - 1));

  const info = document.createElement("span");
  info.className = "pagination-info";
  info.textContent = `${page} / ${totalPages}`;

  const next = document.createElement("button");
  next.type = "button";
  next.className = "pagination-button";
  next.textContent = "다음";
  next.disabled = page >= totalPages;
  next.addEventListener("click", () => onChange(page + 1));
  container.append(prev, info, next);
}

function renderManageUsers() {
  currentParticipantList.innerHTML = "";
  availableParticipantList.innerHTML = "";

  const currentUsers = [...participantDraft]
    .map((uid) => participantUser(uid))
    .filter((user) => participantMatches(user, currentParticipantSearchTerm));
  const availableUsers = allUsers
    .filter((user) => canBeParticipant(user) && !participantDraft.has(user.uid))
    .filter((user) => participantMatches(user, availableParticipantSearchTerm));

  currentParticipantCount.textContent = `${participantDraft.size}명`;
  availableParticipantCount.textContent = `${allUsers.filter((user) => canBeParticipant(user) && !participantDraft.has(user.uid)).length}명`;

  const currentPages = Math.max(1, Math.ceil(currentUsers.length / MANAGE_PAGE_SIZE));
  const availablePages = Math.max(1, Math.ceil(availableUsers.length / MANAGE_PAGE_SIZE));
  currentParticipantPage = Math.min(currentParticipantPage, currentPages);
  availableParticipantPage = Math.min(availableParticipantPage, availablePages);

  if (!currentUsers.length) {
    currentParticipantList.innerHTML = `<div class="participant-manage-empty">${currentParticipantSearchTerm ? "검색 결과가 없습니다." : "현재 지정된 참가자가 없습니다."}</div>`;
  } else {
    const start = (currentParticipantPage - 1) * MANAGE_PAGE_SIZE;
    currentUsers.slice(start, start + MANAGE_PAGE_SIZE).forEach((user) => {
      currentParticipantList.appendChild(createParticipantManageItem(user, "remove"));
    });
  }

  if (!availableUsers.length) {
    availableParticipantList.innerHTML = `<div class="participant-manage-empty">${availableParticipantSearchTerm ? "검색 결과가 없습니다." : "추가 가능한 사용자가 없습니다."}</div>`;
  } else {
    const start = (availableParticipantPage - 1) * MANAGE_PAGE_SIZE;
    availableUsers.slice(start, start + MANAGE_PAGE_SIZE).forEach((user) => {
      availableParticipantList.appendChild(createParticipantManageItem(user, "add"));
    });
  }

  renderManagePagination(currentParticipantPagination, currentUsers.length, currentParticipantPage, (page) => {
    currentParticipantPage = page;
    renderManageUsers();
  });
  renderManagePagination(availableParticipantPagination, availableUsers.length, availableParticipantPage, (page) => {
    availableParticipantPage = page;
    renderManageUsers();
  });

  const saveButton = document.getElementById("saveParticipantsButton");
  saveButton.disabled = !participantDraftDirty;
}

async function saveParticipants() {
  if (!isOwner() || access !== "write" || !participantDraftDirty) return;

  const nextUids = [...participantDraft];
  const previousUids = roomData.participantUids || [];
  const removedUids = previousUids.filter((uid) => !participantDraft.has(uid));

  const saveButton = document.getElementById("saveParticipantsButton");
  saveButton.disabled = true;
  saveButton.textContent = "저장 중...";
  setMessage("");

  try {
    // 삭제 대상이 실제로 이 방에 입장 중인지 먼저 확인합니다.
    // 아직 입장하지 않은 초대 사용자도 조회할 수 있도록 Firestore Rules v12를 함께 적용해야 합니다.
    const activeMembershipRefs = [];
    for (const uid of removedUids) {
      const membershipRef = doc(db, "bingoMemberships", uid);
      const membershipSnap = await getDoc(membershipRef);
      if (membershipSnap.exists()) {
        const data = membershipSnap.data();
        if (data.roomId === roomId && data.role === "participant") {
          activeMembershipRefs.push(membershipRef);
        }
      }
    }

    // 참가자 목록 변경과 현재 입장 중인 제외 사용자의 퇴장을 한 번에 커밋합니다.
    const batch = writeBatch(db);
    batch.update(doc(db, "bingoRooms", roomId), {
      participantUids: nextUids,
      updatedAt: serverTimestamp()
    });
    activeMembershipRefs.forEach((membershipRef) => batch.delete(membershipRef));
    await batch.commit();

    roomData.participantUids = nextUids;
    participantDraftDirty = false;
    renderManageUsers();
    setMessage("참가자 변경사항을 저장했습니다.", true);
  } catch (error) {
    console.error(error);
    setMessage("참가자 변경에 실패했습니다. Firestore Rules v12가 게시되었는지 확인해주세요.");
  } finally {
    saveButton.textContent = "변경사항 저장";
    saveButton.disabled = !participantDraftDirty;
  }
}

async function leaveRoom() {
  if (isOwner()) return;
  const confirmed = await showConfirm(
    "나간 뒤에는 다른 빙고방에 참가할 수 있습니다.",
    { title: "현재 빙고방에서 나갈까요?", confirmText: "방 나가기", danger: true }
  );
  if (!confirmed) return;

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
  const confirmed = await showConfirm(
    "참가자들의 현재 참가 상태와 빙고 데이터도 함께 정리됩니다.",
    { title: "이 빙고방을 삭제할까요?", confirmText: "방 삭제", danger: true }
  );
  if (!confirmed) return;

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

    // 방 문서를 지우는 순간 실시간 리스너가 먼저 이동시키면
    // 방장 membership 삭제가 중단될 수 있으므로 삭제 직전에 감시를 종료합니다.
    roomUnsubscribe?.();
    boardUnsubscribe?.();
    membershipUnsubscribe?.();
    roomUnsubscribe = null;
    boardUnsubscribe = null;
    membershipUnsubscribe = null;

    await deleteDoc(doc(db, "bingoBoards", roomId));
    await deleteDoc(doc(db, "bingoRooms", roomId));
    await deleteDoc(doc(db, "bingoMemberships", currentUser.uid));

    location.replace("./bingo.html");
  } catch (error) {
    console.error(error);
    setMessage("방 삭제 중 오류가 발생했습니다. 다시 시도해주세요.");

    // 방 삭제 전에 실패한 경우에는 화면 실시간 감시를 다시 연결합니다.
    try {
      const roomSnap = await getDoc(doc(db, "bingoRooms", roomId));
      if (roomSnap.exists() && !roomUnsubscribe && !boardUnsubscribe && !membershipUnsubscribe) {
        startRealtimeListeners();
      }
    } catch (_) {
      // 이미 방이 삭제된 상태라면 빙고 로비에서 고아 참가정보를 자동 정리합니다.
      location.replace("./bingo.html");
    }
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
      await showNotice("방장이 참가자 목록에서 제외했습니다.", "빙고방에서 나갑니다");
      location.replace("./bingo.html");
      return;
    }

    renderRoomHeader();
    if (isOwner() && access === "write") {
      if (!participantDraftDirty) {
        await loadManageUsers();
      } else {
        renderManageUsers();
      }
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

selectAllCellsButton.addEventListener("click", () => setAllCells(true));
clearAllCellsButton.addEventListener("click", () => setAllCells(false));
decreaseChickenButton.addEventListener("click", () => changeChickenCount(-1));
increaseChickenButton.addEventListener("click", () => changeChickenCount(1));

currentParticipantSearch.addEventListener("input", () => {
  currentParticipantSearchTerm = currentParticipantSearch.value.trim();
  currentParticipantPage = 1;
  renderManageUsers();
});

availableParticipantSearch.addEventListener("input", () => {
  availableParticipantSearchTerm = availableParticipantSearch.value.trim();
  availableParticipantPage = 1;
  renderManageUsers();
});

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
    initUserManagementModal(currentProfile);

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
