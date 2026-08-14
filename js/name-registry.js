import { db } from "./firebase-config.js";
import {
  collection,
  doc,
  getDoc,
  getDocs
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

export function normalizeUniqueName(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("ko-KR");
}

export function uniqueNameKey(value) {
  const normalized = normalizeUniqueName(value);
  return normalized ? `n_${encodeURIComponent(normalized)}` : "";
}

export function validateUserName(value) {
  const name = String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 20) {
    return { ok: false, name, message: "사용자명은 2~20자로 입력해주세요." };
  }
  if (/[\r\n\t]/.test(name)) {
    return { ok: false, name, message: "사용자명에는 줄바꿈을 사용할 수 없습니다." };
  }
  return { ok: true, name, key: uniqueNameKey(name), message: "" };
}

export function validateChannelName(value) {
  const name = String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!name || name.length > 40) {
    return { ok: false, name, message: "채널 이름은 1~40자로 입력해주세요." };
  }
  if (!/^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9 _.-]+$/.test(name)) {
    return { ok: false, name, message: "채널 이름에는 한글, 영문, 숫자, 공백, _, -, . 만 사용할 수 있습니다." };
  }
  return { ok: true, name, key: uniqueNameKey(name), message: "" };
}

export function userNameRegistryRef(nameOrKey) {
  const key = String(nameOrKey || "").startsWith("n_") ? nameOrKey : uniqueNameKey(nameOrKey);
  return doc(db, "userNames", key);
}

export function channelNameRegistryRef(nameOrKey) {
  const key = String(nameOrKey || "").startsWith("n_") ? nameOrKey : uniqueNameKey(nameOrKey);
  return doc(db, "channelNames", key);
}

export async function isUserNameAvailable(name, excludeUid = "") {
  const checked = validateUserName(name);
  if (!checked.ok) return { ...checked, available: false };
  const snapshot = await getDoc(userNameRegistryRef(checked.key));
  const available = !snapshot.exists() || snapshot.data().uid === excludeUid;
  return {
    ...checked,
    available,
    message: available ? "사용할 수 있는 사용자명입니다." : "이미 사용 중인 사용자명입니다."
  };
}

export async function isChannelNameAvailable(name, excludeChannelId = "") {
  const checked = validateChannelName(name);
  if (!checked.ok) return { ...checked, available: false };

  const registrySnapshot = await getDoc(channelNameRegistryRef(checked.key));
  if (registrySnapshot.exists() && registrySnapshot.data().channelId !== excludeChannelId) {
    return { ...checked, available: false, message: "이미 사용 중인 채널 이름입니다." };
  }

  // 기존 채널 중 nameKey가 아직 없는 데이터까지 중복 검사한다.
  const directorySnapshot = await getDocs(collection(db, "channelDirectory"));
  const duplicate = directorySnapshot.docs.some((item) => {
    if (item.id === excludeChannelId) return false;
    return normalizeUniqueName(item.data().name) === normalizeUniqueName(checked.name);
  });

  return {
    ...checked,
    available: !duplicate,
    message: duplicate ? "이미 사용 중인 채널 이름입니다." : "사용할 수 있는 채널 이름입니다."
  };
}

export async function resolveChannelByName(name) {
  const checked = validateChannelName(name);
  if (!checked.ok) return null;

  const registrySnapshot = await getDoc(channelNameRegistryRef(checked.key));
  if (registrySnapshot.exists()) {
    const channelId = registrySnapshot.data().channelId;
    const directorySnapshot = await getDoc(doc(db, "channelDirectory", channelId));
    if (directorySnapshot.exists()) {
      return { id: directorySnapshot.id, ...directorySnapshot.data() };
    }
  }

  // nameKey 도입 이전 채널 호환.
  const directorySnapshot = await getDocs(collection(db, "channelDirectory"));
  const matches = directorySnapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((item) => normalizeUniqueName(item.name) === normalizeUniqueName(checked.name));

  return matches.length === 1 ? matches[0] : null;
}

export function buildChannelShareUrl(channelName) {
  const name = String(channelName || "").trim();
  return `${location.origin}/?channel=${name}`;
}
