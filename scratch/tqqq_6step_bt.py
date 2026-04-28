import yfinance as yf
import pandas as pd
import numpy as np

def run_tqqq_backtest():
    INTEREST_RATE = 0.0465  # 연 4.65% 대출이자
    
    raw = yf.download('TQQQ', start='2010-01-01', auto_adjust=True, progress=False)
    if isinstance(raw.columns, pd.MultiIndex):
        df = pd.DataFrame({'Close': raw['Close']['TQQQ'], 'High': raw['High']['TQQQ']})
    else:
        df = pd.DataFrame({'Close': raw['Close'], 'High': raw['High']})
    
    df['SMA200'] = df['Close'].rolling(200).mean()
    df = df.dropna(subset=['SMA200']).copy()
    df['Above'] = df['Close'] > df['SMA200']
    df['Streak'] = df['Above'].groupby((df['Above'] != df['Above'].shift()).cumsum()).cumsum()
    df['Streak'] = np.where(df['Above'], df['Streak'], 0)

    # 전략 정의
    strategies = {
        '6단계 분할 익절 (신규)': [
            (10,  0.10),
            (35,  0.15),
            (60,  0.20),
            (100, 0.30),
            (200, 0.30),
            (999, 1.00),  # 이탈 시 전량
        ],
        '100/50, 200/All (기존)': [
            (100, 0.50),
            (200, 1.00),
        ],
        '익절 없음 (순수 추세추종)': [],
    }

    results = {}
    
    for strat_name, tp_rules in strategies.items():
        cash = 100_000_000
        shares = 0.0
        in_pos = False
        entry_price = 0.0
        tp_reached = [False] * len(tp_rules)
        total_interest = 0.0
        equity_series = []

        for i in range(len(df)):
            date = df.index[i]
            price = float(df['Close'].iloc[i])
            high  = float(df['High'].iloc[i])

            # 이자 발생 (포지션 보유 중)
            if in_pos:
                daily_interest = shares * price * (INTEREST_RATE / 365)
                total_interest += daily_interest

            # 이탈
            if in_pos and df['Above'].iloc[i] == False:
                cash += shares * price
                shares = 0.0
                in_pos = False

            # 진입
            if not in_pos and df['Streak'].iloc[i] == 3:
                shares = cash / price
                cash = 0.0
                entry_price = price
                in_pos = True
                tp_reached = [False] * len(tp_rules)

            # 익절 체크
            if in_pos and len(tp_rules) > 0:
                curr_ret = (high - entry_price) / entry_price * 100
                for idx, (threshold, sell_pct) in enumerate(tp_rules):
                    if threshold == 999:
                        break  # 이탈 시 처리
                    if not tp_reached[idx] and curr_ret >= threshold:
                        sell_price = entry_price * (1 + threshold / 100)
                        sell_sh = shares * sell_pct
                        cash += sell_sh * sell_price
                        shares -= sell_sh
                        tp_reached[idx] = True

            equity_series.append(cash + shares * price)

        df[f'Equity_{strat_name}'] = equity_series

        final_equity = equity_series[-1] - total_interest
        years = (df.index[-1] - df.index[0]).days / 365.25
        cagr = ((final_equity / 100_000_000) ** (1 / years) - 1) * 100
        peak = pd.Series(equity_series).cummax()
        mdd  = ((pd.Series(equity_series) - peak) / peak * 100).min()

        results[strat_name] = {
            'final_equity': final_equity,
            'cagr': cagr,
            'mdd': mdd,
            'interest': total_interest,
        }

    # 결과 출력
    print(f"\n{'='*62}")
    print(f"  TQQQ 전략 비교 백테스트 (대출이자 {INTEREST_RATE*100:.2f}% 반영)")
    print(f"  기간: {df.index[0].date()} ~ {df.index[-1].date()}")
    print(f"  초기 자본: 1억원 (전액 대출 가정)")
    print(f"{'='*62}")
    print(f"{'전략':<22} | {'최종자산(억)':<12} | {'CAGR':<8} | {'MDD':<8} | {'총이자(만원)'}")
    print(f"{'-'*62}")
    for name, r in results.items():
        print(f"{name:<22} | {r['final_equity']/1e8:<12.2f} | {r['cagr']:<8.2f}% | {r['mdd']:<8.2f}% | {r['interest']/1e4:.0f}만")
    print(f"{'='*62}")

if __name__ == '__main__':
    run_tqqq_backtest()
