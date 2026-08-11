CHURANG v14 UI 업데이트

GitHub에 아래 파일을 기존 파일과 교체/추가하세요.

교체:
- app.html
- bingo.html
- bingo-room.html
- assets/styles.css
- js/app.js
- js/admin-modal.js
- js/bingo.js
- js/bingo-room.js

새 파일:
- js/ui-dialog.js

변경사항:
1. 빙고판 권한 표시를 '권한: 쓰기/읽기'로 변경
2. 빙고방 참가자 관리 - 현재 참가자/추가 가능 사용자 각각 검색 + 5명 단위 페이징
3. 빙고 로비 안내 문구 삭제
4. 빙고 사진의 WebP 노출 문구 삭제
5. 방 생성 참가자 선택 - 검색 + 5명 단위 페이징, 페이지 이동해도 선택 상태 유지
6. 브라우저 기본 alert/confirm 대신 CHURANG 스타일 모달 사용
   - 킬내기 준비중
   - 방 나가기/삭제 확인
   - 참가자 제외 알림
   - 사용자 관리의 확인/오류 알림

Firebase Firestore/Storage 규칙 변경은 필요하지 않습니다.
