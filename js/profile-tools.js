import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { firebaseErrorMessage } from "./error-messages.js";
import { loadPlatformProfile } from "./channel-context.js";
import { updateTopbarProfile } from "./topbar-menu.js";
import {
  isUserNameAvailable,
  uniqueNameKey,
  userNameRegistryRef,
  validateUserName
} from "./name-registry.js";

let currentUser = null;
let currentProfile = null;
let checkedNameKey = "";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function ensureButton() {
  const nav = document.querySelector(".topbar-user");
  if (!nav || document.getElementById("profileManageButton")) return;

  const button = document.createElement("button");
  button.id = "profileManageButton";
  button.type = "button";
  button.className = "topbar-link profile-manage-button";
  button.textContent = "내 정보";

  const email = nav.querySelector(".topbar-email");
  nav.insertBefore(button, email || nav.firstChild);
  button.addEventListener("click", openModal);
}

function ensureModal() {
  let modal = document.getElementById("profileManageModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "profileManageModal";
  modal.className = "admin-modal hidden";
  modal.innerHTML = `
    <div class="admin-modal-backdrop" data-close-profile></div>
    <section class="admin-modal-dialog profile-manage-dialog" role="dialog" aria-modal="true" aria-labelledby="profileManageTitle">
      <div class="admin-modal-header">
        <div>
          <p class="eyebrow">MY PROFILE</p>
          <h2 id="profileManageTitle">내 정보</h2>
        </div>
        <button class="modal-close-button" data-close-profile type="button" aria-label="닫기">×</button>
      </div>
      <form id="profileManageForm" class="profile-manage-form">
        <label>
          Google 이메일
          <input id="profileEmail" type="email" readonly />
        </label>
        <label>
          사용자명
          <div class="unique-name-row">
            <input id="profileName" type="text" maxlength="20" autocomplete="off" required />
            <button id="profileNameCheck" class="secondary" type="button">중복확인</button>
          </div>
          <small id="profileNameCheckMessage" class="unique-name-message"></small>
        </label>
        <p id="profileManageMessage" class="message"></p>
        <div class="channel-modal-actions">
          <button class="secondary" data-close-profile type="button">취소</button>
          <button id="profileManageSave" type="submit">저장</button>
        </div>
      </form>
    </section>`;

  document.body.appendChild(modal);
  modal.querySelectorAll("[data-close-profile]").forEach((element) => {
    element.addEventListener("click", closeModal);
  });
  modal.querySelector("#profileName").addEventListener("input", () => {
    checkedNameKey = "";
    const text = modal.querySelector("#profileNameCheckMessage");
    text.textContent = "";
    text.classList.remove("success");
  });
  modal.querySelector("#profileNameCheck").addEventListener("click", checkName);
  modal.querySelector("#profileManageForm").addEventListener("submit", saveProfile);
  return modal;
}

function openModal() {
  if (!currentUser || !currentProfile) return;
  const modal = ensureModal();
  checkedNameKey = currentProfile.nameKey || uniqueNameKey(currentProfile.name || "");
  modal.querySelector("#profileEmail").value = currentUser.email || currentProfile.email || "";
  modal.querySelector("#profileName").value = currentProfile.name || "";
  const checkMessage = modal.querySelector("#profileNameCheckMessage");
  checkMessage.textContent = "현재 사용 중인 사용자명입니다.";
  checkMessage.classList.add("success");
  const message = modal.querySelector("#profileManageMessage");
  message.textContent = "";
  message.classList.remove("success");
  modal.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function closeModal() {
  document.getElementById("profileManageModal")?.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

async function checkName() {
  const modal = ensureModal();
  const input = modal.querySelector("#profileName");
  const resultText = modal.querySelector("#profileNameCheckMessage");
  const button = modal.querySelector("#profileNameCheck");
  button.disabled = true;

  try {
    const checked = validateUserName(input.value);
    const currentKey = currentProfile.nameKey || uniqueNameKey(currentProfile.name || "");

    if (!checked.ok) {
      resultText.textContent = checked.message;
      resultText.classList.remove("success");
      checkedNameKey = "";
      return;
    }

    if (checked.key === currentKey) {
      input.value = checked.name;
      checkedNameKey = currentKey;
      resultText.textContent = "현재 사용 중인 사용자명입니다.";
      resultText.classList.add("success");
      return;
    }

    const result = await isUserNameAvailable(checked.name, currentUser.uid);
    resultText.textContent = result.message;
    resultText.classList.toggle("success", result.available === true);
    checkedNameKey = result.available ? result.key : "";
    if (result.ok) input.value = result.name;
  } catch (error) {
    console.error("사용자명 중복 확인 실패", error);
    checkedNameKey = "";
    resultText.textContent = firebaseErrorMessage(error, "사용자명 중복 확인에 실패했습니다.");
    resultText.classList.remove("success");
  } finally {
    button.disabled = false;
  }
}

async function syncMemberDisplayNames(name) {
  const memberships = await getDocs(collection(db, "users", currentUser.uid, "memberships"));
  const resolved = await Promise.all(
    memberships.docs.map(async (membership) => {
      const memberRef = doc(db, "channels", membership.id, "members", currentUser.uid);
      const memberSnapshot = await getDoc(memberRef);
      return { membership, memberRef, memberExists: memberSnapshot.exists() };
    })
  );

  const active = resolved.filter((item) => item.memberExists);
  for (let start = 0; start < active.length; start += 300) {
    const batch = writeBatch(db);
    active.slice(start, start + 300).forEach(({ membership, memberRef }) => {
      batch.update(memberRef, {
        name,
        updatedAt: serverTimestamp()
      });

      if (membership.data().role === "owner") {
        batch.update(doc(db, "channelDirectory", membership.id), {
          ownerName: name,
          updatedAt: serverTimestamp()
        });
      }
    });
    await batch.commit();
  }
}


async function syncActiveRoomOwnerNames(name, memberships) {
  for (const membership of memberships) {
    if (!['owner', 'admin'].includes(membership.data().role)) continue;
    try {
      const rooms = await getDocs(
        query(
          collection(db, "channels", membership.id, "bingoRooms"),
          where("ownerUid", "==", currentUser.uid)
        )
      );
      const activeRooms = rooms.docs.filter((room) => room.data().status !== "closed");
      for (let start = 0; start < activeRooms.length; start += 350) {
        const batch = writeBatch(db);
        activeRooms.slice(start, start + 350).forEach((room) => {
          batch.update(room.ref, {
            ownerName: name,
            updatedAt: serverTimestamp()
          });
        });
        await batch.commit();
      }
    } catch (error) {
      console.warn("활성 빙고방 사용자명 동기화 생략", membership.id, error);
    }
  }
}

async function saveProfile(event) {
  event.preventDefault();
  if (!currentUser || !currentProfile) return;

  const modal = ensureModal();
  const input = modal.querySelector("#profileName");
  const message = modal.querySelector("#profileManageMessage");
  const save = modal.querySelector("#profileManageSave");
  const checked = validateUserName(input.value);

  message.textContent = "";
  message.classList.remove("success");

  if (!checked.ok) {
    message.textContent = checked.message;
    return;
  }

  const currentKey = currentProfile.nameKey || uniqueNameKey(currentProfile.name || "");
  if (checked.key !== currentKey && checkedNameKey !== checked.key) {
    message.textContent = "사용자명 중복확인을 먼저 해주세요.";
    return;
  }

  save.disabled = true;
  save.textContent = "저장 중...";

  try {
    const userRef = doc(db, "users", currentUser.uid);
    const newNameRef = userNameRegistryRef(checked.key);
    const oldNameRef = currentKey ? userNameRegistryRef(currentKey) : null;

    await runTransaction(db, async (transaction) => {
      const userSnapshot = await transaction.get(userRef);
      if (!userSnapshot.exists()) throw new Error("USER_NOT_FOUND");

      const newNameSnapshot = await transaction.get(newNameRef);
      let oldNameSnapshot = null;
      if (oldNameRef && oldNameRef.path !== newNameRef.path) {
        oldNameSnapshot = await transaction.get(oldNameRef);
      }

      if (newNameSnapshot.exists() && newNameSnapshot.data().uid !== currentUser.uid) {
        throw new Error("NAME_TAKEN");
      }

      transaction.set(newNameRef, {
        uid: currentUser.uid,
        name: checked.name,
        createdAt: newNameSnapshot.exists() ? newNameSnapshot.data().createdAt || serverTimestamp() : serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      transaction.update(userRef, {
        name: checked.name,
        nameKey: checked.key,
        updatedAt: serverTimestamp()
      });

      if (oldNameRef && oldNameRef.path !== newNameRef.path && oldNameSnapshot?.exists() && oldNameSnapshot.data().uid === currentUser.uid) {
        transaction.delete(oldNameRef);
      }
    });

    await syncMemberDisplayNames(checked.name);
    const membershipSnapshot = await getDocs(collection(db, "users", currentUser.uid, "memberships"));
    await syncActiveRoomOwnerNames(checked.name, membershipSnapshot.docs);

    currentProfile = {
      ...currentProfile,
      name: checked.name,
      nameKey: checked.key
    };
    checkedNameKey = checked.key;

    updateTopbarProfile(currentProfile, currentUser);
    window.dispatchEvent(new CustomEvent("hnsite:profile-updated", {
      detail: {
        profile: { ...currentProfile },
        user: currentUser
      }
    }));

    const welcomeText = document.getElementById("welcomeText");
    const currentChannelName = document.getElementById("currentChannelName")?.textContent?.trim();
    if (welcomeText && currentChannelName) {
      welcomeText.textContent = `${checked.name}님, ${currentChannelName}에 접속했습니다.`;
    }

    message.textContent = "사용자명을 변경했습니다.";
    message.classList.add("success");
  } catch (error) {
    console.error("사용자명 변경 실패", error);
    message.textContent = error.message === "NAME_TAKEN"
      ? "이미 사용 중인 사용자명입니다. 다시 중복확인해주세요."
      : firebaseErrorMessage(error, "사용자명을 변경하지 못했습니다.");
  } finally {
    save.disabled = false;
    save.textContent = "저장";
  }
}

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  try {
    currentUser = user;
    currentProfile = await loadPlatformProfile(user);
    ensureButton();
    ensureModal();
  } catch (error) {
    console.error("내 정보 초기화 실패", error);
  }
});
