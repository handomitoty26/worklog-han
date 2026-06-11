# 🏠 기숙사 관리일지 프로그램

> 고등학교 기숙사 사감 선생님을 위한 학생 종합 관리 프로그램  
> **PWA(Progressive Web App)** 방식 — 태블릿 홈 화면에 설치하면 앱처럼 사용 가능

---

## ✨ 주요 기능

| 기능 | 설명 |
|------|------|
| 👨‍🎓 학생 관리 | 학년별·호실별 학생 현황, 사진·연락처·특이사항 |
| ⚖️ 상벌점 | 개인·호실 일괄 입력, 항목 편집, 누계 집계 |
| 💬 상담 기록 | 생활상담·사건기록·기타, 날짜별 조회 |
| 📔 근무일지 | 시각별 기록, 달력 조회, 메모 참조 |
| 📊 당일 상벌점 | 근무시간대(15:00~익일 09:00) 집계 |
| 📋 학생 종합 카드 | 사진+연락처+상벌점+상담 한 화면, 인쇄 지원 |
| ⭐ 관심/위기 학생 | 플래그 표시, 목록 조회 |
| 🏠 귀가 연동 | 귀가외출교내활동·기숙사일지 엑셀 연동 |
| 📝 메모장 | 텍스트+펜, 가상키보드(한국어 IME 포함) |
| ✅ 할일 알림 | 학사일정 날짜 지정, 앱 시작 시 알림 팝업 |
| 📅 학사일정 | 2025학년도 내장, 수동 편집, 학년도 전환 |
| ☁️ 구글 드라이브 | 앱 켤 때 자동 백업, 날짜별 보관·자동 정리 |
| 💾 전체 백업/복원 | 명단·사진·기록 JSON 파일 보관 |

---

## 📁 파일 구조

```
/
├── index.html            ← 메인 앱 (단일 파일)
├── manifest.json         ← PWA 매니페스트
├── service-worker.js     ← 오프라인 캐싱
├── icons8-home2-192.png  ← 앱 아이콘 (192px)
├── icons8-home2-512.png  ← 앱 아이콘 (512px)
└── README.md
```

---

## 🚀 GitHub Pages 배포 방법

### 1단계 — 저장소 만들기

1. GitHub([github.com](https://github.com)) 로그인
2. 우측 상단 **＋ → New repository** 클릭
3. Repository name: `dorm-journal` (원하는 이름)
4. **Public** 선택 → **Create repository** 클릭

### 2단계 — 파일 업로드

저장소 페이지에서 **Add file → Upload files** 클릭 후  
아래 파일을 모두 업로드:

```
index.html
manifest.json
service-worker.js
icons8-home2-192.png
icons8-home2-512.png
```

**Commit changes** 버튼 클릭

### 3단계 — GitHub Pages 켜기

1. 저장소 상단 **Settings** 탭 클릭
2. 왼쪽 메뉴 **Pages** 클릭
3. **Branch** → `main` 선택, 폴더 `/ (root)` → **Save**
4. 잠시 후 상단에 주소 표시:  
   `https://아이디.github.io/dorm-journal`

### 4단계 — manifest.json 주소 확인 (중요!)

> 프로젝트 페이지(`github.io/저장소명`)를 쓸 경우 `start_url`을 맞춰야 합니다.

`manifest.json` 파일 열기 → `"start_url"` 확인:

```json
"start_url": "./",
```

`./`로 되어 있으면 대부분 정상 동작합니다.  
만약 홈 화면 설치 후 흰 화면이 뜨면 아래처럼 절대 경로로 수정:

```json
"start_url": "/dorm-journal/",
"scope": "/dorm-journal/"
```

---

## 📱 태블릿/스마트폰 홈 화면에 설치 (PWA)

### 갤럭시 탭 (삼성 인터넷)
1. 위 GitHub Pages 주소를 **삼성 인터넷**으로 접속
2. 하단 **⋮ 메뉴** → **홈 화면에 추가**
3. 이름 확인 → **추가**
4. 홈 화면에 집 모양 아이콘으로 설치 완료

### 갤럭시 탭 (Chrome)
1. Chrome으로 접속
2. 우측 상단 **⋮ 메뉴** → **홈 화면에 추가**
3. 또는 주소창 오른쪽 설치 아이콘 탭

### iPad / iPhone (Safari)
1. Safari로 접속
2. 하단 **공유 버튼(□↑)** → **홈 화면에 추가**

---

## ⚙️ 구글 드라이브 자동 백업 설정

> 태블릿 분실·고장에 대비한 클라우드 백업 기능

[👉 구글 드라이브 자동 백업 설정 매뉴얼](구글드라이브자동백업_설정매뉴얼.html)을 참고하거나  
아래 단계를 따르세요.

1. [Google Cloud Console](https://console.cloud.google.com) 접속
2. 새 프로젝트 생성 → **Google Drive API** 사용 설정
3. **OAuth 동의 화면** → 외부, `drive.file` 범위 추가, 테스트 사용자 등록
4. **OAuth 클라이언트 ID** 발급 (웹 애플리케이션)  
   → 승인된 JS 원본에 `https://아이디.github.io` 추가
5. 앱에서 **⚙️ 설정 → ☁️ 구글 드라이브 자동 백업** → 클라이언트 ID 입력 → 연결

---

## 💡 사용 팁

- **데이터 저장**: 입력 즉시 기기에 자동 저장됩니다 (앱 종료 후 재실행해도 유지)
- **백업 권장**: ⚙️ 설정 → 전체 백업 내보내기로 정기적으로 백업하세요
- **방배정 명단**: ⚙️ 설정 → 방배정 엑셀 불러오기로 매년 초 갱신
- **사진 등록**: ⚙️ 설정 → 사진팩(JSON) 불러오기 또는 PDF 직접 불러오기
- **오프라인**: 한 번 접속 후엔 인터넷 없이도 핵심 기능 사용 가능

---

## 🔧 기술 스택

- **프레임워크**: Vanilla JS (의존성 없음, 단일 HTML 파일)
- **저장소**: localStorage + IndexedDB (사진·메모 그림)
- **외부 라이브러리**:
  - [SheetJS](https://sheetjs.com/) — 엑셀 파싱/내보내기
  - [pdf.js](https://mozilla.github.io/pdf.js/) — 사진명렬표 PDF 처리
  - [pako](https://nodeca.github.io/pako/) — HWP 파일 압축 해제
  - [Pretendard](https://github.com/orioncactus/pretendard) — 한국어 폰트
  - [Google Identity Services](https://developers.google.com/identity) — 드라이브 인증

---

## 📝 업데이트 내역

| 버전 | 주요 변경 |
|------|-----------|
| v16 | 학생 종합 카드, 관심/위기 플래그 |
| v15 | 할일 알림, 메모 수정, 가상 키보드(한국어 IME), 근무일지 메모 참조 |
| v14 | 구글 드라이브 자동 백업 (날짜별 보관·자동 삭제) |
| v13 | 구글 드라이브 연동 기초 |
| v12 | 사진팩 JSON 불러오기, 요일 오류 수정, 1학년 색상 노랑 |
| v10 | 상벌점 일괄입력 숫자패드, 근무시간대 집계, 학사일정표 |
| v9 | HWP 요보호 명단 특이사항 연동 |
| v8 | 호실 일괄 상벌점 |
| v6 | 귀가/입실현황 2파일 자동판별·여학생 제거 |
| v4 | 호실별 보기 (층탭+카드+학년색 점) |

---

## 📄 라이선스

교내 사용 목적으로 제작되었습니다.  
아이콘: [Icons8](https://icons8.com)

---

*문의: 프로그램 담당자*
