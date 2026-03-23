# 데이터 형식과 수집

## 1. 데이터 폴더 구조

```text
data/
├─ fx/
│  └─ usdkrw.csv
├─ kr/
│  ├─ kodex_nasdaq100_lev_h.csv
│  ├─ tiger_us_sp500.csv
│  └─ tiger_us_nasdaq100.csv
├─ templates/
│  └─ price-template.csv
└─ us/
   ├─ bulz.csv
   ├─ qld.csv
   ├─ qqq.csv
   ├─ sgov.csv
   ├─ spym.csv
   └─ tqqq.csv
```

## 2. CSV 형식

필수 컬럼:

```text
Date,Open,High,Low,Close,Adj Close,Volume
```

규칙:

- `Date`, `Close`는 반드시 있어야 합니다.
- `Adj Close`가 있으면 보정종가로 계산합니다.
- `Adj Close`가 없으면 `Close`를 사용합니다.
- `Open`이 없으면 `Close`를 시가 대용으로 씁니다.
- 날짜는 `YYYY-MM-DD` 형식을 권장합니다.

## 3. 수집 소스

- 미국 ETF: `stooq`
- 환율: `FRED DEXKOUS`
- 한국 ETF: 네이버 차트 API

## 4. 실행 예시

```bash
node src/fetch-data.js all
node src/fetch-data.js us --start 2020-01-01
node src/fetch-data.js kr --start 2020-01-01 --end 2026-03-23
node src/fetch-data.js fx
```

## 5. 현재 백테스트가 실제로 쓰는 파일

### ISA

- `data/us/tqqq.csv`
- `data/us/bulz.csv`
- `data/us/spym.csv`
- `data/us/sgov.csv`
- `data/us/qqq.csv`
- `data/us/qld.csv`
- `data/fx/usdkrw.csv`
- `data/kr/kodex_nasdaq100_lev_h.csv`
- `data/kr/tiger_us_sp500.csv`

### 미국 전략

- `TQQQ`, `BULZ`, `SPYM`, `SGOV`, `USDKRW`

## 6. 참고

- ISA 현금성 자산은 별도 ETF를 읽지 않고 `연 3.5% 고정 이자`로 계산합니다.
- `Adj Open`은 로더에서 `Open * (Adj Close / Close)`로 계산됩니다.
