# HANDOVER

## 1. 프로젝트 개요

- 작업 폴더: `C:\Users\user\Documents\ara\aratqqq3`
- 목적: `TQQQ`, `BULZ`, `ISA KODEX 미국나스닥100레버리지(H)` 전략을 CLI로 백테스트하는 Node.js 프로그램
- 현재 상태: 전략 명세 정리, 데이터 수집 스크립트 작성, 백테스터 구현, 실데이터 1차 실행 완료

## 2. 지금까지 확정한 전략 가정

### 2.1 미국 TQQQ 전략

- 신호 자산 = 실행 자산: `TQQQ`
- 이동평균: `SMA200`
- 진입: `종가가 200일선 위에서 3거래일 연속 마감`
- 청산: `종가가 200일선 아래로 마감`
- 체결 가정: `당일 종가 확인 후 애프터장에서 종가 근처 체결`
- 백테스트에서는 애프터장 실제 체결가를 모르므로 `종가 + 슬리피지`로 모델링
- 익절:
  - `+50%` 도달 시 보유 수량의 `20%` 매도
  - `+100%`, `+200%`, `+300%` 도달 시 그 시점 잔여 수량의 `50%` 매도
- 익절 대금은 같은 날 `SPYM` 매수
- 비보유 자금은 `SGOV` 보유
- 매매수수료: `0.25%`
- 슬리피지 시나리오:
  - 낙관적 `0.00%`
  - 기준 `0.05%`
  - 보수적 `0.10%`
  - 스트레스 `0.20%`

### 2.2 미국 BULZ 전략

- 신호 자산 = 실행 자산: `BULZ`
- 이동평균: `SMA200`
- 진입: `종가가 200일선 위에서 2거래일 연속 마감`
- 청산, 익절, `SPYM`, `SGOV`, 수수료, 슬리피지 규칙은 TQQQ와 동일

### 2.3 ISA KODEX 전략

- 신호 자산: `TQQQ`
- 실행 자산: `KODEX 미국나스닥100레버리지(H)`
- 이동평균: `TQQQ SMA200`
- 진입: `종가가 200일선 위에서 1거래일 마감`
- 청산: `종가가 200일선 아래로 마감`
- 익절 없음
- 항상 `전액 진입 / 전액 청산`
- 미국 `D일` 종가 신호를 보고 한국 `다음 거래일`에 체결
- 체결 시나리오:
  - 낙관적: `공정가치`
  - 기준: `다음 거래일 시초가`
  - 보수적: `다음 거래일 시초가`에 `0.5%` 불리한 슬리피지
- 비보유 대기자산:
  - 원래는 CD ETF를 쓰려 했으나 데이터 시작일 문제로 제거
  - 현재는 `연 3.5% 고정 이자`로 가정

## 3. 세금/수수료 가정

### 3.1 미국 전략

- 시작 자금 기본값: `100,000,000원`
- 수수료: 매수/매도 각각 `0.25%`
- 세금 모드 2개:
  - `미반영`
  - `반영`
- 세금 반영 방식:
  - 연간 순실현손익 기준
  - `2,500,000원` 공제 후 `22%`
  - 다음 해 첫 거래일에 포트폴리오에서 차감
  - 마지막 해 미납 세금은 종료 시점에 차감

### 3.2 ISA 전략

- 수수료 기본값: `0.015%`
- 세금 모드 2개:
  - `미반영`
  - `반영`
- 세금 반영 방식:
  - 종료 시 총이익 기준
  - `4,000,000원` 공제 후 `9.9%`

## 4. 주요 파일

- 전략 문서: [전략.txt](C:/Users/user/Documents/ara/aratqqq3/전략.txt)
- 검증 체크리스트: [검증체크리스트.md](C:/Users/user/Documents/ara/aratqqq3/검증체크리스트.md)
- 인계 문서: [HANDOVER.MD](C:/Users/user/Documents/ara/aratqqq3/HANDOVER.MD)
- 실행 CLI: [src/cli.js](C:/Users/user/Documents/ara/aratqqq3/src/cli.js)
- 데이터 수집: [src/fetch-data.js](C:/Users/user/Documents/ara/aratqqq3/src/fetch-data.js)
- 설정: [src/config.js](C:/Users/user/Documents/ara/aratqqq3/src/config.js)
- 미국 전략 엔진: [src/lib/us-strategy.js](C:/Users/user/Documents/ara/aratqqq3/src/lib/us-strategy.js)
- ISA 전략 엔진: [src/lib/isa-strategy.js](C:/Users/user/Documents/ara/aratqqq3/src/lib/isa-strategy.js)
- 세금 로직: [src/lib/tax.js](C:/Users/user/Documents/ara/aratqqq3/src/lib/tax.js)
- 데이터 형식 안내: [data/README.md](C:/Users/user/Documents/ara/aratqqq3/data/README.md)
- 최신 전체 실행 결과: [results/run-all.json](C:/Users/user/Documents/ara/aratqqq3/results/run-all.json)

## 5. 현재 데이터 상태

현재 저장된 파일:

- [data/us/tqqq.csv](C:/Users/user/Documents/ara/aratqqq3/data/us/tqqq.csv)
- [data/us/bulz.csv](C:/Users/user/Documents/ara/aratqqq3/data/us/bulz.csv)
- [data/us/spym.csv](C:/Users/user/Documents/ara/aratqqq3/data/us/spym.csv)
- [data/us/sgov.csv](C:/Users/user/Documents/ara/aratqqq3/data/us/sgov.csv)
- [data/us/qqq.csv](C:/Users/user/Documents/ara/aratqqq3/data/us/qqq.csv)
- [data/fx/usdkrw.csv](C:/Users/user/Documents/ara/aratqqq3/data/fx/usdkrw.csv)
- [data/kr/kodex_nasdaq100_lev_h.csv](C:/Users/user/Documents/ara/aratqqq3/data/kr/kodex_nasdaq100_lev_h.csv)

참고:

- [data/kr/sol_cd_active.csv](C:/Users/user/Documents/ara/aratqqq3/data/kr/sol_cd_active.csv)는 과거 시도 흔적이다.
- 현재 ISA 로직에서는 더 이상 사용하지 않는다.
- 나중에 정리하거나 삭제해도 된다.

## 6. 데이터 수집 방식

- 미국 ETF: `stooq`
- 환율: `FRED DEXKOUS`
- 국내 ETF: `네이버 일봉 API`

참고:

- 처음에는 KRX 다운로드를 시도했지만 `OTP=LOGOUT` 및 `400` 문제로 실패했다.
- 그래서 국내 데이터는 네이버 일봉 API로 우회했다.

## 7. 실행 명령

PowerShell에서 `npm.ps1` 실행 정책 문제를 만날 수 있다.  
안전하게는 `cmd /c npm ...` 또는 `node ...` 직접 실행을 권장한다.

### 7.1 데이터 수집

```bash
cmd /c npm run fetch-data
```

또는

```bash
node src/fetch-data.js all
node src/fetch-data.js us
node src/fetch-data.js fx
node src/fetch-data.js kr
```

### 7.2 데이터 점검

```bash
node src/cli.js check-data all
```

### 7.3 전략 실행

```bash
node src/cli.js run us-tqqq
node src/cli.js run us-bulz
node src/cli.js run isa-kodex
node src/cli.js run all --save results\\run-all.json
```

참고:

- `--json`을 붙이면 콘솔 출력이 매우 길어진다.
- 보통은 `--save results\\run-all.json`만 쓰는 편이 낫다.

## 8. 최신 결과 스냅샷

기준은 `2026-03-21` 시점 마지막 실행 결과다.

### 8.1 미국 TQQQ

- 기준 / 세금 미반영: `최종 5.19억`, `CAGR 32.93%`, `MDD -34.46%`
- 기준 / 세금 반영: `최종 4.04억`, `CAGR 27.30%`, `MDD -38.49%`

### 8.2 미국 BULZ

- 기준 / 세금 미반영: `최종 7.14억`, `CAGR 53.84%`, `MDD -34.96%`
- 기준 / 세금 반영: `최종 5.62억`, `CAGR 45.99%`, `MDD -39.42%`

### 8.3 ISA KODEX

- 기준 / 세금 미반영: `최종 1.866억`, `CAGR 15.71%`, `MDD -29.97%`
- 기준 / 세금 반영: `최종 1.784억`, `CAGR 14.50%`, `MDD -29.97%`

ISA 백테스트 구간:

- `2021-12-09 ~ 2026-03-20`

## 9. 이번 세션에서 고친 핵심 문제

### 9.1 ISA 수익률이 비정상적으로 낮게 보이던 문제

- 처음에는 대기자산으로 `sol_cd_active.csv`를 연결해 ISA 구간이 `2024-09-24`부터만 계산됐다.
- 그 결과 ISA 성과가 과도하게 낮게 보였다.
- 사용자 확인 결과, 대기자산은 `연 3.5% 고정 이자` 가정으로 바꾸기로 합의했다.
- 현재는 그 수정이 반영되어 ISA가 `2021-12-09`부터 계산된다.

### 9.2 ISA 신호 로직 확인

- 사용자 질문: `tqqq 200일선 기준으로 사고 파는거 맞지?`
- 확인 결과: 맞다.
- 현재 ISA는 `TQQQ 종가`와 `SMA200`을 기준으로 신호를 생성한다.

### 9.3 데이터 수집 경로 정리

- 미국/환율 데이터 수집은 정상화됨
- 국내 데이터는 KRX 실패 후 네이버 API로 정착

## 10. 현재 남아 있는 한계

- 미국 ETF 배당/분배금 원천징수는 아직 별도 반영하지 않았다.
- 미국 세금 로직은 `연간 순실현손익 - 250만원 공제 후 22%`의 단순 모델이다.
- ISA 수수료 `0.015%`는 NH 국내 ETF 일반 수수료 기준의 실무 가정값이다.
- `BULZ`는 역사 구간이 짧아 장기 결론을 내리기 어렵다.
- 일부 JS/JSON 출력 라벨은 한글이 깨져 보이는 부분이 있다. 로직에는 영향 없지만 정리 필요하다.
- [data/kr/sol_cd_active.csv](C:/Users/user/Documents/ara/aratqqq3/data/kr/sol_cd_active.csv)는 현재 미사용 파일이다.

## 11. 다음 작업 추천 순서

### 우선순위 1

- `TQQQ vs BULZ`를 공통구간으로만 비교하는 리포트 추가
- 지금은 각 전략이 자기 데이터 전체 구간으로 계산되어 직접 비교 시 착시가 있다

### 우선순위 2

- `KODEX buy & hold` 벤치마크 추가
- ISA 전략이 실제로 얼마나 의미 있는지 바로 비교 가능해진다

### 우선순위 3

- 미국 전략의 배당/분배금 처리 검토
- 특히 `SGOV`, `SPYM`은 분배금 반영 방식 점검이 필요하다

### 우선순위 4

- 한글 라벨 깨짐 정리
- 결과 JSON과 콘솔 가독성 개선

## 12. 다른 컴퓨터에서 이어받을 때 체크 순서

1. Node.js 설치 확인
2. 프로젝트 폴더 전체 복사
3. [package.json](C:/Users/user/Documents/ara/aratqqq3/package.json) 기준으로 실행 환경 확인
4. `node src/cli.js check-data all` 실행
5. 필요하면 `node src/fetch-data.js all`로 데이터 재수집
6. `node src/cli.js run all --save results\\run-all.json` 실행
7. 최신 결과는 [results/run-all.json](C:/Users/user/Documents/ara/aratqqq3/results/run-all.json)에서 확인

## 13. 재개 시 바로 참고할 메모

- 사용자는 ISA 결과가 지나치게 낮게 나오면 바로 이상하다고 느낀다.
- ISA는 `TQQQ 200일선 신호`가 맞고, 대기자산은 현재 `연 3.5%` 고정이 핵심 전제다.
- 다음 대화에서 가장 먼저 할 만한 일은 `공통구간 비교 리포트` 또는 `KODEX buy & hold` 추가다.
