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
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
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
} from "./channel-context.js?v=31";

import {
  firebaseErrorMessage
} from "./error-messages.js?v=31";

import {
  showConfirm
} from "./ui-dialog.js?v=31";


const CHANNEL_PAGE_SIZE = 8;
const REQUEST_PAGE_SIZE = 10;


/* =========================================================
   DOM
========================================================= */

const loadingPanel =
  document.getElementById("loadingPanel");

const channelContent =
  document.getElementById("channelContent");

const channelList =
  document.getElementById("channelList");

const channelMessage =
  document.getElementById("channelMessage");

const channelSearch =
  document.getElementById("channelSearch");

const ownedChannelSection =
  document.getElementById("ownedChannelSection");

const ownedChannelList =
  document.getElementById("ownedChannelList");

const ownedChannelCount =
  document.getElementById("ownedChannelCount");

const joinedChannelHeading =
  document.getElementById("joinedChannelHeading");

const channelPagination =
  document.getElementById("channelPagination");

const channelPageSummary =
  document.getElementById("channelPageSummary");

const channelPageNumber =
  document.getElementById("channelPageNumber");

const channelPrevButton =
  document.getElementById("channelPrevButton");

const channelNextButton =
  document.getElementById("channelNextButton");


const openCreateChannelButton =
  document.getElementById("openCreateChannelButton");

const createChannelModal =
  document.getElementById("createChannelModal");

const createChannelForm =
  document.getElementById("createChannelForm");

const channelOwnerSearch =
  document.getElementById("channelOwnerSearch");

const channelOwnerSelect =
  document.getElementById("channelOwner");

const channelOwnerSearchResult =
  document.getElementById("channelOwnerSearchResult");

const createChannelMessage =
  document.getElementById("createChannelMessage");


const requestChannelCreationButton =
  document.getElementById("requestChannelCreationButton");

const openChannelRequestsButton =
  document.getElementById("openChannelRequestsButton");

const channelRequestBadge =
  document.getElementById("channelRequestBadge");

const channelRequestsModal =
  document.getElementById("channelRequestsModal");

const channelRequestsList =
  document.getElementById("channelRequestsList");

const channelRequestsMessage =
  document.getElementById("channelRequestsMessage");

const channelRequestsPagination =
  document.getElementById("channelRequestsPagination");

const channelRequestsPageSummary =
  document.getElementById("channelRequestsPageSummary");

const channelRequestsPageNumber =
  document.getElementById("channelRequestsPageNumber");

const channelRequestsPrev =
  document.getElementById("channelRequestsPrev");

const channelRequestsNext =
  document.getElementById("channelRequestsNext");


/* =========================================================
   상태
========================================================= */

let currentUser = null;
let currentProfile = null;

let memberships = [];

let allOwnerUsers = [];
let usersByUid = new Map();

let channelSearchTerm = "";
let channelPage = 1;

let channelRequestsUnsubscribe = null;
let cachedChannelRequests = [];
let requestPage = 1;

let selectedChannelRequestUid = null;


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


function normalizeMemberStatus(status) {
  return status === "active"
    ? "approved"
    : status || "pending";
}


function setMessage(text, success = false) {
  channelMessage.textContent = text || "";
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
    text || "";

  createChannelMessage.classList.toggle(
    "success",
    success
  );
}


function channelNameOf(membership) {
  return (
    membership.channel?.name ||
    membership.channelName ||
    "HNSITE 채널"
  );
}


function isOwnedMembership(membership) {
  if (
    isDeveloper(currentProfile)
  ) {
    return false;
  }

  return (
    membership.role === "owner" ||
    membership.channel?.ownerUid ===
      currentUser?.uid
  );
}


/* =========================================================
   채널 카드
========================================================= */

function makeChannelCard(
  membership,
  owned = false
) {
  const channel =
    membership.channel;

  const card =
    document.createElement("article");

  card.className =
    `panel channel-card${
      owned
        ? " owned-channel-card"
        : ""
    }`;

  card.innerHTML = `
    <div class="channel-card-head">

      ${
        channel.photoURL
          ? `
            <img
              class="channel-card-image"
              src="${escapeHtml(channel.photoURL)}"
              alt="${escapeHtml(channelNameOf(membership))} 대표 이미지"
            />
          `
          : `
            <div class="channel-card-image channel-card-image-empty">
              H
            </div>
          `
      }

      <div class="channel-card-info">

        ${
          owned
            ? `
              <span class="owned-channel-badge">
                내 채널
              </span>
            `
            : ""
        }

        <h2>
          ${escapeHtml(
            channelNameOf(membership)
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

  return card;
}


/* =========================================================
   채널 데이터
========================================================= */

async function loadChannels() {

  /*
   * 개발자
   * 모든 활성 채널
   */
  if (
    isDeveloper(currentProfile)
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
        .map((item) => ({
          role: "developer",
          status: "approved",

          channel: {
            id: item.id,
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
            channelNameOf(a)
              .localeCompare(
                channelNameOf(b),
                "ko"
              )
        );

    return;
  }


  /*
   * 일반 사용자
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
    membershipSnapshot.docs
      .map((item) => ({
        id: item.id,
        ...item.data(),

        status:
          normalizeMemberStatus(
            item.data().status
          )
      }));


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
              id: channelSnapshot.id,
              ...channelSnapshot.data()
            };


            if (
              channel.status !== "active"
            ) {
              return null;
            }


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
          channelNameOf(a)
            .localeCompare(
              channelNameOf(b),
              "ko"
            )
      );
}


/* =========================================================
   채널 렌더링 / 페이징
========================================================= */

function renderChannels() {
  setMessage("");

  ownedChannelList.innerHTML = "";
  channelList.innerHTML = "";


  const developer =
    isDeveloper(currentProfile);


  const owned =
    developer
      ? []
      : memberships.filter(
          isOwnedMembership
        );


  const pageable =
    developer
      ? memberships
      : memberships.filter(
          (membership) =>
            !isOwnedMembership(
              membership
            )
        );


  /*
   * 내 소유 채널은
   * 검색/페이징과 무관하게 항상 표시.
   */
  ownedChannelSection.classList.toggle(
    "hidden",
    owned.length === 0
  );


  joinedChannelHeading.classList.toggle(
    "hidden",
    developer
  );


  if (owned.length) {

    ownedChannelCount.textContent =
      `${owned.length}개`;

    owned.forEach(
      (membership) => {
        ownedChannelList.appendChild(
          makeChannelCard(
            membership,
            true
          )
        );
      }
    );
  }


  const term =
    channelSearchTerm
      .trim()
      .toLocaleLowerCase(
        "ko"
      );


  const filtered =
    pageable.filter(
      (membership) => {

        const name =
          channelNameOf(
            membership
          )
            .toLocaleLowerCase(
              "ko"
            );

        return (
          !term ||
          name.includes(term)
        );
      }
    );


  const totalPages =
    Math.max(
      1,
      Math.ceil(
        filtered.length /
        CHANNEL_PAGE_SIZE
      )
    );


  channelPage =
    Math.min(
      Math.max(
        1,
        channelPage
      ),
      totalPages
    );


  if (
    !memberships.length
  ) {

    channelList.innerHTML = `
      <div class="panel channel-empty">
        <strong>
          현재 연결된 채널이 없습니다.
        </strong>

        <span>
          채널 소유자에게 초대를 받거나
          채널 생성을 신청해주세요.
        </span>
      </div>
    `;

    channelPagination.classList.add(
      "hidden"
    );

    return;
  }


  /*
   * 내 채널만 있고
   * 가입한 다른 채널이 없는 경우
   */
  if (
    !developer &&
    owned.length &&
    !pageable.length
  ) {

    channelList.innerHTML = `
      <div class="channel-secondary-empty">
        가입한 다른 채널이 없습니다.
      </div>
    `;

    channelPagination.classList.add(
      "hidden"
    );

    return;
  }


  if (!filtered.length) {

    channelList.innerHTML = `
      <div class="panel channel-empty">
        <strong>
          검색 결과가 없습니다.
        </strong>

        <span>
          다른 채널 이름으로 검색해보세요.
        </span>
      </div>
    `;

    channelPagination.classList.add(
      "hidden"
    );

    return;
  }


  const start =
    (channelPage - 1) *
    CHANNEL_PAGE_SIZE;

  const pageItems =
    filtered.slice(
      start,
      start +
      CHANNEL_PAGE_SIZE
    );


  pageItems.forEach(
    (membership) => {

      channelList.appendChild(
        makeChannelCard(
          membership
        )
      );
    }
  );


  renderChannelPagination(
    filtered.length,
    start,
    pageItems.length,
    totalPages
  );
}


function renderChannelPagination(
  total,
  start,
  visibleCount,
  totalPages
) {
  if (
    total <= CHANNEL_PAGE_SIZE
  ) {

    channelPagination.classList.add(
      "hidden"
    );

    return;
  }


  channelPagination.classList.remove(
    "hidden"
  );


  channelPageSummary.textContent =
    `총 ${total}개 · ${
      start + 1
    }-${start + visibleCount}개 표시`;


  channelPageNumber.textContent =
    `${channelPage} / ${totalPages}`;


  channelPrevButton.disabled =
    channelPage <= 1;


  channelNextButton.disabled =
    channelPage >= totalPages;
}


channelPrevButton
  ?.addEventListener(
    "click",
    () => {

      if (
        channelPage <= 1
      ) {
        return;
      }

      channelPage -= 1;

      renderChannels();
    }
  );


channelNextButton
  ?.addEventListener(
    "click",
    () => {

      channelPage += 1;

      renderChannels();
    }
  );


channelSearch
  ?.addEventListener(
    "input",
    (event) => {

      channelSearchTerm =
        event.target.value || "";

      channelPage = 1;

      renderChannels();
    }
  );


/* =========================================================
   개발자 사용자 / 소유자 검색
========================================================= */

async function loadUsersForDeveloper() {
  if (
    !isDeveloper(currentProfile)
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


  allOwnerUsers =
    snapshot.docs
      .map((item) => ({
        uid: item.id,
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
      allOwnerUsers.map(
        (user) => [
          user.uid,
          user
        ]
      )
    );


  renderOwnerOptions();
}


function renderOwnerOptions(
  preserveUid = ""
) {
  const term =
    (
      channelOwnerSearch
        ?.value ||
      ""
    )
      .trim()
      .toLocaleLowerCase(
        "ko"
      );


  const filtered =
    allOwnerUsers.filter(
      (user) => {

        if (!term) {
          return true;
        }

        const haystack =
          `${user.name || ""} ${
            user.email || ""
          }`
            .toLocaleLowerCase(
              "ko"
            );

        return haystack.includes(
          term
        );
      }
    );


  channelOwnerSelect.innerHTML =
    "";


  if (!filtered.length) {

    channelOwnerSelect.innerHTML = `
      <option value="">
        검색 결과가 없습니다.
      </option>
    `;

    channelOwnerSearchResult.textContent =
      "검색 결과 0명";

    return;
  }


  filtered.forEach(
    (user) => {

      const option =
        document.createElement(
          "option"
        );

      option.value =
        user.uid;

      option.textContent =
        `${
          user.name ||
          user.email ||
          "사용자"
        } · ${
          user.email || ""
        }`;

      channelOwnerSelect.appendChild(
        option
      );
    }
  );


  channelOwnerSearchResult.textContent =
    `검색 결과 ${filtered.length}명`;


  if (
    preserveUid &&
    filtered.some(
      (user) =>
        user.uid ===
        preserveUid
    )
  ) {

    channelOwnerSelect.value =
      preserveUid;
  }
}


channelOwnerSearch
  ?.addEventListener(
    "input",
    () => {
      renderOwnerOptions();
    }
  );


/* =========================================================
   채널 생성 모달
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


  if (ownerUid) {

    const owner =
      usersByUid.get(
        ownerUid
      );


    if (owner) {

      channelOwnerSearch.value =
        owner.name ||
        owner.email ||
        "";

      renderOwnerOptions(
        ownerUid
      );
    }

  } else {

    channelOwnerSearch.value =
      "";

    renderOwnerOptions();
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
   기본 대표사진
========================================================= */

async function getRandomChannelPhoto() {
  const folder =
    storageRef(
      storage,
      "channel-defaults"
    );


  const result =
    await listAll(folder);


  const images =
    result.items.filter(
      (item) =>
        /\.(jpg|jpeg|png|webp)$/i
          .test(item.name)
    );


  if (!images.length) {
    return "";
  }


  const item =
    images[
      Math.floor(
        Math.random() *
        images.length
      )
    ];


  return await getDownloadURL(
    item
  );
}


/* =========================================================
   일반 사용자 채널 생성 신청
========================================================= */

async function syncMyChannelRequestButton() {
  if (
    !currentUser ||
    !currentProfile ||
    isDeveloper(currentProfile)
  ) {
    return;
  }


  try {

    const snapshot =
      await getDoc(
        doc(
          db,
          "channelCreationRequests",
          currentUser.uid
        )
      );


    const pending =
      snapshot.exists() &&
      snapshot.data().status ===
        "pending";


    requestChannelCreationButton.disabled =
      pending;


    requestChannelCreationButton.textContent =
      pending
        ? "채널 생성 신청 대기중"
        : "채널 생성 신청하기";

  } catch (error) {

    console.error(
      "채널 생성 신청 상태 확인 실패",
      error
    );
  }
}


async function requestChannelCreation() {
  if (
    !currentUser ||
    !currentProfile ||
    isDeveloper(currentProfile)
  ) {
    return;
  }


  requestChannelCreationButton.disabled =
    true;

  requestChannelCreationButton.textContent =
    "신청 중...";


  try {

    const requestRef =
      doc(
        db,
        "channelCreationRequests",
        currentUser.uid
      );


    const existing =
      await getDoc(
        requestRef
      );


    if (
      existing.exists() &&
      existing.data().status ===
        "pending"
    ) {

      setMessage(
        "이미 채널 생성 신청이 접수되어 있습니다."
      );

      await syncMyChannelRequestButton();

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
          currentUser.email ||
          "",

        status:
          "pending",

        createdAt:
          serverTimestamp(),

        updatedAt:
          serverTimestamp(),

        approvedAt:
          null,

        approvedByUid:
          "",

        rejectedAt:
          null,

        rejectedByUid:
          "",

        channelId:
          ""
      },
      {
        merge: true
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


    requestChannelCreationButton.disabled =
      false;

    requestChannelCreationButton.textContent =
      "채널 생성 신청하기";
  }
}


requestChannelCreationButton
  ?.addEventListener(
    "click",
    requestChannelCreation
  );


/* =========================================================
   채널 신청 개발자 실시간 감시
========================================================= */

function startChannelRequestWatcher() {
  if (
    !isDeveloper(currentProfile) ||
    channelRequestsUnsubscribe
  ) {
    return;
  }


  const requestQuery =
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
      requestQuery,

      (snapshot) => {

        cachedChannelRequests =
          snapshot.docs
            .map((item) => ({
              id: item.id,
              ...item.data()
            }))
            .sort(
              (a, b) =>
                (
                  b.createdAt
                    ?.toMillis?.() ||
                  0
                ) -
                (
                  a.createdAt
                    ?.toMillis?.() ||
                  0
                )
            );


        const count =
          cachedChannelRequests.length;


        channelRequestBadge.textContent =
          count > 99
            ? "99+"
            : String(count);


        channelRequestBadge.classList.toggle(
          "hidden",
          count === 0
        );


        if (
          !channelRequestsModal
            .classList
            .contains("hidden")
        ) {
          renderChannelRequests();
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
   채널 신청 모달 / 페이징
========================================================= */

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


function openChannelRequestsModal() {
  if (
    !isDeveloper(currentProfile)
  ) {
    return;
  }


  requestPage = 1;

  channelRequestsModal.classList.remove(
    "hidden"
  );

  document.body.classList.add(
    "modal-open"
  );

  renderChannelRequests();
}


function closeChannelRequestsModal() {
  channelRequestsModal.classList.add(
    "hidden"
  );

  document.body.classList.remove(
    "modal-open"
  );
}


function renderChannelRequests() {
  channelRequestsList.innerHTML =
    "";

  channelRequestsMessage.textContent =
    "";


  if (
    !cachedChannelRequests.length
  ) {

    channelRequestsList.innerHTML = `
      <div class="channel-request-empty">
        현재 대기 중인 채널 생성 신청이 없습니다.
      </div>
    `;

    channelRequestsPagination.classList.add(
      "hidden"
    );

    return;
  }


  const total =
    cachedChannelRequests.length;


  const totalPages =
    Math.max(
      1,
      Math.ceil(
        total /
        REQUEST_PAGE_SIZE
      )
    );


  requestPage =
    Math.min(
      Math.max(
        1,
        requestPage
      ),
      totalPages
    );


  const start =
    (requestPage - 1) *
    REQUEST_PAGE_SIZE;


  const pageItems =
    cachedChannelRequests.slice(
      start,
      start +
      REQUEST_PAGE_SIZE
    );


  pageItems.forEach(
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
            class="danger-outline reject-request-button"
            type="button"
          >
            거절
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

            selectedChannelRequestUid =
              request.requesterUid;


            closeChannelRequestsModal();


            openCreateChannelModal(
              request.requesterUid
            );
          }
        );


      item
        .querySelector(
          ".reject-request-button"
        )
        .addEventListener(
          "click",
          () =>
            rejectChannelRequest(
              request
            )
        );


      channelRequestsList.appendChild(
        item
      );
    }
  );


  if (
    total <= REQUEST_PAGE_SIZE
  ) {

    channelRequestsPagination.classList.add(
      "hidden"
    );

    return;
  }


  channelRequestsPagination.classList.remove(
    "hidden"
  );


  channelRequestsPageSummary.textContent =
    `총 ${total}건 · ${
      start + 1
    }-${start + pageItems.length}건 표시`;


  channelRequestsPageNumber.textContent =
    `${requestPage} / ${totalPages}`;


  channelRequestsPrev.disabled =
    requestPage <= 1;


  channelRequestsNext.disabled =
    requestPage >= totalPages;
}


channelRequestsPrev
  ?.addEventListener(
    "click",
    () => {

      if (
        requestPage <= 1
      ) {
        return;
      }

      requestPage -= 1;

      renderChannelRequests();
    }
  );


channelRequestsNext
  ?.addEventListener(
    "click",
    () => {

      requestPage += 1;

      renderChannelRequests();
    }
  );


async function rejectChannelRequest(
  request
) {
  const confirmed =
    await showConfirm(
      `${
        request.requesterName ||
        request.requesterEmail ||
        "선택한 사용자"
      }님의 채널 생성 신청을 거절할까요?`,
      {
        title: "채널 생성 신청 거절",
        confirmText: "거절",
        danger: true
      }
    );


  if (!confirmed) {
    return;
  }


  try {

    await updateDoc(
      doc(
        db,
        "channelCreationRequests",
        request.id
      ),
      {
        status:
          "rejected",

        rejectedAt:
          serverTimestamp(),

        rejectedByUid:
          currentUser.uid,

        approvedAt:
          null,

        approvedByUid:
          "",

        channelId:
          "",

        updatedAt:
          serverTimestamp()
      }
    );


    channelRequestsMessage.textContent =
      "채널 생성 신청을 거절했습니다.";


  } catch (error) {

    console.error(
      "채널 생성 신청 거절 실패",
      error
    );


    channelRequestsMessage.textContent =
      firebaseErrorMessage(
        error,
        "채널 생성 신청 거절에 실패했습니다."
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
   실제 채널 생성
========================================================= */

async function createChannel(event) {
  event.preventDefault();


  if (
    !isDeveloper(currentProfile)
  ) {
    return;
  }


  const nameInput =
    document.getElementById(
      "channelName"
    );


  const name =
    nameInput.value.trim();


  const ownerUid =
    channelOwnerSelect.value;


  if (!name) {

    setCreateMessage(
      "채널 이름을 입력해주세요."
    );

    nameInput.focus();

    return;
  }


  if (!ownerUid) {

    setCreateMessage(
      "채널 소유자를 선택해주세요."
    );

    return;
  }


  const owner =
    usersByUid.get(ownerUid);


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


  button.disabled = true;
  button.textContent = "생성 중...";


  try {

    let photoURL = "";


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
              owner.email || "",

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
              owner.email || "",

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
     * 채널 신청을 통해 생성한 경우
     * 신청을 승인 완료로 기록.
     */
    if (
      selectedChannelRequestUid &&
      selectedChannelRequestUid ===
        ownerUid
    ) {

      try {

        await updateDoc(
          doc(
            db,
            "channelCreationRequests",
            selectedChannelRequestUid
          ),
          {
            status:
              "approved",

            channelId:
              channelRef.id,

            approvedAt:
              serverTimestamp(),

            approvedByUid:
              currentUser.uid,

            rejectedAt:
              null,

            rejectedByUid:
              "",

            updatedAt:
              serverTimestamp()
          }
        );

      } catch (error) {

        console.error(
          "채널 신청 승인 기록 실패",
          error
        );
      }
    }


    selectedChannelRequestUid =
      null;


    createChannelForm.reset();

    channelOwnerSearch.value =
      "";

    renderOwnerOptions();


    closeCreateChannelModal();


    setMessage(
      `${name} 채널을 생성했습니다.`,
      true
    );


    channelPage = 1;


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
   ESC
========================================================= */

document.addEventListener(
  "keydown",
  (event) => {

    if (
      event.key !== "Escape"
    ) {
      return;
    }


    if (
      !createChannelModal
        .classList
        .contains("hidden")
    ) {

      closeCreateChannelModal();

      return;
    }


    if (
      !channelRequestsModal
        .classList
        .contains("hidden")
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


      await signOut(auth);


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

      currentUser = user;


      currentProfile =
        await loadPlatformProfile(
          user
        );


      document
        .getElementById(
          "userEmail"
        )
        .textContent =
          user.email || "";


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


      openCreateChannelButton
        .classList
        .toggle(
          "hidden",
          !developer
        );


      openChannelRequestsButton
        .classList
        .toggle(
          "hidden",
          !developer
        );


      requestChannelCreationButton
        .classList
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

            await signOut(auth);

            location.replace(
              "./index.html"
            );
          }
        );
    }
  }
);