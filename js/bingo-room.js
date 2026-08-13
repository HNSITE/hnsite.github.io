import { auth, db, storage } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  deleteObject,
  getDownloadURL,
  ref as storageRef
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js";
import { initUserManagementModal } from "./admin-modal.js?v=27";
import { firebaseErrorMessage } from "./error-messages.js?v=27";
import { showConfirm, showNotice } from "./ui-dialog.js?v=14";

// 빙고방 ID는 URL에 노출하지 않습니다.
if (location.search) {
  window.history.replaceState(null, "", location.pathname + location.hash);
}

let roomId = null;
let boardImageRef = null;
let archiveMode = false;

const loadingPanel = document.getElementById("loadingPanel");
const roomContent = document.getElementById("roomContent");
const bingoBoard = document.getElementById("bingoBoard");
const roomActions = document.getElementById("roomActions");
const roomMessage = document.getElementById("roomMessage");
const roomClosedNotice = document.getElementById("roomClosedNotice");
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
const undoBoardButton = document.getElementById("undoBoardButton");
const decreaseChickenButton = document.getElementById("decreaseChickenButton");
const increaseChickenButton = document.getElementById("increaseChickenButton");
const chickenHistoryButton = document.getElementById("chickenHistoryButton");
const chickenHistoryPanel = document.getElementById("chickenHistoryPanel");
const closeChickenHistoryButton = document.getElementById("closeChickenHistoryButton");
const chickenHistoryList = document.getElementById("chickenHistoryList");
const roomPresenceSummary = document.getElementById("roomPresenceSummary");
const resultSummaryPanel = document.getElementById("resultSummaryPanel");
const resultSummaryGrid = document.getElementById("resultSummaryGrid");
const printResultButton = document.getElementById("printResultButton");

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
let participantMembershipMap = new Map();
let roomUnsubscribe = null;
let boardUnsubscribe = null;
let membershipUnsubscribe = null;
let chickenLogsUnsubscribe = null;
let chickenLogs = [];
let lastBoardUndo = null;
let currentParticipantSearchTerm = "";
let availableParticipantSearchTerm = "";
let currentParticipantPage = 1;
let availableParticipantPage = 1;
const MANAGE_PAGE_SIZE = 5;
let presenceUnsubscribe = null;
let presenceHeartbeat = null;
let presenceMap = new Map();
let lastSeenActionId = "";
let autoCloseTimer = null;

const roleLabel = (value) => ({
  super_admin: "최고관리자",
  admin: "관리자",
  developer: "개발자",
  user: "일반사용자"
}[value] || value);

const isManager = (profile) => ["super_admin", "admin", "developer"].includes(profile?.role);
const isDeveloper = (profile) => profile?.role === "developer";
const isClosedRoom = () => roomData?.status === "closed";
const isOwner = () => roomData?.ownerUid === currentUser?.uid && (archiveMode || membership?.role === "owner");
const canWriteBoard = () => access === "write" && !archiveMode && !isClosedRoom();

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

function mapsEqual(a, b) {
  const ak = Object.keys(a || {}).sort();
  const bk = Object.keys(b || {}).sort();
  if (ak.length !== bk.length) return false;
  return ak.every((key, index) => key === bk[index] && Boolean(a[key]) === Boolean(b[key]));
}

async function loadProfile(user) {
  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) throw new Error("등록되지 않은 계정입니다.");

  const profile = snap.data();
  if (profile.status !== "approved") throw new Error("승인되지 않았거나 사용중지된 계정입니다.");

  const resolvedAccess = (isManager(profile) || isDeveloper(profile)) ? "write" : (profile.bingoAccess || "none");
  if (resolvedAccess === "none") throw new Error("빙고에 접근할 권한이 없습니다.");

  return { uid: user.uid, ...profile, resolvedAccess };
}

async function loadRoomAndMembership() {
  const archiveRoomId = sessionStorage.getItem("churangArchiveRoomId");
  if (archiveRoomId) {
    const roomSnap = await getDoc(doc(db, "bingoRooms", archiveRoomId));
    if (roomSnap.exists()) {
      const candidate = { id: roomSnap.id, ...roomSnap.data() };
      const allowed = candidate.ownerUid === currentUser.uid
        || (candidate.participantUids || []).includes(currentUser.uid);
      if (candidate.status === "closed" && allowed) {
        archiveMode = true;
        roomId = archiveRoomId;
        membership = null;
        roomData = candidate;
        boardImageRef = storageRef(storage, `bingoImages/${roomId}/board.webp`);
        const boardSnap = await getDoc(doc(db, "bingoBoards", roomId));
        if (!boardSnap.exists()) throw new Error("빙고판 정보를 찾을 수 없습니다.");
        boardData = boardSnap.data();
        return;
      }
    }
    sessionStorage.removeItem("churangArchiveRoomId");
  }

  archiveMode = false;
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
  if (roomData.status === "closed") throw new Error("종료된 빙고방입니다. 빙고 목록에서 결과 보기를 이용해주세요.");

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
    setMessage(firebaseErrorMessage(error, "빙고 사진을 불러오지 못했습니다. 체크 상태는 계속 확인할 수 있습니다."));
  }
}

function roomBoardTypeLabel() {
  if (roomData?.boardType === "alphabet") return "알파벳 빙고";
  if (roomData?.boardType === "text") return "자유 텍스트 빙고";
  return "숫자 빙고";
}

function cellDisplayValue(index) {
  if (roomData?.boardType === "number" || !roomData?.boardType) return String(index + 1);
  const value = boardData?.cellValues?.[index];
  if (roomData?.boardType === "alphabet") return typeof value === "string" && /^[A-Z]$/.test(value) ? value : "?";
  return typeof value === "string" && value.trim() ? value.trim() : "?";
}


function formatDateTime(value) {
  const date = value?.toDate?.() || (value instanceof Date ? value : null);
  if (!date) return "-";
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function makeBoardAction(type, detail) {
  return {
    id: `${currentUser?.uid || "user"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    actorUid: currentUser?.uid || "",
    actorName: currentProfile?.name || currentUser?.displayName || currentUser?.email || "사용자",
    detail: String(detail || "").slice(0, 80),
    atMs: Date.now()
  };
}

function showRoomToast(text) {
  let toast = document.getElementById("roomRealtimeToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "roomRealtimeToast";
    toast.className = "room-realtime-toast hidden";
    toast.setAttribute("role", "status");
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  toast.classList.remove("hidden");
  clearTimeout(showRoomToast.timer);
  showRoomToast.timer = setTimeout(() => toast.classList.add("hidden"), 2300);
}

function actionText(action) {
  if (!action) return "";
  const actor = action.actorName || "다른 사용자";
  if (action.type === "cell_check") return `${actor}님이 ${action.detail} 칸을 변경했습니다.`;
  if (action.type === "select_all") return `${actor}님이 빙고판 전체를 선택했습니다.`;
  if (action.type === "clear_all") return `${actor}님이 빙고판 전체를 해제했습니다.`;
  if (action.type === "undo") return `${actor}님이 전체 작업을 되돌렸습니다.`;
  if (action.type === "chicken") return `${actor}님이 치킨 수량을 ${action.detail} 변경했습니다.`;
  return `${actor}님이 빙고방을 변경했습니다.`;
}

async function writeRoomAudit(action, detail = "") {
  try {
    await addDoc(collection(db, "roomAuditLogs"), {
      actorUid: currentUser.uid,
      actorName: currentProfile.name || currentUser.email || "사용자",
      action,
      roomId,
      roomName: roomData?.name || "빙고방",
      detail: String(detail).slice(0, 500),
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.error("빙고방 이력 저장 실패", error);
  }
}

function renderResultSummary() {
  if (!resultSummaryPanel || !resultSummaryGrid) return;
  const closed = isClosedRoom();
  resultSummaryPanel.classList.toggle("hidden", !closed);
  if (!closed) return;
  const progress = getBoardProgress();
  resultSummaryGrid.innerHTML = `
    <div><span>빙고 종류</span><strong>${escapeHtml(roomBoardTypeLabel())}</strong></div>
    <div><span>빙고판</span><strong>${roomData.size} × ${roomData.size}</strong></div>
    <div><span>완성 빙고</span><strong>${progress.completed}줄</strong></div>
    <div><span>체크된 칸</span><strong>${progress.checked} / ${progress.total}</strong></div>
    <div><span>총 치킨</span><strong>${progress.chicken}치킨</strong></div>
    <div><span>참가자</span><strong>${(roomData.participantUids?.length || 0) + 1}명</strong></div>
    <div><span>시작</span><strong>${escapeHtml(formatDateTime(roomData.createdAt))}</strong></div>
    <div><span>종료</span><strong>${escapeHtml(formatDateTime(roomData.closedAt))}</strong></div>
  `;
}

function inviteUrl() {
  const url = new URL("./bingo.html", location.href);
  url.hash = `invite=${roomId}`;
  return url.toString();
}

async function openInviteModal() {
  if (!roomId || !isOwner() || isClosedRoom()) return;
  let modal = document.getElementById("roomInviteModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "roomInviteModal";
    modal.className = "update-news-modal hidden";
    modal.innerHTML = `
      <div class="update-news-backdrop" data-close-invite></div>
      <section class="invite-dialog" role="dialog" aria-modal="true" aria-label="빙고방 초대">
        <div class="invite-head"><div><p class="eyebrow">INVITE</p><h2>빙고방 초대</h2><p>승인된 사용자는 링크 또는 QR 코드로 이 방에 참가할 수 있습니다.</p></div><button class="modal-close-button" data-close-invite type="button">×</button></div>
        <div class="invite-body">
          <canvas id="inviteQrCanvas" width="220" height="220"></canvas>
          <div class="invite-link-row"><input id="inviteLinkInput" readonly /><button id="copyInviteLinkButton" type="button">링크 복사</button></div>
          <p class="muted">최대 참가자 수는 방장을 제외하고 20명입니다.</p>
        </div>
      </section>`;
    document.body.appendChild(modal);
    modal.querySelectorAll("[data-close-invite]").forEach((el) => el.addEventListener("click", () => modal.classList.add("hidden")));
    modal.querySelector("#copyInviteLinkButton").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(inviteUrl()); showRoomToast("초대 링크를 복사했습니다."); }
      catch (_) { modal.querySelector("#inviteLinkInput").select(); document.execCommand("copy"); showRoomToast("초대 링크를 복사했습니다."); }
    });
  }
  modal.querySelector("#inviteLinkInput").value = inviteUrl();
  modal.classList.remove("hidden");
  try {
    const QRCode = await import("https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm");
    await QRCode.toCanvas(modal.querySelector("#inviteQrCanvas"), inviteUrl(), { width: 220, margin: 1 });
  } catch (error) {
    console.error("QR 코드 생성 실패", error);
    const canvas = modal.querySelector("#inviteQrCanvas");
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillText("QR 코드를 불러오지 못했습니다.", 20, 110);
  }
}

function isPresenceOnline(item) {
  const millis = item?.lastSeen?.toMillis?.() || 0;
  return millis > Date.now() - 5 * 60 * 1000;
}

function renderPresence() {
  if (!roomPresenceSummary || !roomData) return;
  const allowedUids = new Set([roomData.ownerUid, ...(roomData.participantUids || [])]);
  const online = [...presenceMap.entries()].filter(([uid, item]) => allowedUids.has(uid) && isPresenceOnline(item));
  roomPresenceSummary.textContent = `접속 중 ${online.length}명 · 전체 ${(roomData.participantUids?.length || 0) + 1}명`;
  renderManageUsers();
}

async function touchPresence() {
  if (!roomId || !currentUser || isClosedRoom()) return;
  try {
    await setDoc(doc(db, "bingoRooms", roomId, "presence", currentUser.uid), {
      uid: currentUser.uid,
      name: currentProfile.name || currentUser.email || "사용자",
      lastSeen: serverTimestamp()
    }, { merge: true });
  } catch (error) {
    console.error("접속 상태 갱신 실패", error);
  }
}

function startPresence() {
  presenceUnsubscribe?.();
  clearInterval(presenceHeartbeat);
  if (!roomId || isClosedRoom()) {
    presenceMap = new Map();
    renderPresence();
    return;
  }
  touchPresence();
  presenceHeartbeat = setInterval(touchPresence, 180000);
  presenceUnsubscribe = onSnapshot(collection(db, "bingoRooms", roomId, "presence"), (snap) => {
    presenceMap = new Map(snap.docs.map((item) => [item.id, item.data()]));
    renderPresence();
  }, (error) => console.error("접속 상태 조회 실패", error));
}

function scheduleAutoClose() {
  clearTimeout(autoCloseTimer);
  if (!roomData || isClosedRoom() || !roomData.autoCloseAt?.toMillis) return;
  const delay = roomData.autoCloseAt.toMillis() - Date.now();
  if (delay <= 0) {
    attemptAutoClose();
    return;
  }
  autoCloseTimer = setTimeout(attemptAutoClose, Math.min(delay, 2147483647));
}

async function attemptAutoClose() {
  if (!roomData || isClosedRoom() || !roomData.autoCloseAt?.toMillis || roomData.autoCloseAt.toMillis() > Date.now()) return;
  try {
    await updateDoc(doc(db, "bingoRooms", roomId), {
      status: "closed",
      closedAt: serverTimestamp(),
      closedByUid: "AUTO",
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error("자동 종료 처리 실패", error);
  }
}

function renderRoomHeader() {
  document.getElementById("roomTitle").textContent = roomData.name || "빙고";
  const statusText = isClosedRoom() ? "종료" : "진행 중";
  document.getElementById("roomMeta").textContent = `${roomData.size} × ${roomData.size} · ${roomBoardTypeLabel()} · ${statusText} · 방장 ${roomData.ownerName || "-"}`;
  document.getElementById("boardPermission").textContent = isClosedRoom()
    ? "권한: 결과 보기"
    : `권한: ${access === "write" ? "쓰기" : "읽기"}`;
  roomClosedNotice.classList.toggle("hidden", !isClosedRoom());

  roomActions.innerHTML = "";

  if (isOwner()) {
    if (!isClosedRoom() && access === "write") {
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

      const inviteButton = document.createElement("button");
      inviteButton.type = "button";
      inviteButton.className = "secondary";
      inviteButton.textContent = "초대 링크 / QR";
      inviteButton.addEventListener("click", openInviteModal);
      roomActions.appendChild(inviteButton);

      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.className = "secondary room-close-button";
      closeButton.textContent = "방 종료";
      closeButton.addEventListener("click", closeRoom);
      roomActions.appendChild(closeButton);
    }

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "danger";
    deleteButton.textContent = isClosedRoom() ? "기록 삭제" : "방 삭제";
    deleteButton.addEventListener("click", deleteRoom);
    roomActions.appendChild(deleteButton);
  } else if (!isClosedRoom()) {
    const leaveButton = document.createElement("button");
    leaveButton.type = "button";
    leaveButton.className = "danger-outline";
    leaveButton.textContent = "방 나가기";
    leaveButton.addEventListener("click", leaveRoom);
    roomActions.appendChild(leaveButton);
  }
  renderResultSummary();
  renderPresence();
  scheduleAutoClose();
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
  undoBoardButton.disabled = disabled || !lastBoardUndo;
  decreaseChickenButton.disabled = disabled || progress.chicken <= 0;
  increaseChickenButton.disabled = disabled || progress.chicken >= 999;
}

async function setAllCells(checked) {
  if (!canWriteBoard() || !roomId) return;

  const confirmed = await showConfirm(
    checked
      ? "현재 빙고판의 모든 칸이 선택됩니다. 필요하면 실행 취소로 한 번 되돌릴 수 있습니다."
      : "현재 체크된 모든 칸이 해제됩니다. 필요하면 실행 취소로 한 번 되돌릴 수 있습니다.",
    {
      title: checked ? "빙고판 전체 선택" : "빙고판 전체 해제",
      confirmText: checked ? "전체 선택" : "전체 해제",
      danger: !checked
    }
  );
  if (!confirmed) return;

  const boardRef = doc(db, "bingoBoards", roomId);
  const size = Number(roomData?.size) || 0;
  const total = size * size;
  const nextCheckedCells = {};
  if (checked) {
    for (let index = 0; index < total; index += 1) nextCheckedCells[String(index)] = true;
  }

  let previousCheckedCells = null;
  window.CHURANG_SET_SAVE_STATUS?.("saving");
  try {
    await runTransaction(db, async (transaction) => {
      const boardSnap = await transaction.get(boardRef);
      if (!boardSnap.exists()) throw new Error("빙고판 정보를 찾을 수 없습니다.");
      previousCheckedCells = { ...(boardSnap.data().checkedCells || {}) };
      transaction.update(boardRef, {
        checkedCells: nextCheckedCells,
        lastAction: makeBoardAction(checked ? "select_all" : "clear_all", ""),
        updatedAt: serverTimestamp()
      });
    });
    lastBoardUndo = { before: previousCheckedCells || {}, after: nextCheckedCells };
    renderBoardStatus();
    window.CHURANG_SET_SAVE_STATUS?.("saved");
    setMessage(checked ? "전체 칸을 선택했습니다. 실행 취소로 되돌릴 수 있습니다." : "전체 칸을 해제했습니다. 실행 취소로 되돌릴 수 있습니다.", true);
  } catch (error) {
    console.error(error);
    window.CHURANG_SET_SAVE_STATUS?.("error");
    setMessage(firebaseErrorMessage(error, checked ? "전체 선택에 실패했습니다." : "전체 해제에 실패했습니다."));
  }
}

async function undoLastBoardChange() {
  if (!canWriteBoard() || !roomId || !lastBoardUndo) return;
  const undo = lastBoardUndo;
  const boardRef = doc(db, "bingoBoards", roomId);

  try {
    await runTransaction(db, async (transaction) => {
      const boardSnap = await transaction.get(boardRef);
      if (!boardSnap.exists()) throw new Error("빙고판 정보를 찾을 수 없습니다.");
      const current = boardSnap.data().checkedCells || {};
      if (!mapsEqual(current, undo.after)) throw new Error("BOARD_CHANGED");
      transaction.update(boardRef, {
        checkedCells: undo.before,
        lastAction: makeBoardAction("undo", ""),
        updatedAt: serverTimestamp()
      });
    });
    lastBoardUndo = null;
    renderBoardStatus();
    setMessage("마지막 전체 선택/해제를 되돌렸습니다.", true);
  } catch (error) {
    console.error(error);
    if (error.message === "BOARD_CHANGED") {
      lastBoardUndo = null;
      renderBoardStatus();
      setMessage("다른 체크 변경이 있어 이전 전체 작업을 되돌릴 수 없습니다.");
    } else {
      setMessage(firebaseErrorMessage(error, "실행 취소에 실패했습니다."));
    }
  }
}

async function changeChickenCount(delta) {
  if (!canWriteBoard() || !roomId || ![-1, 1].includes(delta)) return;

  const boardRef = doc(db, "bingoBoards", roomId);
  const logRef = doc(collection(db, "bingoRooms", roomId, "chickenLogs"));
  try {
    await runTransaction(db, async (transaction) => {
      const boardSnap = await transaction.get(boardRef);
      if (!boardSnap.exists()) throw new Error("빙고판 정보를 찾을 수 없습니다.");

      const current = Math.max(0, Number(boardSnap.data().chickenCount) || 0);
      const next = Math.min(999, Math.max(0, current + delta));
      if (next === current) return;

      transaction.update(boardRef, {
        chickenCount: next,
        lastAction: makeBoardAction("chicken", delta > 0 ? "+1" : "-1"),
        updatedAt: serverTimestamp()
      });
      transaction.set(logRef, {
        delta,
        actorUid: currentUser.uid,
        actorName: currentProfile.name || currentUser.displayName || currentUser.email || "사용자",
        createdAt: serverTimestamp(),
        reverted: false,
        revertedAt: null,
        revertedByUid: "",
        revertedByName: ""
      });
    });
  } catch (error) {
    console.error(error);
    setMessage(firebaseErrorMessage(error, "치킨 수량을 저장하지 못했습니다."));
  }
}

function getBoardCellSize(size) {
  const mobile = window.matchMedia("(max-width: 760px)").matches;
  if (size >= 9) return mobile ? 40 : 48;
  if (size >= 7) return mobile ? 44 : 54;
  if (size >= 5) return mobile ? 50 : 64;
  return mobile ? 64 : 78;
}

function renderBoard() {
  if (!roomData || !boardData) return;

  const size = Number(roomData.size) || 5;
  const total = size * size;
  const checkedCells = boardData.checkedCells || {};
  const cellSize = getBoardCellSize(size);

  bingoBoard.innerHTML = "";
  bingoBoard.style.setProperty("--bingo-size", size);
  bingoBoard.style.setProperty("--bingo-cell-size", `${cellSize}px`);
  bingoBoard.classList.toggle("image-mode", Boolean(boardImageUrl));
  bingoBoard.classList.toggle("alphabet-board", roomData?.boardType === "alphabet");
  bingoBoard.classList.toggle("text-board", roomData?.boardType === "text");

  const fragment = document.createDocumentFragment();

  for (let index = 0; index < total; index += 1) {
    const checked = checkedCells[String(index)] === true;
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = `bingo-cell${checked ? " checked" : ""}`;
    cell.dataset.index = String(index);
    cell.setAttribute("aria-pressed", checked ? "true" : "false");
    const displayValue = cellDisplayValue(index);
    cell.setAttribute("aria-label", `${displayValue} 칸 ${checked ? "선택됨" : "선택 안 됨"}`);
    cell.disabled = !canWriteBoard();

    if (checked && boardImageUrl) {
      cell.classList.add("has-image");
      cell.style.backgroundImage = `url("${boardImageUrl}")`;
      cell.style.backgroundSize = `${size * 100}% ${size * 100}%`;
      cell.style.backgroundPosition = getCellBackgroundPosition(index, size);
      cell.textContent = "";
    } else {
      cell.innerHTML = `<span class="cell-number">${displayValue}</span>`;
    }

    if (canWriteBoard()) cell.addEventListener("click", () => toggleCell(index));
    fragment.appendChild(cell);
  }

  bingoBoard.appendChild(fragment);
  renderBoardStatus();
}

async function toggleCell(index) {
  if (!canWriteBoard()) return;

  const boardRef = doc(db, "bingoBoards", roomId);
  const field = `checkedCells.${index}`;

  window.CHURANG_SET_SAVE_STATUS?.("saving");
  try {
    await runTransaction(db, async (transaction) => {
      const boardSnap = await transaction.get(boardRef);
      if (!boardSnap.exists()) throw new Error("빙고판 정보를 찾을 수 없습니다.");

      const checkedCells = boardSnap.data().checkedCells || {};
      const currentChecked = checkedCells[String(index)] === true;
      transaction.update(boardRef, {
        [field]: !currentChecked,
        lastAction: makeBoardAction("cell_check", cellDisplayValue(index)),
        updatedAt: serverTimestamp()
      });
    });
    lastBoardUndo = null;
    renderBoardStatus();
    window.CHURANG_SET_SAVE_STATUS?.("saved");
  } catch (error) {
    console.error(error);
    window.CHURANG_SET_SAVE_STATUS?.("error");
    setMessage(firebaseErrorMessage(error, "빙고 체크 상태를 저장하지 못했습니다."));
  }
}

async function loadManageUsers() {
  if (!isOwner() || access !== "write" || isClosedRoom()) return;

  const snap = await getDocs(collection(db, "users"));
  allUsers = snap.docs
    .map((item) => ({ uid: item.id, ...item.data() }))
    .filter((user) => user.uid !== currentUser.uid)
    .sort((a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || "", "ko"));

  participantDraft = new Set(roomData.participantUids || []);
  participantDraftDirty = false;
  participantMembershipMap = new Map();

  await Promise.all([...participantDraft].map(async (uid) => {
    try {
      const snap = await getDoc(doc(db, "bingoMemberships", uid));
      if (snap.exists()) participantMembershipMap.set(uid, snap.data());
    } catch (error) {
      console.error("참가 상태 확인 실패", uid, error);
    }
  }));

  renderManageUsers();
}

function canBeParticipant(user) {
  if (!user || user.status !== "approved") return false;
  if (["super_admin", "admin", "developer"].includes(user.role)) return true;
  return ["read", "write"].includes(user.bingoAccess);
}

function canOwnRoom(user) {
  if (!user || user.status !== "approved") return false;
  if (["super_admin", "admin", "developer"].includes(user.role)) return true;
  return user.bingoAccess === "write";
}

function participantUser(uid) {
  return allUsers.find((user) => user.uid === uid) || { uid, name: "알 수 없는 사용자", email: "" };
}

function participantStatusText(user) {
  const membershipData = participantMembershipMap.get(user.uid);
  const presence = presenceMap.get(user.uid);
  if (membershipData?.roomId === roomId && membershipData?.role === "participant") return isPresenceOnline(presence) ? "접속 중" : "현재 참가 중";
  return "초대됨";
}

function createParticipantManageItem(user, mode) {
  const item = document.createElement("div");
  item.className = "participant-manage-item";

  const info = document.createElement("div");
  info.className = "participant-manage-info";
  info.innerHTML = `
    <strong>${escapeHtml(user.name || user.email || "사용자")}</strong>
    <small>${escapeHtml(user.email || "")}${mode === "remove" ? ` · ${participantStatusText(user)}` : ""}</small>
  `;

  const actions = document.createElement("div");
  actions.className = "participant-manage-actions";

  if (mode === "remove") {
    const membershipData = participantMembershipMap.get(user.uid);
    if (membershipData?.roomId === roomId && membershipData?.role === "participant" && canOwnRoom(user)) {
      const transferButton = document.createElement("button");
      transferButton.type = "button";
      transferButton.className = "secondary compact-button owner-transfer-button";
      transferButton.textContent = "방장 위임";
      transferButton.addEventListener("click", () => transferOwner(user));
      actions.appendChild(transferButton);
    }

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "danger-outline compact-button";
    removeButton.textContent = "제외";
    removeButton.addEventListener("click", () => {
      participantDraft.delete(user.uid);
      participantDraftDirty = true;
      renderManageUsers();
    });
    actions.appendChild(removeButton);
  } else {
    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "secondary compact-button";
    addButton.textContent = "추가";
    addButton.addEventListener("click", () => {
      participantDraft.add(user.uid);
      participantDraftDirty = true;
      renderManageUsers();
    });
    actions.appendChild(addButton);
  }

  item.append(info, actions);
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
  if (!isOwner() || access !== "write" || !participantDraftDirty || isClosedRoom()) return;

  const nextUids = [...participantDraft];
  const previousUids = roomData.participantUids || [];
  const removedUids = previousUids.filter((uid) => !participantDraft.has(uid));
  const saveButton = document.getElementById("saveParticipantsButton");
  saveButton.disabled = true;
  saveButton.textContent = "저장 중...";
  setMessage("");

  try {
    const activeMembershipRefs = [];
    for (const uid of removedUids) {
      const membershipRef = doc(db, "bingoMemberships", uid);
      const membershipSnap = await getDoc(membershipRef);
      if (membershipSnap.exists()) {
        const data = membershipSnap.data();
        if (data.roomId === roomId && data.role === "participant") activeMembershipRefs.push(membershipRef);
      }
    }

    const batch = writeBatch(db);
    batch.update(doc(db, "bingoRooms", roomId), {
      participantUids: nextUids,
      updatedAt: serverTimestamp()
    });
    activeMembershipRefs.forEach((membershipRef) => batch.delete(membershipRef));
    await batch.commit();

    roomData.participantUids = nextUids;
    participantDraftDirty = false;
    removedUids.forEach((uid) => participantMembershipMap.delete(uid));
    renderManageUsers();
    await writeRoomAudit("participants_change", `참가자 ${previousUids.length}명 → ${nextUids.length}명`);
    setMessage("참가자 변경사항을 저장했습니다.", true);
  } catch (error) {
    console.error(error);
    setMessage(firebaseErrorMessage(error, "참가자 변경에 실패했습니다."));
  } finally {
    saveButton.textContent = "변경사항 저장";
    saveButton.disabled = !participantDraftDirty;
  }
}

async function transferOwner(targetUser) {
  if (!isOwner() || access !== "write" || isClosedRoom()) return;
  const targetMembership = participantMembershipMap.get(targetUser.uid);
  if (!canOwnRoom(targetUser)) {
    await showNotice("빙고 쓰기 권한이 있는 참가자에게만 방장을 위임할 수 있습니다.");
    return;
  }
  if (targetMembership?.roomId !== roomId || targetMembership?.role !== "participant") {
    await showNotice("현재 이 빙고방에 입장 중인 참가자에게만 방장을 위임할 수 있습니다.");
    return;
  }

  const confirmed = await showConfirm(
    `${targetUser.name || targetUser.email || "선택한 참가자"}님에게 방장을 위임할까요?\n위임 후 현재 방장은 일반 참가자가 됩니다.`,
    { title: "방장 위임", confirmText: "위임" }
  );
  if (!confirmed) return;

  const roomRef = doc(db, "bingoRooms", roomId);
  const currentMembershipRef = doc(db, "bingoMemberships", currentUser.uid);
  const targetMembershipRef = doc(db, "bingoMemberships", targetUser.uid);

  try {
    await runTransaction(db, async (transaction) => {
      const [roomSnap, currentMemSnap, targetMemSnap] = await Promise.all([
        transaction.get(roomRef),
        transaction.get(currentMembershipRef),
        transaction.get(targetMembershipRef)
      ]);
      if (!roomSnap.exists() || !currentMemSnap.exists() || !targetMemSnap.exists()) throw new Error("TRANSFER_STATE_CHANGED");

      const room = roomSnap.data();
      const currentMem = currentMemSnap.data();
      const targetMem = targetMemSnap.data();
      if (room.status === "closed" || room.ownerUid !== currentUser.uid) throw new Error("TRANSFER_STATE_CHANGED");
      if (currentMem.roomId !== roomId || currentMem.role !== "owner") throw new Error("TRANSFER_STATE_CHANGED");
      if (targetMem.roomId !== roomId || targetMem.role !== "participant") throw new Error("TARGET_NOT_ACTIVE");
      if (!(room.participantUids || []).includes(targetUser.uid)) throw new Error("TARGET_NOT_INVITED");

      const nextParticipants = (room.participantUids || []).filter((uid) => uid !== targetUser.uid);
      if (!nextParticipants.includes(currentUser.uid)) nextParticipants.push(currentUser.uid);

      transaction.update(roomRef, {
        ownerUid: targetUser.uid,
        ownerName: targetUser.name || targetUser.email || "방장",
        participantUids: nextParticipants,
        updatedAt: serverTimestamp()
      });
      transaction.update(currentMembershipRef, { role: "participant" });
      transaction.update(targetMembershipRef, { role: "owner" });
    });
    participantDraftDirty = false;
    await writeRoomAudit("owner_transfer", `${targetUser.name || targetUser.email || "참가자"}에게 방장 위임`);
    setMessage("방장을 위임했습니다. 이제 일반 참가자로 이용합니다.", true);
  } catch (error) {
    console.error(error);
    const fallback = error.message === "TARGET_NOT_ACTIVE"
      ? "상대방이 현재 이 방에 입장 중이 아닙니다. 다시 확인해주세요."
      : "방장 위임에 실패했습니다. 참가 상태가 바뀌었는지 확인해주세요.";
    setMessage(firebaseErrorMessage(error, fallback));
  }
}

async function leaveRoom() {
  if (isOwner() || archiveMode || isClosedRoom()) return;
  const confirmed = await showConfirm(
    "나간 뒤에는 다른 빙고방에 참가할 수 있습니다.",
    { title: "현재 빙고방에서 나갈까요?", confirmText: "방 나가기", danger: true }
  );
  if (!confirmed) return;

  try {
    await deleteDoc(doc(db, "bingoMemberships", currentUser.uid));
    sessionStorage.removeItem("churangArchiveRoomId");
    location.replace("./bingo.html");
  } catch (error) {
    console.error(error);
    setMessage(firebaseErrorMessage(error, "방 나가기에 실패했습니다."));
  }
}

async function closeRoom() {
  if (!isOwner() || archiveMode || isClosedRoom()) return;
  const confirmed = await showConfirm(
    "빙고방을 종료하면 체크 상태, 치킨 기록, 참가자 정보는 보관되고 모두 결과 보기만 가능합니다. 참가자들은 다른 방에 참여할 수 있게 됩니다.",
    { title: "이 빙고방을 종료할까요?", confirmText: "방 종료" }
  );
  if (!confirmed) return;

  setMessage("빙고방을 종료하고 있습니다...");
  try {
    const membershipRefs = [];
    const ownerMembershipRef = doc(db, "bingoMemberships", currentUser.uid);
    membershipRefs.push(ownerMembershipRef);

    for (const uid of roomData.participantUids || []) {
      const ref = doc(db, "bingoMemberships", uid);
      const snap = await getDoc(ref);
      if (snap.exists() && snap.data().roomId === roomId) membershipRefs.push(ref);
    }

    // 종료 상태를 먼저 저장한 뒤 참가정보를 정리합니다.
    // 방장 본인의 membership 삭제 규칙이 종료 상태를 확인할 수 있도록 두 단계로 처리합니다.
    roomUnsubscribe?.();
    roomUnsubscribe = null;

    const closeBatch = writeBatch(db);
    closeBatch.update(doc(db, "bingoRooms", roomId), {
      status: "closed",
      closedAt: serverTimestamp(),
      closedByUid: currentUser.uid,
      updatedAt: serverTimestamp()
    });
    await closeBatch.commit();

    const membershipBatch = writeBatch(db);
    membershipRefs.forEach((ref) => membershipBatch.delete(ref));
    await membershipBatch.commit();
    await writeRoomAudit("room_close", "빙고방 종료 및 결과 보관");

    sessionStorage.removeItem("churangArchiveRoomId");
    location.replace("./bingo.html");
  } catch (error) {
    console.error(error);
    try {
      const snap = await getDoc(doc(db, "bingoRooms", roomId));
      if (snap.exists() && snap.data().status === "closed") {
        sessionStorage.removeItem("churangArchiveRoomId");
        location.replace("./bingo.html");
        return;
      }
    } catch (_) {}
    if (!roomUnsubscribe) startRealtimeListeners();
    setMessage(firebaseErrorMessage(error, "빙고방 종료에 실패했습니다."));
  }
}

async function deleteChickenLogs() {
  const snap = await getDocs(collection(db, "bingoRooms", roomId, "chickenLogs"));
  const docs = [...snap.docs];
  for (let start = 0; start < docs.length; start += 400) {
    const batch = writeBatch(db);
    docs.slice(start, start + 400).forEach((item) => batch.delete(item.ref));
    await batch.commit();
  }
}

async function deletePresenceLogs() {
  try {
    const snap = await getDocs(collection(db, "bingoRooms", roomId, "presence"));
    const docs = [...snap.docs];
    for (let start = 0; start < docs.length; start += 400) {
      const batch = writeBatch(db);
      docs.slice(start, start + 400).forEach((item) => batch.delete(item.ref));
      await batch.commit();
    }
  } catch (error) {
    console.error("접속 상태 정리 실패", error);
  }
}

async function deleteRoom() {
  if (!isOwner()) return;
  const confirmed = await showConfirm(
    isClosedRoom()
      ? "보관된 빙고 결과, 치킨 기록, 사진이 모두 삭제되며 복구할 수 없습니다."
      : "참가자들의 현재 참가 상태, 빙고 데이터, 치킨 기록과 사진도 함께 삭제됩니다.",
    { title: isClosedRoom() ? "보관된 기록을 삭제할까요?" : "이 빙고방을 삭제할까요?", confirmText: "삭제", danger: true }
  );
  if (!confirmed) return;

  setMessage("방을 삭제하고 있습니다...");

  try {
    try {
      if (boardImageRef) await deleteObject(boardImageRef);
    } catch (storageError) {
      if (storageError?.code !== "storage/object-not-found") throw storageError;
    }

    if (!isClosedRoom()) {
      for (const uid of roomData.participantUids || []) {
        const membershipRef = doc(db, "bingoMemberships", uid);
        const membershipSnap = await getDoc(membershipRef);
        if (membershipSnap.exists()) {
          const data = membershipSnap.data();
          if (data.roomId === roomId && data.role === "participant") await deleteDoc(membershipRef);
        }
      }
    }

    roomUnsubscribe?.();
    boardUnsubscribe?.();
    membershipUnsubscribe?.();
    chickenLogsUnsubscribe?.();
    roomUnsubscribe = null;
    boardUnsubscribe = null;
    membershipUnsubscribe = null;
    chickenLogsUnsubscribe = null;

    await deleteChickenLogs();
    await deletePresenceLogs();
    await writeRoomAudit("room_delete", isClosedRoom() ? "보관된 빙고 기록 삭제" : "빙고방 및 연동 데이터 삭제");
    await deleteDoc(doc(db, "bingoBoards", roomId));
    await deleteDoc(doc(db, "bingoRooms", roomId));

    if (!archiveMode) {
      try { await deleteDoc(doc(db, "bingoMemberships", currentUser.uid)); } catch (_) {}
    }

    sessionStorage.removeItem("churangArchiveRoomId");
    location.replace("./bingo.html");
  } catch (error) {
    console.error(error);
    setMessage(firebaseErrorMessage(error, "방 삭제 중 오류가 발생했습니다. 다시 시도해주세요."));

    try {
      const roomSnap = await getDoc(doc(db, "bingoRooms", roomId));
      if (roomSnap.exists() && !roomUnsubscribe && !boardUnsubscribe) startRealtimeListeners();
      else location.replace("./bingo.html");
    } catch (_) {
      location.replace("./bingo.html");
    }
  }
}

function formatLogTime(value) {
  const date = value?.toDate?.();
  if (!date) return "방금 전";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function renderChickenHistory() {
  chickenHistoryList.innerHTML = "";
  const sorted = [...chickenLogs].sort((a, b) => {
    const aTime = a.createdAt?.toMillis?.() || 0;
    const bTime = b.createdAt?.toMillis?.() || 0;
    return bTime - aTime;
  });

  if (!sorted.length) {
    chickenHistoryList.innerHTML = '<div class="chicken-history-empty">아직 치킨 기록이 없습니다.</div>';
    return;
  }

  sorted.slice(0, 100).forEach((log) => {
    const item = document.createElement("div");
    item.className = `chicken-history-item${log.reverted ? " reverted" : ""}`;
    const deltaText = Number(log.delta) > 0 ? "+1" : "-1";
    const detail = document.createElement("div");
    detail.className = "chicken-history-info";
    detail.innerHTML = `
      <strong>${escapeHtml(log.actorName || "사용자")} · ${deltaText} 치킨</strong>
      <small>${formatLogTime(log.createdAt)}${log.reverted ? ` · ${escapeHtml(log.revertedByName || "사용자")}님이 취소` : ""}</small>
    `;
    item.appendChild(detail);

    if (!log.reverted && canWriteBoard()) {
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "secondary compact-button";
      cancel.textContent = "기록 취소";
      cancel.addEventListener("click", () => undoChickenLog(log));
      item.appendChild(cancel);
    }
    chickenHistoryList.appendChild(item);
  });
}

async function undoChickenLog(log) {
  if (!canWriteBoard() || log.reverted) return;
  const confirmed = await showConfirm(
    `${log.actorName || "사용자"}님의 ${Number(log.delta) > 0 ? "+1" : "-1"} 치킨 기록을 취소할까요?`,
    { title: "치킨 기록 취소", confirmText: "취소 처리" }
  );
  if (!confirmed) return;

  const boardRef = doc(db, "bingoBoards", roomId);
  const logRef = doc(db, "bingoRooms", roomId, "chickenLogs", log.id);
  try {
    await runTransaction(db, async (transaction) => {
      const [boardSnap, logSnap] = await Promise.all([transaction.get(boardRef), transaction.get(logRef)]);
      if (!boardSnap.exists() || !logSnap.exists()) throw new Error("기록을 찾을 수 없습니다.");
      const liveLog = logSnap.data();
      if (liveLog.reverted) throw new Error("ALREADY_REVERTED");

      const current = Math.max(0, Number(boardSnap.data().chickenCount) || 0);
      const next = current - Number(liveLog.delta || 0);
      if (next < 0 || next > 999) throw new Error("COUNT_RANGE");
      transaction.update(boardRef, {
        chickenCount: next,
        lastAction: makeBoardAction("chicken", `기록 취소 ${Number(liveLog.delta) > 0 ? "-1" : "+1"}`),
        updatedAt: serverTimestamp()
      });
      transaction.update(logRef, {
        reverted: true,
        revertedAt: serverTimestamp(),
        revertedByUid: currentUser.uid,
        revertedByName: currentProfile.name || currentUser.displayName || currentUser.email || "사용자"
      });
    });
  } catch (error) {
    console.error(error);
    const fallback = error.message === "ALREADY_REVERTED"
      ? "이미 취소된 기록입니다."
      : error.message === "COUNT_RANGE"
        ? "이 기록을 취소하면 치킨 수량이 올바르지 않게 됩니다. 이후 기록을 먼저 확인해주세요."
        : "치킨 기록 취소에 실패했습니다.";
    setMessage(firebaseErrorMessage(error, fallback));
  }
}

function startRealtimeListeners() {
  roomUnsubscribe?.();
  boardUnsubscribe?.();
  membershipUnsubscribe?.();
  chickenLogsUnsubscribe?.();

  roomUnsubscribe = onSnapshot(doc(db, "bingoRooms", roomId), async (snap) => {
    if (!snap.exists()) {
      sessionStorage.removeItem("churangArchiveRoomId");
      location.replace("./bingo.html");
      return;
    }

    roomData = { id: snap.id, ...snap.data() };
    const allowed = roomData.ownerUid === currentUser.uid
      || (roomData.participantUids || []).includes(currentUser.uid);

    if (!allowed) {
      await showNotice("방장이 참가자 목록에서 제외했습니다.", "빙고방에서 나갑니다");
      sessionStorage.removeItem("churangArchiveRoomId");
      location.replace("./bingo.html");
      return;
    }

    if (!archiveMode && roomData.status === "closed") {
      sessionStorage.removeItem("churangArchiveRoomId");
      location.replace("./bingo.html");
      return;
    }

    renderRoomHeader();
    if (isClosedRoom()) { presenceUnsubscribe?.(); clearInterval(presenceHeartbeat); }
    if (isOwner() && access === "write" && !isClosedRoom()) {
      if (!participantDraftDirty) await loadManageUsers();
      else renderManageUsers();
    } else {
      participantManagePanel.classList.add("hidden");
    }
    renderBoard();
    renderChickenHistory();
  });

  boardUnsubscribe = onSnapshot(doc(db, "bingoBoards", roomId), (snap) => {
    if (!snap.exists()) return;
    const nextBoard = snap.data();
    if (lastBoardUndo && !mapsEqual(nextBoard.checkedCells || {}, lastBoardUndo.after)) lastBoardUndo = null;
    const action = nextBoard.lastAction;
    if (action?.id && action.id !== lastSeenActionId) {
      const initial = !lastSeenActionId;
      lastSeenActionId = action.id;
      if (!initial && action.actorUid !== currentUser.uid) showRoomToast(actionText(action));
    }
    boardData = nextBoard;
    renderBoard();
    renderResultSummary();
  });

  chickenLogsUnsubscribe = onSnapshot(collection(db, "bingoRooms", roomId, "chickenLogs"), (snap) => {
    chickenLogs = snap.docs.map((item) => ({ id: item.id, ...item.data() }));
    renderChickenHistory();
  }, (error) => {
    console.error("치킨 기록 실시간 조회 실패", error);
    chickenHistoryList.innerHTML = `<div class="chicken-history-empty">${escapeHtml(firebaseErrorMessage(error, "치킨 기록을 불러오지 못했습니다."))}</div>`;
  });

  if (!archiveMode) {
    membershipUnsubscribe = onSnapshot(doc(db, "bingoMemberships", currentUser.uid), (snap) => {
      if (!snap.exists()) {
        location.replace("./bingo.html");
        return;
      }
      const data = snap.data();
      if (data.roomId !== roomId) location.replace("./bingo.html");
      else membership = data;
    });
  }
}

selectAllCellsButton.addEventListener("click", () => setAllCells(true));
clearAllCellsButton.addEventListener("click", () => setAllCells(false));
undoBoardButton.addEventListener("click", undoLastBoardChange);
decreaseChickenButton.addEventListener("click", () => changeChickenCount(-1));
increaseChickenButton.addEventListener("click", () => changeChickenCount(1));
chickenHistoryButton.addEventListener("click", () => chickenHistoryPanel.classList.toggle("hidden"));
closeChickenHistoryButton.addEventListener("click", () => chickenHistoryPanel.classList.add("hidden"));

printResultButton?.addEventListener("click", () => window.print());
document.addEventListener("visibilitychange", () => { if (!document.hidden) touchPresence(); });

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
  sessionStorage.removeItem("churangArchiveRoomId");
  roomUnsubscribe?.();
  boardUnsubscribe?.();
  membershipUnsubscribe?.();
  chickenLogsUnsubscribe?.();
  presenceUnsubscribe?.();
  clearInterval(presenceHeartbeat);
  clearTimeout(autoCloseTimer);
  await signOut(auth);
  location.replace("./index.html");
});

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderBoard, 120);
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
    const roleBadge = document.getElementById("roleBadge");
    roleBadge.textContent = roleLabel(currentProfile.role);
    roleBadge.dataset.role = currentProfile.role;

    await loadRoomAndMembership();
    await loadBoardImage();
    renderRoomHeader();
    renderBoard();

    if (isOwner() && access === "write" && !isClosedRoom()) await loadManageUsers();

    loadingPanel.classList.add("hidden");
    roomContent.classList.remove("hidden");
    startRealtimeListeners();
    startPresence();
  } catch (error) {
    console.error(error);
    sessionStorage.removeItem("churangArchiveRoomId");
    loadingPanel.innerHTML = `
      <h2>빙고방에 들어갈 수 없습니다.</h2>
      <p>${escapeHtml(firebaseErrorMessage(error, error.message || "빙고방 정보를 불러오지 못했습니다."))}</p>
      <a class="service-button inline-button" href="./bingo.html">빙고 목록으로 돌아가기</a>
    `;
  }
});
