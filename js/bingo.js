import { auth, db, storage } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  addDoc,
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
import { deleteObject, ref as storageRef, uploadBytes } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js";
import { BINGO_IMAGE_POLICY, compressBingoImage } from "./image-policy.js";
import { initChannelMemberApproval } from "./channel-members.js";
import { initDeveloperChannelTools } from "./developer-channel-tools.js";
import { initChannelOwnerTools } from "./channel-owner-tools.js";
import { setTopbarContext } from "./topbar-menu.js";
import { firebaseErrorMessage } from "./error-messages.js";
import { normalizeUniqueName, resolveChannelByName, uniqueNameKey } from "./name-registry.js";
import {
  accessLabel,
  archiveRoomStorageKey,
  currentRoomStorageKey,
  displayRole,
  isChannelManager,
  isDeveloper,
  loadCurrentChannelContext,
  loadPlatformProfile,
  resolvedFeatureAccess,
  setCurrentChannelId,
  watchCurrentChannelAccess
} from "./channel-context.js";

let stopChannelAccessWatcher = null;

const loadingPanel = document.getElementById("loadingPanel");
const bingoContent = document.getElementById("bingoContent");
const currentRoomContent = document.getElementById("currentRoomContent");
const lobbyMessage = document.getElementById("lobbyMessage");
const createPanel = document.getElementById("createPanel");
const joinPanel = document.getElementById("joinPanel");
const participantList = document.getElementById("participantList");
const roomList = document.getElementById("roomList");
const createRoomButton = document.getElementById("createRoomButton");
const roomImage = document.getElementById("roomImage");
const imageUploadStatus = document.getElementById("imageUploadStatus");
const participantSearch = document.getElementById("participantSearch");
const participantSearchCount = document.getElementById("participantSearchCount");
const participantPagination = document.getElementById("participantPagination");
const boardTypeSelect = document.getElementById("boardType");
const roomSizeSelect = document.getElementById("roomSize");
const alphabetOptions = document.getElementById("alphabetOptions");
const alphabetModeSelect = document.getElementById("alphabetMode");
const alphabetModeHelp = document.getElementById("alphabetModeHelp");
const randomAlphabetPanel = document.getElementById("randomAlphabetPanel");
const randomAlphabetGrid = document.getElementById("randomAlphabetGrid");
const randomAlphabetCount = document.getElementById("randomAlphabetCount");
const shuffleRandomAlphabetButton = document.getElementById("shuffleRandomAlphabetButton");
const customAlphabetPanel = document.getElementById("customAlphabetPanel");
const customAlphabetGrid = document.getElementById("customAlphabetGrid");
const customAlphabetCount = document.getElementById("customAlphabetCount");
const alphabetBulkInput = document.getElementById("alphabetBulkInput");
const applyAlphabetBulkButton = document.getElementById("applyAlphabetBulkButton");
const fillAlphabetRandomButton = document.getElementById("fillAlphabetRandomButton");
const shuffleAlphabetButton = document.getElementById("shuffleAlphabetButton");
const clearAlphabetButton = document.getElementById("clearAlphabetButton");
const textOptions = document.getElementById("textOptions");
const customTextGrid = document.getElementById("customTextGrid");
const customTextCount = document.getElementById("customTextCount");
const textBulkInput = document.getElementById("textBulkInput");
const applyTextBulkButton = document.getElementById("applyTextBulkButton");
const clearTextButton = document.getElementById("clearTextButton");
const autoCloseAtInput = document.getElementById("autoCloseAt");
const roomSearch = document.getElementById("roomSearch");
const roomStatusFilter = document.getElementById("roomStatusFilter");
const roomTypeFilter = document.getElementById("roomTypeFilter");
const roomSort = document.getElementById("roomSort");

let currentUser = null;
let currentProfile = null;
let currentContext = null;
let selectableUsers = [];
let visibleRooms = [];
let roomSummaries = new Map();
let selectedParticipantUids = new Set();
let participantSearchTerm = "";
let participantPage = 1;
const PARTICIPANT_PAGE_SIZE = 5;
let roomSearchTerm = "";
let roomStatusValue = "all";
let roomTypeValue = "all";
let roomSortValue = "recent";
let favoriteRoomIds = new Set();
let cloneSourceRoomId = "";
let cloneCellValues = null;
let randomAlphabetPreviewValues = [];

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const bingoAccess = () => resolvedFeatureAccess(currentContext, "bingo");
const canCreateRoom = () => isChannelManager(currentContext) && bingoAccess() === "write";
const roomsRef = () => collection(db, "channels", currentContext.channelId, "bingoRooms");
const roomRef = (roomId) => doc(db, "channels", currentContext.channelId, "bingoRooms", roomId);
const boardRef = (roomId) => doc(db, "channels", currentContext.channelId, "bingoBoards", roomId);
const slotRef = (uid, slot) => doc(db, "channels", currentContext.channelId, "bingoRoomOwners", uid, "slots", String(slot));

function setMessage(text, success = false) {
  lobbyMessage.textContent = text;
  lobbyMessage.classList.toggle("success", success);
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function escapeAttribute(value) { return escapeHtml(value); }

function boardTypeLabel(room) {
  if (room?.boardType === "alphabet") return "알파벳 빙고";
  if (room?.boardType === "text") return "자유 텍스트 빙고";
  return "숫자 빙고";
}
function isClosedRoom(room) { return room?.status === "closed"; }
function isRoomVisibleToUser(room) {
  return isChannelManager(currentContext) || room.ownerUid === currentUser.uid || (room.participantUids || []).includes(currentUser.uid);
}
function isRoomParticipant(room) { return room.ownerUid === currentUser.uid || (room.participantUids || []).includes(currentUser.uid); }
function activeOwnedRooms() { return visibleRooms.filter((room) => !isClosedRoom(room) && room.ownerUid === currentUser.uid); }

function createRandomAlphabetValues(total) {
  const values = Array.from({ length: total }, (_, index) => ALPHABET[index % ALPHABET.length]);
  for (let index = values.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [values[index], values[randomIndex]] = [values[randomIndex], values[index]];
  }
  return values;
}
function shuffleAlphabetValues(values) {
  const next = [...values];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[randomIndex]] = [next[randomIndex], next[index]];
  }
  return next;
}
function renderRandomAlphabetPreview(values = null) {
  const size = Number(roomSizeSelect.value) || 5;
  const total = size * size;
  if (Array.isArray(values) && values.length === total) {
    randomAlphabetPreviewValues = values.map(normalizeAlphabetValue);
  } else if (randomAlphabetPreviewValues.length !== total || randomAlphabetPreviewValues.some((value) => !normalizeAlphabetValue(value))) {
    randomAlphabetPreviewValues = createRandomAlphabetValues(total);
  }

  randomAlphabetGrid.innerHTML = "";
  randomAlphabetGrid.style.setProperty("--alphabet-size", size);
  randomAlphabetCount.textContent = `${total}칸`;
  randomAlphabetPreviewValues.forEach((value, index) => {
    const cell = document.createElement("span");
    cell.className = "random-alphabet-cell";
    cell.textContent = normalizeAlphabetValue(value) || "?";
    cell.setAttribute("aria-label", `${index + 1}번 칸 ${cell.textContent}`);
    randomAlphabetGrid.appendChild(cell);
  });
}
function resetRandomAlphabetPreview() {
  randomAlphabetPreviewValues = [];
  if (boardTypeSelect.value === "alphabet" && alphabetModeSelect.value === "random") {
    renderRandomAlphabetPreview();
  }
}
function extractAlphabetValues(value) { return (String(value || "").toUpperCase().match(/[A-Z]/g) || []); }
function normalizeAlphabetValue(value) { return String(value || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1); }
function customAlphabetInputs() { return [...customAlphabetGrid.querySelectorAll("input")]; }
function applyCustomAlphabetValues(values, startIndex = 0) {
  const inputs = customAlphabetInputs();
  values.forEach((value, offset) => {
    const input = inputs[startIndex + offset];
    if (!input) return;
    input.value = normalizeAlphabetValue(value);
    input.classList.remove("invalid");
  });
}
function renderCustomAlphabetGrid() {
  const size = Number(roomSizeSelect.value) || 5;
  const total = size * size;
  const previousValues = customAlphabetInputs().map((input) => input.value);
  customAlphabetGrid.innerHTML = "";
  customAlphabetGrid.style.setProperty("--alphabet-size", size);
  customAlphabetCount.textContent = `${total}칸`;
  for (let index = 0; index < total; index += 1) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "alphabet-cell-input";
    input.maxLength = 1;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("aria-label", `${index + 1}번 칸 알파벳`);
    input.value = normalizeAlphabetValue(previousValues[index]);
    input.addEventListener("input", () => { cloneCellValues = null; input.value = normalizeAlphabetValue(input.value); input.classList.remove("invalid"); });
    input.addEventListener("paste", (event) => {
      const pasted = extractAlphabetValues(event.clipboardData?.getData("text"));
      if (pasted.length <= 1) return;
      event.preventDefault();
      applyCustomAlphabetValues(pasted, index);
    });
    customAlphabetGrid.appendChild(input);
  }
}
function getCustomAlphabetValues() {
  const inputs = customAlphabetInputs();
  const values = inputs.map((input) => normalizeAlphabetValue(input.value));
  let firstInvalid = null;
  inputs.forEach((input, index) => { const invalid = !values[index]; input.classList.toggle("invalid", invalid); if (invalid && !firstInvalid) firstInvalid = input; });
  if (firstInvalid) { firstInvalid.focus(); return null; }
  return values;
}
function customTextInputs() { return [...customTextGrid.querySelectorAll("input")]; }
function renderCustomTextGrid() {
  const size = Number(roomSizeSelect.value) || 5;
  const total = size * size;
  const previous = customTextInputs().map((input) => input.value);
  customTextGrid.innerHTML = "";
  customTextGrid.style.setProperty("--text-size", size);
  customTextCount.textContent = `${total}칸`;
  for (let index = 0; index < total; index += 1) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "text-cell-input";
    input.maxLength = 20;
    input.autocomplete = "off";
    input.placeholder = String(index + 1);
    input.setAttribute("aria-label", `${index + 1}번 칸 문구`);
    input.value = previous[index] || "";
    input.addEventListener("input", () => { cloneCellValues = null; input.classList.remove("invalid"); });
    customTextGrid.appendChild(input);
  }
}
function extractTextValues(value) { return String(value || "").split(/[\n,\t]+/).map((item) => item.trim().slice(0, 20)).filter(Boolean); }
function applyCustomTextValues(values) {
  const inputs = customTextInputs();
  values.forEach((value, index) => { if (inputs[index]) { inputs[index].value = String(value || "").trim().slice(0, 20); inputs[index].classList.remove("invalid"); } });
}
function getCustomTextValues() {
  const inputs = customTextInputs();
  const values = inputs.map((input) => input.value.trim().slice(0, 20));
  let firstInvalid = null;
  inputs.forEach((input, index) => { const invalid = !values[index]; input.classList.toggle("invalid", invalid); if (invalid && !firstInvalid) firstInvalid = input; });
  if (firstInvalid) { firstInvalid.focus(); return null; }
  return values;
}
function updateAlphabetOptions() {
  const isAlphabet = boardTypeSelect.value === "alphabet";
  const isText = boardTypeSelect.value === "text";
  const isCustom = isAlphabet && alphabetModeSelect.value === "custom";
  const isRandom = isAlphabet && alphabetModeSelect.value === "random";
  alphabetOptions.classList.toggle("hidden", !isAlphabet);
  textOptions?.classList.toggle("hidden", !isText);
  randomAlphabetPanel.classList.toggle("hidden", !isRandom);
  customAlphabetPanel.classList.toggle("hidden", !isCustom);
  alphabetModeHelp.textContent = isCustom ? "직접 지정한 알파벳이 모든 참가자에게 같은 순서로 표시됩니다." : "A~Z를 섞어 배치합니다. 아래 미리보기에서 원하는 배치가 나올 때까지 다시 셔플할 수 있습니다.";
  if (isRandom) renderRandomAlphabetPreview();
  if (isCustom) renderCustomAlphabetGrid();
  if (isText) renderCustomTextGrid();
}

async function loadVisibleRooms() {
  const rooms = new Map();
  if (isChannelManager(currentContext)) {
    const snap = await getDocs(roomsRef());
    snap.docs.forEach((item) => rooms.set(item.id, { id: item.id, ...item.data() }));
  } else {
    const [ownedSnap, invitedSnap] = await Promise.all([
      getDocs(query(roomsRef(), where("ownerUid", "==", currentUser.uid))),
      getDocs(query(roomsRef(), where("participantUids", "array-contains", currentUser.uid)))
    ]);
    [...ownedSnap.docs, ...invitedSnap.docs].forEach((item) => rooms.set(item.id, { id: item.id, ...item.data() }));
  }
  visibleRooms = [...rooms.values()].filter(isRoomVisibleToUser).sort((a, b) => {
    const aClosed = isClosedRoom(a) ? 1 : 0;
    const bClosed = isClosedRoom(b) ? 1 : 0;
    if (aClosed !== bClosed) return aClosed - bClosed;
    return (b.updatedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0);
  });
}

function progressFromRoomBoard(room, board) {
  const size = Number(room?.size) || 0;
  const total = size * size;
  const checked = board?.checkedCells || {};
  const selected = new Set();
  for (let index = 0; index < total; index += 1) if (checked[String(index)] === true) selected.add(index);
  let completed = 0;
  for (let row = 0; row < size; row += 1) if (Array.from({ length: size }, (_, col) => row * size + col).every((i) => selected.has(i))) completed += 1;
  for (let col = 0; col < size; col += 1) if (Array.from({ length: size }, (_, row) => row * size + col).every((i) => selected.has(i))) completed += 1;
  if (size && Array.from({ length: size }, (_, i) => i * size + i).every((i) => selected.has(i))) completed += 1;
  if (size && Array.from({ length: size }, (_, i) => i * size + (size - 1 - i)).every((i) => selected.has(i))) completed += 1;
  return { completed, checked: selected.size, total, chicken: Math.max(0, Number(board?.chickenCount) || 0) };
}
async function loadRoomSummaries() {
  const entries = await Promise.all(visibleRooms.map(async (room) => {
    try {
      const snap = await getDoc(boardRef(room.id));
      return [room.id, snap.exists() ? { ...progressFromRoomBoard(room, snap.data()), cellValues: snap.data().cellValues || [] } : null];
    } catch (error) { console.error("빙고 진행 조회 실패", room.id, error); return [room.id, null]; }
  }));
  roomSummaries = new Map(entries);
}

async function closeExpiredVisibleRooms() {
  for (const room of visibleRooms) {
    if (isClosedRoom(room) || !room.autoCloseAt?.toMillis || room.autoCloseAt.toMillis() > Date.now()) continue;
    try {
      await runTransaction(db, async (transaction) => {
        const ref = roomRef(room.id);
        const snap = await transaction.get(ref);
        if (!snap.exists()) return;
        const live = snap.data();
        if (live.status === "closed" || !live.autoCloseAt?.toMillis || live.autoCloseAt.toMillis() > Date.now()) return;
        transaction.update(ref, { status: "closed", closedAt: serverTimestamp(), closedByUid: "AUTO", updatedAt: serverTimestamp() });
        if (live.ownerUid && live.ownerSlot) transaction.delete(slotRef(live.ownerUid, live.ownerSlot));
      });
      room.status = "closed";
    } catch (error) { console.error("자동 종료 실패", room.id, error); }
  }
}

function renderCurrentRoom() {
  const active = visibleRooms.filter((room) => !isClosedRoom(room) && isRoomParticipant(room));
  const owned = active.filter((room) => room.ownerUid === currentUser.uid).length;
  const joined = Math.max(0, active.length - owned);
  currentRoomContent.className = "current-room-card room-summary-card";
  currentRoomContent.innerHTML = `<div><span class="room-state-badge">활성 ${active.length}개</span><h3>${canCreateRoom() ? `내가 만든 방 ${owned}/5` : "참여 중인 빙고방"}</h3><p>소유 ${owned}개 · 참여 ${joined}개${canCreateRoom() ? " · 관리자별 활성 방은 최대 5개" : ""}</p></div><a class="secondary-link-button" href="#roomList">방 목록 보기</a>`;
}

function favoriteStorageKey() { return `hnsiteFavoriteRooms:${currentContext.channelId}:${currentUser.uid}`; }
function loadFavorites() { try { favoriteRoomIds = new Set(JSON.parse(localStorage.getItem(favoriteStorageKey()) || "[]")); } catch (_) { favoriteRoomIds = new Set(); } }
function saveFavorites() { localStorage.setItem(favoriteStorageKey(), JSON.stringify([...favoriteRoomIds])); }
function toggleFavorite(roomId) { favoriteRoomIds.has(roomId) ? favoriteRoomIds.delete(roomId) : favoriteRoomIds.add(roomId); saveFavorites(); renderRoomList(); }
function formatRoomTime(value) {
  const date = value?.toDate?.();
  if (!date) return "-";
  return new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}
function roomStatusText(room) {
  if (isClosedRoom(room)) return "종료";
  if (room.ownerUid === currentUser.uid) return "내가 만든 방";
  if ((room.participantUids || []).includes(currentUser.uid)) return "참여 가능";
  return "채널 관리";
}
function filteredRoomsForList() {
  const term = roomSearchTerm.toLocaleLowerCase("ko");
  return visibleRooms.filter((room) => {
    if (roomStatusValue !== "all" && (isClosedRoom(room) ? "closed" : "active") !== roomStatusValue) return false;
    if (roomTypeValue !== "all" && (room.boardType || "number") !== roomTypeValue) return false;
    return !term || `${room.name || ""} ${room.ownerName || ""}`.toLocaleLowerCase("ko").includes(term);
  }).sort((a, b) => {
    const af = favoriteRoomIds.has(a.id) ? 1 : 0, bf = favoriteRoomIds.has(b.id) ? 1 : 0;
    if (af !== bf) return bf - af;
    if (roomSortValue === "name") return (a.name || "").localeCompare(b.name || "", "ko");
    const av = roomSortValue === "created" ? a.createdAt?.toMillis?.() || 0 : a.updatedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0;
    const bv = roomSortValue === "created" ? b.createdAt?.toMillis?.() || 0 : b.updatedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0;
    return bv - av;
  });
}
function openRoom(roomId, archived = false) {
  sessionStorage.setItem(currentRoomStorageKey(currentContext.channelId), roomId);
  if (archived) sessionStorage.setItem(archiveRoomStorageKey(currentContext.channelId), roomId);
  else sessionStorage.removeItem(archiveRoomStorageKey(currentContext.channelId));
  location.href = "./bingo-room.html";
}
function renderRoomList() {
  const listed = filteredRoomsForList();
  if (!listed.length) { roomList.innerHTML = '<div class="empty-list-box">현재 확인할 수 있는 빙고방이 없습니다.</div>'; return; }
  roomList.innerHTML = "";
  listed.forEach((room) => {
    const summary = roomSummaries.get(room.id);
    const closed = isClosedRoom(room);
    const card = document.createElement("article");
    card.className = `bingo-room-item${closed ? " closed" : ""}`;
    const participantCount = (room.participantUids?.length || 0) + 1;
    const progressText = summary ? `완성 ${summary.completed}줄 · ${summary.checked}/${summary.total}칸 · ${summary.chicken}치킨` : "진행 정보 확인 불가";
    let action = "";
    if (closed) action = `<button class="secondary open-archive-room-button" data-room-id="${escapeAttribute(room.id)}" type="button">결과 보기</button>`;
    else if (isRoomParticipant(room) || isChannelManager(currentContext)) action = `<button class="service-button open-room-button" data-room-id="${escapeAttribute(room.id)}" type="button">들어가기</button>`;
    else action = `<button class="join-room-button" data-room-id="${escapeAttribute(room.id)}" type="button">참가하기</button>`;
    card.innerHTML = `<div class="bingo-room-item-main"><div class="room-card-badges"><button class="room-favorite-button ${favoriteRoomIds.has(room.id) ? "active" : ""}" data-room-id="${escapeAttribute(room.id)}" type="button">${favoriteRoomIds.has(room.id) ? "★" : "☆"}</button><span class="room-state-badge">${roomStatusText(room)}</span><span class="room-type-badge">${boardTypeLabel(room)}</span></div><h3>${escapeHtml(room.name)}</h3><p>${room.size} × ${room.size} · 참가자 ${participantCount}명 · 방장 ${escapeHtml(room.ownerName || "-")}</p><div class="room-card-detail"><span>${progressText}</span><span>최근 수정 ${formatRoomTime(room.updatedAt)}</span></div></div><div class="bingo-room-item-action">${action}${canCreateRoom() ? `<button class="secondary compact-button clone-room-button" data-room-id="${escapeAttribute(room.id)}" type="button">복제</button>` : ""}</div>`;
    roomList.appendChild(card);
  });
  roomList.querySelectorAll(".open-room-button").forEach((button) => button.addEventListener("click", () => openRoom(button.dataset.roomId)));
  roomList.querySelectorAll(".open-archive-room-button").forEach((button) => button.addEventListener("click", () => openRoom(button.dataset.roomId, true)));
  roomList.querySelectorAll(".join-room-button").forEach((button) => button.addEventListener("click", () => joinRoom(button.dataset.roomId)));
  roomList.querySelectorAll(".room-favorite-button").forEach((button) => button.addEventListener("click", () => toggleFavorite(button.dataset.roomId)));
  roomList.querySelectorAll(".clone-room-button").forEach((button) => button.addEventListener("click", () => { const room = visibleRooms.find((item) => item.id === button.dataset.roomId); if (room) cloneRoomToForm(room); }));
}

async function loadSelectableUsers() {
  if (!canCreateRoom()) { selectableUsers = []; return; }
  const snap = await getDocs(collection(db, "channels", currentContext.channelId, "members"));
  selectableUsers = snap.docs.map((item) => ({ uid: item.id, ...item.data() })).filter((user) => user.uid !== currentUser.uid && ["approved", "active"].includes(
  user.status
) && (["owner", "admin"].includes(user.role) || ["read", "write"].includes(user.bingoAccess))).sort((a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || "", "ko"));
}


function applySelectableUsersFromMembers(memberItems = []) {
  if (!canCreateRoom()) {
    selectableUsers = [];
    renderParticipantList();
    return;
  }

  selectableUsers = memberItems
    .filter((user) =>
      user.uid !== currentUser.uid &&
      ["approved", "active"].includes(user.status) &&
      (
        ["owner", "admin"].includes(user.role) ||
        ["read", "write"].includes(user.bingoAccess)
      )
    )
    .sort((a, b) =>
      (a.name || a.email || "").localeCompare(
        b.name || b.email || "",
        "ko"
      )
    );

  const validUids = new Set(selectableUsers.map((user) => user.uid));
  selectedParticipantUids = new Set(
    [...selectedParticipantUids].filter((uid) => validUids.has(uid))
  );
  participantPage = 1;
  renderParticipantList();
}

window.addEventListener("hnsite:channel-members-updated", (event) => {
  if (!currentContext?.channelId || event.detail?.channelId !== currentContext.channelId) return;
  applySelectableUsersFromMembers(event.detail?.members || []);
});
function matchesParticipantSearch(user, term) { return !term || `${user.name || ""} ${user.email || ""}`.toLocaleLowerCase("ko").includes(term.toLocaleLowerCase("ko")); }
function renderPagination(container, totalItems, pageValue, onChange) {
  container.innerHTML = "";
  const pages = Math.max(1, Math.ceil(totalItems / PARTICIPANT_PAGE_SIZE));
  if (totalItems <= PARTICIPANT_PAGE_SIZE) return;
  const prev = document.createElement("button"); prev.type = "button"; prev.className = "pagination-button"; prev.textContent = "이전"; prev.disabled = pageValue <= 1; prev.addEventListener("click", () => onChange(pageValue - 1));
  const info = document.createElement("span"); info.className = "pagination-info"; info.textContent = `${pageValue} / ${pages}`;
  const next = document.createElement("button"); next.type = "button"; next.className = "pagination-button"; next.textContent = "다음"; next.disabled = pageValue >= pages; next.addEventListener("click", () => onChange(pageValue + 1));
  container.append(prev, info, next);
}
function renderParticipantList() {
  if (!canCreateRoom()) { participantList.textContent = "채널 소유자 또는 관리자만 빙고방을 만들 수 있습니다."; participantPagination.innerHTML = ""; return; }
  const filtered = selectableUsers.filter((user) => matchesParticipantSearch(user, participantSearchTerm));
  const pages = Math.max(1, Math.ceil(filtered.length / PARTICIPANT_PAGE_SIZE)); participantPage = Math.min(participantPage, pages); participantSearchCount.textContent = `${filtered.length}명`;
  if (!filtered.length) { participantList.innerHTML = '<div class="participant-manage-empty participant-list-empty">추가 가능한 채널 멤버가 없습니다.</div>'; participantPagination.innerHTML = ""; return; }
  const start = (participantPage - 1) * PARTICIPANT_PAGE_SIZE;
  participantList.innerHTML = "";
  filtered.slice(start, start + PARTICIPANT_PAGE_SIZE).forEach((user) => {
    const label = document.createElement("label"); label.className = "participant-option";
    label.innerHTML = `<input type="checkbox" value="${escapeAttribute(user.uid)}" ${selectedParticipantUids.has(user.uid) ? "checked" : ""}/><span><strong>${escapeHtml(user.name || user.email || "사용자")}</strong><small>${escapeHtml(user.email || "")}</small></span>`;
    const checkbox = label.querySelector("input"); checkbox.addEventListener("change", () => checkbox.checked ? selectedParticipantUids.add(user.uid) : selectedParticipantUids.delete(user.uid)); participantList.appendChild(label);
  });
  renderPagination(participantPagination, filtered.length, participantPage, (next) => { participantPage = next; renderParticipantList(); });
}

function cloneRoomToForm(room) {
  if (!canCreateRoom()) { setMessage("채널 소유자 또는 관리자만 빙고방을 복제할 수 있습니다."); return; }
  if (activeOwnedRooms().length >= 5) { setMessage("활성 빙고방을 이미 5개 소유하고 있습니다. 기존 방을 종료하거나 삭제한 뒤 복제해주세요."); return; }
  cloneSourceRoomId = room.id;
  cloneCellValues = [...(roomSummaries.get(room.id)?.cellValues || [])];
  randomAlphabetPreviewValues = [];
  document.getElementById("roomName").value = `${room.name || "빙고"} 복사`.slice(0, 30);
  roomSizeSelect.value = String(room.size || 5);
  boardTypeSelect.value = room.boardType || "number";
  alphabetModeSelect.value = room.alphabetMode === "custom" ? "custom" : "random";
  selectedParticipantUids.clear();
  if (room.boardType === "alphabet" && room.alphabetMode !== "custom" && cloneCellValues.length === (Number(room.size) || 5) ** 2) {
    randomAlphabetPreviewValues = [...cloneCellValues];
  }
  updateAlphabetOptions();
  if (room.boardType === "alphabet" && room.alphabetMode === "custom") applyCustomAlphabetValues(cloneCellValues);
  if (room.boardType === "text") applyCustomTextValues(cloneCellValues);
  renderParticipantList();
  createPanel.classList.remove("hidden"); joinPanel.classList.add("hidden");
  setMessage("방 설정을 복사했습니다. 참가자와 사진은 복사되지 않습니다.", true);
}

async function writeRoomAudit(action, room, detail = "") {
  try {
    await addDoc(collection(db, "channels", currentContext.channelId, "roomAuditLogs"), { actorUid: currentUser.uid, actorName: currentProfile.name || currentUser.email || "사용자", action, roomId: room.id || room, roomName: room.name || document.getElementById("roomName")?.value || "빙고방", detail: String(detail).slice(0, 500), createdAt: serverTimestamp() });
  } catch (error) { console.error("빙고방 이력 저장 실패", error); }
}

async function joinRoom(roomId) {
  const ref = roomRef(roomId);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error("ROOM_NOT_FOUND");
    const room = { id: snap.id, ...snap.data() };
    if (room.status === "closed") return openRoom(roomId, true);
    if (isChannelManager(currentContext) || isRoomParticipant(room)) return openRoom(roomId);
    await runTransaction(db, async (transaction) => {
      const roomSnap = await transaction.get(ref);
      if (!roomSnap.exists()) throw new Error("ROOM_NOT_FOUND");
      const live = roomSnap.data();
      if (live.status === "closed") throw new Error("ROOM_CLOSED");
      if (live.inviteEnabled !== true) throw new Error("NOT_INVITED");
      const participants = live.participantUids || [];
      if (!participants.includes(currentUser.uid)) {
        if (participants.length >= 20) throw new Error("ROOM_FULL");
        transaction.update(ref, { participantUids: [...participants, currentUser.uid], updatedAt: serverTimestamp() });
      }
    });
    openRoom(roomId);
  } catch (error) {
    console.error(error);
    const text = error.message === "ROOM_CLOSED" ? "이미 종료된 방입니다." : error.message === "ROOM_FULL" ? "참가자 정원이 가득 찼습니다." : error.message === "NOT_INVITED" ? "이 방에 참가할 수 없습니다." : firebaseErrorMessage(error, "방 참가에 실패했습니다.");
    setMessage(text);
  }
}

async function createRoom(event) {
  event.preventDefault();
  setMessage("");
  if (!canCreateRoom()) { setMessage("빙고방은 채널 소유자 또는 관리자만 만들 수 있습니다."); return; }
  if (activeOwnedRooms().length >= 5) { setMessage("관리자 한 명이 동시에 소유할 수 있는 활성 빙고방은 최대 5개입니다."); return; }

  const name = document.getElementById("roomName").value.trim();
  const size = Number(roomSizeSelect.value);
  const boardType = ["alphabet", "text"].includes(boardTypeSelect.value) ? boardTypeSelect.value : "number";
  const alphabetMode = boardType === "alphabet" ? (alphabetModeSelect.value === "custom" ? "custom" : "random") : "none";
  const imageFile = roomImage.files?.[0] || null;
  const participantUids = [...selectedParticipantUids];
  if (participantUids.length > 20) return setMessage("빙고방 참가자는 방장을 제외하고 최대 20명까지 지정할 수 있습니다.");
  if (!name) return setMessage("빙고 이름을 입력해주세요.");
  if (![3,4,5,6,7,8,9,10].includes(size)) return setMessage("올바른 빙고판 크기를 선택해주세요.");

  let cellValues = [];
  if (boardType === "alphabet") {
    if (alphabetMode === "custom") {
      cellValues = cloneCellValues && cloneCellValues.length === size * size ? [...cloneCellValues] : getCustomAlphabetValues();
      if (!cellValues) return setMessage("알파벳 직접 지정 칸을 모두 입력해주세요.");
    } else {
      if (randomAlphabetPreviewValues.length !== size * size) renderRandomAlphabetPreview();
      cellValues = [...randomAlphabetPreviewValues];
    }
  } else if (boardType === "text") {
    if (cloneCellValues && cloneCellValues.length === size * size) {
      cellValues = [...cloneCellValues];
    } else {
      cellValues = getCustomTextValues();
    }
    if (!cellValues) return setMessage("자유 텍스트 빙고의 모든 칸을 입력해주세요.");
  }
  let autoCloseAt = null;
  if (autoCloseAtInput?.value) {
    const date = new Date(autoCloseAtInput.value);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) return setMessage("자동 종료 시간은 현재보다 이후로 지정해주세요.");
    autoCloseAt = Timestamp.fromDate(date);
  }

  createRoomButton.disabled = true;
  const newRoomRef = doc(roomsRef());
  const newBoardRef = boardRef(newRoomRef.id);
  let ownerSlot = null;
  let newSlotRef = null;
  const imageRef = storageRef(storage, `channels/${currentContext.channelId}/bingoImages/${newRoomRef.id}/${BINGO_IMAGE_POLICY.fixedFileName}`);
  let compressedImage = null;
  let roomCreated = false;
  try {
    if (imageFile) {
      createRoomButton.textContent = "사진 압축 중...";
      imageUploadStatus.textContent = "사진을 자동으로 압축하고 있습니다...";
      compressedImage = await compressBingoImage(imageFile);
      imageUploadStatus.textContent = `압축 완료: ${formatBytes(compressedImage.size)}`;
    }
    createRoomButton.textContent = "방 생성 중...";
    await runTransaction(db, async (transaction) => {
      const candidateRefs = [1, 2, 3, 4, 5].map((slot) => slotRef(currentUser.uid, slot));
      const candidateSnaps = await Promise.all(candidateRefs.map((ref) => transaction.get(ref)));
      const freeIndex = candidateSnaps.findIndex((snap) => !snap.exists());
      if (freeIndex < 0) throw new Error("ROOM_LIMIT");
      ownerSlot = String(freeIndex + 1);
      newSlotRef = candidateRefs[freeIndex];
      transaction.set(newSlotRef, { ownerUid: currentUser.uid, roomId: newRoomRef.id, slot: ownerSlot, createdAt: serverTimestamp() });
      transaction.set(newRoomRef, { name, ownerUid: currentUser.uid, ownerName: currentProfile.name || currentUser.displayName || currentUser.email || "방장", ownerSlot, size, boardType, alphabetMode, participantUids, status: "active", closedAt: null, closedByUid: "", autoCloseAt, inviteEnabled: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      transaction.set(newBoardRef, { checkedCells: {}, imagePath: "", chickenCount: 0, cellValues, lastAction: null, updatedAt: serverTimestamp() });
    });
    roomCreated = true;
    if (compressedImage) await uploadBytes(imageRef, compressedImage, { contentType: BINGO_IMAGE_POLICY.outputType, cacheControl: "private,max-age=3600" });
    await writeRoomAudit(cloneSourceRoomId ? "room_clone" : "room_create", { id: newRoomRef.id, name }, cloneSourceRoomId ? `원본 방 ${cloneSourceRoomId}` : `${boardTypeLabel({ boardType })} ${size}×${size}`);
    openRoom(newRoomRef.id);
  } catch (error) {
    console.error(error);
    if (roomCreated) {
      try { if (compressedImage) await deleteObject(imageRef); } catch (_) {}
      try {
        const cleanupBatch = writeBatch(db);
        cleanupBatch.delete(newBoardRef);
        cleanupBatch.delete(newRoomRef);
        if (newSlotRef) cleanupBatch.delete(newSlotRef);
        await cleanupBatch.commit();
      } catch (cleanupError) {
        console.error("빙고방 생성 실패 데이터 정리 오류", cleanupError);
      }
    }
    setMessage(error.message === "ROOM_LIMIT" ? "활성 빙고방 5개가 이미 사용 중입니다." : firebaseErrorMessage(error, error.message || "빙고방 생성에 실패했습니다."));
  } finally {
    createRoomButton.disabled = false;
    createRoomButton.textContent = "빙고방 생성";
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function refreshAll() {
  await loadVisibleRooms();
  await closeExpiredVisibleRooms();
  await loadVisibleRooms();
  await loadRoomSummaries();
  renderCurrentRoom();
  renderRoomList();
}

function showCreatePanel() {
  setMessage("");
  if (!canCreateRoom()) { setMessage("빙고방은 채널 소유자 또는 관리자만 만들 수 있습니다."); return; }
  if (activeOwnedRooms().length >= 5) { setMessage("활성 빙고방을 이미 5개 소유하고 있습니다. 기존 방을 종료하거나 삭제해주세요."); return; }
  createPanel.classList.remove("hidden"); joinPanel.classList.add("hidden"); createPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

document.getElementById("showCreateButton").addEventListener("click", showCreatePanel);
document.getElementById("showJoinButton").addEventListener("click", () => { setMessage(""); joinPanel.classList.remove("hidden"); createPanel.classList.add("hidden"); });
document.getElementById("closeCreateButton").addEventListener("click", () => createPanel.classList.add("hidden"));
document.getElementById("refreshRoomsButton").addEventListener("click", async () => { try { await refreshAll(); } catch (error) { setMessage(firebaseErrorMessage(error, "방 목록을 새로고침하지 못했습니다.")); } });
boardTypeSelect.addEventListener("change", () => { cloneCellValues = null; if (boardTypeSelect.value === "alphabet" && alphabetModeSelect.value === "random") resetRandomAlphabetPreview(); updateAlphabetOptions(); });
alphabetModeSelect.addEventListener("change", () => { cloneCellValues = null; if (alphabetModeSelect.value === "random") resetRandomAlphabetPreview(); updateAlphabetOptions(); });
roomSizeSelect.addEventListener("change", () => { cloneCellValues = null; randomAlphabetPreviewValues = []; if (boardTypeSelect.value === "alphabet" && alphabetModeSelect.value === "random") renderRandomAlphabetPreview(); if (boardTypeSelect.value === "alphabet" && alphabetModeSelect.value === "custom") renderCustomAlphabetGrid(); if (boardTypeSelect.value === "text") renderCustomTextGrid(); });
shuffleRandomAlphabetButton?.addEventListener("click", () => {
  const total = (Number(roomSizeSelect.value) || 5) ** 2;
  if (randomAlphabetPreviewValues.length !== total) randomAlphabetPreviewValues = createRandomAlphabetValues(total);
  else randomAlphabetPreviewValues = shuffleAlphabetValues(randomAlphabetPreviewValues);
  cloneCellValues = null;
  renderRandomAlphabetPreview(randomAlphabetPreviewValues);
  setMessage("랜덤 알파벳 배치를 다시 섞었습니다.", true);
});
applyAlphabetBulkButton?.addEventListener("click", () => { const values = extractAlphabetValues(alphabetBulkInput?.value); if (!values.length) return setMessage("입력할 알파벳을 A~Z로 입력해주세요."); cloneCellValues = null; applyCustomAlphabetValues(values); setMessage(`${Math.min(values.length, customAlphabetInputs().length)}칸을 입력했습니다.`, true); });
fillAlphabetRandomButton?.addEventListener("click", () => { cloneCellValues = null; applyCustomAlphabetValues(createRandomAlphabetValues(customAlphabetInputs().length)); setMessage("알파벳을 자동으로 채웠습니다.", true); });
shuffleAlphabetButton?.addEventListener("click", () => { const inputs = customAlphabetInputs(); const current = inputs.map((input) => normalizeAlphabetValue(input.value)); const values = current.every(Boolean) ? shuffleAlphabetValues(current) : createRandomAlphabetValues(inputs.length); cloneCellValues = null; applyCustomAlphabetValues(values); setMessage("알파벳 순서를 섞었습니다.", true); });
clearAlphabetButton?.addEventListener("click", () => { cloneCellValues = null; customAlphabetInputs().forEach((input) => { input.value = ""; input.classList.remove("invalid"); }); if (alphabetBulkInput) alphabetBulkInput.value = ""; });
applyTextBulkButton?.addEventListener("click", () => { const values = extractTextValues(textBulkInput?.value); if (!values.length) return setMessage("입력할 문구를 한 줄씩 또는 쉼표로 구분해 입력해주세요."); cloneCellValues = null; applyCustomTextValues(values); setMessage(`${Math.min(values.length, customTextInputs().length)}칸을 입력했습니다.`, true); });
clearTextButton?.addEventListener("click", () => { customTextInputs().forEach((input) => { input.value = ""; input.classList.remove("invalid"); }); if (textBulkInput) textBulkInput.value = ""; cloneCellValues = null; });
roomSearch?.addEventListener("input", () => { roomSearchTerm = roomSearch.value.trim(); renderRoomList(); });
roomStatusFilter?.addEventListener("change", () => { roomStatusValue = roomStatusFilter.value; renderRoomList(); });
roomTypeFilter?.addEventListener("change", () => { roomTypeValue = roomTypeFilter.value; renderRoomList(); });
roomSort?.addEventListener("change", () => { roomSortValue = roomSort.value; renderRoomList(); });
participantSearch.addEventListener("input", () => { participantSearchTerm = participantSearch.value.trim(); participantPage = 1; renderParticipantList(); });
roomImage.addEventListener("change", () => { const file = roomImage.files?.[0]; if (!file) return imageUploadStatus.textContent = "사진을 선택하면 빙고판 생성 시 자동으로 압축 후 업로드합니다."; if (!file.type?.startsWith("image/")) { roomImage.value = ""; imageUploadStatus.textContent = "이미지 파일만 선택할 수 있습니다."; return; } imageUploadStatus.textContent = `선택: ${file.name} (${formatBytes(file.size)}) · 방 생성 시 자동 압축`; });
document.getElementById("createRoomForm").addEventListener("submit", createRoom);
document.getElementById("logoutButton").addEventListener("click", async () => { stopChannelAccessWatcher?.(); await signOut(auth); location.replace("./index.html"); });
updateAlphabetOptions();


async function prepareRoomInviteChannel(user, profile, channelId) {
  const channelSnapshot = await getDoc(doc(db, "channels", channelId));
  if (!channelSnapshot.exists()) throw new Error("초대된 채널을 찾을 수 없습니다.");
  const channel = channelSnapshot.data();
  if (channel.status !== "active" || channel.bingoEnabled !== true) {
    throw new Error("현재 빙고를 이용할 수 없는 채널입니다.");
  }

  if (!isDeveloper(profile)) {
    const memberSnapshot = await getDoc(doc(db, "channels", channelId, "members", user.uid));
    if (!memberSnapshot.exists() || !["approved", "active"].includes(memberSnapshot.data().status)) {
      throw new Error("이 채널의 승인된 사용자만 빙고방 초대 링크를 사용할 수 있습니다.");
    }
  }

  setCurrentChannelId(user.uid, channelId);
}

function inviteRoomNameFromHash() {
  const raw = String(location.hash || "").replace(/^#/, "").trim();
  if (!raw || raw.startsWith("invite=")) return "";
  try {
    return decodeURIComponent(raw).trim();
  } catch (_) {
    return raw;
  }
}

async function resolveNamedRoomInvite(user, profile, channelName, roomName) {
  const resolvedChannel = await resolveChannelByName(channelName);
  if (!resolvedChannel?.id) throw new Error("초대된 채널을 찾을 수 없습니다.");

  await prepareRoomInviteChannel(user, profile, resolvedChannel.id);

  const inviteKey = uniqueNameKey(roomName);
  if (!inviteKey) throw new Error("빙고방 초대 링크가 올바르지 않습니다.");

  const inviteSnapshot = await getDoc(
    doc(db, "channels", resolvedChannel.id, "bingoInviteNames", inviteKey)
  );

  if (!inviteSnapshot.exists()) {
    throw new Error("초대된 빙고방을 찾을 수 없습니다. 방장이 새 초대 링크를 다시 만들어주세요.");
  }

  const invite = inviteSnapshot.data();
  if (
    !invite.roomId ||
    normalizeUniqueName(invite.roomName || "") !== normalizeUniqueName(roomName)
  ) {
    throw new Error("빙고방 초대 링크가 올바르지 않습니다.");
  }

  const roomSnapshot = await getDoc(
    doc(db, "channels", resolvedChannel.id, "bingoRooms", invite.roomId)
  );

  if (!roomSnapshot.exists()) {
    throw new Error("초대된 빙고방을 찾을 수 없습니다.");
  }

  const room = roomSnapshot.data();
  if (
    room.status !== "active" ||
    room.inviteEnabled !== true ||
    normalizeUniqueName(room.name || "") !== normalizeUniqueName(roomName)
  ) {
    throw new Error("현재 사용할 수 없는 빙고방 초대 링크입니다.");
  }

  return {
    channelId: resolvedChannel.id,
    roomId: invite.roomId
  };
}

onAuthStateChanged(auth, async (user) => {
  if (!user) return location.replace("./index.html");
  try {
    currentUser = user;
    currentProfile = await loadPlatformProfile(user);
    const inviteParams = new URLSearchParams(location.search);
    const inviteChannelName = inviteParams.get("channel")?.trim() || "";
    const inviteRoomName = inviteRoomNameFromHash();

    // 현재 초대 링크: ?channel={채널명}#방제
    // 사용자에게 채널 ID와 방 ID를 노출하지 않습니다.
    let namedInvite = null;
    if (inviteChannelName && inviteRoomName) {
      namedInvite = await resolveNamedRoomInvite(
        user,
        currentProfile,
        inviteChannelName,
        inviteRoomName
      );
    }

    // 이미 배포된 예전 ID 기반 링크는 호환용으로만 계속 처리합니다.
    const inviteChannelId = inviteParams.get("inviteChannel") || "";
    const inviteRoomId = inviteParams.get("inviteRoom") || "";
    const legacyInviteMatch = location.hash.match(/^#invite=([^:]+):([A-Za-z0-9_-]+)$/);

    if (!namedInvite && inviteChannelId && inviteRoomId) {
      await prepareRoomInviteChannel(user, currentProfile, inviteChannelId);
    } else if (!namedInvite && legacyInviteMatch) {
      await prepareRoomInviteChannel(user, currentProfile, legacyInviteMatch[1]);
    }

    currentContext = await loadCurrentChannelContext(user, currentProfile);
    setTopbarContext({ user, profile: currentProfile, context: currentContext });
    await initDeveloperChannelTools(user, currentProfile, currentContext);
    initChannelOwnerTools(user, currentProfile, currentContext);
    stopChannelAccessWatcher?.();
    stopChannelAccessWatcher = watchCurrentChannelAccess(user, currentProfile, currentContext, { feature: "bingo" });
    initChannelMemberApproval(currentContext);
    if (bingoAccess() === "none") throw new Error("이 채널에서 빙고를 이용할 권한이 없습니다.");
    loadFavorites();
    document.getElementById("userEmail").textContent = user.email || "";
    document.getElementById("currentChannelName").textContent = currentContext.channel.name || "HNSITE";
    const roleBadge = document.getElementById("roleBadge"); roleBadge.textContent = displayRole(currentContext); roleBadge.dataset.role = isDeveloper(currentProfile) ? "developer" : currentContext.member.role;
    document.getElementById("bingoPermissionBadge").textContent = `빙고 권한: ${accessLabel(bingoAccess())}${canCreateRoom() ? " · 방 생성 가능" : ""}`;
    const createButton = document.getElementById("showCreateButton");
    if (!canCreateRoom()) { createButton.disabled = true; createButton.textContent = "관리자만 생성 가능"; }
    await refreshAll();
    try { await loadSelectableUsers(); } catch (error) { console.error("채널 멤버 목록 조회 실패", error); selectableUsers = []; }
    renderParticipantList();
    if (namedInvite?.roomId) {
      history.replaceState(null, "", location.pathname);
      await joinRoom(namedInvite.roomId);
      return;
    }

    if (inviteChannelId && inviteRoomId) {
      history.replaceState(null, "", location.pathname);
      await joinRoom(inviteRoomId);
      return;
    }

    // 기존에 배포된 초대 링크도 계속 사용할 수 있도록 호환합니다.
    const legacyRoomMatch = location.hash.match(/^#invite=(?:[^:]+:)?([A-Za-z0-9_-]+)$/);
    if (legacyRoomMatch) {
      history.replaceState(null, "", location.pathname);
      await joinRoom(legacyRoomMatch[1]);
      return;
    }
    loadingPanel.classList.add("hidden"); bingoContent.classList.remove("hidden"); joinPanel.classList.remove("hidden");
  } catch (error) {
    console.error(error);
    if (["NO_CHANNEL", "CHANNEL_NOT_FOUND", "CHANNEL_INACTIVE"].includes(error.code)) return location.replace("./channels.html");
    loadingPanel.innerHTML = `<h2>빙고에 접근할 수 없습니다.</h2><p>${escapeHtml(firebaseErrorMessage(error, error.message || "빙고에 접근할 수 없습니다."))}</p><a class="service-button inline-button" href="./app.html">메인으로 돌아가기</a>`;
  }
});
