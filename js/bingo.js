import { auth, db, storage } from "./firebase-config.js";
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
  where
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  deleteObject,
  ref as storageRef,
  uploadBytes
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js";
import { BINGO_IMAGE_POLICY, compressBingoImage } from "./image-policy.js?v=7";
import { initUserManagementModal } from "./admin-modal.js?v=17";

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

let currentUser = null;
let currentProfile = null;
let currentMembership = null;
let selectableUsers = [];
let visibleRooms = [];
let selectedParticipantUids = new Set();
let participantSearchTerm = "";
let participantPage = 1;
const PARTICIPANT_PAGE_SIZE = 5;

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
    <a class="service-button" href="./bingo-room.html">현재 방으로 이동</a>
  `;
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
      actionHtml = `<a class="service-button" href="./bingo-room.html">들어가기</a>`;
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

  // membership은 남아 있는데 실제로 접근 가능한 방이 없다면 고아 참가정보입니다.
  // 참가자 제거, 방 삭제 중 페이지 이동 등 어떤 경우라도 여기서 자동 정리합니다.
  if (currentMembership) {
    const membershipRoomExists = visibleRooms.some((room) => room.id === currentMembership.roomId);

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

    location.href = "./bingo-room.html";
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
        participantUids,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      transaction.set(boardRef, {
        checkedCells: {},
        imagePath: "",
        chickenCount: 0,
        updatedAt: serverTimestamp()
      });
    });
    roomCreated = true;

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
    } else if (error?.code?.startsWith?.("storage/")) {
      setMessage("사진 업로드에 실패했습니다. Storage 규칙이 게시되었는지 확인해주세요.");
    } else if (error.message) {
      setMessage(error.message);
    } else {
      setMessage("빙고방 생성에 실패했습니다. 다시 시도해주세요.");
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
    initUserManagementModal(currentProfile);

    document.getElementById("userEmail").textContent = user.email || "";
    document.getElementById("roleBadge").textContent = roleLabel(currentProfile.role);
    document.getElementById("bingoPermissionBadge").textContent = `빙고 권한: ${accessLabel(bingoAccess())}`;

    // 빙고 핵심 상태를 먼저 복구합니다. 참가자 선택용 사용자 목록 조회 실패가
    // 빙고 전체 진입을 막지 않도록 별도로 처리합니다.
    await refreshAll();

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
      <p>${escapeHtml(error.message)}</p>
      <a class="service-button inline-button" href="./app.html">메인으로 돌아가기</a>
    `;
  }
});
