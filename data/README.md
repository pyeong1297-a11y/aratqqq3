# 데이터 폴더 형식

이 백테스터는 아래 경로의 CSV 파일을 읽는다.

## 폴더 구조

```text
data/
  us/
    tqqq.csv
    bulz.csv
    spym.csv
    sgov.csv
    qqq.csv
  kr/
    kodex_nasdaq100_lev_h.csv
  fx/
    usdkrw.csv
  templates/
    price-template.csv
```

## 지원 헤더

다음 열 이름을 우선 지원한다.

```text
Date, Open, High, Low, Close, Adj Close, Volume
```

주의:
- `Date`와 `Close`는 반드시 있어야 한다.
- `Adj Close`가 있으면 총수익 계산에 사용한다.
- `Adj Close`가 없으면 `Close`를 그대로 사용한다.
- `Open`이 없으면 `Close`를 시가 대용으로 사용한다.

## 날짜 형식

- `YYYY-MM-DD` 권장
- 일반적인 CSV 날짜 문자열도 허용하지만 가능하면 ISO 형식을 권장

## 데이터 사용 원칙

- 미국 전략은 `TQQQ/BULZ/SPYM/SGOV` 가격을 달러 기준으로 읽는다.
- 미국 전략의 포트폴리오 평가는 `USDKRW` 환율을 곱해 원화 기준으로 계산한다.
- 미국 세금도 원화 기준 실현손익으로 계산한다.
- ISA 전략은 국내 ETF 가격이므로 원화 기준 그대로 사용한다.
- ISA 대기자산은 실데이터 ETF가 아니라 `연 3.5% 고정 이자` 가정이다.
- ISA 전략의 실제 체결 시나리오는 `Adj Open`을 사용한다.
- `Adj Open`은 `Open * (Adj Close / Close)` 방식으로 계산한다.

## 현재 반영된 세금 규칙

- 미국 전략
  - 세금 미반영
  - 세금 반영: 연간 순실현이익에서 `2,500,000원` 공제 후 `22%`
  - 연도별 세금은 다음 연도 첫 거래일에 포트폴리오에서 차감
  - 백테스트 종료 시점의 당해연도 미납세액도 마지막 날 차감

- ISA 전략
  - 세금 미반영
  - 세금 반영: 해지 시점 총이익에서 `4,000,000원` 공제 후 `9.9%`

## 현재 반영된 수수료 규칙

- 미국 전략: 나무증권 미국주식 일반 온라인 수수료 `0.25%`
- ISA 전략: 국내 ETF 온라인 매매 수수료 기본값 `0.015%`

## 실행 예시

```text
npm run fetch-data
node src/fetch-data.js us
node src/fetch-data.js kr --start 2018-01-01
node src/fetch-data.js fx
node src/cli.js check-data all
node src/cli.js run us-tqqq
node src/cli.js run us-bulz
node src/cli.js run isa-kodex
node src/cli.js run all --json
```

## 자동 수집 스크립트 메모

- `src/fetch-data.js`
  - 미국 ETF: `stooq` CSV 다운로드
  - 환율: `FRED DEXKOUS`
  - 국내 ETF: `네이버 일봉 API`
- ISA 대기자산은 더 이상 별도 ETF 데이터를 사용하지 않는다.
