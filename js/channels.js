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
  isDeveloper,
  loadPlatformProfile,
  setCurrentChannelId
} from "./channel-context.js?v=29";


import {
  firebaseErrorMessage
} from "./error-messages.js?v=29";


/* =========================================================
   DOM
========================================================= */

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


const channelSearch =
  document.getElementById(
    "channelSearch"
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


/* =========================================================
   상태
========================================================= */

let currentUser = null;

let currentProfile = null;

let memberships = [];

let usersByUid =
  new Map();

let channelSearchTerm = "";

let channelRequestsUnsubscribe =
  null;

/*
 * 신청 목록에서
 * "이 사용자로 채널 생성"을 눌렀을 때 기억한다.
 */
let selectedChannelRequestUid =
  null;


/* =========================================================
   공통
========================================================= */

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


/*
 * 기존 active 데이터와
 * 새 approved 데이터를 임시 호환.
 */
function normalizeMemberStatus(status) {
  if (status === "active") {
    return "approved";
  }

  return status || "pending";
}


function setMessage(
  text,
  success = false
) {
  if (!channelMessage) {
    return;
  }

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
  if (!createChannelMessage) {
    return;
  }

  createChannelMessage.textContent =
    text;

  createChannelMessage.classList.toggle(
    "success",
    success
  );
}


/* =========================================================
   채널 생성 팝업
========================================================= */

function openCreateChannelModal(
  ownerUid = ""
) {
  if (
    !isDeveloper(
      currentProfile
    )
  ) {
    return;
  }


  setCreateMessage("");


  if (
    ownerUid &&
    [...channelOwnerSelect.options]
      .some(
        (option) =>
          option.value === ownerUid
      )
  ) {
    channelOwnerSelect.value =
      ownerUid;
  }


  createChannelModal.classList.remove(
    "hidden"
  );


  document.body.classList.add(
    "modal-open"
  );


  requestAnimationFrame(
    () => {
      document
        .getElementById(
          "channelName"
        )
        ?.focus();
    }
  );
}


function closeCreateChannelModal() {
  createChannelModal.classList.add(
    "hidden"
  );


  document.body.classList.remove(
    "modal-open"
  );


  setCreateMessage("");


  selectedChannelRequestUid =
    null;
}


openCreateChannelButton
  ?.addEventListener(
    "click",
    () => {
      selectedChannelRequestUid =
        null;

      openCreateChannelModal();
    }
  );


createChannelModal
  ?.querySelectorAll(
    "[data-close-create-channel]"
  )
  .forEach(
    (element) => {
      element.addEventListener(
        "click",
        closeCreateChannelModal
      );
    }
  );


/* =========================================================
   기본 채널 대표사진
========================================================= */

async function getRandomChannelPhoto() {
  const folderRef =
    storageRef(
      storage,
      "channel-defaults"
    );


  const result =
    await listAll(
      folderRef
    );


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


  const randomIndex =
    Math.floor(
      Math.random() *
      images.length
    );


  return await getDownloadURL(
    images[randomIndex]
  );
}


/* =========================================================
   개발자용 사용자 목록
========================================================= */

async function loadUsersForDeveloper() {
  if (
    !isDeveloper(
      currentProfile
    )
  ) {
    return;
  }


  const snapshot =
    await getDocs(
      collection(
        db,
        "users"
      )
    );


  const users =
    snapshot.docs
      .map(
        (item) => ({
          uid:
            item.id,

          ...item.data()
        })
      )
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


  if (!users.length) {
    channelOwnerSelect.innerHTML =
      `
        <option value="">
          선택 가능한 사용자가 없습니다.
        </option>
      `;

    return;
  }


  channelOwnerSelect.innerHTML =
    users
      .map(
        (user) => `
          <option
            value="${escapeHtml(
              user.uid
            )}"
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


/* =========================================================
   채널 목록 불러오기
========================================================= */

async function loadChannels() {

  /*
   * 개발자
   *
   * 모든 활성 채널 표시
   */
  if (
    isDeveloper(
      currentProfile
    )
  ) {

    const snapshot =
      await getDocs(
        collection(
          db,
          "channels"
        )
      );


    memberships =
      snapshot.docs
        .map(
          (item) => ({
            role:
              "developer",

            status:
              "approved",

            channel: {
              id:
                item.id,

              ...item.data()
            }
          })
        )
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
   * users/{uid}/memberships
   * 기준으로 채널 목록 조회
   */
  const membershipSnapshot =
    await getDocs(
      collection(
        db,
        "users",
        currentUser.uid,
        "memberships"
      )
    );


  const rawMemberships =
    membershipSnapshot.docs.map(
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
      rawMemberships.map(
        async (membership) => {

          try {

            const channelSnapshot =
              await getDoc(
                doc(
                  db,
                  "channels",
                  membership.id
                )
              );


            if (
              !channelSnapshot.exists()
            ) {
              return null;
            }


            const channel = {
              id:
                channelSnapshot.id,

              ...channelSnapshot.data()
            };


            if (
              channel.status !==
              "active"
            ) {
              return null;
            }


            /*
             * 실제 members 문서가 있다면
             * 최신 상태를 우선 사용.
             */
            const memberSnapshot =
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
              memberSnapshot.exists()
            ) {

              const member =
                memberSnapshot.data();


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
             * 기존 mirror 데이터 호환.
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


/* =========================================================
   채널 검색 / 카드
========================================================= */

function renderChannels() {
  channelList.innerHTML =
    "";


  const searchTerm =
    String(
      channelSearchTerm || ""
    )
      .trim()
      .toLocaleLowerCase(
        "ko"
      );


  const filteredMemberships =
    memberships.filter(
      (membership) => {

        const channelName =
          membership.channel?.name ||
          membership.channelName ||
          "";


        return (
          !searchTerm ||

          channelName
            .toLocaleLowerCase(
              "ko"
            )
            .includes(
              searchTerm
            )
        );
      }
    );


  /*
   * 연결된 채널 자체가 없음
   */
  if (!memberships.length) {

    channelList.innerHTML = `
      <div
        class="panel channel-empty"
      >
        <strong>
          현재 연결된 채널이 없습니다.
        </strong>

        <span>
          채널 소유자에게 초대를 받거나
          채널 생성을 신청해주세요.
        </span>
      </div>
    `;


    return;
  }


  /*
   * 검색 결과 없음
   */
  if (!filteredMemberships.length) {

    channelList.innerHTML = `
      <div
        class="panel channel-empty"
      >
        <strong>
          검색 결과가 없습니다.
        </strong>

        <span>
          다른 채널 이름으로 검색해보세요.
        </span>
      </div>
    `;


    return;
  }


  filteredMemberships.forEach(
    (membership) => {

      const channel =
        membership.channel;


      const card =
        document.createElement(
          "article"
        );


      card.className =
        "panel channel-card";


      card.innerHTML = `

        <div class="channel-card-head">

          ${
            channel.photoURL
              ? `
                <img
                  class="channel-card-image"
                  src="${escapeHtml(
                    channel.photoURL
                  )}"
                  alt="${escapeHtml(
                    channel.name ||
                    "채널"
                  )} 대표 이미지"
                />
              `
              : `
                <div
                  class="channel-card-image channel-card-image-empty"
                >
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


channelSearch
  ?.addEventListener(
    "input",
    (event) => {

      channelSearchTerm =
        event.target.value ||
        "";


      renderChannels();
    }
  );


/* =========================================================
   일반 사용자 채널 생성 신청
========================================================= */

async function syncMyChannelRequestButton() {
  if (
    !currentUser ||
    !requestChannelCreationButton ||
    isDeveloper(
      currentProfile
    )
  ) {
    return;
  }


  try {

    const requestSnapshot =
      await getDoc(
        doc(
          db,
          "channelCreationRequests",
          currentUser.uid
        )
      );


    const pending =
      requestSnapshot.exists() &&
      requestSnapshot.data().status ===
        "pending";


    requestChannelCreationButton.disabled =
      pending;


    requestChannelCreationButton.textContent =
      pending
        ? "채널 생성 신청 대기중"
        : "채널 생성 신청하기";

  } catch (error) {

    console.error(
      "내 채널 생성 신청 확인 실패",
      error
    );


    requestChannelCreationButton.disabled =
      false;


    requestChannelCreationButton.textContent =
      "채널 생성 신청하기";
  }
}


async function requestChannelCreation() {
  if (
    !currentUser ||
    !currentProfile ||
    isDeveloper(
      currentProfile
    )
  ) {
    return;
  }


  const button =
    requestChannelCreationButton;


  button.disabled =
    true;


  button.textContent =
    "신청 중...";


  try {

    const requestRef =
      doc(
        db,
        "channelCreationRequests",
        currentUser.uid
      );


    const existingSnapshot =
      await getDoc(
        requestRef
      );


    if (
      existingSnapshot.exists() &&
      existingSnapshot.data().status ===
        "pending"
    ) {

      setMessage(
        "이미 채널 생성 신청이 접수되어 있습니다."
      );


      await syncMyChannelRequestButton();


      return;
    }


    const existingCreatedAt =
      existingSnapshot.exists()
        ? existingSnapshot.data()
            .createdAt
        : null;


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
          currentUser.email ||
          "",

        status:
          "pending",

        createdAt:
          existingCreatedAt ||
          serverTimestamp(),

        updatedAt:
          serverTimestamp()
      },
      {
        merge:
          true
      }
    );


    setMessage(
      "채널 생성 신청이 완료되었습니다.",
      true
    );


    await syncMyChannelRequestButton();

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


    button.disabled =
      false;


    button.textContent =
      "채널 생성 신청하기";
  }
}


requestChannelCreationButton
  ?.addEventListener(
    "click",
    requestChannelCreation
  );


/* =========================================================
   개발자 채널 생성 신청 실시간 알림
========================================================= */

function setChannelRequestBadge(
  count
) {
  if (
    !channelRequestBadge
  ) {
    return;
  }


  channelRequestBadge.textContent =
    count > 99
      ? "99+"
      : String(count);


  channelRequestBadge.classList.toggle(
    "hidden",
    count === 0
  );
}


function startChannelRequestWatcher() {
  if (
    !isDeveloper(
      currentProfile
    ) ||
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

        setChannelRequestBadge(
          snapshot.size
        );


        openChannelRequestsButton
          ?.classList
          .remove(
            "hidden"
          );


        /*
         * 신청 목록 팝업이 열린 상태라면
         * 실시간으로 목록도 갱신.
         */
        if (
          channelRequestsModal &&
          !channelRequestsModal
            .classList
            .contains(
              "hidden"
            )
        ) {
          renderChannelRequests(
            snapshot.docs.map(
              (item) => ({
                id:
                  item.id,

                ...item.data()
              })
            )
          );
        }
      },

      (error) => {

        console.error(
          "채널 신청 실시간 조회 실패",
          error
        );
      }
    );
}


/* =========================================================
   개발자 채널 생성 신청 목록
========================================================= */

function formatRequestDate(
  value
) {
  const date =
    value?.toDate?.();


  if (!date) {
    return "-";
  }


  return new Intl.DateTimeFormat(
    "ko-KR",
    {
      year:
        "numeric",

      month:
        "2-digit",

      day:
        "2-digit",

      hour:
        "2-digit",

      minute:
        "2-digit",

      hour12:
        false
    }
  ).format(
    date
  );
}


function openChannelRequestsModal() {
  if (
    !isDeveloper(
      currentProfile
    )
  ) {
    return;
  }


  channelRequestsModal.classList.remove(
    "hidden"
  );


  document.body.classList.add(
    "modal-open"
  );


  loadChannelRequests();
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
  if (
    !isDeveloper(
      currentProfile
    )
  ) {
    return;
  }


  channelRequestsMessage.textContent =
    "신청 목록을 불러오는 중...";


  try {

    const snapshot =
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
      snapshot.docs.map(
        (item) => ({
          id:
            item.id,

          ...item.data()
        })
      );


    renderChannelRequests(
      requests
    );


    channelRequestsMessage.textContent =
      "";

  } catch (error) {

    console.error(
      "채널 생성 신청 목록 조회 실패",
      error
    );


    channelRequestsMessage.textContent =
      firebaseErrorMessage(
        error,
        "채널 생성 신청을 불러오지 못했습니다."
      );
  }
}


function renderChannelRequests(
  requests
) {
  const sorted =
    [...requests].sort(
      (a, b) =>
        (
          b.updatedAt
            ?.toMillis?.() ||
          b.createdAt
            ?.toMillis?.() ||
          0
        ) -
        (
          a.updatedAt
            ?.toMillis?.() ||
          a.createdAt
            ?.toMillis?.() ||
          0
        )
    );


  channelRequestsList.innerHTML =
    "";


  if (!sorted.length) {

    channelRequestsList.innerHTML = `
      <div class="channel-request-empty">
        현재 대기 중인 채널 생성 신청이 없습니다.
      </div>
    `;


    return;
  }


  sorted.forEach(
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
            신청
            ${escapeHtml(
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


            if (!ownerExists) {

              channelRequestsMessage.textContent =
                "신청한 사용자를 채널 소유자 목록에서 찾을 수 없습니다.";


              return;
            }


            selectedChannelRequestUid =
              request.requesterUid;


            channelOwnerSelect.value =
              request.requesterUid;


            closeChannelRequestsModal();


            openCreateChannelModal(
              request.requesterUid
            );
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
              request.id
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
  requestId
) {
  try {

    await deleteDoc(
      doc(
        db,
        "channelCreationRequests",
        requestId
      )
    );


    await loadChannelRequests();

  } catch (error) {

    console.error(
      "채널 생성 신청 처리 실패",
      error
    );


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


/* =========================================================
   채널 생성
========================================================= */

async function createChannel(
  event
) {
  event.preventDefault();


  if (
    !isDeveloper(
      currentProfile
    )
  ) {
    return;
  }


  const channelNameInput =
    document.getElementById(
      "channelName"
    );


  const name =
    channelNameInput.value
      .trim();


  const ownerUid =
    channelOwnerSelect.value;


  if (!name) {

    setCreateMessage(
      "채널 이름을 입력해주세요."
    );


    channelNameInput.focus();


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

        /*
         * 채널
         */
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
         * 소유자
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


    /*
     * 신청 목록에서 바로 생성한 경우
     * 성공 후 신청도 자동 제거.
     */
    if (
      selectedChannelRequestUid &&
      selectedChannelRequestUid ===
        ownerUid
    ) {

      try {

        await deleteDoc(
          doc(
            db,
            "channelCreationRequests",
            selectedChannelRequestUid
          )
        );

      } catch (error) {

        console.warn(
          "채널 신청 자동 처리 실패",
          error
        );
      }
    }


    selectedChannelRequestUid =
      null;


    createChannelForm.reset();


    closeCreateChannelModal();


    setMessage(
      `${name} 채널을 생성했습니다.`,
      true
    );


    await loadChannels();


    renderChannels();

  } catch (error) {

    console.error(
      "채널 생성 실패",
      error
    );


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


/* =========================================================
   ESC 팝업 닫기
========================================================= */

document.addEventListener(
  "keydown",
  (event) => {

    if (
      event.key !==
      "Escape"
    ) {
      return;
    }


    if (
      createChannelModal &&
      !createChannelModal
        .classList
        .contains(
          "hidden"
        )
    ) {

      closeCreateChannelModal();

      return;
    }


    if (
      channelRequestsModal &&
      !channelRequestsModal
        .classList
        .contains(
          "hidden"
        )
    ) {

      closeChannelRequestsModal();
    }
  }
);


/* =========================================================
   로그아웃
========================================================= */

document
  .getElementById(
    "logoutButton"
  )
  ?.addEventListener(
    "click",
    async () => {

      if (
        channelRequestsUnsubscribe
      ) {

        channelRequestsUnsubscribe();

        channelRequestsUnsubscribe =
          null;
      }


      await signOut(
        auth
      );


      location.replace(
        "./index.html"
      );
    }
  );


/* =========================================================
   초기화
========================================================= */

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
       * 개발자 버튼
       */
      openCreateChannelButton
        ?.classList
        .toggle(
          "hidden",
          !developer
        );


      openChannelRequestsButton
        ?.classList
        .toggle(
          "hidden",
          !developer
        );


      /*
       * 일반 사용자 신청 버튼
       */
      requestChannelCreationButton
        ?.classList
        .toggle(
          "hidden",
          developer
        );


      if (developer) {

        await loadUsersForDeveloper();


        startChannelRequestWatcher();

      } else {

        await syncMyChannelRequestButton();
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

      console.error(
        "채널 페이지 초기화 실패",
        error
      );


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

            await signOut(
              auth
            );


            location.replace(
              "./index.html"
            );
          }
        );
    }
  }
);