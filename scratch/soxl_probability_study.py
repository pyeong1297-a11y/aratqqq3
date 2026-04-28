import yfinance as yf
import pandas as pd
import numpy as np
from datetime import datetime

def analyze_soxl_probabilities_day3_5pct():
    ticker_name = 'SOXL'
    raw = yf.download(ticker_name, start='2010-01-01', auto_adjust=True, progress=False)
    
    if raw.empty:
        print("Error: 데이터를 가져오지 못했습니다.")
        return

    if isinstance(raw.columns, pd.MultiIndex):
        close_s = raw['Close'][ticker_name]
        high_s = raw['High'][ticker_name]
    else:
        close_s = raw['Close']
        high_s = raw['High']
    
    df = pd.DataFrame({'Close': close_s, 'High': high_s})
    df['SMA200'] = df['Close'].rolling(window=200).mean()
    df = df.dropna(subset=['SMA200']).copy()

    df['Above'] = df['Close'] > df['SMA200']
    df['Streak'] = df['Above'].groupby((df['Above'] != df['Above'].shift()).cumsum()).cumsum()
    df['Streak'] = np.where(df['Above'], df['Streak'], 0)
    
    df['Entry'] = (df['Streak'] == 3)
    df['Exit'] = (df['Close'] < df['SMA200'])

    cycles = []
    in_pos = False
    entry_price = 0
    max_high = 0
    
    for i in range(len(df)):
        row = df.iloc[i]
        if not in_pos and row['Entry']:
            in_pos = True
            entry_price = row['Close']
            max_high = row['High']
        elif in_pos:
            max_high = max(max_high, row['High'])
            if row['Exit']:
                cycles.append((max_high - entry_price) / entry_price * 100)
                in_pos = False
    
    if in_pos:
        cycles.append((max_high - entry_price) / entry_price * 100)

    total_cycles = len(cycles)
    print(f"\n[분석 완료] 총 SMA200 'Day 3 진입' 사이클 수: {total_cycles}회")
    
    results = []
    # 5% to 300% in 5% increments
    for t in range(5, 305, 5):
        count = sum(1 for r in cycles if r >= t)
        prob = (count / total_cycles) * 100
        results.append((t, prob, count))
    
    print("\n--- SOXL 수익률 도달 확률 (5% 단위, 3일 확정 진입) ---")
    print(f"{'목표':<6} | {'확률':<8} | {'횟수'}")
    print("-" * 30)
    for t, p, c in results:
        # Only print all if t <= 100, then print every 20% to keep it concise but cover up to 300
        # Wait, the user asked for 300%까지, I'll print them all but in a compact format if needed
        # Actually I'll print all as requested.
        print(f"+{t:3}%  | {p:6.2f}% | {c}/{total_cycles}")

if __name__ == "__main__":
    analyze_soxl_probabilities_day3_5pct()
