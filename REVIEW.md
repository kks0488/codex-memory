# codex-memory MVP 코드 리뷰

## 핵심 Findings (심각도 순)

### [HIGH] `timeline`가 repo 경계를 무시해 타 프로젝트 데이터가 섞여 반환됨
- 근거 코드: `src/db.ts:391`, `src/db.ts:404`
- `timeline` 조회는 `created_at` 윈도우만 사용하고 `repo_id` 필터가 없습니다.
- 결과적으로 한 repo의 anchor로 조회해도 동일 시간대 다른 repo observation/memory가 섞입니다.
- 설계 대화는 repo 중심 메모리 경계를 전제로 함: `archive/chat.md:54`, `archive/chat.md:130`.

### [HIGH] `save_memory(update_id)`가 repo 소유권 검증 없이 임의 ID를 수정 가능
- 근거 코드: `src/tools/save-memory.ts:37`, `src/db.ts:258`
- 현재는 `id`만으로 업데이트하며 `repo_id` 조건이 없습니다.
- MCP 호출자가 ID만 알면 다른 repo memory를 수정할 수 있어 데이터 무결성 문제가 큽니다.

### [MEDIUM] 설계된 Tool 스펙 일부가 MVP 코드에 미반영 (`search`/`timeline`/`save_memory`)
- 설계 입력: `search(query, repo_id or cwd, type, limit, since, tags)` (`archive/chat.md:130`)
- 설계 입력: `timeline(anchor_id 또는 query, window_before, window_after)` (`archive/chat.md:133`)
- 설계 입력: `save_memory(..., scope(repo/global), source_obs_ids)` (`archive/chat.md:138`)
- 실제 구현: `search`는 `since/tags/cwd` 없음 (`src/server.ts:30`), `timeline`은 `anchor_id + window_min`만 지원 (`src/server.ts:52`), `save_memory`는 scope 필드 없음 (`src/server.ts:83`).

### [MEDIUM] `notify` ingest가 핵심 관찰 필드(`input-messages`)를 저장하지 않음
- 설계에서 notify payload 핵심 필드로 언급: `archive/chat.md:155`
- 실제 구현은 `last-assistant-message` 중심 저장, 사용자 입력은 누락: `src/ingest.ts:19`, `src/ingest.ts:38`.
- 회고/원인 추적 시 관찰 품질이 떨어집니다.

### [MEDIUM] DB 초기화가 부분 마이그레이션/복구에 취약
- 트리거 존재 체크를 `obs_ai` 하나만 확인: `src/db.ts:91`
- 이후 트리거 생성은 `IF NOT EXISTS` 없이 일괄 실행: `src/db.ts:98`, `src/db.ts:116`
- 일부 트리거만 손상된 상태에서 재기동 시 실패 가능성이 있습니다.

### [MEDIUM] 인덱스 설계가 조회 패턴 대비 불충분
- `memories.created_at` 인덱스 없음 (timeline 메모리 조회는 시간 범위 기반): `src/db.ts:403`
- `pinned/status/repo` 조합 인덱스 없음 (중요 메모리 조회 패턴): `src/db.ts:441`
- 대규모 데이터에서 full scan 가능성이 큽니다.

### [MEDIUM] 타입/스키마 정의 중복으로 드리프트 위험
- `server.ts`에 Zod 스키마 직접 선언: `src/server.ts:30`
- `src/tools/*.ts`에도 동일 스키마 재선언: `src/tools/search.ts:4`, `src/tools/save-memory.ts:5`
- 현재는 우연히 동일하지만 향후 한쪽만 수정될 가능성이 큽니다.

### [LOW] `get_observations` 반환이 JSON 필드를 파싱하지 않아 소비자 부담 증가
- 설계 메모: `meta_json`, `tags_json` 파싱 반환 권장: `archive/chat.md:374`
- 실제는 raw string 그대로 반환: `src/tools/get-observations.ts:11`

### [LOW] 테스트 부재
- 단위/통합 테스트 파일이 없습니다 (`src/` 외 테스트 없음).
- 특히 FTS 쿼리, timeline 경계, trigger sync 같은 회귀 리스크가 큰 영역이 미보장 상태입니다.

---

## 1) 아키텍처 리뷰 (설계 반영도)

### 잘 반영된 점
- Observation/Memory 분리 모델 구현: `src/db.ts:38`, `src/db.ts:57`
- SQLite + FTS5 + trigger sync 구현: `src/db.ts:78`, `src/db.ts:83`, `src/db.ts:98`
- 5개 MCP Tool 구성 유지: `src/server.ts:27`, `src/server.ts:49`, `src/server.ts:70`, `src/server.ts:80`, `src/server.ts:113`
- notify 기반 ingest 파이프라인 존재: `src/cli.ts:9`, `src/ingest.ts:9`

### 설계 대비 불일치
- Tool I/O 일부 축소 (`since/tags/cwd`, `window_before/after`, `scope`) 미반영
- repo 경계 일관성 미흡 (`timeline`, `updateMemory`)
- 관찰 원문 품질(사용자 입력 보존) 미흡

판정: **핵심 골격은 반영됐지만, 설계 의도(repo 경계/점진적 조회 파라미터/관찰 품질)에서 중요한 누락이 있음**.

---

## 2) 코드 품질 (TypeScript, 에러 처리, 타입 안전성)

### 장점
- 전반적으로 명시적 타입 선언과 Zod 입력 검증을 사용함: `src/server.ts:30`
- DB 접근이 함수 단위로 분리되어 응집도는 양호함: `src/db.ts`

### 개선 필요
- `cli notify`는 `NotifyPayload`를 런타임 검증하지 않고 단순 캐스팅: `src/cli.ts:17`
- `payload.type` 미존재 시 `includes` 호출로 런타임 오류 가능: `src/ingest.ts:66`
- DB row를 `as Type`로 단정하는 패턴 다수 (런타임 안전장치 부족): `src/db.ts:178`, `src/db.ts:302`
- 스키마 중복 정의로 유지보수 리스크

---

## 3) DB 설계 (SQLite/FTS5/트리거/인덱스)

### 좋은 점
- WAL/NORMAL pragma 적용: `src/db.ts:24`, `src/db.ts:25`
- FTS5 external content + 동기화 트리거 구성은 방향이 적절함
- parameterized query 사용으로 SQL injection 기본 방어는 양호

### 문제점
- repo 경계 쿼리 누락 (`timeline`)
- 트리거 생성 idempotency 취약
- 인덱스가 실제 조회 패턴과 일부 불일치
- enum/range에 대한 DB `CHECK` 제약 없음 (`importance`, `status`, `kind` 등)

---

## 4) MCP 프로토콜 리뷰 (5개 Tool I/O/description)

### search
- description 품질: 양호
- I/O 갭: `since`, `tags`, `cwd` 누락 (설계 대비)

### timeline
- description 품질: 보통
- I/O 갭: `query` 기반 anchor, `window_before/after` 미지원
- 동작 갭: repo 경계 누락

### get_observations
- description 품질: 양호
- 출력 갭: `meta_json` 구조화 미파싱

### save_memory
- description 품질: 양호
- I/O 갭: scope 입력 부재, update 시 repo 안전장치 부재

### __IMPORTANT
- usage guide 제공은 좋음
- pinned 출력은 `tags_json` raw string 노출이라 읽기성은 떨어짐: `src/tools/important.ts:57`

종합: **툴 개수/기본 역할은 맞지만, 설계에서 의도한 입력 파라미터와 안전성 제약이 일부 빠짐**.

---

## 5) chat.md 기준 MVP 누락 기능

MVP 범주에서 “빠졌다고 볼 수 있는” 항목:
- `search`의 `since`, `tags`, `cwd` 입력
- `timeline`의 `query` 기반 진입, 비대칭 시간 윈도우
- `save_memory`의 `scope(repo/global)` 명시 입력
- `get_observations` JSON 필드 파싱 반환
- notify ingest에서 `input-messages` 저장
- AGENTS 메모리 사용 규칙 템플릿 파일(문서 내 강조 대비 실제 리포 미포함): `archive/chat.md:166`

참고: `ingest-jsonl`은 대화에서 **선택(옵션)**으로 표기되어 MVP 필수 누락으로는 보지 않았습니다 (`archive/chat.md:480`).

---

## 6) 보안 리뷰 (SQL injection / 입력검증 / 경로탐색)

### SQL injection
- 일반 SQL injection 위험은 낮음 (prepared statement 사용)
- 동적 SQL은 화이트리스트 기반 문자열만 사용 (`anchorTable`, update set 절)로 상대적으로 안전

### 입력 검증
- MCP는 Zod 검증이 있으나 string 길이 상한 없음 (대형 입력 DoS/비용 리스크)
- CLI notify 경로는 Zod 검증 없음

### 경로 탐색
- 사용자 입력으로 파일 경로를 직접 여는 로직이 없어 path traversal 위험은 낮음

### 추가 보안/무결성 리스크
- cross-repo read/write 경계 부족 (`timeline`, `updateMemory`)

---

## 7) 개선 제안 (즉시 vs 후속)

## 즉시 수정 (우선순위 높음)
1. `timeline`에 `repo_id` 필터 강제 추가, anchor 조회 시 repo 검증까지 포함
2. `updateMemory`를 `WHERE id = ? AND repo_id = ?`로 변경하고 tool 레이어에서 repo 해석 일원화
3. notify payload에 Zod 검증 도입 (`type`, `thread-id`, `turn-id`, `input-messages`, `last-assistant-message`)
4. 트리거 생성을 `CREATE TRIGGER IF NOT EXISTS`로 전환하고 마이그레이션 안전화
5. 최소 인덱스 추가
   - `memories(created_at)`
   - `memories(pinned, status, repo_id, importance DESC)`

## 나중에 할 것 (중기 개선)
1. Tool 스펙 확장: `search.since/tags/cwd`, `timeline.query/window_before/window_after`, `save_memory.scope`
2. `get_observations`/`important` 출력 구조화 (`meta_json`, `tags_json` parse)
3. 스키마 단일화: server와 tools에서 중복된 Zod 정의 제거
4. DB `CHECK` 제약 추가 (importance range, status/kind enum)
5. 테스트 추가
   - FTS 검색/정렬
   - timeline repo isolation
   - trigger sync
   - save_memory update 권한 경계

---

## 오픈 질문 / 가정
- 의도적으로 cross-repo 검색/타임라인을 허용하려는 제품 정책인지 확인이 필요합니다.
- `save_memory update`를 모든 repo 공용 ID 공간에서 허용할지(현재), repo 경계로 제한할지 정책 확정이 필요합니다.
- `memory scope`를 `repo_id` 특수값(`_global`)로 계속 표현할지, 별도 `scope` 컬럼으로 분리할지 결정이 필요합니다.
