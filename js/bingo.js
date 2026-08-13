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
  where
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  deleteObject,
  ref as storageRef,
  uploadBytes
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js";
import { BINGO_IMAGE_POLICY, compressBingoImage } from "./image-policy.js?v=7";
import { initUserManagementModal } from "./admin-modal.js?v=27";
import { firebaseErrorMessage } from "./error-messages.js?v=27";

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
let currentMembership = null;
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

const roleLabel = (value) => ({
  super_admin: "최고관리자",
  admin: "관리자",
  developer: "개발자",
  user: "일반사용자"
}[value] || value);

const isManager = (profile) => ["super_admin", "admin", "developer"].includes(profile?.role);
const isDeveloper = (profile) => profile?.role === "developer";
const bingoAccess = () => (isManager(currentProfile) || isDeveloper(currentProfile)) ? "write" : (currentProfile?.bingoAccess || "none");
const accessLabel = (value) => ({ none: "권한 없음", read: "읽기", write: "쓰기" }[value] || "권한 없음");

function setMessage(text, success = false) {
  lobbyMessage.textContent = text;
  lobbyMessage.classList.toggle("success", success);
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function boardTypeLabel(room) {
  if (room?.boardType === "alphabet") return "알파벳 빙고";
  if (room?.boardType === "text") return "자유 텍스트 빙고";
  return "숫자 빙고";
}

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

function extractAlphabetValues(value) {
  return (String(value || "").toUpperCase().match(/[A-Z]/g) || []);
}

function customAlphabetInputs() {
  return [...customAlphabetGrid.querySelectorAll("input")];
}

function applyCustomAlphabetValues(values, startIndex = 0) {
  const inputs = customAlphabetInputs();
  values.forEach((value, offset) => {
    const input = inputs[startIndex + offset];
    if (!input) return;
    input.value = normalizeAlphabetValue(value);
    input.classList.remove("invalid");
  });
}

function normalizeAlphabetValue(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
}

function renderCustomAlphabetGrid() {
  const size = Number(roomSizeSelect.value) || 5;
  const total = size * size;
  const previousValues = [...customAlphabetGrid.querySelectorAll("input")].map((input) => input.value);

  customAlphabetGrid.innerHTML = "";
  customAlphabetGrid.style.setProperty("--alphabet-size", size);
  customAlphabetCount.textContent = `${total}칸`;

  const fragment = document.createDocumentFragment();
  for (let index = 0; index < total; index += 1) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "alphabet-cell-input";
    input.maxLength = 1;
    input.inputMode = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("aria-label", `${index + 1}번 칸 알파벳`);
    input.value = normalizeAlphabetValue(previousValues[index]);
    input.addEventListener("input", () => {
      cloneCellValues = null;
      input.value = normalizeAlphabetValue(input.value);
      input.classList.remove("invalid");
    });
    input.addEventListener("paste", (event) => {
      const pasted = extractAlphabetValues(event.clipboardData?.getData("text"));
      if (pasted.length <= 1) return;
      event.preventDefault();
      applyCustomAlphabetValues(pasted, index);
      customAlphabetInputs()[Math.min(total - 1, index + pasted.length - 1)]?.focus();
    });
    fragment.appendChild(input);
  }
  customAlphabetGrid.appendChild(fragment);
}


function customTextInputs() {
  return [...customTextGrid.querySelectorAll("input")];
}

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

function extractTextValues(value) {
  return String(value || "")
    .split(/[\n,\t]+/)
    .map((item) => item.trim().slice(0, 20))
    .filter(Boolean);
}

function applyCustomTextValues(values) {
  const inputs = customTextInputs();
  values.forEach((value, index) => {
    if (!inputs[index]) return;
    inputs[index].value = String(value || "").trim().slice(0, 20);
    inputs[index].classList.remove("invalid");
  });
}

function getCustomTextValues() {
  const inputs = customTextInputs();
  const values = inputs.map((input) => input.value.trim().slice(0, 20));
  let firstInvalid = null;
  inputs.forEach((input, index) => {
    const invalid = !values[index];
    input.classList.toggle("invalid", invalid);
    if (invalid && !firstInvalid) firstInvalid = input;
  });
  if (firstInvalid) {
    firstInvalid.focus();
    return null;
  }
  return values;
}

function updateAlphabetOptions() {
  const isAlphabet = boardTypeSelect.value === "alphabet";
  const isText = boardTypeSelect.value === "text";
  const isCustom = isAlphabet && alphabetModeSelect.value === "custom";

  alphabetOptions.classList.toggle("hidden", !isAlphabet);
  textOptions?.classList.toggle("hidden", !isText);
  customAlphabetPanel.classList.toggle("hidden", !isCustom);
  alphabetModeHelp.textContent = alphabetModeSelect.value === "custom"
    ? "직접 지정한 알파벳이 모든 참가자에게 같은 순서로 표시됩니다."
    : "A~Z를 섞어 배치합니다. 27칸 이상에서는 알파벳이 반복됩니다.";

  if (isCustom) renderCustomAlphabetGrid();
  if (isText) renderCustomTextGrid();
}

function getCustomAlphabetValues() {
  const inputs = [...customAlphabetGrid.querySelectorAll("input")];
  const values = inputs.map((input) => normalizeAlphabetValue(input.value));
  let firstInvalid = null;

  inputs.forEach((input, index) => {
    const invalid = !values[index];
    input.classList.toggle("invalid", invalid);
    if (invalid && !firstInvalid) firstInvalid = input;
  });

  if (firstInvalid) {
    firstInvalid.focus();
    return null;
  }
  return values;
}

async function loadProfile(user) {
  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) throw new Error("등록되지 않은 계정입니다.");

  const profile = snap.data();
  if (profile.status !== "approved") throw new Error("승인되지 않았거나 사용중지된 계정입니다.");

  const access = (isManager(profile) || isDeveloper(profile)) ? "write" : (profile.bingoAccess || "none");
  if (access === "none") throw new Error("빙고에 접근할 권한이 없습니다.");

  return { uid: user.uid, ...profile };
}

async function loadMembership() {
  const membershipRef = doc(db, "bingoMemberships", currentUser.uid);
  const membershipSnap = await getDoc(membershipRef);
  if (!membershipSnap.exists()) return null;

  const membership = { id: membershipSnap.id, ...membershipSnap.data() };

  if (!membership.roomId) {
    await deleteDoc(membershipRef);
    return null;
  }

  // 여기서는 room 문서를 직접 읽지 않습니다.
  // 삭제된 room을 getDoc()으로 읽으면 Security Rules의 resource.data 조건 때문에
  // permission-denied가 발생할 수 있습니다. refreshAll()에서 접근 가능한 방 목록과
  // 비교한 뒤 고아 membership을 정리합니다.
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
    const aClosed = a.status === "closed" ? 1 : 0;
    const bClosed = b.status === "closed" ? 1 : 0;
    if (aClosed !== bClosed) return aClosed - bClosed;
    const aMillis = a.updatedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0;
    const bMillis = b.updatedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0;
    return bMillis - aMillis;
  });
}

function isClosedRoom(room) {
  return room?.status === "closed";
}

function progressFromRoomBoard(room, board) {
  const size = Number(room?.size) || 0;
  const total = size * size;
  const checked = board?.checkedCells || {};
  const selected = new Set();
  for (let index = 0; index < total; index += 1) {
    if (checked[String(index)] === true) selected.add(index);
  }
  let completed = 0;
  for (let row = 0; row < size; row += 1) {
    if (Array.from({ length: size }, (_, col) => row * size + col).every((i) => selected.has(i))) completed += 1;
  }
  for (let col = 0; col < size; col += 1) {
    if (Array.from({ length: size }, (_, row) => row * size + col).every((i) => selected.has(i))) completed += 1;
  }
  if (size && Array.from({ length: size }, (_, i) => i * size + i).every((i) => selected.has(i))) completed += 1;
  if (size && Array.from({ length: size }, (_, i) => i * size + (size - 1 - i)).every((i) => selected.has(i))) completed += 1;
  return { completed, checked: selected.size, total, chicken: Math.max(0, Number(board?.chickenCount) || 0) };
}

function formatRoomTime(value) {
  const date = value?.toDate?.();
  if (!date) return "-";
  return new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

async function loadRoomSummaries() {
  const entries = await Promise.all(visibleRooms.map(async (room) => {
    try {
      const snap = await getDoc(doc(db, "bingoBoards", room.id));
      return [room.id, snap.exists() ? { ...progressFromRoomBoard(room, snap.data()), cellValues: snap.data().cellValues || [] } : null];
    } catch (error) {
      console.error("빙고방 진행 정보 조회 실패", room.id, error);
      return [room.id, null];
    }
  }));
  roomSummaries = new Map(entries);
}

function openRoom(roomId, archived = false) {
  if (archived) sessionStorage.setItem("churangArchiveRoomId", roomId);
  else sessionStorage.removeItem("churangArchiveRoomId");
  location.href = "./bingo-room.html";
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
      <p>${room?.size || "-"} × ${room?.size || "-"} · ${boardTypeLabel(room)}</p>
    </div>
    <button id="openCurrentRoomButton" class="service-button" type="button">현재 방으로 이동</button>
  `;
  document.getElementById("openCurrentRoomButton")?.addEventListener("click", () => openRoom(room.id, false));
}

function matchesParticipantSearch(user, term) {
  if (!term) return true;
  const haystack = `${user.name || ""} ${user.email || ""}`.toLocaleLowerCase("ko");
  return haystack.includes(term.toLocaleLowerCase("ko"));
}

function renderPagination(container, totalItems, page, onChange) {
  container.innerHTML = "";
  const totalPages = Math.max(1, Math.ceil(totalItems / PARTICIPANT_PAGE_SIZE));
  if (totalItems <= PARTICIPANT_PAGE_SIZE) return;

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

function renderParticipantList() {
  if (bingoAccess() !== "write") {
    participantList.textContent = "빙고 쓰기 권한이 있어야 방을 생성할 수 있습니다.";
    participantPagination.innerHTML = "";
    return;
  }

  const filtered = selectableUsers.filter((user) => matchesParticipantSearch(user, participantSearchTerm));
  const totalPages = Math.max(1, Math.ceil(filtered.length / PARTICIPANT_PAGE_SIZE));
  participantPage = Math.min(participantPage, totalPages);
  participantSearchCount.textContent = `${filtered.length}명`;

  if (!filtered.length) {
    participantList.innerHTML = '<div class="participant-manage-empty participant-list-empty">검색 결과가 없습니다.</div>';
    participantPagination.innerHTML = "";
    return;
  }

  const start = (participantPage - 1) * PARTICIPANT_PAGE_SIZE;
  const pageUsers = filtered.slice(start, start + PARTICIPANT_PAGE_SIZE);
  participantList.innerHTML = "";

  pageUsers.forEach((user) => {
    const label = document.createElement("label");
    label.className = "participant-option";
    const checked = selectedParticipantUids.has(user.uid) ? "checked" : "";
    label.innerHTML = `
      <input type="checkbox" name="participantUid" value="${escapeAttribute(user.uid)}" ${checked} />
      <span>
        <strong>${escapeHtml(user.name || user.email || "사용자")}</strong>
        <small>${escapeHtml(user.email || "")}</small>
      </span>
    `;
    const checkbox = label.querySelector("input");
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedParticipantUids.add(user.uid);
      else selectedParticipantUids.delete(user.uid);
    });
    participantList.appendChild(label);
  });

  renderPagination(participantPagination, filtered.length, participantPage, (nextPage) => {
    participantPage = nextPage;
    renderParticipantList();
  });
}

function roomStatusText(room) {
  if (isClosedRoom(room)) return "종료";
  if (room.ownerUid === currentUser.uid) return "내가 만든 방";
  if (currentMembership?.roomId === room.id) return "현재 참가 중";
  return "초대받은 방";
}


function favoriteStorageKey() {
  return `churangFavoriteRooms:${currentUser?.uid || "guest"}`;
}

function loadFavorites() {
  try { favoriteRoomIds = new Set(JSON.parse(localStorage.getItem(favoriteStorageKey()) || "[]")); }
  catch (_) { favoriteRoomIds = new Set(); }
}

function saveFavorites() {
  localStorage.setItem(favoriteStorageKey(), JSON.stringify([...favoriteRoomIds]));
}

function toggleFavorite(roomId) {
  if (favoriteRoomIds.has(roomId)) favoriteRoomIds.delete(roomId);
  else favoriteRoomIds.add(roomId);
  saveFavorites();
  renderRoomList();
}

function filteredRoomsForList() {
  const term = roomSearchTerm.toLocaleLowerCase("ko");
  return visibleRooms.filter((room) => {
    if (roomStatusValue !== "all" && (isClosedRoom(room) ? "closed" : "active") !== roomStatusValue) return false;
    if (roomTypeValue !== "all" && (room.boardType || "number") !== roomTypeValue) return false;
    if (term && !`${room.name || ""} ${room.ownerName || ""}`.toLocaleLowerCase("ko").includes(term)) return false;
    return true;
  }).sort((a, b) => {
    const af = favoriteRoomIds.has(a.id) ? 1 : 0;
    const bf = favoriteRoomIds.has(b.id) ? 1 : 0;
    if (af !== bf) return bf - af;
    if (roomSortValue === "name") return (a.name || "").localeCompare(b.name || "", "ko");
    const av = roomSortValue === "created" ? a.createdAt?.toMillis?.() || 0 : a.updatedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0;
    const bv = roomSortValue === "created" ? b.createdAt?.toMillis?.() || 0 : b.updatedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0;
    return bv - av;
  });
}

function cloneRoomToForm(room) {
  if (currentMembership) {
    setMessage("현재 참여 중인 방을 먼저 종료하거나 나간 뒤 복제할 수 있습니다.");
    return;
  }
  cloneSourceRoomId = room.id;
  cloneCellValues = [...(roomSummaries.get(room.id)?.cellValues || [])];
  document.getElementById("roomName").value = `${room.name || "빙고"} 복사`.slice(0, 30);
  roomSizeSelect.value = String(room.size || 5);
  boardTypeSelect.value = room.boardType || "number";
  alphabetModeSelect.value = room.alphabetMode === "custom" ? "custom" : "random";
  selectedParticipantUids.clear();
  updateAlphabetOptions();
  if (room.boardType === "alphabet" && room.alphabetMode === "custom") applyCustomAlphabetValues(cloneCellValues);
  if (room.boardType === "text") applyCustomTextValues(cloneCellValues);
  renderParticipantList();
  createPanel.classList.remove("hidden");
  joinPanel.classList.add("hidden");
  setMessage("방 설정을 복사했습니다. 참가자와 사진은 복사되지 않습니다. 확인 후 새 방을 생성해주세요.", true);
  createPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function closeExpiredVisibleRooms() {
  const now = Date.now();
  let changed = false;
  for (const room of visibleRooms) {
    if (isClosedRoom(room)) continue;
    const due = room.autoCloseAt?.toMillis?.();
    if (!due || due > now) continue;
    try {
      await updateDoc(doc(db, "bingoRooms", room.id), {
        status: "closed",
        closedAt: serverTimestamp(),
        closedByUid: "AUTO",
        updatedAt: serverTimestamp()
      });
      room.status = "closed";
      changed = true;
    } catch (error) {
      console.error("자동 종료 처리 실패", room.id, error);
    }
  }
  return changed;
}

async function writeRoomAudit(action, room, detail = "") {
  try {
    await addDoc(collection(db, "roomAuditLogs"), {
      actorUid: currentUser.uid,
      actorName: currentProfile.name || currentUser.email || "사용자",
      action,
      roomId: room.id || room,
      roomName: room.name || document.getElementById("roomName")?.value || "빙고방",
      detail: String(detail).slice(0, 500),
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.error("빙고방 이력 저장 실패", error);
  }
}

function renderRoomList() {
  const listedRooms = filteredRoomsForList();
  if (!listedRooms.length) {
    roomList.innerHTML = `<div class="empty-list-box">현재 확인할 수 있는 빙고방이 없습니다.</div>`;
    return;
  }

  roomList.innerHTML = "";

  listedRooms.forEach((room) => {
    const isOwner = room.ownerUid === currentUser.uid;
    const isCurrent = currentMembership?.roomId === room.id && !isClosedRoom(room);
    const closed = isClosedRoom(room);
    const summary = roomSummaries.get(room.id);
    const card = document.createElement("article");
    card.className = `bingo-room-item${isCurrent ? " current" : ""}${closed ? " closed" : ""}`;

    let actionHtml = "";
    if (closed) {
      actionHtml = `<button class="secondary open-archive-room-button" data-room-id="${escapeAttribute(room.id)}" type="button">결과 보기</button>`;
    } else if (isCurrent) {
      actionHtml = `<button class="service-button open-current-room-button" data-room-id="${escapeAttribute(room.id)}" type="button">들어가기</button>`;
    } else if (isOwner) {
      actionHtml = `<span class="room-blocked-text">현재 참가정보를 확인해주세요.</span>`;
    } else if (currentMembership) {
      const reason = currentMembership.role === "owner"
        ? "현재 방을 종료하거나 삭제한 후 참가할 수 있습니다."
        : "현재 방에서 나간 후 참가할 수 있습니다.";
      actionHtml = `<button class="secondary" type="button" disabled>${reason}</button>`;
    } else {
      actionHtml = `<button class="join-room-button" data-room-id="${escapeAttribute(room.id)}" type="button">참가하기</button>`;
    }

    const participantCount = (room.participantUids?.length || 0) + 1;
    const progressText = summary
      ? `완성 ${summary.completed}줄 · ${summary.checked}/${summary.total}칸 · ${summary.chicken}치킨`
      : "진행 정보 확인 불가";

    card.innerHTML = `
      <div class="bingo-room-item-main">
        <div class="room-card-badges">
          <button class="room-favorite-button ${favoriteRoomIds.has(room.id) ? "active" : ""}" data-room-id="${escapeAttribute(room.id)}" type="button" aria-label="즐겨찾기">${favoriteRoomIds.has(room.id) ? "★" : "☆"}</button>
          <span class="room-state-badge">${roomStatusText(room)}</span>
          <span class="room-type-badge">${boardTypeLabel(room)}</span>
        </div>
        <h3>${escapeHtml(room.name)}</h3>
        <p>${room.size} × ${room.size} · 참가자 ${participantCount}명</p>
        <div class="room-card-detail">
          <span>${progressText}</span>
          <span>최근 수정 ${formatRoomTime(room.updatedAt)}</span>
        </div>
      </div>
      <div class="bingo-room-item-action">${actionHtml}<button class="secondary compact-button clone-room-button" data-room-id="${escapeAttribute(room.id)}" type="button">복제</button></div>
    `;

    roomList.appendChild(card);
  });

  roomList.querySelectorAll(".join-room-button").forEach((button) => {
    button.addEventListener("click", () => joinRoom(button.dataset.roomId));
  });
  roomList.querySelectorAll(".open-current-room-button").forEach((button) => {
    button.addEventListener("click", () => openRoom(button.dataset.roomId, false));
  });
  roomList.querySelectorAll(".open-archive-room-button").forEach((button) => {
    button.addEventListener("click", () => openRoom(button.dataset.roomId, true));
  });
  roomList.querySelectorAll(".room-favorite-button").forEach((button) => {
    button.addEventListener("click", () => toggleFavorite(button.dataset.roomId));
  });
  roomList.querySelectorAll(".clone-room-button").forEach((button) => {
    const room = visibleRooms.find((item) => item.id === button.dataset.roomId);
    button.addEventListener("click", () => room && cloneRoomToForm(room));
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
      if (["super_admin", "admin", "developer"].includes(user.role)) return true;
      return ["read", "write"].includes(user.bingoAccess);
    })
    .sort((a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || "", "ko"));
}

async function refreshAll() {
  currentMembership = await loadMembership();
  await loadVisibleRooms();
  await closeExpiredVisibleRooms();
  await loadRoomSummaries();

  // membership은 남아 있는데 방이 삭제되었거나 종료됐다면 고아 참가정보로 정리합니다.
  if (currentMembership) {
    const membershipRoom = visibleRooms.find((room) => room.id === currentMembership.roomId);
    const membershipRoomExists = Boolean(membershipRoom) && !isClosedRoom(membershipRoom);

    if (!membershipRoomExists) {
      const membershipRef = doc(db, "bingoMemberships", currentUser.uid);
      try {
        await deleteDoc(membershipRef);
        currentMembership = null;
      } catch (cleanupError) {
        console.error("고아 빙고 참가정보 정리 실패", cleanupError);
        throw new Error("이전 빙고방 참가정보가 남아 있습니다. Firebase에서 참가정보를 한 번 정리해주세요.");
      }
    }
  }

  renderCurrentRoom();
  renderRoomList();
}

async function joinRoom(roomId) {
  setMessage("");

  if (currentMembership) {
    setMessage(currentMembership.role === "owner"
      ? "현재 진행 중인 빙고방을 종료하거나 삭제한 후 다른 방에 참가할 수 있습니다."
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
      if (room.status === "closed") throw new Error("ROOM_CLOSED");
      const participants = room.participantUids || [];
      const invited = participants.includes(currentUser.uid);
      if (!invited && room.inviteEnabled !== true) throw new Error("NOT_INVITED");
      if (!invited) {
        if (participants.length >= 20) throw new Error("ROOM_FULL");
        transaction.update(roomRef, { participantUids: [...participants, currentUser.uid], updatedAt: serverTimestamp() });
      }

      transaction.set(membershipRef, {
        roomId,
        role: "participant",
        joinedAt: serverTimestamp()
      });
    });

    location.href = "./bingo-room.html";
  } catch (error) {
    console.error(error);
    if (error.message === "ALREADY_IN_ROOM") {
      setMessage("이미 다른 빙고방에 참가 중입니다.");
    } else if (error.message === "NOT_INVITED") {
      setMessage("현재 이 방의 참가자로 지정되어 있지 않습니다.");
    } else if (error.message === "ROOM_CLOSED") {
      setMessage("이미 종료된 빙고방입니다. 결과 보기만 가능합니다.");
    } else if (error.message === "ROOM_FULL") {
      setMessage("참가자 정원이 가득 찼습니다.");
    } else {
      setMessage(firebaseErrorMessage(error, "방 참가에 실패했습니다. 다시 시도해주세요."));
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
      ? "이미 진행 중인 빙고방이 있습니다. 기존 방을 종료하거나 삭제한 후 새 방을 만들 수 있습니다."
      : "현재 다른 빙고방에 참가 중입니다. 기존 방을 나간 후 새 방을 만들 수 있습니다.");
    return;
  }

  const name = document.getElementById("roomName").value.trim();
  const size = Number(roomSizeSelect.value);
  const boardType = ["alphabet", "text"].includes(boardTypeSelect.value) ? boardTypeSelect.value : "number";
  const alphabetMode = boardType === "alphabet"
    ? (alphabetModeSelect.value === "custom" ? "custom" : "random")
    : "none";
  const imageFile = roomImage.files?.[0] || null;
  const participantUids = [...selectedParticipantUids];

  if (!name) {
    setMessage("빙고 이름을 입력해주세요.");
    return;
  }

  const allowedSizes = [3, 4, 5, 6, 7, 8, 9, 10];
  if (!allowedSizes.includes(size)) {
    setMessage("올바른 빙고판 크기를 선택해주세요.");
    return;
  }

  let cellValues = [];
  if (cloneCellValues && cloneCellValues.length === size * size && boardType !== "number") {
    cellValues = [...cloneCellValues];
  } else if (boardType === "alphabet") {
    if (alphabetMode === "custom") {
      cellValues = getCustomAlphabetValues();
      if (!cellValues) {
        setMessage("알파벳 직접 지정 칸을 모두 입력해주세요.");
        return;
      }
    } else {
      cellValues = createRandomAlphabetValues(size * size);
    }
  } else if (boardType === "text") {
    cellValues = getCustomTextValues();
    if (!cellValues) {
      setMessage("자유 텍스트 빙고의 모든 칸을 입력해주세요.");
      return;
    }
  }

  let autoCloseAt = null;
  if (autoCloseAtInput?.value) {
    const date = new Date(autoCloseAtInput.value);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) {
      setMessage("자동 종료 시간은 현재보다 이후로 지정해주세요.");
      return;
    }
    autoCloseAt = Timestamp.fromDate(date);
  }

  createRoomButton.disabled = true;
  const roomRef = doc(collection(db, "bingoRooms"));
  const boardRef = doc(db, "bingoBoards", roomRef.id);
  const membershipRef = doc(db, "bingoMemberships", currentUser.uid);
  const imageRef = storageRef(storage, `bingoImages/${roomRef.id}/${BINGO_IMAGE_POLICY.fixedFileName}`);
  let roomCreated = false;
  let compressedImage = null;

  try {
    if (imageFile) {
      createRoomButton.textContent = "사진 압축 중...";
      imageUploadStatus.textContent = "사진을 자동으로 압축하고 있습니다...";
      compressedImage = await compressBingoImage(imageFile);
      imageUploadStatus.textContent = `압축 완료: ${formatBytes(compressedImage.size)} (최대 2MB)`;
    }

    createRoomButton.textContent = "방 생성 중...";
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
        boardType,
        alphabetMode,
        participantUids,
        status: "active",
        closedAt: null,
        closedByUid: "",
        autoCloseAt,
        inviteEnabled: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      transaction.set(boardRef, {
        checkedCells: {},
        imagePath: "",
        chickenCount: 0,
        cellValues,
        lastAction: null,
        updatedAt: serverTimestamp()
      });
    });
    roomCreated = true;
    await writeRoomAudit(cloneSourceRoomId ? "room_clone" : "room_create", { id: roomRef.id, name }, cloneSourceRoomId ? `원본 방 ${cloneSourceRoomId}` : `${boardTypeLabel({ boardType })} ${size}×${size}`);

    if (compressedImage) {
      createRoomButton.textContent = "사진 업로드 중...";
      await uploadBytes(imageRef, compressedImage, {
        contentType: BINGO_IMAGE_POLICY.outputType,
        cacheControl: "private,max-age=3600"
      });
      imageUploadStatus.textContent = "사진 업로드가 완료됐습니다.";
    }

    location.href = "./bingo-room.html";
  } catch (error) {
    console.error(error);

    if (roomCreated) {
      try {
        if (compressedImage) await deleteObject(imageRef);
      } catch (cleanupError) {
        if (cleanupError?.code !== "storage/object-not-found") console.error(cleanupError);
      }
      try { await deleteDoc(boardRef); } catch (cleanupError) { console.error(cleanupError); }
      try { await deleteDoc(roomRef); } catch (cleanupError) { console.error(cleanupError); }
      try { await deleteDoc(membershipRef); } catch (cleanupError) { console.error(cleanupError); }
    }

    if (error.message === "ALREADY_IN_ROOM") {
      setMessage("이미 다른 빙고방에 참여 중입니다.");
    } else {
      setMessage(firebaseErrorMessage(error, error.message || "빙고방 생성에 실패했습니다. 다시 시도해주세요."));
    }
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
      ? "이미 진행 중인 방이 있습니다. 기존 방을 종료하거나 삭제한 후 새 방을 만들 수 있습니다."
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
    setMessage(firebaseErrorMessage(error, "방 목록을 새로고침하지 못했습니다."));
  }
});


boardTypeSelect.addEventListener("change", () => { cloneCellValues = null; updateAlphabetOptions(); });
alphabetModeSelect.addEventListener("change", () => { cloneCellValues = null; updateAlphabetOptions(); });
roomSizeSelect.addEventListener("change", () => {
  cloneCellValues = null;
  if (boardTypeSelect.value === "alphabet" && alphabetModeSelect.value === "custom") renderCustomAlphabetGrid();
  if (boardTypeSelect.value === "text") renderCustomTextGrid();
});

applyAlphabetBulkButton?.addEventListener("click", () => {
  const values = extractAlphabetValues(alphabetBulkInput?.value);
  if (!values.length) {
    setMessage("입력할 알파벳을 A~Z로 입력해주세요.");
    return;
  }
  cloneCellValues = null;
  applyCustomAlphabetValues(values);
  setMessage(`${Math.min(values.length, customAlphabetInputs().length)}칸을 입력했습니다.`, true);
});

fillAlphabetRandomButton?.addEventListener("click", () => {
  cloneCellValues = null;
  applyCustomAlphabetValues(createRandomAlphabetValues(customAlphabetInputs().length));
  setMessage("알파벳을 자동으로 채웠습니다.", true);
});

shuffleAlphabetButton?.addEventListener("click", () => {
  const inputs = customAlphabetInputs();
  const current = inputs.map((input) => normalizeAlphabetValue(input.value));
  const values = current.every(Boolean) ? shuffleAlphabetValues(current) : createRandomAlphabetValues(inputs.length);
  cloneCellValues = null;
  applyCustomAlphabetValues(values);
  setMessage(current.every(Boolean) ? "현재 알파벳 순서를 섞었습니다." : "빈칸이 있어 A~Z로 자동 채운 뒤 섞었습니다.", true);
});

clearAlphabetButton?.addEventListener("click", () => {
  cloneCellValues = null;
  customAlphabetInputs().forEach((input) => {
    input.value = "";
    input.classList.remove("invalid");
  });
  if (alphabetBulkInput) alphabetBulkInput.value = "";
  setMessage("알파벳 입력을 비웠습니다.", true);
});


applyTextBulkButton?.addEventListener("click", () => {
  const values = extractTextValues(textBulkInput?.value);
  if (!values.length) {
    setMessage("입력할 문구를 한 줄씩 또는 쉼표로 구분해 입력해주세요.");
    return;
  }
  cloneCellValues = null;
  applyCustomTextValues(values);
  setMessage(`${Math.min(values.length, customTextInputs().length)}칸을 입력했습니다.`, true);
});

clearTextButton?.addEventListener("click", () => {
  customTextInputs().forEach((input) => { input.value = ""; input.classList.remove("invalid"); });
  if (textBulkInput) textBulkInput.value = "";
  cloneCellValues = null;
  setMessage("자유 텍스트 입력을 비웠습니다.", true);
});

roomSearch?.addEventListener("input", () => { roomSearchTerm = roomSearch.value.trim(); renderRoomList(); });
roomStatusFilter?.addEventListener("change", () => { roomStatusValue = roomStatusFilter.value; renderRoomList(); });
roomTypeFilter?.addEventListener("change", () => { roomTypeValue = roomTypeFilter.value; renderRoomList(); });
roomSort?.addEventListener("change", () => { roomSortValue = roomSort.value; renderRoomList(); });

participantSearch.addEventListener("input", () => {
  participantSearchTerm = participantSearch.value.trim();
  participantPage = 1;
  renderParticipantList();
});

roomImage.addEventListener("change", () => {
  const file = roomImage.files?.[0];
  if (!file) {
    imageUploadStatus.textContent = "사진을 선택하면 빙고판 생성 시 자동으로 압축 후 업로드합니다.";
    return;
  }
  if (!file.type?.startsWith("image/")) {
    roomImage.value = "";
    imageUploadStatus.textContent = "이미지 파일만 선택할 수 있습니다.";
    return;
  }
  imageUploadStatus.textContent = `선택: ${file.name} (${formatBytes(file.size)}) · 방 생성 시 자동 압축`;
});

document.getElementById("createRoomForm").addEventListener("submit", createRoom);

document.getElementById("logoutButton").addEventListener("click", async () => {
  sessionStorage.removeItem("churangArchiveRoomId");
  await signOut(auth);
  location.replace("./index.html");
});

updateAlphabetOptions();

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.replace("./index.html");
    return;
  }

  try {
    currentUser = user;
    currentProfile = await loadProfile(user);
    loadFavorites();
    initUserManagementModal(currentProfile);

    document.getElementById("userEmail").textContent = user.email || "";
    const roleBadge = document.getElementById("roleBadge");
    roleBadge.textContent = roleLabel(currentProfile.role);
    roleBadge.dataset.role = currentProfile.role;
    document.getElementById("bingoPermissionBadge").textContent = `빙고 권한: ${accessLabel(bingoAccess())}`;

    // 빙고 핵심 상태를 먼저 복구합니다. 참가자 선택용 사용자 목록 조회 실패가
    // 빙고 전체 진입을 막지 않도록 별도로 처리합니다.
    await refreshAll();

    const inviteMatch = location.hash.match(/^#invite=([A-Za-z0-9_-]+)$/);
    if (inviteMatch && !currentMembership) {
      const invitedRoomId = inviteMatch[1];
      history.replaceState(null, "", location.pathname);
      await joinRoom(invitedRoomId);
      return;
    }

    try {
      await loadSelectableUsers();
    } catch (userListError) {
      console.error("참가자 선택 목록 조회 실패", userListError);
      selectableUsers = [];
      setMessage("빙고는 사용할 수 있지만 참가자 목록을 불러오지 못했습니다.");
    }
    renderParticipantList();

    loadingPanel.classList.add("hidden");
    bingoContent.classList.remove("hidden");
    joinPanel.classList.remove("hidden");
  } catch (error) {
    console.error(error);
    loadingPanel.innerHTML = `
      <h2>빙고에 접근할 수 없습니다.</h2>
      <p>${escapeHtml(firebaseErrorMessage(error, error.message || "빙고에 접근할 수 없습니다."))}</p>
      <a class="service-button inline-button" href="./app.html">메인으로 돌아가기</a>
    `;
  }
});
