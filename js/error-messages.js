export function firebaseErrorMessage(error, fallback = "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.") {
  const code = String(error?.code || "");
  const message = String(error?.message || "");

  if (code.includes("permission-denied") || message.includes("Missing or insufficient permissions")) {
    return "이 작업을 수행할 권한이 없습니다. 권한 상태를 확인해주세요.";
  }
  if (code.includes("unavailable") || code.includes("network-request-failed")) {
    return "네트워크 연결이 원활하지 않습니다. 연결 상태를 확인한 뒤 다시 시도해주세요.";
  }
  if (code.includes("not-found")) {
    return "요청한 정보를 찾을 수 없습니다. 이미 삭제되었는지 확인해주세요.";
  }
  if (code.includes("resource-exhausted") || code.includes("quota-exceeded")) {
    return "현재 요청이 많아 처리하지 못했습니다. 잠시 후 다시 시도해주세요.";
  }
  if (code.includes("unauthenticated") || code.includes("user-token-expired")) {
    return "로그인 정보가 만료되었습니다. 다시 로그인해주세요.";
  }
  if (code.includes("storage/unauthorized")) {
    return "이 사진에 접근할 권한이 없습니다.";
  }
  if (code.includes("storage/retry-limit-exceeded")) {
    return "사진 처리 시간이 초과되었습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.";
  }
  if (code.includes("storage/quota-exceeded")) {
    return "저장 공간 한도를 초과했습니다. 관리자에게 문의해주세요.";
  }
  return fallback;
}
