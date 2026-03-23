# aratqqq3 Backtester

TQQQ, BULZ, ISA KODEX Nasdaq100 레버리지 전략을 비교하는 Node.js 백테스트 프로젝트입니다.

현재 저장소는 단순한 SMA200 실험본이 아니라, 실제 ISA 납입 흐름과 재가입 규칙까지 반영한 최신 버전 기준으로 정리되어 있습니다.

- 기존 ISA 1년 보유 가정
- 시작 1,000만원 + 매달 21일 60만원 납입
- 해지 가능 시점 이후에도 `TQQQ > SMA200`이면 해지 연기
- 해지 후 즉시 재가입, 2,000만원 납입, 이후 매년 1월 2일 2,000만원 납입
- 위험 구간 추가금은 `TIGER 미국S&P500`
- 해지 자금은 USD 슬리브로 이동 후 `BULZ / SGOV` 규칙 적용

## 빠른 시작

```bash
npm run check-data
npm run run:isa
```

`run:isa`는 최신 ISA 결과를 `results/isa-kodex-latest.json`으로 저장합니다.

## 브라우저 대시보드

서버 방식:

```bash
npm run app
```

정적 HTML 내보내기:

```bash
npm run app:export
```

원격 개발환경이나 컨테이너처럼 `localhost`가 내 브라우저와 분리된 환경에서는 서버 방식이 안 붙을 수 있습니다. 그런 경우엔 정적 HTML 내보내기를 권장합니다.

## 주요 명령

```bash
npm run help
npm run fetch-data
npm run check-data
npm run run
npm run run:tqqq
npm run run:bulz
npm run run:isa
npm run run:isa:console
npm run app
npm run app:export
```

## 폴더 구조

```text
.
├─ app.js
├─ data/
│  ├─ fx/
│  ├─ kr/
│  ├─ templates/
│  └─ us/
├─ docs/
│  ├─ data-format.md
│  ├─ strategy.md
│  └─ validation-checklist.md
├─ results/
│  └─ .gitkeep
└─ src/
   ├─ cli.js
   ├─ config.js
   ├─ fetch-data.js
   └─ lib/
```

## 문서

- 전략 명세: `docs/strategy.md`
- 데이터 형식 및 수집: `docs/data-format.md`
- 검증 체크리스트: `docs/validation-checklist.md`

## 참고

- 데이터는 저장소에 포함돼 있지만 `results/`는 생성물 폴더로 취급합니다.
- 현재 대시보드와 CLI는 `isa-kodex` 결과 JSON을 기준으로 움직입니다.
- 비교용으로 `QLD`, `TIGER 미국S&P500`, `TIGER 미국나스닥100` 데이터가 포함돼 있습니다.
