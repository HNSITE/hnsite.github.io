import { db } from "./firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

export const HNSITE_VERSION = "28";

export function platformRole(profile) {
  return profile?.platformRole || (profile?.role === "developer" ? "developer" : "user");
}

export function isDeveloper(profile) {
  return profile?.status === "approved" && platformRole(profile) === "developer";
}

export function channelRoleLabel(role) {
  return ({ owner: "소유자", admin: "관리자", member: "멤버" }[role] || role || "멤버");
}

export function accessLabel(value) {
  return ({ none: "접근 권한 없음", read: "보기", write: "사용 가능" }[value] || "접근 권한 없음");
}

export function currentChannelStorageKey(uid) {
  return `hnsiteCurrentChannelId:${uid}`;
}

export function setCurrentChannelId(uid, channelId) {
  localStorage.setItem(currentChannelStorageKey(uid), channelId);
}

export function clearCurrentChannelId(uid) {
  localStorage.removeItem(currentChannelStorageKey(uid));
}

export function currentRoomStorageKey(channelId) {
  return `hnsiteCurrentRoomId:${channelId}`;
}

export function archiveRoomStorageKey(channelId) {
  return `hnsiteArchiveRoomId:${channelId}`;
}

export async function loadPlatformProfile(user) {
  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) throw new Error("등록되지 않은 계정입니다.");
  const profile = snap.data();
  if (profile.status !== "approved") throw new Error("승인되지 않았거나 사용중지된 계정입니다.");
  return { uid: user.uid, ...profile, platformRole: platformRole(profile) };
}

export async function loadCurrentChannelContext(user, profile = null) {
  const resolvedProfile = profile || await loadPlatformProfile(user);
  const channelId = localStorage.getItem(currentChannelStorageKey(user.uid));
  if (!channelId) {
    const error = new Error("사용할 채널을 먼저 선택해주세요.");
    error.code = "NO_CHANNEL";
    throw error;
  }

  const [channelSnap, memberSnap] = await Promise.all([
    getDoc(doc(db, "channels", channelId)),
    getDoc(doc(db, "channels", channelId, "members", user.uid))
  ]);

  if (!channelSnap.exists() || !memberSnap.exists()) {
    clearCurrentChannelId(user.uid);
    const error = new Error("선택한 채널에 접근할 수 없습니다.");
    error.code = "CHANNEL_NOT_FOUND";
    throw error;
  }

  const channel = { id: channelSnap.id, ...channelSnap.data() };
  const member = { uid: memberSnap.id, ...memberSnap.data() };
  if (channel.status !== "active" || member.status !== "active") {
    const error = new Error("현재 사용할 수 없는 채널입니다.");
    error.code = "CHANNEL_INACTIVE";
    throw error;
  }

  return { profile: resolvedProfile, channelId, channel, member };
}

export function isChannelManager(context) {
  if (!context?.member || context.member.status !== "active") return false;
  return ["owner", "admin"].includes(context.member.role);
}


export function isSubscriptionExpired(channel) {
  if (!channel) return true;
  if (channel.subscriptionStatus === "expired") return true;
  const endsAt = channel.subscriptionEndsAt?.toMillis?.();
  return Number.isFinite(endsAt) && endsAt <= Date.now();
}

export function resolvedFeatureAccess(context, feature) {
  if (!context?.channel || !context?.member) return "none";
  const enabled = feature === "bingo" ? context.channel.bingoEnabled === true : context.channel.killEnabled === true;
  if (!enabled) return "none";
  const expired = isSubscriptionExpired(context.channel);
  if (isChannelManager(context)) return expired ? "read" : "write";
  const field = feature === "bingo" ? "bingoAccess" : "killSheetAccess";
  const memberAccess = ["read", "write"].includes(context.member[field]) ? context.member[field] : "none";
  return expired && memberAccess === "write" ? "read" : memberAccess;
}

export function displayRole(context) {
  if (isDeveloper(context?.profile)) return `개발자 · ${channelRoleLabel(context?.member?.role)}`;
  return channelRoleLabel(context?.member?.role);
}
