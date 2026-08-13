import { db } from "./firebase-config.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

export const HNSITE_VERSION = "29";

/*
 * 플랫폼 역할
 *
 * developer
 * user
 */
export function platformRole(profile) {
  if (
    profile?.platformRole === "developer" ||
    profile?.role === "developer"
  ) {
    return "developer";
  }

  return "user";
}

/*
 * 개발자는 플랫폼 status와 관계없이 developer 역할만 확인한다.
 */
export function isDeveloper(profile) {
  return platformRole(profile) === "developer";
}

/*
 * 기존 active 데이터도 임시 호환
 *
 * 최종적으로는
 * pending / approved
 * 두 상태로 통일한다.
 */
export function normalizeMemberStatus(status) {
  if (status === "active") {
    return "approved";
  }

  return status || "pending";
}

export function isMemberApproved(member) {
  return (
    normalizeMemberStatus(
      member?.status
    ) === "approved"
  );
}

export function isMemberPending(member) {
  return (
    normalizeMemberStatus(
      member?.status
    ) === "pending"
  );
}

export function channelRoleLabel(role) {
  return (
    {
      owner: "소유자",
      admin: "관리자",
      member: "멤버",
      developer: "개발자"
    }[role] ||
    role ||
    "멤버"
  );
}

export function accessLabel(value) {
  return (
    {
      none: "접근 권한 없음",
      read: "보기",
      write: "사용 가능"
    }[value] ||
    "접근 권한 없음"
  );
}

export function currentChannelStorageKey(uid) {
  return `hnsiteCurrentChannelId:${uid}`;
}

export function setCurrentChannelId(
  uid,
  channelId
) {
  localStorage.setItem(
    currentChannelStorageKey(uid),
    channelId
  );
}

export function clearCurrentChannelId(uid) {
  localStorage.removeItem(
    currentChannelStorageKey(uid)
  );
}

export function currentRoomStorageKey(
  channelId
) {
  return `hnsiteCurrentRoomId:${channelId}`;
}

export function archiveRoomStorageKey(
  channelId
) {
  return `hnsiteArchiveRoomId:${channelId}`;
}

/*
 * 플랫폼 사용자 조회
 *
 * 더 이상 users.status를 검사하지 않는다.
 *
 * Google 로그인 + users 문서 존재 여부만 확인.
 */
export async function loadPlatformProfile(
  user
) {
  const snap =
    await getDoc(
      doc(
        db,
        "users",
        user.uid
      )
    );

  if (!snap.exists()) {
    const error =
      new Error(
        "사용자 정보를 찾을 수 없습니다."
      );

    error.code =
      "PROFILE_NOT_FOUND";

    throw error;
  }

  const profile =
    snap.data();

  return {
    uid:
      user.uid,

    ...profile,

    platformRole:
      platformRole(profile)
  };
}

/*
 * 현재 선택된 채널 정보
 */
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

  /*
   * 채널 문서 확인
   */
  const channelSnap =
    await getDoc(
      doc(
        db,
        "channels",
        channelId
      )
    );

  if (!channelSnap.exists()) {
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
      channelSnap.id,

    ...channelSnap.data()
  };

  if (
    channel.status !== "active"
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
   * developer는 members 문서가 없어도
   * 모든 채널에 접근 가능
   */
  if (
    isDeveloper(
      resolvedProfile
    )
  ) {
    const member = {
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
    };

    return {
      profile:
        resolvedProfile,

      channelId,

      channel,

      member
    };
  }

  /*
   * 일반 사용자의 채널 멤버십 확인
   */
  const memberSnap =
    await getDoc(
      doc(
        db,
        "channels",
        channelId,
        "members",
        user.uid
      )
    );

  if (!memberSnap.exists()) {
    const error =
      new Error(
        "아직 이 채널에 가입 요청이 등록되지 않았습니다."
      );

    error.code =
      "CHANNEL_MEMBERSHIP_NOT_FOUND";

    throw error;
  }

  const memberData =
    memberSnap.data();

  const member = {
    uid:
      memberSnap.id,

    ...memberData,

    status:
      normalizeMemberStatus(
        memberData.status
      )
  };

  /*
   * pending 사용자는 여기서 차단하지 않는다.
   *
   * app.html까지 들어간 후
   * 승인 대기 화면을 보여준다.
   */
  if (
    ![
      "pending",
      "approved"
    ].includes(
      member.status
    )
  ) {
    const error =
      new Error(
        "현재 사용할 수 없는 채널 멤버십입니다."
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

/*
 * 채널 관리자 여부
 *
 * developer는 모든 채널 관리자 기능 사용 가능
 */
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

  return [
    "owner",
    "admin"
  ].includes(
    context?.member?.role
  );
}

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
    channel
      .subscriptionEndsAt
      ?.toMillis?.();

  return (
    Number.isFinite(endsAt) &&
    endsAt <= Date.now()
  );
}

/*
 * 기능 권한
 */
export function resolvedFeatureAccess(
  context,
  feature
) {
  if (
    !context?.channel
  ) {
    return "none";
  }

  const enabled =
    feature === "bingo"
      ? context.channel
          .bingoEnabled === true
      : context.channel
          .killEnabled === true;

  if (!enabled) {
    return "none";
  }

  /*
   * developer는 채널 멤버 승인 없이 사용 가능
   */
  if (
    isDeveloper(
      context.profile
    )
  ) {
    return "write";
  }

  /*
   * pending은 기능 사용 불가
   */
  if (
    !isMemberApproved(
      context.member
    )
  ) {
    return "none";
  }

  const expired =
    isSubscriptionExpired(
      context.channel
    );

  /*
   * owner / admin
   */
  if (
    isChannelManager(
      context
    )
  ) {
    return expired
      ? "read"
      : "write";
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
      context.member?.[field]
    )
      ? context.member[field]
      : "none";

  if (
    expired &&
    memberAccess === "write"
  ) {
    return "read";
  }

  return memberAccess;
}

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