# HNSITE v28 멀티채널 베타

기준본: `churang-bingo-v27-all`

v28은 기존 v27 빙고 기능을 HNSITE 멀티채널 구조로 전환한 버전입니다. 기존 Firestore 빙고 데이터는 마이그레이션하지 않는 전제로 작성했습니다.

## 핵심 변경사항

- 화면 브랜드 `CHURANG` → `HNSITE`
- Google 로그인 후 `channels.html`에서 채널 선택
- 사용자는 자신이 가입된 채널만 목록에서 확인
- 플랫폼 역할과 채널 역할 분리
  - 플랫폼: `developer`
  - 채널: `owner`, `admin`, `member`
- 채널별 Firestore 경로 분리
- 채널별 Storage 경로 분리
- 업데이트 소식은 `platformUpdates`에서 관리하며 개발자만 작성/수정/삭제
- 빙고방 생성은 채널 `owner`, `admin`만 가능
- 플랫폼 개발자도 고객 채널에 자동 접근하지 않으며, 테스트/지원이 필요한 채널에서 `owner` 또는 `admin` 역할을 받아야 빙고 관리자 기능을 사용
- 관리자 1명당 활성 빙고방 최대 5개
- 한 사용자가 여러 빙고방에 동시에 참여 가능
- 방 종료/삭제 시 사용한 방 슬롯이 반환되어 다시 새 방 생성 가능
- 채널 멤버 초대 링크 및 채널 멤버 관리 추가
- 기존 숫자/알파벳/자유텍스트/사진 빙고, 전체 선택/해제, 치킨 기록, 실시간 상태, 자동 종료, 결과 요약, QR 초대, 복제 기능 유지

## v28 데이터 구조

```text
users/{uid}
  name
  email
  platformRole
  status

users/{uid}/memberships/{channelId}
  channelId
  channelName
  role
  status

channels/{channelId}
  name
  ownerUid
  status
  subscriptionStatus
  bingoEnabled
  killEnabled
  killPlan
  maxActiveBingoRoomsPerManager: 5

channels/{channelId}/members/{uid}
  role: owner | admin | member
  status
  bingoAccess
  killSheetAccess

channels/{channelId}/invites/{inviteId}
channels/{channelId}/bingoRooms/{roomId}
channels/{channelId}/bingoBoards/{roomId}
channels/{channelId}/bingoRoomOwners/{uid}/slots/{1..5}
channels/{channelId}/bingoRooms/{roomId}/chickenLogs/{logId}
channels/{channelId}/bingoRooms/{roomId}/presence/{uid}
channels/{channelId}/roomAuditLogs/{logId}

platformUpdates/{updateId}
platformAuditLogs/{logId}
```

## 5개 방 제한 방식

UI에서 개수를 확인하는 것만으로 제한하지 않습니다.

각 관리자에게 Firestore에 1~5번 슬롯만 허용하고 활성 방을 만들 때 슬롯 하나를 같은 트랜잭션에서 점유합니다.

```text
channels/{channelId}/bingoRoomOwners/{uid}/slots/1
...
channels/{channelId}/bingoRoomOwners/{uid}/slots/5
```

활성 방이 5개면 사용 가능한 슬롯이 없으므로 6번째 방 생성이 Firestore Rules에서 차단됩니다. 방을 종료하거나 삭제하거나 다른 관리자에게 위임하면 해당 슬롯이 반환됩니다.

## 적용 전 중요 사항

현재 v27에서 `role: "developer"`, `status: "approved"`로 사용 중인 개발자 `users/{uid}` 문서는 남겨두는 것을 권장합니다.

v28 Rules는 기존 `role: "developer"`도 개발자로 인식하므로 바로 채널을 생성할 수 있습니다. 개발자 사용자 문서까지 모두 삭제하면 승인과 최초 채널 생성 주체가 없어지므로 Firebase Console에서 개발자 사용자 문서를 다시 만들어야 합니다.

기존 아래 데이터는 v28에서 사용하지 않으므로 삭제해도 됩니다.

```text
bingoRooms
bingoBoards
bingoMemberships
roomAuditLogs
appUpdates
adminAuditLogs
```

기존 `bingoImages/` Storage 폴더도 v28에서는 사용하지 않습니다.

## 적용 순서

1. 현재 v27 GitHub 파일을 별도 백업
2. Firebase의 기존 개발자 `users/{uid}` 문서는 유지
3. Firebase Firestore Rules를 `firebase/firestore.rules`로 전체 교체 후 게시
4. Firebase Storage Rules를 `firebase/storage.rules`로 전체 교체 후 게시
5. `github/` 폴더의 파일을 GitHub Pages 저장소에 반영
6. 브라우저에서 기존 Service Worker 캐시가 갱신될 때까지 새로고침
7. 개발자 계정으로 로그인
8. `채널 선택` 화면에서 새 채널 생성 후 소유자 지정
9. 소유자 계정에서 채널 멤버 초대 링크 생성
10. owner/admin/member 계정으로 각각 권한 테스트

## 확인할 항목

- 로그인 후 채널 선택 화면 표시
- 다른 채널 데이터가 표시되지 않는지
- member 계정의 `생성하기` 버튼 비활성화
- owner/admin 계정은 방 생성 가능
- 같은 관리자가 활성 방 5개 생성 후 6번째 생성 차단
- 방 하나 종료 후 다시 새 방 생성 가능
- 한 사용자가 여러 방에 참가 가능
- 사진 업로드 경로가 `channels/{channelId}/bingoImages/...`인지
- 채널 변경 후 이전 채널의 방이 보이지 않는지
- 종료 결과/치킨 기록/실시간 체크/QR 초대/복제 기능 확인

## Firebase 프로젝트 ID

`firebase-config.js`의 Firebase 프로젝트 ID와 `authDomain`에는 기존 `churang-b2d09` 값이 남아 있습니다. 이것은 Firebase 내부 프로젝트 식별자이며 HNSITE 화면 브랜드와 별개입니다. Firebase 프로젝트 자체를 새로 만들기 전까지 변경하지 않습니다.

## 현재 검증 상태

- v28 JavaScript 전체 `node --check` 문법 검사 완료
- v27 전역 빙고 컬렉션 참조를 채널 경로로 변경 확인
- HNSITE 버전/브랜드 및 PWA 캐시명을 v28로 변경 확인
- 실제 Firebase Rules 게시 및 GitHub Pages 적용 화면에서의 최종 동작 확인은 필요합니다.

## 베타 판매용 이용권 관리

`developer` 계정의 채널 선택 화면에는 **채널 이용권 관리** 영역이 표시됩니다.

현재 v28에서는 자동결제를 붙이지 않고 다음 값을 개발자가 직접 관리할 수 있습니다.

```text
subscriptionStatus: beta | trial | active | expired
subscriptionStartedAt
subscriptionEndsAt
bingoEnabled
```

이용기간이 만료되거나 `subscriptionStatus`가 `expired`이면 기존 데이터는 삭제하지 않고 빙고 쓰기 기능을 읽기 전용으로 전환합니다. 이후 이용권을 다시 활성화하면 같은 채널 데이터를 계속 사용할 수 있습니다.

## 보안 구조 확인

- 채널 목록은 `users/{uid}/memberships`에 등록된 채널만 사용자 화면에 표시합니다.
- 채널 메타데이터도 해당 채널의 활성 멤버 또는 플랫폼 개발자만 직접 읽을 수 있도록 Rules를 구성했습니다.
- 1회용 채널 초대는 초대 문서와 멤버십 생성을 같은 트랜잭션에서 처리하고 사용한 초대 문서를 삭제합니다.
- 빙고방 생성 권한과 활성 방 5개 제한은 화면뿐 아니라 Firestore Rules에서도 확인하도록 구성했습니다.
- 실제 Rules 게시 후 owner/admin/member 계정을 나눠 Firebase 환경에서 권한 테스트가 필요합니다.
