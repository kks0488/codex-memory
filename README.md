# codex-memory

**OpenAI Codex CLI를 위한 영구 메모리(Persistent Memory) 시스템**

> Claude Code의 [claude-mem](https://github.com/thedotmack/claude-mem)에서 영감을 받아,
> Codex CLI에 세션 간 장기 기억 기능을 부여하는 MCP 서버 + 수집 파이프라인.

---

## 왜 필요한가

Codex CLI는 `codex resume`으로 세션을 이어갈 수 있지만, **다른 세션/프로젝트 간 장기 기억이 없다.**

- "이전에 어떤 아키텍처 결정을 했는지"
- "어떤 버그를 어떻게 고쳤는지"
- "이 프로젝트에서 선호하는 패턴이 뭔지"

이런 지식이 매 세션마다 휘발된다. codex-memory는 이를 해결한다.

---

## 핵심 컨셉

### Observation (관찰) vs Memory (기억)

| | Observation | Memory |
|---|---|---|
| **성격** | 원시 기록 (무슨 일이 있었는지) | 정제된 지식 (무엇을 알아야 하는지) |
| **양** | 많고 거침 | 적고 정제됨 |
| **예시** | 턴 요약, 파일 변경, 툴 사용 로그 | 규칙, 결정, 교훈, 선호 |
| **생애** | 자동 수집, 시간이 지나면 정리 | 수동 저장 또는 승격으로 생성, 장기 유지 |

### Progressive Disclosure (점진적 공개)

토큰을 절약하면서 필요한 만큼만 컨텍스트에 주입:

```
1단계: search → 제목 + 스니펫 + 점수          → 최소 토큰
2단계: timeline → 시간순 관찰/기억 목록        → 중간 토큰
3단계: get_observations → 전체 본문            → 최대 토큰
```

---

## 아키텍처

```
┌─────────────────────────────────────────────────┐
│                   Codex CLI                      │
│                                                  │
│  config.toml          AGENTS.md          Skills  │
│  (mcp_servers,        (메모리 툴               │
│   notify 훅)          호출 규칙)                │
└──────┬──────────────────┬───────────────────────┘
       │ MCP (stdio)      │ notify 훅
       ▼                  ▼
┌──────────────┐  ┌──────────────┐
│  MCP Server  │  │  Ingest      │
│  (5개 Tool)  │  │  Pipeline    │
│              │  │  (수집기)     │
└──────┬───────┘  └──────┬───────┘
       │                 │
       ▼                 ▼
┌─────────────────────────────────────┐
│         SQLite + FTS5               │
│  ┌─────────────┐ ┌───────────────┐  │
│  │ observations │ │   memories    │  │
│  │ (관찰)       │ │   (기억)      │  │
│  └─────────────┘ └───────────────┘  │
│  ┌─────────────────────────────────┐│
│  │  FTS5 인덱스 (UNINDEXED 필터)   ││
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
```

### Codex 확장 포인트 활용

| 확장 포인트 | 용도 |
|---|---|
| **MCP Server** | 메모리 검색/저장 도구를 Codex 툴로 노출 |
| **notify 훅** | 턴 종료 시 자동으로 observation 수집 |

---

## MCP Tools (5개)

| Tool | 설명 | 입력 | 출력 |
|---|---|---|---|
| `search` | FTS5 BM25 키워드 검색 (Layer 1) | `query`, `repo_id?`, `type?`, `limit?` | `{results: [{id, table, title, snippet, score, created_at, kind?, memory_type?}]}` |
| `timeline` | anchor 기준 시간 윈도우 조회 (Layer 2) | `anchor_id`, `anchor_table?`, `window_min?` | `{timeline: [{id, table, title, created_at}]}` |
| `get_observations` | ID 배치로 상세 조회 (Layer 3) | `ids[]` | `{items: [{id, title, content, kind, scope, cwd, ...}]}` |
| `save_memory` | 메모리 저장/갱신 | `title`, `body`, `memory_type`, ... | `{memory_id, created_at}` |
| `__IMPORTANT` | 사용 가이드 + 핀 메모리 | `repo_id?` | 가이드 텍스트 + 핀 목록 |

---

## 데이터 모델

### observations 테이블

```sql
CREATE TABLE observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,       -- Unix epoch milliseconds
  repo_id TEXT NOT NULL,             -- git remote 기반 (예: user/repo)
  thread_id TEXT,                    -- Codex 세션 ID
  turn_id TEXT,                      -- 턴 ID
  scope TEXT NOT NULL DEFAULT 'repo', -- 'global', 'repo', 'thread'
  cwd TEXT,                          -- 작업 디렉토리
  kind TEXT NOT NULL,                -- turn_summary, file_change, tool_use, error, decision, custom
  title TEXT,                        -- 짧은 제목 (첫 줄 추출)
  content TEXT NOT NULL,             -- 전체 내용
  meta_json TEXT                     -- JSON 메타데이터
);
```

### memories 테이블

```sql
CREATE TABLE memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,       -- Unix epoch milliseconds
  updated_at INTEGER NOT NULL,
  repo_id TEXT NOT NULL,
  memory_type TEXT NOT NULL,         -- decision, fix, rule, preference, pattern, architecture, lesson, custom
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  importance INTEGER NOT NULL DEFAULT 3,  -- 1-5
  tags_json TEXT NOT NULL DEFAULT '[]',
  source_obs_ids TEXT NOT NULL DEFAULT '[]',  -- JSON array of observation IDs
  pinned INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,                -- TTL (NULL = no expiry)
  status TEXT NOT NULL DEFAULT 'active'  -- active, draft, superseded, quarantined
);
```

### FTS5 전문 검색

```sql
-- UNINDEXED 컬럼으로 JOIN 없이 필터 가능
CREATE VIRTUAL TABLE obs_fts USING fts5(
  title, content, repo_id UNINDEXED,
  content='observations', content_rowid='id'
);

CREATE VIRTUAL TABLE mem_fts USING fts5(
  title, body, repo_id UNINDEXED, memory_type UNINDEXED,
  content='memories', content_rowid='id'
);
```

FTS5 INSERT/UPDATE/DELETE 트리거로 자동 동기화.

---

## 설치 & 빌드

```bash
cd codex-memory
npm install
npm run build
```

## Codex 연동

`~/.codex/config.toml`에 추가:

```toml
# MCP 서버 등록
[mcp_servers.codex-memory]
type = "stdio"
command = "node"
args = ["/path/to/codex-memory/dist/server.js"]

# notify 훅 (턴 완료 시 자동 수집)
[notify]
command = "node"
args = ["/path/to/codex-memory/dist/cli.js", "notify"]
```

---

## 기술 스택

| 영역 | 기술 |
|---|---|
| 언어 | TypeScript (Node 22+, ESM) |
| DB | SQLite3 (better-sqlite3) + FTS5 + WAL |
| MCP | @modelcontextprotocol/sdk (stdio transport) |
| 검증 | Zod |

---

## 현재 상태

- **설계**: GPT-5.2-pro와의 4회 심층 대화로 아키텍처 완성 (archive/ 참조)
- **구현**: MVP 완료 -- MCP 5개 Tool + notify ingest + SQLite/FTS5
- **포트**: 9002 할당 (웹 뷰어용, 현재 미사용)

### 향후 계획

| 우선순위 | 기능 |
|----------|------|
| MEDIUM | search에 `since`, `tags` 필터 추가 |
| MEDIUM | CLI에 `ingest-jsonl` 서브커맨드 (배치 수집) |
| LOW | Token Budget 자동 제어 (tiktoken + Context Planner) |
| LOW | app-server thread importer (백필 + 증분) |
| LOW | 로컬 웹 뷰어 (Express + SSE) |
| LOW | 자동 승격 파이프라인 (Observation → Draft → Active) |
| LOW | 충돌 해결 (claim 정규화 + conflict inbox) |
| LOW | Hard pin / Soft pin 분리 |
| LOW | 보안 레이어 (exclude 마커, repo allowlist, TTL 정리) |
| LOW | AGENTS.md / Skills 템플릿 패키징 |

---

## 참조

- [claude-mem](https://github.com/thedotmack/claude-mem) -- 영감 원천
- [Codex MCP 가이드](https://developers.openai.com/codex/mcp/)
- [Codex config 레퍼런스](https://developers.openai.com/codex/config-reference/)
- [Codex app-server](https://developers.openai.com/codex/app-server/)
- [Codex memory feature request #4933](https://github.com/openai/codex/issues/4933)
- GPT-5.2-pro 설계 대화: `archive/chat.md`

---

## 디렉토리 구조

```
codex-memory/
├── src/
│   ├── server.ts          # MCP 서버 엔트리포인트
│   ├── db.ts              # SQLite + FTS5 (스키마, CRUD, 검색)
│   ├── paths.ts           # 경로 유틸 (CODEX_HOME, DB_PATH)
│   ├── repo.ts            # git remote 기반 repo_id 감지
│   ├── types.ts           # Observation, Memory, SearchResult 등 타입
│   ├── ingest.ts          # notify 페이로드 → observation 저장
│   ├── cli.ts             # CLI 엔트리 (codex-memory notify)
│   └── tools/
│       ├── search.ts      # FTS5 BM25 검색 (Layer 1)
│       ├── timeline.ts    # 시간 윈도우 조회 (Layer 2)
│       ├── get-observations.ts  # ID 배치 상세 조회 (Layer 3)
│       ├── save-memory.ts # 메모리 저장/갱신
│       └── important.ts   # 사용 가이드 + 핀 메모리
├── dist/                  # 빌드 출력
├── package.json
├── tsconfig.json
├── codex-config-example.toml  # Codex 연동 설정 예시
├── .env                   # PORT=9002
├── .claude/CLAUDE.md      # 프로젝트 인프라 가이드
├── README.md              # 이 문서
└── archive/               # GPT-5.2-pro 설계 대화 원본
    └── chat.md            # 설계 대화 전문
```
