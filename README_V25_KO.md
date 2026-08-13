# CHURANG v25 개선 통합본

기준본: v24 알림 기능 버전

## 이번 추가 기능

1. 빙고방 종료/보관 및 종료 결과 보기
2. 전체 선택/전체 해제 확인 + 1회 실행 취소
3. 빙고방 목록에 종류/크기/참가자/진행률/치킨/상태/최근 수정 표시
4. 알파벳 직접 지정 한번에 입력/자동 채우기/섞기/비우기/다중 붙여넣기
5. 치킨 +1/-1 기록, 변경 사용자/시간 표시, 기록 취소
6. 사용자 관리의 관리자 변경 이력 탭
7. 현재 입장 중이며 쓰기 권한이 있는 참가자에게 방장 위임
8. 관리자 업데이트 소식 등록/수정/삭제/공개 여부 관리
9. 모바일 8~10칸 빙고 가로 스크롤 및 글자/상단 메뉴 개선
10. Firebase 오류를 사용자용 한국어 안내로 변환

## 적용 순서

1. Firebase Firestore Database > 규칙에서 `firebase/firestore.rules` 전체 교체 후 게시
2. Firebase Storage > Rules에서 `firebase/storage.rules` 전체 교체 후 게시
3. GitHub 저장소에서 아래 파일 교체/추가

- app.html
- bingo.html
- bingo-room.html
- kill.html
- assets/styles.css
- js/app.js
- js/feature.js
- js/bingo.js
- js/bingo-room.js
- js/admin-modal.js
- js/update-modal.js
- js/error-messages.js (신규)

`firebase` 폴더는 GitHub Pages 동작용이 아니라 Firebase 콘솔에 복사할 규칙 파일입니다.

## 확인 순서

- 기존 숫자/알파벳 빙고방 진입
- 새 방 생성
- 전체 선택/해제와 실행 취소
- 치킨 기록 및 기록 취소
- 방장 위임
- 방 종료 후 목록의 결과 보기
- 관리자 사용자 관리 > 관리 이력
- 업데이트 > 업데이트 관리
- 모바일에서 10 x 10 빙고 좌우 스크롤

실제 Firebase와 GitHub Pages 적용 화면에서 최종 동작 확인이 필요합니다.
