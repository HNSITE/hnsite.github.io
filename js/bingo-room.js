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
import { deleteObject, getDownloadURL, ref as storageRef } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js";
import { firebaseErrorMessage } from "./error-messages.js";
import { initChannelMemberApproval } from "./channel-members.js";
import { initDeveloperChannelTools } from "./developer-channel-tools.js";
import { initChannelOwnerTools } from "./channel-owner-tools.js";
import { setTopbarContext } from "./topbar-menu.js";
import { showConfirm, showNotice } from "./ui-dialog.js";
import {
  archiveRoomStorageKey,
  currentRoomStorageKey,
  displayRole,
  isChannelManager,
  isDeveloper,
  loadCurrentChannelContext,
  loadPlatformProfile,
  resolvedFeatureAccess,
  watchCurrentChannelAccess
} from "./channel-context.js";

if (location.search) window.history.replaceState(null, "", location.pathname + location.hash);

let stopChannelAccessWatcher = null;

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
let currentContext = null;
let roomId = null;
let roomData = null;
let boardData = null;
let boardImageRef = null;
let boardImageUrl = "";
let archiveMode = false;
let access = "none";
let allUsers = [];
let participantDraft = new Set();
let participantDraftDirty = false;
let roomUnsubscribe = null;
let boardUnsubscribe = null;
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

const roomRef = () => doc(db, "channels", currentContext.channelId, "bingoRooms", roomId);
const boardRef = () => doc(db, "channels", currentContext.channelId, "bingoBoards", roomId);
const slotRef = (uid, slot) => doc(db, "channels", currentContext.channelId, "bingoRoomOwners", uid, "slots", String(slot));
const roomLogsRef = () => collection(db, "channels", currentContext.channelId, "roomAuditLogs");
const chickenLogsRef = () => collection(db, "channels", currentContext.channelId, "bingoRooms", roomId, "chickenLogs");
const presenceRef = () => collection(db, "channels", currentContext.channelId, "bingoRooms", roomId, "presence");
const isClosedRoom = () => roomData?.status === "closed";
const isRoomParticipant = () => roomData?.ownerUid === currentUser?.uid || (roomData?.participantUids || []).includes(currentUser?.uid);
const isRoomManager = () => isChannelManager(currentContext) || roomData?.ownerUid === currentUser?.uid;
const canWriteBoard = () => access === "write" && !archiveMode && !isClosedRoom() && (isRoomParticipant() || isChannelManager(currentContext));

function setMessage(text, success = false) { roomMessage.textContent = text; roomMessage.classList.toggle("success", success); }
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function mapsEqual(a, b) { const ak = Object.keys(a || {}).sort(), bk = Object.keys(b || {}).sort(); return ak.length === bk.length && ak.every((key, index) => key === bk[index] && Boolean(a[key]) === Boolean(b[key])); }

async function loadRoomAndBoard() {
  roomId = sessionStorage.getItem(currentRoomStorageKey(currentContext.channelId));
  const archiveRoomId = sessionStorage.getItem(archiveRoomStorageKey(currentContext.channelId));
  archiveMode = Boolean(roomId && archiveRoomId === roomId);
  if (!roomId) throw new Error("빙고 목록에서 들어갈 방을 먼저 선택해주세요.");

  const roomSnap = await getDoc(roomRef());
  if (!roomSnap.exists()) throw new Error("삭제되었거나 존재하지 않는 빙고방입니다.");
  roomData = { id: roomSnap.id, ...roomSnap.data() };
  const allowed = isChannelManager(currentContext) || roomData.ownerUid === currentUser.uid || (roomData.participantUids || []).includes(currentUser.uid);
  if (!allowed) throw new Error("이 빙고방에 접근할 수 없습니다.");
  if (archiveMode && roomData.status !== "closed") archiveMode = false;
  if (!archiveMode && roomData.status === "closed") {
    sessionStorage.setItem(archiveRoomStorageKey(currentContext.channelId), roomId);
    archiveMode = true;
  }

  const boardSnap = await getDoc(boardRef());
  if (!boardSnap.exists()) throw new Error("빙고판 정보를 찾을 수 없습니다.");
  boardData = boardSnap.data();
  boardImageRef = storageRef(storage, `channels/${currentContext.channelId}/bingoImages/${roomId}/board.webp`);
}

async function loadBoardImage() {
  boardImageUrl = "";
  try { boardImageUrl = await getDownloadURL(boardImageRef); }
  catch (error) { if (error?.code !== "storage/object-not-found") { console.error(error); setMessage(firebaseErrorMessage(error, "빙고 사진을 불러오지 못했습니다.")); } }
}

function roomBoardTypeLabel() { return roomData?.boardType === "alphabet" ? "알파벳 빙고" : roomData?.boardType === "text" ? "자유 텍스트 빙고" : "숫자 빙고"; }
function cellDisplayValue(index) {
  if (roomData?.boardType === "number" || !roomData?.boardType) return String(index + 1);
  const value = boardData?.cellValues?.[index];
  if (roomData?.boardType === "alphabet") return typeof value === "string" && /^[A-Z]$/.test(value) ? value : "?";
  return typeof value === "string" && value.trim() ? value.trim() : "?";
}
function formatDateTime(value) { const date = value?.toDate?.() || (value instanceof Date ? value : null); return date ? new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date) : "-"; }
function formatLogTime(value) { const date = value?.toDate?.(); return date ? new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date) : "방금 전"; }

function makeBoardAction(type, detail) {
  return { id: `${currentUser?.uid || "user"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, type, actorUid: currentUser?.uid || "", actorName: currentProfile?.name || currentUser?.displayName || currentUser?.email || "사용자", detail: String(detail || "").slice(0, 80), atMs: Date.now() };
}
function showRoomToast(text) {
  let toast = document.getElementById("roomRealtimeToast");
  if (!toast) { toast = document.createElement("div"); toast.id = "roomRealtimeToast"; toast.className = "room-realtime-toast hidden"; toast.setAttribute("role", "status"); document.body.appendChild(toast); }
  toast.textContent = text; toast.classList.remove("hidden"); clearTimeout(showRoomToast.timer); showRoomToast.timer = setTimeout(() => toast.classList.add("hidden"), 2300);
}
function actionText(action) {
  const actor = action?.actorName || "다른 사용자";
  if (action?.type === "cell_check") return `${actor}님이 ${action.detail} 칸을 변경했습니다.`;
  if (action?.type === "select_all") return `${actor}님이 빙고판 전체를 선택했습니다.`;
  if (action?.type === "clear_all") return `${actor}님이 빙고판 전체를 해제했습니다.`;
  if (action?.type === "undo") return `${actor}님이 전체 작업을 되돌렸습니다.`;
  if (action?.type === "chicken") return `${actor}님이 치킨 수량을 ${action.detail} 변경했습니다.`;
  return `${actor}님이 빙고방을 변경했습니다.`;
}

async function writeRoomAudit(action, detail = "") {
  try { await addDoc(roomLogsRef(), { actorUid: currentUser.uid, actorName: currentProfile.name || currentUser.email || "사용자", action, roomId, roomName: roomData?.name || "빙고방", detail: String(detail).slice(0, 500), createdAt: serverTimestamp() }); }
  catch (error) { console.error("빙고방 이력 저장 실패", error); }
}

function getBoardProgress() {
  const size = Number(roomData?.size) || 0, total = size * size, checkedCells = boardData?.checkedCells || {}, selected = new Set();
  for (let index = 0; index < total; index += 1) if (checkedCells[String(index)] === true) selected.add(index);
  let completed = 0;
  for (let row = 0; row < size; row += 1) if (Array.from({ length: size }, (_, col) => row * size + col).every((i) => selected.has(i))) completed += 1;
  for (let col = 0; col < size; col += 1) if (Array.from({ length: size }, (_, row) => row * size + col).every((i) => selected.has(i))) completed += 1;
  if (size && Array.from({ length: size }, (_, i) => i * size + i).every((i) => selected.has(i))) completed += 1;
  if (size && Array.from({ length: size }, (_, i) => i * size + (size - 1 - i)).every((i) => selected.has(i))) completed += 1;
  return { total, checked: selected.size, remaining: Math.max(0, total - selected.size), completed, chicken: Math.max(0, Number(boardData?.chickenCount) || 0) };
}
function renderBoardStatus() {
  const progress = getBoardProgress();
  completedBingoCount.textContent = String(progress.completed); checkedCellCount.textContent = `${progress.checked} / ${progress.total}`; remainingCellCount.textContent = String(progress.remaining); chickenCount.textContent = String(progress.chicken);
  const disabled = !canWriteBoard();
  selectAllCellsButton.disabled = disabled || progress.total === 0 || progress.checked === progress.total;
  clearAllCellsButton.disabled = disabled || progress.checked === 0;
  undoBoardButton.disabled = disabled || !lastBoardUndo;
  decreaseChickenButton.disabled = disabled || progress.chicken <= 0;
  increaseChickenButton.disabled = disabled || progress.chicken >= 999;
}
function renderResultSummary() {
  if (!resultSummaryPanel || !resultSummaryGrid) return;
  resultSummaryPanel.classList.toggle("hidden", !isClosedRoom());
  if (!isClosedRoom()) return;
  const progress = getBoardProgress();
  resultSummaryGrid.innerHTML = `<div><span>빙고 종류</span><strong>${escapeHtml(roomBoardTypeLabel())}</strong></div><div><span>빙고판</span><strong>${roomData.size} × ${roomData.size}</strong></div><div><span>완성 빙고</span><strong>${progress.completed}줄</strong></div><div><span>체크된 칸</span><strong>${progress.checked} / ${progress.total}</strong></div><div><span>총 치킨</span><strong>${progress.chicken}치킨</strong></div><div><span>참가자</span><strong>${(roomData.participantUids?.length || 0) + 1}명</strong></div><div><span>시작</span><strong>${escapeHtml(formatDateTime(roomData.createdAt))}</strong></div><div><span>종료</span><strong>${escapeHtml(formatDateTime(roomData.closedAt))}</strong></div>`;
}

function getCellBackgroundPosition(index, size) { const row = Math.floor(index / size), col = index % size; return `${size <= 1 ? 0 : (col / (size - 1)) * 100}% ${size <= 1 ? 0 : (row / (size - 1)) * 100}%`; }
function getBoardCellSize(size) { const mobile = window.matchMedia("(max-width: 760px)").matches; if (size >= 9) return mobile ? 40 : 48; if (size >= 7) return mobile ? 44 : 54; if (size >= 5) return mobile ? 50 : 64; return mobile ? 64 : 78; }
function renderBoard() {
  if (!roomData || !boardData) return;
  const size = Number(roomData.size) || 5, total = size * size, checkedCells = boardData.checkedCells || {}, cellSize = getBoardCellSize(size);
  bingoBoard.innerHTML = ""; bingoBoard.style.setProperty("--bingo-size", size); bingoBoard.style.setProperty("--bingo-cell-size", `${cellSize}px`); bingoBoard.classList.toggle("image-mode", Boolean(boardImageUrl)); bingoBoard.classList.toggle("alphabet-board", roomData.boardType === "alphabet"); bingoBoard.classList.toggle("text-board", roomData.boardType === "text");
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < total; index += 1) {
    const checked = checkedCells[String(index)] === true, cell = document.createElement("button"), displayValue = cellDisplayValue(index);
    cell.type = "button"; cell.className = `bingo-cell${checked ? " checked" : ""}`; cell.dataset.index = String(index); cell.setAttribute("aria-pressed", checked ? "true" : "false"); cell.setAttribute("aria-label", `${displayValue} 칸 ${checked ? "선택됨" : "선택 안 됨"}`); cell.disabled = !canWriteBoard();
    if (checked && boardImageUrl) { cell.classList.add("has-image"); cell.style.backgroundImage = `url("${boardImageUrl}")`; cell.style.backgroundSize = `${size * 100}% ${size * 100}%`; cell.style.backgroundPosition = getCellBackgroundPosition(index, size); }
    else cell.innerHTML = `<span class="cell-number">${escapeHtml(displayValue)}</span>`;
    if (canWriteBoard()) cell.addEventListener("click", () => toggleCell(index));
    fragment.appendChild(cell);
  }
  bingoBoard.appendChild(fragment); renderBoardStatus();
}

async function toggleCell(index) {
  if (!canWriteBoard()) return;
  window.HNSITE_SET_SAVE_STATUS?.("saving");
  try {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(boardRef()); if (!snap.exists()) throw new Error("빙고판 정보를 찾을 수 없습니다.");
      const checkedCells = snap.data().checkedCells || {}, currentChecked = checkedCells[String(index)] === true;
      transaction.update(boardRef(), { [`checkedCells.${index}`]: !currentChecked, lastAction: makeBoardAction("cell_check", cellDisplayValue(index)), updatedAt: serverTimestamp() });
    });
    lastBoardUndo = null; window.HNSITE_SET_SAVE_STATUS?.("saved");
  } catch (error) { console.error(error); window.HNSITE_SET_SAVE_STATUS?.("error"); setMessage(firebaseErrorMessage(error, "빙고 체크 상태를 저장하지 못했습니다.")); }
}

async function setAllCells(checked) {
  if (!canWriteBoard()) return;
  const confirmed = await showConfirm(checked ? "현재 빙고판의 모든 칸이 선택됩니다. 필요하면 실행 취소로 한 번 되돌릴 수 있습니다." : "현재 체크된 모든 칸이 해제됩니다. 필요하면 실행 취소로 한 번 되돌릴 수 있습니다.", { title: checked ? "빙고판 전체 선택" : "빙고판 전체 해제", confirmText: checked ? "전체 선택" : "전체 해제", danger: !checked });
  if (!confirmed) return;
  const total = Number(roomData.size) ** 2, nextCheckedCells = {};
  if (checked) for (let index = 0; index < total; index += 1) nextCheckedCells[String(index)] = true;
  let previous = null;
  window.HNSITE_SET_SAVE_STATUS?.("saving");
  try {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(boardRef()); if (!snap.exists()) throw new Error("빙고판 정보를 찾을 수 없습니다.");
      previous = { ...(snap.data().checkedCells || {}) };
      transaction.update(boardRef(), { checkedCells: nextCheckedCells, lastAction: makeBoardAction(checked ? "select_all" : "clear_all", ""), updatedAt: serverTimestamp() });
    });
    lastBoardUndo = { before: previous || {}, after: nextCheckedCells }; window.HNSITE_SET_SAVE_STATUS?.("saved"); setMessage(checked ? "전체 칸을 선택했습니다." : "전체 칸을 해제했습니다.", true);
  } catch (error) { console.error(error); window.HNSITE_SET_SAVE_STATUS?.("error"); setMessage(firebaseErrorMessage(error, "빙고판 전체 변경에 실패했습니다.")); }
}
async function undoLastBoardChange() {
  if (!canWriteBoard() || !lastBoardUndo) return;
  const undo = lastBoardUndo;
  try {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(boardRef()); if (!snap.exists()) throw new Error("빙고판 정보를 찾을 수 없습니다.");
      if (!mapsEqual(snap.data().checkedCells || {}, undo.after)) throw new Error("BOARD_CHANGED");
      transaction.update(boardRef(), { checkedCells: undo.before, lastAction: makeBoardAction("undo", ""), updatedAt: serverTimestamp() });
    });
    lastBoardUndo = null; setMessage("마지막 전체 선택/해제를 되돌렸습니다.", true);
  } catch (error) { console.error(error); if (error.message === "BOARD_CHANGED") { lastBoardUndo = null; setMessage("다른 체크 변경이 있어 이전 작업을 되돌릴 수 없습니다."); } else setMessage(firebaseErrorMessage(error, "실행 취소에 실패했습니다.")); }
}

async function changeChickenCount(delta) {
  if (!canWriteBoard() || ![-1,1].includes(delta)) return;
  const logRef = doc(chickenLogsRef());
  try {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(boardRef()); if (!snap.exists()) throw new Error("빙고판 정보를 찾을 수 없습니다.");
      const current = Math.max(0, Number(snap.data().chickenCount) || 0), next = Math.min(999, Math.max(0, current + delta)); if (next === current) return;
      transaction.update(boardRef(), { chickenCount: next, lastAction: makeBoardAction("chicken", delta > 0 ? "+1" : "-1"), updatedAt: serverTimestamp() });
      transaction.set(logRef, { delta, actorUid: currentUser.uid, actorName: currentProfile.name || currentUser.email || "사용자", createdAt: serverTimestamp(), reverted: false, revertedAt: null, revertedByUid: "", revertedByName: "" });
    });
  } catch (error) { console.error(error); setMessage(firebaseErrorMessage(error, "치킨 수량을 저장하지 못했습니다.")); }
}
function renderChickenHistory() {
  chickenHistoryList.innerHTML = "";
  const sorted = [...chickenLogs].sort((a,b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  if (!sorted.length) { chickenHistoryList.innerHTML = '<div class="chicken-history-empty">아직 치킨 기록이 없습니다.</div>'; return; }
  sorted.slice(0,100).forEach((log) => {
    const item = document.createElement("div"); item.className = `chicken-history-item${log.reverted ? " reverted" : ""}`; item.innerHTML = `<div class="chicken-history-info"><strong>${escapeHtml(log.actorName || "사용자")} · ${Number(log.delta) > 0 ? "+1" : "-1"} 치킨</strong><small>${formatLogTime(log.createdAt)}${log.reverted ? ` · ${escapeHtml(log.revertedByName || "사용자")}님이 취소` : ""}</small></div>`;
    if (!log.reverted && canWriteBoard()) { const button = document.createElement("button"); button.type = "button"; button.className = "secondary compact-button"; button.textContent = "기록 취소"; button.addEventListener("click", () => undoChickenLog(log)); item.appendChild(button); }
    chickenHistoryList.appendChild(item);
  });
}
async function undoChickenLog(log) {
  if (!canWriteBoard() || log.reverted) return;
  if (!await showConfirm(`${log.actorName || "사용자"}님의 치킨 기록을 취소할까요?`, { title: "치킨 기록 취소", confirmText: "취소 처리" })) return;
  const logRef = doc(db, "channels", currentContext.channelId, "bingoRooms", roomId, "chickenLogs", log.id);
  try {
    await runTransaction(db, async (transaction) => {
      const [boardSnap, logSnap] = await Promise.all([transaction.get(boardRef()), transaction.get(logRef)]); if (!boardSnap.exists() || !logSnap.exists()) throw new Error("기록을 찾을 수 없습니다.");
      const live = logSnap.data(); if (live.reverted) throw new Error("ALREADY_REVERTED");
      const next = Math.max(0, Number(boardSnap.data().chickenCount) || 0) - Number(live.delta || 0); if (next < 0 || next > 999) throw new Error("COUNT_RANGE");
      transaction.update(boardRef(), { chickenCount: next, lastAction: makeBoardAction("chicken", "기록 취소"), updatedAt: serverTimestamp() });
      transaction.update(logRef, { reverted: true, revertedAt: serverTimestamp(), revertedByUid: currentUser.uid, revertedByName: currentProfile.name || currentUser.email || "사용자" });
    });
  } catch (error) { console.error(error); setMessage(firebaseErrorMessage(error, "치킨 기록 취소에 실패했습니다.")); }
}

function isPresenceOnline(item) { return (item?.lastSeen?.toMillis?.() || 0) > Date.now() - 5 * 60 * 1000; }
function renderPresence() {
  if (!roomPresenceSummary || !roomData) return;
  const allowedUids = new Set([roomData.ownerUid, ...(roomData.participantUids || [])]);
  if (isChannelManager(currentContext)) allowedUids.add(currentUser.uid);
  const online = [...presenceMap.entries()].filter(([uid,item]) => allowedUids.has(uid) && isPresenceOnline(item));
  roomPresenceSummary.textContent = `접속 중 ${online.length}명 · 참가자 ${(roomData.participantUids?.length || 0) + 1}명`;
  renderManageUsers();
}
async function touchPresence() {
  if (!roomId || !currentUser || isClosedRoom()) return;
  try { await setDoc(doc(db, "channels", currentContext.channelId, "bingoRooms", roomId, "presence", currentUser.uid), { uid: currentUser.uid, name: currentProfile.name || currentUser.email || "사용자", lastSeen: serverTimestamp() }, { merge: true }); }
  catch (error) { console.error("접속 상태 갱신 실패", error); }
}
function startPresence() {
  presenceUnsubscribe?.(); clearInterval(presenceHeartbeat);
  if (isClosedRoom()) return;
  touchPresence(); presenceHeartbeat = setInterval(touchPresence, 180000);
  presenceUnsubscribe = onSnapshot(presenceRef(), (snap) => { presenceMap = new Map(snap.docs.map((item) => [item.id, item.data()])); renderPresence(); }, (error) => console.error("접속 상태 조회 실패", error));
}

async function clearMyPresence() {
  if (!roomId || !currentUser || !currentContext?.channelId) return;
  try {
    await deleteDoc(doc(db, "channels", currentContext.channelId, "bingoRooms", roomId, "presence", currentUser.uid));
  } catch (error) {
    if (error?.code !== "permission-denied") console.error("접속 상태 정리 실패", error);
  }
}

window.addEventListener("pagehide", () => { clearMyPresence(); });

function inviteUrl() { const url = new URL("./bingo.html", location.href); url.hash = `invite=${currentContext.channelId}:${roomId}`; return url.toString(); }
async function openInviteModal() {
  if (!isRoomManager() || isClosedRoom()) return;
  let modal = document.getElementById("roomInviteModal");
  if (!modal) {
    modal = document.createElement("div"); modal.id = "roomInviteModal"; modal.className = "update-news-modal hidden";
    modal.innerHTML = `<div class="update-news-backdrop" data-close-invite></div><section class="invite-dialog" role="dialog" aria-modal="true"><div class="invite-head"><div><p class="eyebrow">INVITE</p><h2>빙고방 초대</h2><p>현재 채널의 승인된 멤버가 링크 또는 QR 코드로 참가할 수 있습니다.</p></div><button class="modal-close-button" data-close-invite type="button">×</button></div><div class="invite-body"><canvas id="inviteQrCanvas" width="220" height="220"></canvas><div class="invite-link-row"><input id="inviteLinkInput" readonly /><button id="copyInviteLinkButton" type="button">링크 복사</button></div></div></section>`;
    document.body.appendChild(modal); modal.querySelectorAll("[data-close-invite]").forEach((el) => el.addEventListener("click", () => modal.classList.add("hidden"))); modal.querySelector("#copyInviteLinkButton").addEventListener("click", async () => { try { await navigator.clipboard.writeText(inviteUrl()); showRoomToast("초대 링크를 복사했습니다."); } catch (_) {} });
  }
  modal.querySelector("#inviteLinkInput").value = inviteUrl(); modal.classList.remove("hidden");
  try { const QRCode = await import("https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm"); await QRCode.toCanvas(modal.querySelector("#inviteQrCanvas"), inviteUrl(), { width: 220, margin: 1 }); } catch (error) { console.error("QR 생성 실패", error); }
}

async function loadManageUsers() {
  if (!isRoomManager() || access !== "write" || isClosedRoom()) return;
  const snap = await getDocs(collection(db, "channels", currentContext.channelId, "members"));
  allUsers = snap.docs
    .map((item) => ({ uid: item.id, ...item.data() }))
    .filter((user) =>
      user.uid !== roomData.ownerUid &&
      ["approved", "active"].includes(user.status)
    )
    .sort((a, b) =>
      (a.name || a.email || "").localeCompare(b.name || b.email || "", "ko")
    );
  participantDraft = new Set(roomData.participantUids || []); participantDraftDirty = false; renderManageUsers();
}
function canBeParticipant(user) {
  return (
    ["approved", "active"].includes(
      user?.status
    ) &&
    (
      ["owner", "admin"].includes(
        user.role
      ) ||
      ["read", "write"].includes(
        user.bingoAccess
      )
    )
  );
}
function canOwnRoom(user) {
  return (
    ["approved", "active"].includes(
      user?.status
    ) &&
    ["owner", "admin"].includes(
      user.role
    )
  );
}
function participantUser(uid) { return allUsers.find((user) => user.uid === uid) || { uid, name: "알 수 없는 사용자", email: "" }; }
function participantStatusText(user) { return isPresenceOnline(presenceMap.get(user.uid)) ? "접속 중" : "초대됨"; }
function participantMatches(user, term) { return !term || `${user.name || ""} ${user.email || ""}`.toLocaleLowerCase("ko").includes(term.toLocaleLowerCase("ko")); }
function createParticipantManageItem(user, mode) {
  const item = document.createElement("div"); item.className = "participant-manage-item";
  const info = document.createElement("div"); info.className = "participant-manage-info"; info.innerHTML = `<strong>${escapeHtml(user.name || user.email || "사용자")}</strong><small>${escapeHtml(user.email || "")}${mode === "remove" ? ` · ${participantStatusText(user)}` : ""}</small>`;
  const actions = document.createElement("div"); actions.className = "participant-manage-actions";
  if (mode === "remove") {
    if (roomData.ownerUid === currentUser.uid && canOwnRoom(user)) { const transfer = document.createElement("button"); transfer.type = "button"; transfer.className = "secondary compact-button owner-transfer-button"; transfer.textContent = "방장 위임"; transfer.addEventListener("click", () => transferOwner(user)); actions.appendChild(transfer); }
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "danger-outline compact-button"; remove.textContent = "제외"; remove.addEventListener("click", () => { participantDraft.delete(user.uid); participantDraftDirty = true; renderManageUsers(); }); actions.appendChild(remove);
  } else { const add = document.createElement("button"); add.type = "button"; add.className = "secondary compact-button"; add.textContent = "추가"; add.addEventListener("click", () => { participantDraft.add(user.uid); participantDraftDirty = true; renderManageUsers(); }); actions.appendChild(add); }
  item.append(info, actions); return item;
}
function renderManagePagination(container, totalItems, pageValue, onChange) {
  container.innerHTML = ""; const pages = Math.max(1, Math.ceil(totalItems / MANAGE_PAGE_SIZE)); if (totalItems <= MANAGE_PAGE_SIZE) return;
  const prev = document.createElement("button"); prev.type="button"; prev.className="pagination-button"; prev.textContent="이전"; prev.disabled=pageValue<=1; prev.addEventListener("click",()=>onChange(pageValue-1));
  const info = document.createElement("span"); info.className="pagination-info"; info.textContent=`${pageValue} / ${pages}`;
  const next = document.createElement("button"); next.type="button"; next.className="pagination-button"; next.textContent="다음"; next.disabled=pageValue>=pages; next.addEventListener("click",()=>onChange(pageValue+1)); container.append(prev,info,next);
}
function renderManageUsers() {
  if (!currentParticipantList || !availableParticipantList) return;
  currentParticipantList.innerHTML = ""; availableParticipantList.innerHTML = "";
  const currentUsers = [...participantDraft].map(participantUser).filter((user) => participantMatches(user, currentParticipantSearchTerm));
  const availableUsers = allUsers.filter((user) => canBeParticipant(user) && !participantDraft.has(user.uid)).filter((user) => participantMatches(user, availableParticipantSearchTerm));
  currentParticipantCount.textContent = `${participantDraft.size}명`; availableParticipantCount.textContent = `${allUsers.filter((user) => canBeParticipant(user) && !participantDraft.has(user.uid)).length}명`;
  const cp = Math.max(1, Math.ceil(currentUsers.length / MANAGE_PAGE_SIZE)), ap = Math.max(1, Math.ceil(availableUsers.length / MANAGE_PAGE_SIZE)); currentParticipantPage = Math.min(currentParticipantPage, cp); availableParticipantPage = Math.min(availableParticipantPage, ap);
  if (!currentUsers.length) currentParticipantList.innerHTML = '<div class="participant-manage-empty">현재 지정된 참가자가 없습니다.</div>'; else currentUsers.slice((currentParticipantPage-1)*MANAGE_PAGE_SIZE, currentParticipantPage*MANAGE_PAGE_SIZE).forEach((user) => currentParticipantList.appendChild(createParticipantManageItem(user,"remove")));
  if (!availableUsers.length) availableParticipantList.innerHTML = '<div class="participant-manage-empty">추가 가능한 사용자가 없습니다.</div>'; else availableUsers.slice((availableParticipantPage-1)*MANAGE_PAGE_SIZE, availableParticipantPage*MANAGE_PAGE_SIZE).forEach((user) => availableParticipantList.appendChild(createParticipantManageItem(user,"add")));
  renderManagePagination(currentParticipantPagination,currentUsers.length,currentParticipantPage,(p)=>{currentParticipantPage=p;renderManageUsers();}); renderManagePagination(availableParticipantPagination,availableUsers.length,availableParticipantPage,(p)=>{availableParticipantPage=p;renderManageUsers();});
  document.getElementById("saveParticipantsButton").disabled = !participantDraftDirty;
}
async function saveParticipants() {
  if (!isRoomManager() || access !== "write" || !participantDraftDirty || isClosedRoom()) return;
  const nextUids = [...participantDraft], previous = roomData.participantUids || [], button = document.getElementById("saveParticipantsButton");
  if (nextUids.length > 20) { setMessage("빙고방 참가자는 방장을 제외하고 최대 20명까지 지정할 수 있습니다."); return; }
  button.disabled = true; button.textContent = "저장 중...";
  try { await updateDoc(roomRef(), { participantUids: nextUids, updatedAt: serverTimestamp() }); roomData.participantUids = nextUids; participantDraftDirty = false; await writeRoomAudit("participants_change", `참가자 ${previous.length}명 → ${nextUids.length}명`); renderManageUsers(); setMessage("참가자 변경사항을 저장했습니다.", true); }
  catch (error) { console.error(error); setMessage(firebaseErrorMessage(error, "참가자 변경에 실패했습니다.")); }
  finally { button.textContent = "변경사항 저장"; button.disabled = !participantDraftDirty; }
}
async function transferOwner(targetUser) {
  if (roomData.ownerUid !== currentUser.uid || !canOwnRoom(targetUser) || isClosedRoom()) return;
  if (!await showConfirm(`${targetUser.name || targetUser.email}님에게 방장을 위임할까요?`, { title: "방장 위임", confirmText: "위임" })) return;

  try {
    await runTransaction(db, async (transaction) => {
      const roomSnap = await transaction.get(roomRef());
      if (!roomSnap.exists()) throw new Error("TRANSFER_STATE_CHANGED");

      const live = roomSnap.data();
      if (live.ownerUid !== currentUser.uid || live.status === "closed" || !(live.participantUids || []).includes(targetUser.uid)) {
        throw new Error("TRANSFER_STATE_CHANGED");
      }

      const targetSlotRefs = [1, 2, 3, 4, 5].map((slot) => slotRef(targetUser.uid, slot));
      const targetSlotSnaps = await Promise.all(targetSlotRefs.map((ref) => transaction.get(ref)));
      const freeIndex = targetSlotSnaps.findIndex((snap) => !snap.exists());
      if (freeIndex < 0) throw new Error("TARGET_ROOM_LIMIT");

      const targetSlot = String(freeIndex + 1);
      const targetSlotRef = targetSlotRefs[freeIndex];
      const currentSlot = live.ownerSlot;
      const nextParticipants = (live.participantUids || []).filter((uid) => uid !== targetUser.uid);
      if (!nextParticipants.includes(currentUser.uid)) nextParticipants.push(currentUser.uid);

      transaction.set(targetSlotRef, {
        ownerUid: targetUser.uid,
        roomId,
        slot: targetSlot,
        createdAt: serverTimestamp()
      });
      if (currentSlot) transaction.delete(slotRef(currentUser.uid, currentSlot));
      transaction.update(roomRef(), {
        ownerUid: targetUser.uid,
        ownerName: targetUser.name || targetUser.email || "방장",
        ownerSlot: targetSlot,
        participantUids: nextParticipants,
        updatedAt: serverTimestamp()
      });
    });

    await writeRoomAudit("owner_transfer", `${targetUser.name || targetUser.email}에게 방장 위임`);
    setMessage("방장을 위임했습니다.", true);
  } catch (error) {
    console.error(error);
    if (error.message === "TARGET_ROOM_LIMIT") {
      await showNotice("선택한 관리자는 이미 활성 빙고방 5개를 소유하고 있습니다.");
    } else {
      setMessage(firebaseErrorMessage(error, "방장 위임에 실패했습니다."));
    }
  }
}

async function leaveRoom() {
  if (roomData.ownerUid === currentUser.uid || !(roomData.participantUids || []).includes(currentUser.uid) || isClosedRoom()) return;
  if (!await showConfirm("이 빙고방 참가 목록에서 나갈까요?", { title: "빙고방 나가기", confirmText: "나가기", danger: true })) return;
  try {
    await runTransaction(db, async (transaction) => { const snap = await transaction.get(roomRef()); if (!snap.exists()) return; const participants = snap.data().participantUids || []; transaction.update(roomRef(), { participantUids: participants.filter((uid)=>uid!==currentUser.uid), updatedAt: serverTimestamp() }); });
    sessionStorage.removeItem(currentRoomStorageKey(currentContext.channelId)); location.replace("./bingo.html");
  } catch (error) { console.error(error); setMessage(firebaseErrorMessage(error, "방 나가기에 실패했습니다.")); }
}
async function closeRoom() {
  if (!isRoomManager() || isClosedRoom()) return;
  if (!await showConfirm("빙고방을 종료하면 결과는 보관되고 더 이상 체크할 수 없습니다. 관리자별 5개 제한에서는 즉시 제외됩니다.", { title: "이 빙고방을 종료할까요?", confirmText: "방 종료" })) return;
  try {
    await runTransaction(db, async (transaction) => { const snap = await transaction.get(roomRef()); if (!snap.exists()) throw new Error("ROOM_NOT_FOUND"); const live = snap.data(); if (live.status === "closed") return; transaction.update(roomRef(), { status:"closed", closedAt:serverTimestamp(), closedByUid:currentUser.uid, updatedAt:serverTimestamp() }); if (live.ownerUid && live.ownerSlot) transaction.delete(slotRef(live.ownerUid,live.ownerSlot)); });
    await writeRoomAudit("room_close","빙고방 종료 및 결과 보관"); sessionStorage.removeItem(currentRoomStorageKey(currentContext.channelId)); sessionStorage.removeItem(archiveRoomStorageKey(currentContext.channelId)); location.replace("./bingo.html");
  } catch (error) { console.error(error); setMessage(firebaseErrorMessage(error,"빙고방 종료에 실패했습니다.")); }
}
async function deleteSubcollection(ref) { const snap = await getDocs(ref); const docs=[...snap.docs]; for(let start=0;start<docs.length;start+=400){const batch=writeBatch(db);docs.slice(start,start+400).forEach((item)=>batch.delete(item.ref));await batch.commit();} }
async function deleteRoom() {
  if (!isRoomManager()) return;
  if (!await showConfirm(isClosedRoom()?"보관된 빙고 결과, 기록과 사진이 모두 삭제됩니다.":"빙고 데이터, 치킨 기록과 사진이 모두 삭제됩니다.",{title:isClosedRoom()?"보관된 기록을 삭제할까요?":"이 빙고방을 삭제할까요?",confirmText:"삭제",danger:true})) return;
  try {
    roomUnsubscribe?.(); boardUnsubscribe?.(); chickenLogsUnsubscribe?.(); presenceUnsubscribe?.(); clearInterval(presenceHeartbeat); clearTimeout(autoCloseTimer);
    await deleteSubcollection(chickenLogsRef());
    await deleteSubcollection(presenceRef());

    const batch=writeBatch(db);
    batch.delete(boardRef());
    batch.delete(roomRef());
    if (!isClosedRoom() && roomData.ownerUid && roomData.ownerSlot) batch.delete(slotRef(roomData.ownerUid,roomData.ownerSlot));
    await batch.commit();

    await writeRoomAudit("room_delete",isClosedRoom()?"보관 기록 삭제":"빙고방 삭제");
    try { await deleteObject(boardImageRef); } catch (error) { if (error?.code!=="storage/object-not-found") console.warn("빙고 사진 정리 실패", error); }

    sessionStorage.removeItem(currentRoomStorageKey(currentContext.channelId));
    sessionStorage.removeItem(archiveRoomStorageKey(currentContext.channelId));
    location.replace("./bingo.html");
  } catch (error) { console.error(error); setMessage(firebaseErrorMessage(error,"방 삭제 중 오류가 발생했습니다.")); }
}

function scheduleAutoClose() { clearTimeout(autoCloseTimer); if (!roomData || isClosedRoom() || !roomData.autoCloseAt?.toMillis) return; const delay=roomData.autoCloseAt.toMillis()-Date.now(); if(delay<=0) return attemptAutoClose(); autoCloseTimer=setTimeout(attemptAutoClose,Math.min(delay,2147483647)); }
async function attemptAutoClose() {
  if (!roomData || isClosedRoom() || !roomData.autoCloseAt?.toMillis || roomData.autoCloseAt.toMillis()>Date.now()) return;
  try { await runTransaction(db, async (transaction)=>{const snap=await transaction.get(roomRef());if(!snap.exists())return;const live=snap.data();if(live.status==="closed"||!live.autoCloseAt?.toMillis||live.autoCloseAt.toMillis()>Date.now())return;transaction.update(roomRef(),{status:"closed",closedAt:serverTimestamp(),closedByUid:"AUTO",updatedAt:serverTimestamp()});if(live.ownerUid&&live.ownerSlot)transaction.delete(slotRef(live.ownerUid,live.ownerSlot));}); }
  catch(error){console.error("자동 종료 실패",error);}
}

function renderRoomHeader() {
  document.getElementById("roomTitle").textContent=roomData.name||"빙고"; const status=isClosedRoom()?"종료":"진행 중"; document.getElementById("roomMeta").textContent=`${roomData.size} × ${roomData.size} · ${roomBoardTypeLabel()} · ${status} · 방장 ${roomData.ownerName||"-"}`; document.getElementById("boardPermission").textContent=isClosedRoom()?"권한: 결과 보기":`권한: ${access==="write"?"사용":"보기"}`; roomClosedNotice.classList.toggle("hidden",!isClosedRoom()); roomActions.innerHTML="";
  if(isRoomManager()){
    if(!isClosedRoom()&&access==="write"){
      const manage=document.createElement("button");manage.type="button";manage.className="secondary";manage.textContent="참가자 관리";manage.addEventListener("click",async()=>{const open=participantManagePanel.classList.contains("hidden");participantManagePanel.classList.toggle("hidden");manage.textContent=open?"참가자 관리 닫기":"참가자 관리";if(open&&!allUsers.length)await loadManageUsers();});roomActions.appendChild(manage);
      const invite=document.createElement("button");invite.type="button";invite.className="secondary";invite.textContent="초대 링크 / QR";invite.addEventListener("click",openInviteModal);roomActions.appendChild(invite);
      const close=document.createElement("button");close.type="button";close.className="secondary room-close-button";close.textContent="방 종료";close.addEventListener("click",closeRoom);roomActions.appendChild(close);
    }
    const del=document.createElement("button");del.type="button";del.className="danger";del.textContent=isClosedRoom()?"기록 삭제":"방 삭제";del.addEventListener("click",deleteRoom);roomActions.appendChild(del);
  } else if(!isClosedRoom()&&(roomData.participantUids||[]).includes(currentUser.uid)) { const leave=document.createElement("button");leave.type="button";leave.className="danger-outline";leave.textContent="방 나가기";leave.addEventListener("click",leaveRoom);roomActions.appendChild(leave); }
  renderResultSummary();renderPresence();scheduleAutoClose();
}

function startRealtimeListeners() {
  roomUnsubscribe?.();boardUnsubscribe?.();chickenLogsUnsubscribe?.();
  roomUnsubscribe=onSnapshot(roomRef(),async(snap)=>{
    if(!snap.exists()){location.replace("./bingo.html");return;} roomData={id:snap.id,...snap.data()}; const allowed=isChannelManager(currentContext)||roomData.ownerUid===currentUser.uid||(roomData.participantUids||[]).includes(currentUser.uid); if(!allowed){await showNotice("이 빙고방 참가 목록에서 제외되었습니다.");location.replace("./bingo.html");return;} if(!archiveMode&&isClosedRoom()){sessionStorage.setItem(archiveRoomStorageKey(currentContext.channelId),roomId);archiveMode=true;}
    renderRoomHeader(); if(isClosedRoom()){presenceUnsubscribe?.();clearInterval(presenceHeartbeat);} if(isRoomManager()&&access==="write"&&!isClosedRoom()){if(!participantDraftDirty)await loadManageUsers();else renderManageUsers();}else participantManagePanel.classList.add("hidden"); renderBoard();renderChickenHistory();
  },async(error)=>{console.error("빙고방 실시간 조회 실패",error);if(error?.code?.includes("permission-denied")){await showNotice("이 빙고방에 더 이상 접근할 수 없습니다.");location.replace("./bingo.html");}});
  boardUnsubscribe=onSnapshot(boardRef(),(snap)=>{if(!snap.exists())return;const next=snap.data();if(lastBoardUndo&&!mapsEqual(next.checkedCells||{},lastBoardUndo.after))lastBoardUndo=null;const action=next.lastAction;if(action?.id&&action.id!==lastSeenActionId){const initial=!lastSeenActionId;lastSeenActionId=action.id;if(!initial&&action.actorUid!==currentUser.uid)showRoomToast(actionText(action));}boardData=next;renderBoard();renderResultSummary();},(error)=>console.error("빙고판 실시간 조회 실패",error));
  chickenLogsUnsubscribe=onSnapshot(chickenLogsRef(),(snap)=>{chickenLogs=snap.docs.map((item)=>({id:item.id,...item.data()}));renderChickenHistory();},(error)=>{console.error(error);chickenHistoryList.innerHTML=`<div class="chicken-history-empty">${escapeHtml(firebaseErrorMessage(error,"치킨 기록을 불러오지 못했습니다."))}</div>`;});
}

selectAllCellsButton.addEventListener("click",()=>setAllCells(true));clearAllCellsButton.addEventListener("click",()=>setAllCells(false));undoBoardButton.addEventListener("click",undoLastBoardChange);decreaseChickenButton.addEventListener("click",()=>changeChickenCount(-1));increaseChickenButton.addEventListener("click",()=>changeChickenCount(1));chickenHistoryButton.addEventListener("click",()=>chickenHistoryPanel.classList.toggle("hidden"));closeChickenHistoryButton.addEventListener("click",()=>chickenHistoryPanel.classList.add("hidden"));printResultButton?.addEventListener("click",()=>window.print());document.addEventListener("visibilitychange",()=>{if(!document.hidden)touchPresence();});
currentParticipantSearch.addEventListener("input",()=>{currentParticipantSearchTerm=currentParticipantSearch.value.trim();currentParticipantPage=1;renderManageUsers();});availableParticipantSearch.addEventListener("input",()=>{availableParticipantSearchTerm=availableParticipantSearch.value.trim();availableParticipantPage=1;renderManageUsers();});document.getElementById("saveParticipantsButton").addEventListener("click",saveParticipants);
document.getElementById("logoutButton").addEventListener("click",async()=>{await clearMyPresence();roomUnsubscribe?.();boardUnsubscribe?.();chickenLogsUnsubscribe?.();presenceUnsubscribe?.();clearInterval(presenceHeartbeat);clearTimeout(autoCloseTimer);stopChannelAccessWatcher?.();await signOut(auth);location.replace("./index.html");});
let resizeTimer=null;window.addEventListener("resize",()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(renderBoard,120);});

onAuthStateChanged(auth,async(user)=>{
  if(!user)return location.replace("./index.html");
  try{
    currentUser=user;currentProfile=await loadPlatformProfile(user);currentContext=await loadCurrentChannelContext(user,currentProfile);setTopbarContext({user,profile:currentProfile,context:currentContext});await initDeveloperChannelTools(user,currentProfile,currentContext);initChannelOwnerTools(user,currentProfile,currentContext);stopChannelAccessWatcher?.();stopChannelAccessWatcher=watchCurrentChannelAccess(user,currentProfile,currentContext,{feature:"bingo"});initChannelMemberApproval(currentContext);access=resolvedFeatureAccess(currentContext,"bingo");if(access==="none")throw new Error("이 채널에서 빙고를 이용할 권한이 없습니다.");
    document.getElementById("userEmail").textContent=user.email||"";document.getElementById("currentChannelName").textContent=currentContext.channel.name||"HNSITE";const roleBadge=document.getElementById("roleBadge");roleBadge.textContent=displayRole(currentContext);roleBadge.dataset.role=isDeveloper(currentProfile)?"developer":currentContext.member.role;
    await loadRoomAndBoard();await loadBoardImage();renderRoomHeader();renderBoard();if(isRoomManager()&&access==="write"&&!isClosedRoom())await loadManageUsers();loadingPanel.classList.add("hidden");roomContent.classList.remove("hidden");startRealtimeListeners();startPresence();
  }catch(error){console.error(error);if(["NO_CHANNEL","CHANNEL_NOT_FOUND","CHANNEL_INACTIVE"].includes(error.code))return location.replace("./channels.html");loadingPanel.innerHTML=`<h2>빙고방에 들어갈 수 없습니다.</h2><p>${escapeHtml(firebaseErrorMessage(error,error.message||"빙고방 정보를 불러오지 못했습니다."))}</p><a class="service-button inline-button" href="./bingo.html">빙고 목록으로 돌아가기</a>`;}
});
