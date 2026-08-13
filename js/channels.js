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
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where
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

const channelSearch =
  document.getElementById("channelSearch");
const requestChannelCreationButton =
  document.getElementById(
    "requestChannelCreationButton"
  );

const openChannelRequestsButton =
  document.getElementById(
    "openChannelRequestsButton"
  );

const channelRequestBadge =
  document.getElementById(
    "channelRequestBadge"
  );

const channelRequestsModal =
  document.getElementById(
    "channelRequestsModal"
  );

const channelRequestsList =
  document.getElementById(
    "channelRequestsList"
  );

const channelRequestsMessage =
  document.getElementById(
    "channelRequestsMessage"
  );

let channelRequestsUnsubscribe = null;
let channelSearchTerm = "";
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
   채널 생성 신청
========================================= */

async function requestChannelCreation() {
  if (
    !currentUser ||
    !currentProfile ||
    isDeveloper(currentProfile)
  ) {
    return;
  }

  const button =
    requestChannelCreationButton;

  button.disabled = true;
  button.textContent = "신청 중...";

  try {
    const requestRef =
      doc(
        db,
        "channelCreationRequests",
        currentUser.uid
      );

    const existing =
      await getDoc(requestRef);

    if (
      existing.exists() &&
      existing.data().status === "pending"
    ) {
      setMessage(
        "이미 채널 생성 신청이 접수되어 있습니다."
      );

      return;
    }

    await setDoc(
      requestRef,
      {
        requesterUid:
          currentUser.uid,

        requesterName:
          currentProfile.name ||
          currentUser.displayName ||
          currentUser.email ||
          "사용자",

        requesterEmail:
          currentUser.email || "",

        status:
          "pending",

        createdAt:
          serverTimestamp(),

        updatedAt:
          serverTimestamp()
      }
    );

    setMessage(
      "채널 생성 신청이 완료되었습니다.",
      true
    );

  } catch (error) {
    console.error(
      "채널 생성 신청 실패",
      error
    );

    setMessage(
      firebaseErrorMessage(
        error,
        "채널 생성 신청에 실패했습니다."
      )
    );

  } finally {
    button.disabled = false;
    button.textContent =
      "채널 생성 신청하기";
  }
}


requestChannelCreationButton
  ?.addEventListener(
    "click",
    requestChannelCreation
  );
/* =========================================
   채널 카드
========================================= */

function renderChannels() {
  channelList.innerHTML = "";

  const searchTerm =
    (channelSearchTerm || "")
      .trim()
      .toLocaleLowerCase("ko");

  const filteredMemberships =
    memberships.filter((membership) => {
      const channelName =
        membership.channel?.name ||
        membership.channelName ||
        "";

      return (
        !searchTerm ||
        channelName
          .toLocaleLowerCase("ko")
          .includes(searchTerm)
      );
    });

  // 애초에 가입된 채널이 하나도 없는 경우
  if (!memberships.length) {
    channelList.innerHTML = `
      <div class="panel channel-empty">
        <strong>현재 연결된 채널이 없습니다.</strong>
        <span>채널 소유자에게 초대를 받아주세요.</span>
      </div>
    `;
    return;
  }

  // 채널은 있지만 검색 결과가 없는 경우
  if (!filteredMemberships.length) {
    channelList.innerHTML = `
      <div class="panel channel-empty">
        <strong>검색 결과가 없습니다.</strong>
        <span>다른 채널 이름으로 검색해보세요.</span>
      </div>
    `;
    return;
  }

  filteredMemberships.forEach((membership) => {
    const channel = membership.channel;

    const card =
      document.createElement("article");

    card.className =
      "panel channel-card";

    card.innerHTML = `
      <div class="channel-card-head">

        ${
          channel.photoURL
            ? `
              <img
                class="channel-card-image"
                src="${escapeHtml(channel.photoURL)}"
                alt="${escapeHtml(channel.name || "채널")} 대표 이미지"
              />
            `
            : `
              <div class="channel-card-image channel-card-image-empty">
                H
              </div>
            `
        }

        <div class="channel-card-info">
          <h2>
            ${escapeHtml(
              channel.name ||
              membership.channelName ||
              "HNSITE 채널"
            )}
          </h2>
        </div>

      </div>

      <div class="channel-card-actions">
        <button
          class="select-channel-button"
          type="button"
        >
          이 채널 사용
        </button>
      </div>
    `;

    card
      .querySelector(".select-channel-button")
      .addEventListener("click", () => {
        setCurrentChannelId(
          currentUser.uid,
          channel.id
        );

        location.href =
          "./app.html";
      });

    channelList.appendChild(card);
  });
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

  startChannelRequestWatcher();

  openChannelRequestsButton
    .classList
    .remove("hidden");

} else {
  requestChannelCreationButton
    .classList
    .remove("hidden");
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



  function startChannelRequestWatcher() {
  if (
    !isDeveloper(currentProfile) ||
    channelRequestsUnsubscribe
  ) {
    return;
  }

  const requestsQuery =
    query(
      collection(
        db,
        "channelCreationRequests"
      ),
      where(
        "status",
        "==",
        "pending"
      )
    );

  channelRequestsUnsubscribe =
    onSnapshot(
      requestsQuery,

      (snapshot) => {
        const count =
          snapshot.size;

        channelRequestBadge.textContent =
          count > 99
            ? "99+"
            : String(count);

        channelRequestBadge.classList.toggle(
          "hidden",
          count === 0
        );

        openChannelRequestsButton.classList.remove(
          "hidden"
        );
      },

      (error) => {
        console.error(
          "채널 신청 실시간 조회 실패",
          error
        );
      }
    );
}

function formatRequestDate(value) {
  const date =
    value?.toDate?.();

  if (!date) {
    return "-";
  }

  return new Intl.DateTimeFormat(
    "ko-KR",
    {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }
  ).format(date);
}


async function openChannelRequestsModal() {
  if (!isDeveloper(currentProfile)) {
    return;
  }

  channelRequestsModal.classList.remove(
    "hidden"
  );

  document.body.classList.add(
    "modal-open"
  );

  channelRequestsMessage.textContent =
    "신청 목록을 불러오는 중...";

  try {
    await loadChannelRequests();

    channelRequestsMessage.textContent =
      "";

  } catch (error) {
    console.error(error);

    channelRequestsMessage.textContent =
      firebaseErrorMessage(
        error,
        "채널 생성 신청을 불러오지 못했습니다."
      );
  }
}


function closeChannelRequestsModal() {
  channelRequestsModal.classList.add(
    "hidden"
  );

  document.body.classList.remove(
    "modal-open"
  );
}


async function loadChannelRequests() {
  const snap =
    await getDocs(
      query(
        collection(
          db,
          "channelCreationRequests"
        ),
        where(
          "status",
          "==",
          "pending"
        )
      )
    );

  const requests =
    snap.docs
      .map((item) => ({
        id:
          item.id,

        ...item.data()
      }))
      .sort(
        (a, b) =>
          (
            b.updatedAt?.toMillis?.() ||
            0
          ) -
          (
            a.updatedAt?.toMillis?.() ||
            0
          )
      );

  channelRequestsList.innerHTML =
    "";

  if (!requests.length) {
    channelRequestsList.innerHTML = `
      <div class="channel-request-empty">
        현재 대기 중인 채널 생성 신청이 없습니다.
      </div>
    `;

    return;
  }

  requests.forEach(
    (request) => {
      const item =
        document.createElement(
          "article"
        );

      item.className =
        "channel-request-item";

      item.innerHTML = `
        <div class="channel-request-info">

          <strong>
            ${escapeHtml(
              request.requesterName ||
              request.requesterEmail ||
              "사용자"
            )}
          </strong>

          <span>
            ${escapeHtml(
              request.requesterEmail ||
              ""
            )}
          </span>

          <small>
            신청 ${escapeHtml(
              formatRequestDate(
                request.updatedAt ||
                request.createdAt
              )
            )}
          </small>

        </div>

        <div class="channel-request-actions">

          <button
            class="secondary create-for-request-button"
            type="button"
          >
            이 사용자로 채널 생성
          </button>

          <button
            class="secondary complete-request-button"
            type="button"
          >
            처리 완료
          </button>

        </div>
      `;

      item
        .querySelector(
          ".create-for-request-button"
        )
        .addEventListener(
          "click",
          () => {
            const ownerExists =
              [...channelOwnerSelect.options]
                .some(
                  (option) =>
                    option.value ===
                    request.requesterUid
                );

            if (ownerExists) {
              channelOwnerSelect.value =
                request.requesterUid;
            }

            closeChannelRequestsModal();

            openCreateChannelModal();

            document
              .getElementById(
                "channelName"
              )
              ?.focus();
          }
        );

      item
        .querySelector(
          ".complete-request-button"
        )
        .addEventListener(
          "click",
          async () => {
            await completeChannelRequest(
              request
            );
          }
        );

      channelRequestsList.appendChild(
        item
      );
    }
  );
}

async function completeChannelRequest(
  request
) {
  try {
    await deleteDoc(
      doc(
        db,
        "channelCreationRequests",
        request.id
      )
    );

    await loadChannelRequests();

  } catch (error) {
    console.error(error);

    channelRequestsMessage.textContent =
      firebaseErrorMessage(
        error,
        "신청 처리에 실패했습니다."
      );
  }
}

openChannelRequestsButton
  ?.addEventListener(
    "click",
    openChannelRequestsModal
  );


channelRequestsModal
  ?.querySelectorAll(
    "[data-close-channel-requests]"
  )
  .forEach(
    (element) => {
      element.addEventListener(
        "click",
        closeChannelRequestsModal
      );
    }
  );

  channelSearch?.addEventListener(
  "input",
  (event) => {
    channelSearchTerm =
      event.target.value || "";

    renderChannels();
  }
);