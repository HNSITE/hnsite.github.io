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
  isMemberApproved,
  normalizeMemberStatus,
  loadPlatformProfile,
  setCurrentChannelId
} from "./channel-context.js";

import {
  firebaseErrorMessage
} from "./error-messages.js";

import {
  showConfirm
} from "./ui-dialog.js";

import {
  channelNameRegistryRef,
  isChannelNameAvailable,
  resolveChannelByName,
  uniqueNameKey,
  validateChannelName
} from "./name-registry.js";

import {
  initDeveloperChannelTools
} from "./developer-channel-tools.js";

import {
  setTopbarContext
} from "./topbar-menu.js";


const CHANNEL_PAGE_SIZE = 8;
const JOINED_PAGE_SIZE = 8;
const REQUEST_PAGE_SIZE = 10;


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


const ownedChannelSection =
  document.getElementById(
    "ownedChannelSection"
  );

const ownedChannelList =
  document.getElementById(
    "ownedChannelList"
  );

const ownedChannelCount =
  document.getElementById(
    "ownedChannelCount"
  );


const joinedChannelSection =
  document.getElementById(
    "joinedChannelSection"
  );

const joinedChannelList =
  document.getElementById(
    "joinedChannelList"
  );

const joinedChannelCount =
  document.getElementById(
    "joinedChannelCount"
  );

const joinedChannelPagination =
  document.getElementById(
    "joinedChannelPagination"
  );

const joinedChannelPageSummary =
  document.getElementById(
    "joinedChannelPageSummary"
  );

const joinedChannelPageNumber =
  document.getElementById(
    "joinedChannelPageNumber"
  );

const joinedChannelPrev =
  document.getElementById(
    "joinedChannelPrev"
  );

const joinedChannelNext =
  document.getElementById(
    "joinedChannelNext"
  );


const channelFindTitle =
  document.getElementById(
    "channelFindTitle"
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

const channelPagination =
  document.getElementById(
    "channelPagination"
  );

const channelPageSummary =
  document.getElementById(
    "channelPageSummary"
  );

const channelPageNumber =
  document.getElementById(
    "channelPageNumber"
  );

const channelPrevButton =
  document.getElementById(
    "channelPrevButton"
  );

const channelNextButton =
  document.getElementById(
    "channelNextButton"
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

const channelOwnerSearch =
  document.getElementById(
    "channelOwnerSearch"
  );

const channelOwnerSelect =
  document.getElementById(
    "channelOwner"
  );

const channelOwnerSearchResult =
  document.getElementById(
    "channelOwnerSearchResult"
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

const channelRequestsPagination =
  document.getElementById(
    "channelRequestsPagination"
  );

const channelRequestsPageSummary =
  document.getElementById(
    "channelRequestsPageSummary"
  );

const channelRequestsPageNumber =
  document.getElementById(
    "channelRequestsPageNumber"
  );

const channelRequestsPrev =
  document.getElementById(
    "channelRequestsPrev"
  );

const channelRequestsNext =
  document.getElementById(
    "channelRequestsNext"
  );


/* =========================================================
   STATE
========================================================= */

let currentUser = null;
let currentProfile = null;

let memberships = [];
let directoryChannels = [];

let allOwnerUsers = [];
let usersByUid = new Map();

let joinedPage = 1;

let channelSearchTerm = "";
let channelPage = 1;

let channelRequestsUnsubscribe = null;
let cachedChannelRequests = [];
let requestPage = 1;

let selectedChannelRequestUid = null;
let developerChannelIds = new Set();


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


function setMessage(
  text,
  success = false
) {
  channelMessage.textContent =
    text || "";

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


function membershipChannelId(
  item
) {
  return (
    item.channel?.id ||
    item.channelId ||
    item.id ||
    ""
  );
}


function membershipChannelName(
  item
) {
  return (
    item.channel?.name ||
    item.channelName ||
    "HNSITE 채널"
  );
}


function membershipPhoto(
  item
) {
  return (
    item.channel?.photoURL ||
    item.photoURL ||
    ""
  );
}


function membershipStatus(
  item
) {
  return normalizeMemberStatus(
    item.status
  );
}


function isOwnedMembership(
  item
) {
  return (
    !isDeveloper(
      currentProfile
    ) &&
    item.role === "owner" &&
    isMemberApproved(
      item
    )
  );
}


/* =========================================================
   가입/소유 채널 카드
========================================================= */

function makeMembershipCard(
  item,
  owned = false
) {
  const channelId =
    membershipChannelId(
      item
    );

  const name =
    membershipChannelName(
      item
    );

  const photoURL =
    membershipPhoto(
      item
    );

  const status =
    membershipStatus(
      item
    );

  const approved =
    isMemberApproved(
      item
    ) ||
    isDeveloper(
      currentProfile
    );


  const card =
    document.createElement(
      "article"
    );


  card.className =
    `panel channel-card${
      owned
        ? " owned-channel-card"
        : ""
    }`;


  card.innerHTML = `
    <div class="channel-card-head">

      ${
        photoURL
          ? `
            <img
              class="channel-card-image"
              src="${escapeHtml(photoURL)}"
              alt="${escapeHtml(name)} 대표 이미지"
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

        ${
          owned
            ? `
              <span class="owned-channel-badge">
                내 채널
              </span>
            `
            : ""
        }

        ${
          status === "pending"
            ? `
              <span class="pending-channel-badge">
                승인 대기
              </span>
            `
            : ""
        }

        <h2>
          ${escapeHtml(name)}
        </h2>

      </div>

    </div>

    <div class="channel-card-actions"></div>
  `;


  const actions =
    card.querySelector(
      ".channel-card-actions"
    );


  const button =
    document.createElement(
      "button"
    );


  button.type =
    "button";


  if (approved) {

    button.className =
      "select-channel-button";

    button.textContent =
      "채널 입장";


    button.addEventListener(
      "click",
      () => {

        setCurrentChannelId(
          currentUser.uid,
          channelId
        );


        location.href =
          "./app.html";
      }
    );

  } else if (
    status === "pending"
  ) {

    button.className =
      "secondary pending-channel-button";

    button.textContent =
      "승인 대기 확인";


    button.addEventListener(
      "click",
      () => {

        setCurrentChannelId(
          currentUser.uid,
          channelId
        );


        location.href =
          "./app.html";
      }
    );

  } else {

    button.className =
      "secondary";

    button.textContent =
      "현재 이용 불가";

    button.disabled =
      true;
  }


  actions.appendChild(
    button
  );


  return card;
}


/* =========================================================
   내 채널 + 가입 채널 렌더링
========================================================= */

function renderMembershipSections() {

  if (
    isDeveloper(
      currentProfile
    )
  ) {

    ownedChannelSection
      .classList
      .add("hidden");

    joinedChannelSection
      .classList
      .add("hidden");

    channelFindTitle.textContent =
      "전체 채널";

    return;
  }


  const owned =
    memberships.filter(
      isOwnedMembership
    );


  const joined =
    memberships.filter(
      (item) =>
        !isOwnedMembership(
          item
        )
    );


  /* -----------------------------
     내 채널
  ----------------------------- */

  ownedChannelList.innerHTML =
    "";


  ownedChannelSection
    .classList
    .toggle(
      "hidden",
      owned.length === 0
    );


  ownedChannelCount.textContent =
    `${owned.length}개`;


  owned.forEach(
    (item) => {

      ownedChannelList.appendChild(
        makeMembershipCard(
          item,
          true
        )
      );
    }
  );


  /* -----------------------------
     가입한 채널
  ----------------------------- */

  joinedChannelList.innerHTML =
    "";


  joinedChannelSection
    .classList
    .toggle(
      "hidden",
      joined.length === 0
    );


  joinedChannelCount.textContent =
    `${joined.length}개`;


  if (!joined.length) {

    joinedChannelPagination
      .classList
      .add("hidden");

  } else {

    const totalPages =
      Math.max(
        1,
        Math.ceil(
          joined.length /
          JOINED_PAGE_SIZE
        )
      );


    joinedPage =
      Math.min(
        Math.max(
          1,
          joinedPage
        ),
        totalPages
      );


    const start =
      (
        joinedPage - 1
      ) *
      JOINED_PAGE_SIZE;


    const pageItems =
      joined.slice(
        start,
        start +
        JOINED_PAGE_SIZE
      );


    pageItems.forEach(
      (item) => {

        joinedChannelList.appendChild(
          makeMembershipCard(
            item
          )
        );
      }
    );


    if (
      joined.length <=
      JOINED_PAGE_SIZE
    ) {

      joinedChannelPagination
        .classList
        .add("hidden");

    } else {

      joinedChannelPagination
        .classList
        .remove("hidden");


      joinedChannelPageSummary
        .textContent =
          `총 ${joined.length}개 · ` +
          `${start + 1}-` +
          `${start + pageItems.length}개 표시`;


      joinedChannelPageNumber
        .textContent =
          `${joinedPage} / ${totalPages}`;


      joinedChannelPrev.disabled =
        joinedPage <= 1;


      joinedChannelNext.disabled =
        joinedPage >= totalPages;
    }
  }


  channelFindTitle.textContent =
    "채널 찾기";
}


/* =========================================================
   멤버십 데이터
========================================================= */

async function loadMemberships() {

  /*
   * 개발자
   * members 문서 없이 모든 채널 접근.
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


    developerChannelIds =
      new Set(
        snapshot.docs.map(
          (item) =>
            item.id
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
            membershipChannelName(a)
              .localeCompare(
                membershipChannelName(b),
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


  const raw =
    membershipSnapshot.docs
      .map(
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
        async (
          membership
        ) => {

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
              !memberSnapshot.exists()
            ) {
              try {
                await deleteDoc(
                  doc(
                    db,
                    "users",
                    currentUser.uid,
                    "memberships",
                    membership.id
                  )
                );
              } catch (cleanupError) {
                console.warn(
                  "유효하지 않은 멤버십 정리 실패",
                  membership.id,
                  cleanupError
                );
              }
              return null;
            }


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

          } catch (error) {

            console.error(
              "채널 멤버십 조회 실패",
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
          membershipChannelName(a)
            .localeCompare(
              membershipChannelName(b),
              "ko"
            )
      );
}


/* =========================================================
   전체 검색용 channelDirectory
========================================================= */

async function loadDirectoryChannels() {

  /*
   * 개발자는 이미 channels를 모두 읽었으므로
   * 그 데이터를 사용한다.
   */
  if (
    isDeveloper(
      currentProfile
    )
  ) {

    directoryChannels =
      memberships
        .map(
          (item) => {

            const channel =
              item.channel;


            const owner =
              usersByUid.get(
                channel.ownerUid
              );


            return {
              id:
                channel.id,

              name:
                channel.name ||
                "HNSITE 채널",

              photoURL:
                channel.photoURL ||
                "",

              ownerName:
                owner?.name ||
                owner?.email ||
                channel.ownerEmail ||
                "",

              status:
                channel.status ||
                "active",

              createdAt:
                channel.createdAt ||
                null,

              updatedAt:
                channel.updatedAt ||
                null
            };
          }
        )
        .filter(
          (item) =>
            item.status ===
            "active"
        );


    return;
  }


  /*
   * 일반 사용자는 실제 channels가 아니라
   * 검색용 channelDirectory만 조회.
   */
  const snapshot =
    await getDocs(
      collection(
        db,
        "channelDirectory"
      )
    );


  directoryChannels =
    snapshot.docs
      .map(
        (item) => ({
          id:
            item.id,

          ...item.data()
        })
      )
      .filter(
        (item) =>
          item.status ===
          "active"
      )
      .sort(
        (a, b) =>
          (
            a.name || ""
          ).localeCompare(
            b.name || "",
            "ko"
          )
      );
}


/* =========================================================
   삭제된 채널 검색 정보 정리
   - channels 문서는 없는데 channelDirectory가 남아 있으면 검색에 노출될 수 있음
   - channelNames 레지스트리도 함께 정리하여 삭제된 이름을 다시 사용할 수 있게 함
========================================================= */

async function cleanupDeletedChannelReferencesForDeveloper() {

  if (!isDeveloper(currentProfile)) {
    return;
  }


  try {

    const [directorySnapshot, nameRegistrySnapshot] =
      await Promise.all([
        getDocs(
          collection(
            db,
            "channelDirectory"
          )
        ),
        getDocs(
          collection(
            db,
            "channelNames"
          )
        )
      ]);


    const cleanupJobs = [];


    directorySnapshot.docs.forEach(
      (item) => {

        if (
          !developerChannelIds.has(
            item.id
          )
        ) {

          cleanupJobs.push(
            deleteDoc(
              item.ref
            )
          );
        }
      }
    );


    nameRegistrySnapshot.docs.forEach(
      (item) => {

        const channelId =
          String(
            item.data().channelId ||
            ""
          );


        if (
          channelId &&
          !developerChannelIds.has(
            channelId
          )
        ) {

          cleanupJobs.push(
            deleteDoc(
              item.ref
            )
          );
        }
      }
    );


    if (cleanupJobs.length) {
      await Promise.allSettled(
        cleanupJobs
      );
    }

  } catch (error) {

    console.error(
      "삭제된 채널 검색 정보 정리 실패",
      error
    );
  }
}


/* =========================================================
   기존 채널 → channelDirectory 동기화
   개발자 접속 시 자동 실행
========================================================= */

async function syncChannelDirectoryForDeveloper() {

  if (!isDeveloper(currentProfile)) {
    return;
  }

  for (const item of memberships) {
    const channel = item.channel;
    const owner = usersByUid.get(channel.ownerUid);
    const directoryRef = doc(db, "channelDirectory", channel.id);
    const channelRef = doc(db, "channels", channel.id);
    const name = channel.name || "HNSITE 채널";

    try {
      const directorySnapshot = await getDoc(directoryRef);
      const common = {
        name,
        photoURL: channel.photoURL || "",
        ownerName: owner?.name || owner?.email || channel.ownerEmail || "",
        status: channel.status || "active",
        updatedAt: serverTimestamp(),
        ...(channel.nameKey ? { nameKey: channel.nameKey } : {})
      };

      if (directorySnapshot.exists()) {
        await updateDoc(directoryRef, common);
        continue;
      }

      const checked = validateChannelName(name);
      if (!checked.ok) {
        console.warn("채널 검색 목록 생성 생략: 잘못된 채널 이름", channel.id, name);
        continue;
      }

      const nameKey = channel.nameKey || checked.key;
      const registryRef = channelNameRegistryRef(nameKey);

      await runTransaction(db, async (transaction) => {
        const liveChannel = await transaction.get(channelRef);
        const registry = await transaction.get(registryRef);
        if (!liveChannel.exists()) return;
        if (registry.exists() && registry.data().channelId !== channel.id) {
          throw new Error("CHANNEL_NAME_TAKEN");
        }

        if (!registry.exists()) {
          transaction.set(registryRef, {
            channelId: channel.id,
            name,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        }

        if (liveChannel.data().nameKey !== nameKey) {
          transaction.update(channelRef, {
            nameKey,
            updatedAt: serverTimestamp()
          });
        }

        transaction.set(directoryRef, {
          ...common,
          nameKey,
          createdAt: channel.createdAt || serverTimestamp()
        });
      });

      channel.nameKey = nameKey;
    } catch (error) {
      console.error("채널 검색 목록 동기화 실패", channel.id, error);
    }
  }
}


/* =========================================================
   전체 채널 검색 결과 렌더링
========================================================= */

function renderDirectoryChannels() {

  channelList.innerHTML =
    "";

  setMessage("");


  const developer =
    isDeveloper(
      currentProfile
    );


  const term =
    channelSearchTerm
      .trim()
      .toLocaleLowerCase(
        "ko"
      );


  const membershipIds =
    new Set(
      memberships.map(
        membershipChannelId
      )
    );


  /*
   * 일반 사용자는 검색어를 입력하기 전
   * 전체 채널을 노출하지 않는다.
   */
  if (
    !developer &&
    !term
  ) {

    channelPagination
      .classList
      .add("hidden");


    channelList.innerHTML = `
      <div class="panel channel-empty">

        <strong>
          찾을 채널 이름을 입력해주세요.
        </strong>

        <span>
          검색 결과에서 원하는 채널에 가입 신청할 수 있습니다.
        </span>

      </div>
    `;


    return;
  }


  const filtered =
    directoryChannels.filter(
      (channel) => {

        /*
         * 이미 가입했거나
         * 승인 대기 중인 채널은
         * 채널 찾기에서 제외.
         */
        if (
          !developer &&
          membershipIds.has(
            channel.id
          )
        ) {
          return false;
        }


        const name =
          String(
            channel.name || ""
          )
            .toLocaleLowerCase(
              "ko"
            );


        return (
          !term ||
          name.includes(
            term
          )
        );
      }
    );


  if (!filtered.length) {

    channelPagination
      .classList
      .add("hidden");


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


    return;
  }


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


  const start =
    (
      channelPage - 1
    ) *
    CHANNEL_PAGE_SIZE;


  const pageItems =
    filtered.slice(
      start,
      start +
      CHANNEL_PAGE_SIZE
    );


  pageItems.forEach(
    (channel) => {

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
                "HNSITE 채널"
              )}
            </h2>

            ${
              channel.ownerName
                ? `
                  <p class="channel-owner-name">
                    소유자
                    ${escapeHtml(
                      channel.ownerName
                    )}
                  </p>
                `
                : ""
            }

          </div>

        </div>

        <div class="channel-card-actions"></div>
      `;


      const actions =
        card.querySelector(
          ".channel-card-actions"
        );


      const button =
        document.createElement(
          "button"
        );


      button.type =
        "button";


      if (developer) {

        button.className =
          "select-channel-button";

        button.textContent =
          "채널 입장";


        button.addEventListener(
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

      } else {

        button.className =
          "join-channel-button";

        button.textContent =
          "가입 신청";


        button.addEventListener(
          "click",
          () =>
            requestJoinChannel(
              channel,
              button
            )
        );
      }


      actions.appendChild(
        button
      );


      channelList.appendChild(
        card
      );
    }
  );


  if (
    filtered.length <=
    CHANNEL_PAGE_SIZE
  ) {

    channelPagination
      .classList
      .add("hidden");

  } else {

    channelPagination
      .classList
      .remove("hidden");


    channelPageSummary.textContent =
      `총 ${filtered.length}개 · ` +
      `${start + 1}-` +
      `${start + pageItems.length}개 표시`;


    channelPageNumber.textContent =
      `${channelPage} / ${totalPages}`;


    channelPrevButton.disabled =
      channelPage <= 1;


    channelNextButton.disabled =
      channelPage >= totalPages;
  }
}


/* =========================================================
   채널 가입 신청
========================================================= */

async function requestJoinChannel(
  channel,
  button
) {

  if (
    !currentUser ||
    isDeveloper(
      currentProfile
    )
  ) {
    return;
  }


  button.disabled =
    true;

  button.textContent =
    "신청 중...";

  setMessage("");


  const memberRef =
    doc(
      db,
      "channels",
      channel.id,
      "members",
      currentUser.uid
    );


  const mirrorRef =
    doc(
      db,
      "users",
      currentUser.uid,
      "memberships",
      channel.id
    );


  try {

    await runTransaction(
      db,
      async (
        transaction
      ) => {

        const memberSnapshot =
          await transaction.get(
            memberRef
          );


        const mirrorSnapshot =
          await transaction.get(
            mirrorRef
          );


        if (
          memberSnapshot.exists() ||
          mirrorSnapshot.exists()
        ) {

          throw new Error(
            "ALREADY_REQUESTED"
          );
        }


        transaction.set(
          memberRef,
          {
            uid:
              currentUser.uid,

            name:
              currentProfile.name ||
              currentUser.displayName ||
              currentUser.email ||
              "사용자",

            email:
              currentUser.email ||
              "",

            role:
              "member",

            status:
              "pending",

            bingoAccess:
              "none",

            killSheetAccess:
              "none",

            requestedAt:
              serverTimestamp(),

            joinedAt:
              null,

            updatedAt:
              serverTimestamp()
          }
        );


        transaction.set(
          mirrorRef,
          {
            channelId:
              channel.id,

            channelName:
              channel.name ||
              "HNSITE 채널",

            role:
              "member",

            status:
              "pending",

            requestedAt:
              serverTimestamp(),

            joinedAt:
              null,

            updatedAt:
              serverTimestamp()
          }
        );
      }
    );


    setMessage(
      `${
        channel.name ||
        "선택한 채널"
      } 가입 신청이 완료되었습니다.`,
      true
    );


    await loadMemberships();


    joinedPage =
      1;


    renderMembershipSections();


    channelPage =
      1;


    renderDirectoryChannels();

  } catch (error) {

    console.error(
      "채널 가입 신청 실패",
      error
    );


    setMessage(
      error.message ===
        "ALREADY_REQUESTED"

        ? "이미 가입했거나 가입 승인 대기 중인 채널입니다."

        : firebaseErrorMessage(
            error,
            "채널 가입 신청에 실패했습니다."
          )
    );


    button.disabled =
      false;

    button.textContent =
      "가입 신청";
  }
}


/* =========================================================
   검색 / 페이징 이벤트
========================================================= */

channelSearch
  ?.addEventListener(
    "input",
    (event) => {

      channelSearchTerm =
        event.target.value ||
        "";


      channelPage =
        1;


      renderDirectoryChannels();
    }
  );


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


      renderDirectoryChannels();
    }
  );


channelNextButton
  ?.addEventListener(
    "click",
    () => {

      channelPage += 1;


      renderDirectoryChannels();
    }
  );


joinedChannelPrev
  ?.addEventListener(
    "click",
    () => {

      if (
        joinedPage <= 1
      ) {
        return;
      }


      joinedPage -= 1;


      renderMembershipSections();
    }
  );


joinedChannelNext
  ?.addEventListener(
    "click",
    () => {

      joinedPage += 1;


      renderMembershipSections();
    }
  );


/* =========================================================
   개발자 소유자 사용자 검색
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


  allOwnerUsers =
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
          !isDeveloper(
            user
          )
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
    String(
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


        return (
          `${
            user.name || ""
          } ${
            user.email || ""
          }`
            .toLocaleLowerCase(
              "ko"
            )
            .includes(
              term
            )
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


    channelOwnerSearchResult
      .textContent =
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
   새 채널 생성 모달
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


  createChannelModal
    .classList
    .remove("hidden");


  document.body
    .classList
    .add("modal-open");


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

  createChannelModal
    .classList
    .add("hidden");


  document.body
    .classList
    .remove("modal-open");


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
   채널 대표사진
========================================================= */

async function getRandomChannelPhoto() {

  const result =
    await listAll(
      storageRef(
        storage,
        "channel-defaults"
      )
    );


  const images =
    result.items.filter(
      (item) =>
        /\.(jpg|jpeg|png|webp)$/i
          .test(
            item.name
          )
    );


  if (!images.length) {
    return "";
  }


  const random =
    images[
      Math.floor(
        Math.random() *
        images.length
      )
    ];


  return await getDownloadURL(
    random
  );
}


/* =========================================================
   실제 채널 생성
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


  const nameInput =
    document.getElementById(
      "channelName"
    );


  const channelNameCheck =
    validateChannelName(
      nameInput.value
    );

  const name =
    channelNameCheck.name;


  const ownerUid =
    channelOwnerSelect.value;


  const owner =
    usersByUid.get(
      ownerUid
    );


  const bingoEnabled =
    document.getElementById(
      "channelFeatureBingo"
    )?.checked === true;


  const killEnabled =
    document.getElementById(
      "channelFeatureKill"
    )?.checked === true;


  if (!channelNameCheck.ok) {

    setCreateMessage(
      channelNameCheck.message
    );


    nameInput.focus();


    return;
  }


  if (
    !ownerUid ||
    !owner
  ) {

    setCreateMessage(
      "채널 소유자를 선택해주세요."
    );


    return;
  }


  if (
    !bingoEnabled &&
    !killEnabled
  ) {

    setCreateMessage(
      "빙고와 킬내기 중 하나 이상을 선택해주세요."
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

    const nameAvailability =
      await isChannelNameAvailable(
        name
      );

    if (!nameAvailability.available) {
      throw new Error("CHANNEL_NAME_TAKEN");
    }

    const nameKey =
      nameAvailability.key;

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


    const directoryRef =
      doc(
        db,
        "channelDirectory",
        channelRef.id
      );


    const nameRegistryRef =
      channelNameRegistryRef(
        nameKey
      );


    const requestRef =
      selectedChannelRequestUid

        ? doc(
            db,
            "channelCreationRequests",
            selectedChannelRequestUid
          )

        : null;


    await runTransaction(
      db,
      async (
        transaction
      ) => {

        const nameRegistrySnapshot =
          await transaction.get(
            nameRegistryRef
          );

        if (
          nameRegistrySnapshot.exists()
        ) {
          throw new Error(
            "CHANNEL_NAME_TAKEN"
          );
        }

        transaction.set(
          nameRegistryRef,
          {
            channelId:
              channelRef.id,

            name,

            createdAt:
              serverTimestamp(),

            updatedAt:
              serverTimestamp()
          }
        );

        transaction.set(
          channelRef,
          {
            name,

            nameKey,

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

            bingoEnabled,

            killEnabled,

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
              owner.email ||
              "",

            role:
              "owner",

            status:
              "approved",

            bingoAccess:
              bingoEnabled
                ? "write"
                : "none",

            killSheetAccess:
              killEnabled
                ? "write"
                : "none",

            requestedAt:
              null,

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

            requestedAt:
              null,

            joinedAt:
              serverTimestamp(),

            updatedAt:
              serverTimestamp()
          }
        );


        transaction.set(
          directoryRef,
          {
            name,

            nameKey,

            photoURL,

            ownerName:
              owner.name ||
              owner.email ||
              "소유자",

            status:
              "active",

            createdAt:
              serverTimestamp(),

            updatedAt:
              serverTimestamp()
          }
        );


        /*
         * 채널 생성 신청에서 넘어온 사용자면
         * 신청 상태도 approved 처리.
         */
        if (
          requestRef &&
          selectedChannelRequestUid ===
            ownerUid
        ) {

          transaction.update(
            requestRef,
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
        }
      }
    );


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


    await loadMemberships();


    await loadDirectoryChannels();


    renderMembershipSections();


    renderDirectoryChannels();

  } catch (error) {

    console.error(
      "채널 생성 실패",
      error
    );


    setCreateMessage(
      error.message === "CHANNEL_NAME_TAKEN"
        ? "이미 사용 중인 채널 이름입니다."
        : firebaseErrorMessage(
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
   일반 사용자 채널 생성 신청
========================================================= */

async function syncMyChannelCreationRequestButton() {

  if (
    !currentUser ||
    isDeveloper(
      currentProfile
    )
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
    isDeveloper(
      currentProfile
    )
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


      await syncMyChannelCreationRequestButton();


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
      }
    );


    setMessage(
      "채널 생성 신청이 완료되었습니다.",
      true
    );


    await syncMyChannelCreationRequestButton();

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
   개발자 채널 생성 신청 실시간 감시
========================================================= */

function startChannelRequestWatcher() {

  if (
    !isDeveloper(
      currentProfile
    ) ||
    channelRequestsUnsubscribe
  ) {
    return;
  }


  channelRequestsUnsubscribe =
    onSnapshot(
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
      ),

      (snapshot) => {

        cachedChannelRequests =
          snapshot.docs
            .map(
              (item) => ({
                id:
                  item.id,

                ...item.data()
              })
            )
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


        channelRequestBadge
          .classList
          .toggle(
            "hidden",
            count === 0
          );


        if (
          !channelRequestsModal
            .classList
            .contains(
              "hidden"
            )
        ) {

          renderChannelRequests();
        }
      },

      (error) => {

        console.error(
          "채널 생성 신청 실시간 조회 실패",
          error
        );
      }
    );
}


/* =========================================================
   채널 생성 신청 모달
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


  requestPage =
    1;


  channelRequestsModal
    .classList
    .remove("hidden");


  document.body
    .classList
    .add("modal-open");


  renderChannelRequests();
}


function closeChannelRequestsModal() {

  channelRequestsModal
    .classList
    .add("hidden");


  document.body
    .classList
    .remove("modal-open");
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


    channelRequestsPagination
      .classList
      .add("hidden");


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
    (
      requestPage - 1
    ) *
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

            if (
              !usersByUid.has(
                request.requesterUid
              )
            ) {

              channelRequestsMessage.textContent =
                "신청 사용자를 소유자 목록에서 찾을 수 없습니다.";


              return;
            }


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
          () => {

            rejectChannelRequest(
              request
            );
          }
        );


      channelRequestsList.appendChild(
        item
      );
    }
  );


  if (
    total <=
    REQUEST_PAGE_SIZE
  ) {

    channelRequestsPagination
      .classList
      .add("hidden");

  } else {

    channelRequestsPagination
      .classList
      .remove("hidden");


    channelRequestsPageSummary.textContent =
      `총 ${total}건 · ` +
      `${start + 1}-` +
      `${start + pageItems.length}건 표시`;


    channelRequestsPageNumber.textContent =
      `${requestPage} / ${totalPages}`;


    channelRequestsPrev.disabled =
      requestPage <= 1;


    channelRequestsNext.disabled =
      requestPage >= totalPages;
  }
}


/* =========================================================
   채널 생성 신청 거절
========================================================= */

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
        title:
          "채널 생성 신청 거절",

        confirmText:
          "거절",

        danger:
          true
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


/* =========================================================
   신청 모달 이벤트
========================================================= */

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


/* =========================================================
   ESC
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
   공유 채널 링크 처리
   https://hnsite.github.io/?channel=채널명
========================================================= */
async function handleSharedChannelLink() {
  const params = new URLSearchParams(location.search);
  const sharedName = params.get("channel")?.trim() || "";
  if (!sharedName || !currentUser || !currentProfile) return;

  history.replaceState(null, "", location.pathname + location.hash);

  const channel = await resolveChannelByName(sharedName);
  if (!channel || channel.status !== "active") {
    setMessage("공유된 채널을 찾을 수 없거나 현재 이용할 수 없습니다.");
    return;
  }

  if (isDeveloper(currentProfile)) {
    setCurrentChannelId(currentUser.uid, channel.id);
    location.replace("./app.html");
    return;
  }

  const membership = memberships.find((item) => membershipChannelId(item) === channel.id);
  if (membership) {
    setCurrentChannelId(currentUser.uid, channel.id);
    location.replace("./app.html");
    return;
  }

  const confirmed = await showConfirm(
    `${channel.name || sharedName} 채널에 가입 신청할까요?`,
    {
      title: "채널 초대",
      confirmText: "가입 신청"
    }
  );

  if (!confirmed) return;

  const temporaryButton = document.createElement("button");
  await requestJoinChannel(channel, temporaryButton);

  await loadMemberships();
  const requested = memberships.find((item) => membershipChannelId(item) === channel.id);
  if (requested) {
    setCurrentChannelId(currentUser.uid, channel.id);
    location.replace("./app.html");
  }
}

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

      channelRequestsUnsubscribe
        ?.();


      channelRequestsUnsubscribe =
        null;


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
  async (
    user
  ) => {

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


      setTopbarContext({
        user,
        profile: currentProfile,
        context: null
      });


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


      await initDeveloperChannelTools(
        user,
        currentProfile,
        null
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

      } else {

        await syncMyChannelCreationRequestButton();
      }


      await loadMemberships();


      if (developer) {

        await cleanupDeletedChannelReferencesForDeveloper();


        await syncChannelDirectoryForDeveloper();


        startChannelRequestWatcher();
      }


      await loadDirectoryChannels();


      renderMembershipSections();


      renderDirectoryChannels();


      await handleSharedChannelLink();


      loadingPanel
        .classList
        .add("hidden");


      channelContent
        .classList
        .remove("hidden");

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