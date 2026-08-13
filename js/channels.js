import {
  auth,
  db,
  storage
} from "./firebase-config.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

import {
  getDownloadURL,
  listAll,
  ref as storageRef
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js";

import {
  channelRoleLabel,
  isDeveloper,
  loadPlatformProfile,
  normalizeMemberStatus,
  setCurrentChannelId
} from "./channel-context.js?v=29";

import {
  firebaseErrorMessage
} from "./error-messages.js?v=28";


const loadingPanel =
  document.getElementById(
    "loadingPanel"
  );

const channelContent =
  document.getElementById(
    "channelContent"
  );

const channelList =
  document.getElementById(
    "channelList"
  );

const channelMessage =
  document.getElementById(
    "channelMessage"
  );

const openCreateChannelButton =
  document.getElementById(
    "openCreateChannelButton"
  );

const createChannelModal =
  document.getElementById(
    "createChannelModal"
  );

const createChannelForm =
  document.getElementById(
    "createChannelForm"
  );

const channelOwnerSelect =
  document.getElementById(
    "channelOwner"
  );

const createChannelMessage =
  document.getElementById(
    "createChannelMessage"
  );


let currentUser = null;
let currentProfile = null;
let memberships = [];
let usersByUid = new Map();


function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function setMessage(
  text,
  success = false
) {
  channelMessage.textContent =
    text;

  channelMessage.classList.toggle(
    "success",
    success
  );
}


function setCreateMessage(
  text,
  success = false
) {
  createChannelMessage.textContent =
    text;

  createChannelMessage.classList.toggle(
    "success",
    success
  );
}


/* =========================================
   개발자 채널 생성 팝업
========================================= */

function openCreateChannelModal() {
  if (!isDeveloper(currentProfile)) {
    return;
  }

  setCreateMessage("");

  createChannelModal.classList.remove(
    "hidden"
  );

  document.body.classList.add(
    "modal-open"
  );

  document
    .getElementById("channelName")
    ?.focus();
}


function closeCreateChannelModal() {
  createChannelModal.classList.add(
    "hidden"
  );

  document.body.classList.remove(
    "modal-open"
  );

  setCreateMessage("");
}


openCreateChannelButton
  ?.addEventListener(
    "click",
    openCreateChannelModal
  );


createChannelModal
  ?.querySelectorAll(
    "[data-close-create-channel]"
  )
  .forEach((element) => {
    element.addEventListener(
      "click",
      closeCreateChannelModal
    );
  });


document.addEventListener(
  "keydown",
  (event) => {
    if (
      event.key === "Escape" &&
      !createChannelModal
        ?.classList
        .contains("hidden")
    ) {
      closeCreateChannelModal();
    }
  }
);


/* =========================================
   기본 대표사진 랜덤 선택
========================================= */

async function getRandomChannelPhoto() {
  const folderRef =
    storageRef(
      storage,
      "channel-defaults"
    );

  const result =
    await listAll(folderRef);

  const images =
    result.items.filter(
      (item) =>
        /\.(jpg|jpeg|png|webp)$/i.test(
          item.name
        )
    );

  if (!images.length) {
    return "";
  }

  const randomItem =
    images[
      Math.floor(
        Math.random() *
        images.length
      )
    ];

  return await getDownloadURL(
    randomItem
  );
}


/* =========================================
   개발자용 전체 사용자 불러오기
========================================= */

async function loadUsersForDeveloper() {
  if (!isDeveloper(currentProfile)) {
    return;
  }

  const snap =
    await getDocs(
      collection(
        db,
        "users"
      )
    );

  const users =
    snap.docs
      .map((item) => ({
        uid:
          item.id,

        ...item.data()
      }))
      .filter(
        (user) =>
          !isDeveloper(user)
      )
      .sort(
        (a, b) =>
          (
            a.name ||
            a.email ||
            ""
          ).localeCompare(
            b.name ||
            b.email ||
            "",
            "ko"
          )
      );

  usersByUid =
    new Map(
      users.map(
        (user) => [
          user.uid,
          user
        ]
      )
    );


  channelOwnerSelect.innerHTML =
    users
      .map(
        (user) => `
          <option
            value="${escapeHtml(user.uid)}"
          >
            ${escapeHtml(
              user.name ||
              user.email ||
              "사용자"
            )}
            ·
            ${escapeHtml(
              user.email || ""
            )}
          </option>
        `
      )
      .join("");
}


/* =========================================
   채널 목록
========================================= */

async function loadChannels() {

  /*
   * developer
   *
   * members 문서가 없어도
   * 모든 활성 채널 표시
   */
  if (isDeveloper(currentProfile)) {

    const snap =
      await getDocs(
        collection(
          db,
          "channels"
        )
      );

    memberships =
      snap.docs
        .map((item) => ({
          role:
            "developer",

          status:
            "approved",

          channel: {
            id:
              item.id,

            ...item.data()
          }
        }))
        .filter(
          (item) =>
            item.channel.status ===
            "active"
        )
        .sort(
          (a, b) =>
            (
              a.channel.name ||
              ""
            ).localeCompare(
              b.channel.name ||
              "",
              "ko"
            )
        );

    return;
  }


  /*
   * 일반 사용자
   *
   * 자신에게 등록된 채널 membership 목록 확인
   */
  const membershipSnap =
    await getDocs(
      collection(
        db,
        "users",
        currentUser.uid,
        "memberships"
      )
    );


  const raw =
    membershipSnap.docs.map(
      (item) => ({
        id:
          item.id,

        ...item.data(),

        status:
          normalizeMemberStatus(
            item.data().status
          )
      })
    );


  const results =
    await Promise.all(
      raw.map(
        async (membership) => {

          try {

            const channelSnap =
              await getDoc(
                doc(
                  db,
                  "channels",
                  membership.id
                )
              );


            if (
              !channelSnap.exists()
            ) {
              return null;
            }


            const channel = {
              id:
                channelSnap.id,

              ...channelSnap.data()
            };


            if (
              channel.status !==
              "active"
            ) {
              return null;
            }


            /*
             * 실제 members 문서의 최신 상태 확인
             */
            const memberSnap =
              await getDoc(
                doc(
                  db,
                  "channels",
                  channel.id,
                  "members",
                  currentUser.uid
                )
              );


            if (
              memberSnap.exists()
            ) {

              const member =
                memberSnap.data();

              return {
                ...membership,

                ...member,

                status:
                  normalizeMemberStatus(
                    member.status
                  ),

                channel
              };

            }


            /*
             * mirror만 존재하는 옛 데이터
             */
            return {
              ...membership,
              channel
            };

          } catch (error) {

            console.error(
              "채널 조회 실패",
              membership.id,
              error
            );

            return null;

          }
        }
      )
    );


  memberships =
    results
      .filter(Boolean)
      .sort(
        (a, b) =>
          (
            a.channel?.name ||
            a.channelName ||
            ""
          ).localeCompare(
            b.channel?.name ||
            b.channelName ||
            "",
            "ko"
          )
      );
}


/* =========================================
   채널 카드
========================================= */

function renderChannels() {

  channelList.innerHTML =
    "";


  if (!memberships.length) {

    channelList.innerHTML = `
      <div
        class="panel channel-empty"
      >

        <strong>
          현재 연결된 채널이 없습니다.
        </strong>

        <span>
          채널 소유자에게 초대를 받아주세요.
        </span>

      </div>
    `;

    return;
  }


  memberships.forEach(
    (membership) => {

      const channel =
        membership.channel;

      const developer =
        isDeveloper(
          currentProfile
        );

      const status =
        developer
          ? "approved"
          : normalizeMemberStatus(
              membership.status
            );


      const roleText =
        developer
          ? "개발자"
          : channelRoleLabel(
              membership.role
            );


      const statusText =
        developer
          ? "모든 채널 접근"
          : status === "pending"
          ? "승인 대기"
          : "이용 가능";


      const card =
        document.createElement(
          "article"
        );


      card.className =
        "panel channel-card";


      card.innerHTML = `

        <div
          class="channel-card-head"
          style="
            display:flex;
            align-items:center;
            gap:16px;
          "
        >

          ${
            channel.photoURL
              ? `
                <img
                  src="${escapeHtml(
                    channel.photoURL
                  )}"
                  alt=""
                  style="
                    width:72px;
                    height:72px;
                    border-radius:16px;
                    object-fit:cover;
                    flex:0 0 auto;
                  "
                />
              `
              : `
                <div
                  style="
                    width:72px;
                    height:72px;
                    border-radius:16px;
                    background:#f0ecfa;
                    display:grid;
                    place-items:center;
                    font-weight:900;
                    color:#8064cb;
                    flex:0 0 auto;
                  "
                >
                  H
                </div>
              `
          }


          <div>

            <span
              class="room-state-badge"
            >
              ${escapeHtml(roleText)}
            </span>


            <h2>
              ${escapeHtml(
                channel.name ||
                membership.channelName ||
                "HNSITE 채널"
              )}
            </h2>


            <p class="muted">
              ${escapeHtml(statusText)}
            </p>

          </div>

        </div>


        <div
          class="channel-card-actions"
        >

          <button
            class="select-channel-button"
            type="button"
          >
            이 채널 사용
          </button>

        </div>
      `;


      card
        .querySelector(
          ".select-channel-button"
        )
        .addEventListener(
          "click",
          () => {

            setCurrentChannelId(
              currentUser.uid,
              channel.id
            );

            /*
             * pending 사용자도
             * app.html까지 이동한다.
             *
             * app.js에서 승인대기 화면 표시.
             */
            location.href =
              "./app.html";

          }
        );


      channelList.appendChild(
        card
      );
    }
  );
}


/* =========================================
   채널 생성
========================================= */

async function createChannel(
  event
) {

  event.preventDefault();


  if (!isDeveloper(currentProfile)) {
    return;
  }


  const name =
    document
      .getElementById(
        "channelName"
      )
      .value
      .trim();


  const ownerUid =
    channelOwnerSelect.value;


  if (!name) {
    setCreateMessage(
      "채널 이름을 입력해주세요."
    );

    return;
  }


  if (!ownerUid) {
    setCreateMessage(
      "채널 소유자를 선택해주세요."
    );

    return;
  }


  const owner =
    usersByUid.get(
      ownerUid
    );


  if (!owner) {
    setCreateMessage(
      "선택한 사용자 정보를 찾을 수 없습니다."
    );

    return;
  }


  const button =
    document.getElementById(
      "createChannelButton"
    );


  button.disabled =
    true;

  button.textContent =
    "생성 중...";


  try {

    let photoURL =
      "";

    try {
      photoURL =
        await getRandomChannelPhoto();
    } catch (error) {
      console.warn(
        "기본 대표사진 선택 실패",
        error
      );
    }


    const channelRef =
      doc(
        collection(
          db,
          "channels"
        )
      );


    const memberRef =
      doc(
        db,
        "channels",
        channelRef.id,
        "members",
        ownerUid
      );


    const mirrorRef =
      doc(
        db,
        "users",
        ownerUid,
        "memberships",
        channelRef.id
      );


    await runTransaction(
      db,
      async (transaction) => {

        transaction.set(
          channelRef,
          {

            name,

            photoURL,

            ownerUid,

            ownerEmail:
              owner.email ||
              "",

            createdBy:
              currentUser.uid,

            status:
              "active",

            subscriptionStatus:
              "beta",

            bingoEnabled:
              true,

            killEnabled:
              false,

            killPlan:
              "none",

            maxActiveBingoRoomsPerManager:
              5,

            subscriptionStartedAt:
              null,

            subscriptionEndsAt:
              null,

            createdAt:
              serverTimestamp(),

            updatedAt:
              serverTimestamp()
          }
        );


        /*
         * 채널 소유자는
         * 자동 승인
         */
        transaction.set(
          memberRef,
          {

            uid:
              ownerUid,

            name:
              owner.name ||
              owner.email ||
              "소유자",

            email:
              owner.email ||
              "",

            role:
              "owner",

            status:
              "approved",

            bingoAccess:
              "write",

            killSheetAccess:
              "none",

            joinedAt:
              serverTimestamp(),

            updatedAt:
              serverTimestamp()
          }
        );


        /*
         * 채널 선택 목록용 mirror
         */
        transaction.set(
          mirrorRef,
          {

            channelId:
              channelRef.id,

            channelName:
              name,

            role:
              "owner",

            status:
              "approved",

            joinedAt:
              serverTimestamp(),

            updatedAt:
              serverTimestamp()
          }
        );

      }
    );


    createChannelForm.reset();

    closeCreateChannelModal();


    setMessage(
      `${name} 채널을 생성했습니다.`,
      true
    );


    await loadChannels();

    renderChannels();

  } catch (error) {

    console.error(error);

    setCreateMessage(
      firebaseErrorMessage(
        error,
        "채널 생성에 실패했습니다."
      )
    );

  } finally {

    button.disabled =
      false;

    button.textContent =
      "채널 생성";

  }
}


createChannelForm
  ?.addEventListener(
    "submit",
    createChannel
  );


/* =========================================
   로그아웃
========================================= */

document
  .getElementById(
    "logoutButton"
  )
  ?.addEventListener(
    "click",
    async () => {

      await signOut(auth);

      location.replace(
        "./index.html"
      );

    }
  );


/* =========================================
   초기화
========================================= */

onAuthStateChanged(
  auth,
  async (user) => {

    if (!user) {

      location.replace(
        "./index.html"
      );

      return;
    }


    try {

      currentUser =
        user;


      currentProfile =
        await loadPlatformProfile(
          user
        );


      document
        .getElementById(
          "userEmail"
        )
        .textContent =
          user.email ||
          "";


      const developer =
        isDeveloper(
          currentProfile
        );


      document
        .getElementById(
          "platformRoleBadge"
        )
        .textContent =
          developer
            ? "개발자"
            : "사용자";


      /*
       * developer에게만
       * 채널 생성 버튼 표시
       */
      openCreateChannelButton
        .classList
        .toggle(
          "hidden",
          !developer
        );


      if (developer) {
        await loadUsersForDeveloper();
      }


      await loadChannels();

      renderChannels();


      loadingPanel.classList.add(
        "hidden"
      );

      channelContent.classList.remove(
        "hidden"
      );

    } catch (error) {

      console.error(error);


      loadingPanel.innerHTML = `

        <h2>
          채널 정보를 불러올 수 없습니다.
        </h2>

        <p>
          ${escapeHtml(
            firebaseErrorMessage(
              error,
              error.message ||
              "채널 정보를 불러오지 못했습니다."
            )
          )}
        </p>

        <button
          id="channelBackLogin"
          type="button"
        >
          로그인 화면으로
        </button>
      `;


      document
        .getElementById(
          "channelBackLogin"
        )
        ?.addEventListener(
          "click",
          async () => {

            await signOut(auth);

            location.replace(
              "./index.html"
            );

          }
        );
    }
  }
);