import { db, storage } from "./firebase-config.js";
import {
  doc,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytes
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js";
import { firebaseErrorMessage } from "./error-messages.js";
import { isDeveloper } from "./channel-context.js";
import {
  CHANNEL_PROFILE_IMAGE_POLICY,
  compressChannelProfileImage
} from "./image-policy.js";
import {
  buildChannelShareUrl,
  channelNameRegistryRef,
  isChannelNameAvailable,
  uniqueNameKey,
  validateChannelName
} from "./name-registry.js";

let currentUser = null;
let currentProfile = null;
let currentContext = null;
let checkedChannelNameKey = "";
let selectedProfileBlob = null;
let selectedProfilePreviewUrl = "";

function isOwner() {
  return !isDeveloper(currentProfile) && currentContext?.member?.role === "owner";
}

function canShare() {
  return !isDeveloper(currentProfile) && ["owner", "admin"].includes(currentContext?.member?.role);
}

function ensureButtons() {
  const nav = document.querySelector(".topbar-user");
  if (!nav || !canShare()) return;

  if (isOwner() && !document.getElementById("channelOwnerSettingsButton")) {
    const button = document.createElement("button");
    button.id = "channelOwnerSettingsButton";
    button.type = "button";
    button.className = "topbar-link channel-owner-settings-button";
    button.textContent = "채널 설정";
    const email = nav.querySelector(".topbar-email");
    nav.insertBefore(button, email || nav.firstChild);
    button.addEventListener("click", openSettingsModal);
  }

  if (!document.getElementById("channelShareButton")) {
    const button = document.createElement("button");
    button.id = "channelShareButton";
    button.type = "button";
    button.className = "topbar-link channel-share-button";
    button.textContent = "채널 공유";
    const email = nav.querySelector(".topbar-email");
    nav.insertBefore(button, email || nav.firstChild);
    button.addEventListener("click", openShareModal);
  }
}

function ensureShareModal() {
  let modal = document.getElementById("channelShareModal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "channelShareModal";
  modal.className = "admin-modal hidden";
  modal.innerHTML = `
    <div class="admin-modal-backdrop" data-close-channel-share></div>
    <section class="admin-modal-dialog channel-share-dialog" role="dialog" aria-modal="true" aria-labelledby="channelShareTitle">
      <div class="admin-modal-header">
        <div>
          <p class="eyebrow">CHANNEL SHARE</p>
          <h2 id="channelShareTitle">채널 공유</h2>
          <p class="muted">링크를 받은 사용자는 로그인 후 이 채널에 가입 신청할 수 있습니다.</p>
        </div>
        <button class="modal-close-button" data-close-channel-share type="button" aria-label="닫기">×</button>
      </div>
      <div class="channel-share-link-row">
        <input id="channelShareLink" type="text" readonly />
        <button id="copyChannelShareLink" type="button">링크 복사</button>
      </div>
      <p id="channelShareMessage" class="message"></p>
    </section>`;
  document.body.appendChild(modal);
  modal.querySelectorAll("[data-close-channel-share]").forEach((element) => element.addEventListener("click", closeShareModal));
  modal.querySelector("#copyChannelShareLink").addEventListener("click", copyShareLink);
  return modal;
}

function openShareModal() {
  if (!canShare()) return;
  const modal = ensureShareModal();
  modal.querySelector("#channelShareTitle").textContent = `${currentContext.channel.name || "채널"} 공유`;
  modal.querySelector("#channelShareLink").value = buildChannelShareUrl(currentContext.channel.name || "");
  const message = modal.querySelector("#channelShareMessage");
  message.textContent = "";
  message.classList.remove("success");
  modal.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function closeShareModal() {
  document.getElementById("channelShareModal")?.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

async function copyShareLink() {
  const modal = ensureShareModal();
  const link = modal.querySelector("#channelShareLink").value;
  const message = modal.querySelector("#channelShareMessage");
  try {
    await navigator.clipboard.writeText(link);
    message.textContent = "채널 공유 링크를 복사했습니다.";
    message.classList.add("success");
  } catch (error) {
    console.error("채널 링크 복사 실패", error);
    modal.querySelector("#channelShareLink").select();
    message.textContent = "링크를 선택했습니다. 직접 복사해주세요.";
    message.classList.remove("success");
  }
}

function revokeSelectedPreviewUrl() {
  if (!selectedProfilePreviewUrl) return;
  URL.revokeObjectURL(selectedProfilePreviewUrl);
  selectedProfilePreviewUrl = "";
}

function resetSelectedProfileImage() {
  revokeSelectedPreviewUrl();
  selectedProfileBlob = null;
}

function renderProfilePreview(url = "") {
  const modal = ensureSettingsModal();
  const image = modal.querySelector("#channelOwnerPhotoPreview");
  const empty = modal.querySelector("#channelOwnerPhotoEmpty");
  if (url) {
    image.src = url;
    image.classList.remove("hidden");
    empty.classList.add("hidden");
  } else {
    image.removeAttribute("src");
    image.classList.add("hidden");
    empty.classList.remove("hidden");
  }
}

function ensureSettingsModal() {
  let modal = document.getElementById("channelOwnerSettingsModal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "channelOwnerSettingsModal";
  modal.className = "admin-modal hidden";
  modal.innerHTML = `
    <div class="admin-modal-backdrop" data-close-channel-owner-settings></div>
    <section class="admin-modal-dialog channel-owner-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="channelOwnerSettingsTitle">
      <div class="admin-modal-header">
        <div>
          <p class="eyebrow">CHANNEL SETTINGS</p>
          <h2 id="channelOwnerSettingsTitle">채널 설정</h2>
          <p class="muted">채널 이름, 프로필 사진과 공유 링크를 관리합니다.</p>
        </div>
        <button class="modal-close-button" data-close-channel-owner-settings type="button" aria-label="닫기">×</button>
      </div>
      <form id="channelOwnerSettingsForm" class="channel-owner-settings-form">
        <label>
          채널 이름
          <div class="unique-name-row">
            <input id="channelOwnerName" type="text" maxlength="40" autocomplete="off" required />
            <button id="channelOwnerNameCheck" class="secondary" type="button">중복확인</button>
          </div>
          <small id="channelOwnerNameCheckMessage" class="unique-name-message"></small>
        </label>

        <div class="channel-profile-photo-field">
          <span class="channel-profile-photo-label">채널 프로필 사진</span>
          <div class="channel-profile-photo-editor">
            <div class="channel-profile-photo-preview-wrap">
              <img id="channelOwnerPhotoPreview" class="channel-profile-photo-preview hidden" alt="채널 프로필 사진 미리보기" />
              <div id="channelOwnerPhotoEmpty" class="channel-profile-photo-preview channel-profile-photo-empty">H</div>
            </div>
            <div class="channel-profile-photo-controls">
              <label class="secondary channel-profile-photo-select" for="channelOwnerPhotoInput">사진 선택</label>
              <input id="channelOwnerPhotoInput" class="visually-hidden" type="file" accept="image/*" />
              <small id="channelOwnerPhotoStatus" class="muted">가운데 기준 정사각형으로 자동 조정되며 최대 1MB로 압축됩니다.</small>
            </div>
          </div>
        </div>

        <label>
          공유 링크
          <div class="channel-share-link-row">
            <input id="channelOwnerShareLink" type="text" readonly />
            <button id="channelOwnerCopyLink" class="secondary" type="button">복사</button>
          </div>
        </label>
        <p id="channelOwnerSettingsMessage" class="message"></p>
        <div class="channel-modal-actions">
          <button class="secondary" data-close-channel-owner-settings type="button">취소</button>
          <button id="channelOwnerSettingsSave" type="submit">저장</button>
        </div>
      </form>
    </section>`;
  document.body.appendChild(modal);
  modal.querySelectorAll("[data-close-channel-owner-settings]").forEach((element) => element.addEventListener("click", closeSettingsModal));
  modal.querySelector("#channelOwnerName").addEventListener("input", updateOwnerNameInput);
  modal.querySelector("#channelOwnerNameCheck").addEventListener("click", checkChannelName);
  modal.querySelector("#channelOwnerPhotoInput").addEventListener("change", handleProfilePhotoSelection);
  modal.querySelector("#channelOwnerCopyLink").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(modal.querySelector("#channelOwnerShareLink").value);
      const message = modal.querySelector("#channelOwnerSettingsMessage");
      message.textContent = "채널 공유 링크를 복사했습니다.";
      message.classList.add("success");
    } catch (_) {}
  });
  modal.querySelector("#channelOwnerSettingsForm").addEventListener("submit", saveChannelSettings);
  return modal;
}

function openSettingsModal() {
  if (!isOwner()) return;
  const modal = ensureSettingsModal();
  const name = currentContext.channel.name || "";
  const key = currentContext.channel.nameKey || uniqueNameKey(name);
  checkedChannelNameKey = key;
  resetSelectedProfileImage();
  modal.querySelector("#channelOwnerPhotoInput").value = "";
  modal.querySelector("#channelOwnerPhotoStatus").textContent = "가운데 기준 정사각형으로 자동 조정되며 최대 1MB로 압축됩니다.";
  modal.querySelector("#channelOwnerName").value = name;
  modal.querySelector("#channelOwnerShareLink").value = buildChannelShareUrl(name);
  renderProfilePreview(currentContext.channel.photoURL || "");
  const checkMessage = modal.querySelector("#channelOwnerNameCheckMessage");
  checkMessage.textContent = "현재 사용 중인 채널 이름입니다.";
  checkMessage.classList.add("success");
  const message = modal.querySelector("#channelOwnerSettingsMessage");
  message.textContent = "";
  message.classList.remove("success");
  modal.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function closeSettingsModal() {
  resetSelectedProfileImage();
  document.getElementById("channelOwnerSettingsModal")?.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

function updateOwnerNameInput(event) {
  checkedChannelNameKey = "";
  const modal = ensureSettingsModal();
  const value = event.target.value.trim();
  modal.querySelector("#channelOwnerShareLink").value = buildChannelShareUrl(value);
  const text = modal.querySelector("#channelOwnerNameCheckMessage");
  text.textContent = "";
  text.classList.remove("success");
}

async function handleProfilePhotoSelection(event) {
  const modal = ensureSettingsModal();
  const file = event.target.files?.[0] || null;
  const status = modal.querySelector("#channelOwnerPhotoStatus");
  const message = modal.querySelector("#channelOwnerSettingsMessage");
  resetSelectedProfileImage();
  message.textContent = "";
  message.classList.remove("success");

  if (!file) {
    renderProfilePreview(currentContext.channel.photoURL || "");
    status.textContent = "가운데 기준 정사각형으로 자동 조정되며 최대 1MB로 압축됩니다.";
    return;
  }

  try {
    status.textContent = "사진을 최적화하고 있습니다...";
    selectedProfileBlob = await compressChannelProfileImage(file);
    selectedProfilePreviewUrl = URL.createObjectURL(selectedProfileBlob);
    renderProfilePreview(selectedProfilePreviewUrl);
    status.textContent = `새 사진 준비 완료 · ${Math.max(1, Math.round(selectedProfileBlob.size / 1024))}KB`;
  } catch (error) {
    console.error("채널 프로필 사진 처리 실패", error);
    event.target.value = "";
    renderProfilePreview(currentContext.channel.photoURL || "");
    status.textContent = error.message || "사진을 처리하지 못했습니다.";
  }
}

async function checkChannelName() {
  const modal = ensureSettingsModal();
  const input = modal.querySelector("#channelOwnerName");
  const message = modal.querySelector("#channelOwnerNameCheckMessage");
  const button = modal.querySelector("#channelOwnerNameCheck");
  button.disabled = true;
  try {
    const result = await isChannelNameAvailable(input.value, currentContext.channelId);
    message.textContent = result.message;
    message.classList.toggle("success", result.available === true);
    checkedChannelNameKey = result.available ? result.key : "";
    if (result.ok) {
      input.value = result.name;
      modal.querySelector("#channelOwnerShareLink").value = buildChannelShareUrl(result.name);
    }
  } catch (error) {
    console.error("채널명 중복 확인 실패", error);
    checkedChannelNameKey = "";
    message.textContent = firebaseErrorMessage(error, "채널명 중복 확인에 실패했습니다.");
    message.classList.remove("success");
  } finally {
    button.disabled = false;
  }
}

function createProfileStoragePath() {
  const random = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return `channels/${currentContext.channelId}/profile/${Date.now()}-${random}.webp`;
}

async function safelyDeleteProfileObject(path) {
  if (!path || !path.startsWith(`channels/${currentContext.channelId}/profile/`)) return;
  try {
    await deleteObject(storageRef(storage, path));
  } catch (error) {
    if (error?.code !== "storage/object-not-found") {
      console.warn("이전 채널 프로필 사진 정리 실패", error);
    }
  }
}

async function saveChannelSettings(event) {
  event.preventDefault();
  if (!isOwner()) return;
  const modal = ensureSettingsModal();
  const checked = validateChannelName(modal.querySelector("#channelOwnerName").value);
  const message = modal.querySelector("#channelOwnerSettingsMessage");
  const save = modal.querySelector("#channelOwnerSettingsSave");
  message.textContent = "";
  message.classList.remove("success");

  if (!checked.ok) {
    message.textContent = checked.message;
    return;
  }

  const oldKey = currentContext.channel.nameKey || uniqueNameKey(currentContext.channel.name || "");
  if (checked.key !== oldKey && checkedChannelNameKey !== checked.key) {
    message.textContent = "채널 이름 중복확인을 먼저 해주세요.";
    return;
  }

  save.disabled = true;
  save.textContent = "저장 중...";

  let newPhotoPath = "";
  let newPhotoURL = currentContext.channel.photoURL || "";
  const oldPhotoPath = currentContext.channel.photoStoragePath || "";

  try {
    const availability = await isChannelNameAvailable(checked.name, currentContext.channelId);
    if (!availability.available) throw new Error("NAME_TAKEN");

    if (selectedProfileBlob) {
      save.textContent = "사진 업로드 중...";
      newPhotoPath = createProfileStoragePath();
      const newPhotoRef = storageRef(storage, newPhotoPath);
      await uploadBytes(newPhotoRef, selectedProfileBlob, {
        contentType: CHANNEL_PROFILE_IMAGE_POLICY.outputType,
        cacheControl: "public,max-age=31536000,immutable"
      });
      newPhotoURL = await getDownloadURL(newPhotoRef);
    }

    save.textContent = "정보 저장 중...";
    const channelRef = doc(db, "channels", currentContext.channelId);
    const directoryRef = doc(db, "channelDirectory", currentContext.channelId);
    const newNameRef = channelNameRegistryRef(checked.key);
    const oldNameRef = oldKey ? channelNameRegistryRef(oldKey) : null;

    await runTransaction(db, async (transaction) => {
      const channelSnapshot = await transaction.get(channelRef);
      const directorySnapshot = await transaction.get(directoryRef);
      const newNameSnapshot = await transaction.get(newNameRef);
      let oldNameSnapshot = null;
      if (oldNameRef && oldNameRef.path !== newNameRef.path) {
        oldNameSnapshot = await transaction.get(oldNameRef);
      }

      if (!channelSnapshot.exists()) throw new Error("CHANNEL_NOT_FOUND");
      if (channelSnapshot.data().ownerUid !== currentUser.uid) throw new Error("NOT_OWNER");
      if (newNameSnapshot.exists() && newNameSnapshot.data().channelId !== currentContext.channelId) {
        throw new Error("NAME_TAKEN");
      }

      transaction.set(newNameRef, {
        channelId: currentContext.channelId,
        name: checked.name,
        createdAt: newNameSnapshot.exists() ? newNameSnapshot.data().createdAt || serverTimestamp() : serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      const channelUpdate = {
        name: checked.name,
        nameKey: checked.key,
        photoURL: newPhotoURL,
        updatedAt: serverTimestamp()
      };
      if (newPhotoPath) channelUpdate.photoStoragePath = newPhotoPath;

      transaction.update(channelRef, channelUpdate);

      if (directorySnapshot.exists()) {
        transaction.update(directoryRef, {
          name: checked.name,
          nameKey: checked.key,
          photoURL: newPhotoURL,
          ownerName: currentProfile.name || currentUser.email || "소유자",
          updatedAt: serverTimestamp()
        });
      }

      if (oldNameRef && oldNameRef.path !== newNameRef.path && oldNameSnapshot?.exists() && oldNameSnapshot.data().channelId === currentContext.channelId) {
        transaction.delete(oldNameRef);
      }
    });

    if (newPhotoPath && oldPhotoPath && oldPhotoPath !== newPhotoPath) {
      await safelyDeleteProfileObject(oldPhotoPath);
    }

    currentContext.channel.name = checked.name;
    currentContext.channel.nameKey = checked.key;
    currentContext.channel.photoURL = newPhotoURL;
    if (newPhotoPath) currentContext.channel.photoStoragePath = newPhotoPath;
    checkedChannelNameKey = checked.key;
    document.getElementById("currentChannelName").textContent = checked.name;
    modal.querySelector("#channelOwnerShareLink").value = buildChannelShareUrl(checked.name);
    renderProfilePreview(newPhotoURL);
    resetSelectedProfileImage();
    modal.querySelector("#channelOwnerPhotoInput").value = "";
    modal.querySelector("#channelOwnerPhotoStatus").textContent = "채널 프로필 사진이 저장되었습니다.";
    message.textContent = "채널 정보를 변경했습니다.";
    message.classList.add("success");
    setTimeout(() => location.reload(), 700);
  } catch (error) {
    if (newPhotoPath) await safelyDeleteProfileObject(newPhotoPath);
    console.error("채널 정보 변경 실패", error);
    message.textContent = error.message === "NAME_TAKEN"
      ? "이미 사용 중인 채널 이름입니다. 다시 중복확인해주세요."
      : firebaseErrorMessage(error, "채널 정보를 변경하지 못했습니다.");
  } finally {
    save.disabled = false;
    save.textContent = "저장";
  }
}

export function initChannelOwnerTools(user, profile, context) {
  currentUser = user;
  currentProfile = profile;
  currentContext = context;
  if (!canShare()) return;
  ensureButtons();
  ensureShareModal();
  if (isOwner()) ensureSettingsModal();
}
