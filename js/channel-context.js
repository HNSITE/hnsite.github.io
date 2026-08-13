import {
  db
} from "./firebase-config.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";


export const HNSITE_VERSION =
  "33";


export function platformRole(
  profile
) {
  return (
    profile?.platformRole ||
    (
      profile?.role ===
      "developer"
        ? "developer"
        : "user"
    )
  );
}


export function isDeveloper(
  profile
) {
  return (
    platformRole(
      profile
    ) === "developer"
  );
}


export function normalizeMemberStatus(
  status
) {

  if (
    status === "active"
  ) {
    return "approved";
  }


  return (
    status ||
    "pending"
  );
}


export function isMemberApproved(
  member
) {
  return (
    normalizeMemberStatus(
      member?.status
    ) === "approved"
  );
}


export function isMemberPending(
  member
) {
  return (
    normalizeMemberStatus(
      member?.status
    ) === "pending"
  );
}


export function channelRoleLabel(
  role
) {
  return (
    {
      owner:
        "소유자",

      admin:
        "관리자",

      member:
        "멤버",

      developer:
        "개발자"
    }[role] ||
    role ||
    "멤버"
  );
}


export function accessLabel(
  value
) {
  return (
    {
      none:
        "접근 권한 없음",

      read:
        "보기",

      write:
        "사용 가능"
    }[value] ||
    "접근 권한 없음"
  );
}


export function currentChannelStorageKey(
  uid
) {
  return (
    `hnsiteCurrentChannelId:${uid}`
  );
}


export function setCurrentChannelId(
  uid,
  channelId
) {
  localStorage.setItem(
    currentChannelStorageKey(
      uid
    ),
    channelId
  );
}


export function clearCurrentChannelId(
  uid
) {
  localStorage.removeItem(
    currentChannelStorageKey(
      uid
    )
  );
}


export function currentRoomStorageKey(
  channelId
) {
  return (
    `hnsiteCurrentRoomId:${channelId}`
  );
}


export function archiveRoomStorageKey(
  channelId
) {
  return (
    `hnsiteArchiveRoomId:${channelId}`
  );
}


/* =========================================================
   플랫폼 사용자
========================================================= */

export async function loadPlatformProfile(
  user
) {

  const snapshot =
    await getDoc(
      doc(
        db,
        "users",
        user.uid
      )
    );


  if (
    !snapshot.exists()
  ) {

    throw new Error(
      "등록되지 않은 계정입니다."
    );
  }


  const profile =
    snapshot.data();


  /*
   * 플랫폼 승인 여부로 로그인 차단하지 않는다.
   *
   * Google 로그인 성공 후 users/{uid}가 존재하면
   * 채널 선택 화면 사용 가능.
   */
  return {
    uid:
      user.uid,

    ...profile,

    platformRole:
      platformRole(
        profile
      )
  };
}


/* =========================================================
   현재 채널
========================================================= */

export async function loadCurrentChannelContext(
  user,
  profile = null
) {

  const resolvedProfile =
    profile ||
    await loadPlatformProfile(
      user
    );


  const channelId =
    localStorage.getItem(
      currentChannelStorageKey(
        user.uid
      )
    );


  if (!channelId) {

    const error =
      new Error(
        "사용할 채널을 먼저 선택해주세요."
      );


    error.code =
      "NO_CHANNEL";


    throw error;
  }


  const channelSnapshot =
    await getDoc(
      doc(
        db,
        "channels",
        channelId
      )
    );


  if (
    !channelSnapshot.exists()
  ) {

    clearCurrentChannelId(
      user.uid
    );


    const error =
      new Error(
        "선택한 채널을 찾을 수 없습니다."
      );


    error.code =
      "CHANNEL_NOT_FOUND";


    throw error;
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

    const error =
      new Error(
        "현재 사용할 수 없는 채널입니다."
      );


    error.code =
      "CHANNEL_INACTIVE";


    throw error;
  }


  /*
   * 개발자는 실제 member 문서가 없어도
   * 모든 채널 접근 가능.
   */
  if (
    isDeveloper(
      resolvedProfile
    )
  ) {

    return {
      profile:
        resolvedProfile,

      channelId,

      channel,

      member: {
        uid:
          user.uid,

        role:
          "developer",

        status:
          "approved",

        bingoAccess:
          "write",

        killSheetAccess:
          "write",

        virtualDeveloper:
          true
      }
    };
  }


  const memberSnapshot =
    await getDoc(
      doc(
        db,
        "channels",
        channelId,
        "members",
        user.uid
      )
    );


  if (
    !memberSnapshot.exists()
  ) {

    clearCurrentChannelId(
      user.uid
    );


    const error =
      new Error(
        "선택한 채널에 가입되어 있지 않습니다."
      );


    error.code =
      "CHANNEL_NOT_FOUND";


    throw error;
  }


  const member = {
    uid:
      memberSnapshot.id,

    ...memberSnapshot.data(),

    status:
      normalizeMemberStatus(
        memberSnapshot.data()
          .status
      )
  };


  /*
   * pending도 app.html까지는 들어가서
   * 승인 대기 화면을 보여준다.
   */
  if (
    ![
      "approved",
      "pending"
    ].includes(
      member.status
    )
  ) {

    const error =
      new Error(
        "현재 사용할 수 없는 채널입니다."
      );


    error.code =
      "CHANNEL_INACTIVE";


    throw error;
  }


  return {
    profile:
      resolvedProfile,

    channelId,

    channel,

    member
  };
}


/* =========================================================
   채널 관리자
========================================================= */

export function isChannelManager(
  context
) {

  if (
    isDeveloper(
      context?.profile
    )
  ) {
    return true;
  }


  if (
    !isMemberApproved(
      context?.member
    )
  ) {
    return false;
  }


  return (
    [
      "owner",
      "admin"
    ].includes(
      context.member.role
    )
  );
}


/* =========================================================
   구독 상태
========================================================= */

export function isSubscriptionExpired(
  channel
) {

  if (!channel) {
    return true;
  }


  if (
    channel.subscriptionStatus ===
    "expired"
  ) {
    return true;
  }


  const endsAt =
    channel.subscriptionEndsAt
      ?.toMillis?.();


  return (
    Number.isFinite(
      endsAt
    ) &&
    endsAt <=
      Date.now()
  );
}


/* =========================================================
   기능 권한
========================================================= */

export function resolvedFeatureAccess(
  context,
  feature
) {

  if (
    !context?.channel ||
    !context?.member
  ) {
    return "none";
  }


  /*
   * 승인 대기자는
   * 어떤 기능도 사용할 수 없음.
   */
  if (
    isMemberPending(
      context.member
    ) &&
    !isDeveloper(
      context.profile
    )
  ) {
    return "none";
  }


  const enabled =
    feature === "bingo"

      ? context.channel
          .bingoEnabled ===
        true

      : context.channel
          .killEnabled ===
        true;


  if (!enabled) {
    return "none";
  }


  const expired =
    isSubscriptionExpired(
      context.channel
    );


  if (
    isChannelManager(
      context
    )
  ) {

    return (
      expired
        ? "read"
        : "write"
    );
  }


  const field =
    feature === "bingo"

      ? "bingoAccess"

      : "killSheetAccess";


  const memberAccess =
    [
      "read",
      "write"
    ].includes(
      context.member[field]
    )

      ? context.member[field]

      : "none";


  return (
    expired &&
    memberAccess ===
      "write"

      ? "read"

      : memberAccess
  );
}


/* =========================================================
   화면 역할
========================================================= */

export function displayRole(
  context
) {

  if (
    isDeveloper(
      context?.profile
    )
  ) {
    return "개발자";
  }


  return channelRoleLabel(
    context?.member?.role
  );
}