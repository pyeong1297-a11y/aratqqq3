import yfinance as yf
import pandas as pd
import numpy as np

def analyze_tqqq_cycle_detail():
    ticker_name = 'TQQQ'
    raw = yf.download(ticker_name, start='2010-01-01', auto_adjust=True, progress=False)
    
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
    entry_date = None

    for i in range(len(df)):
        row = df.iloc[i]
        date = df.index[i]
        if not in_pos and row['Entry']:
            in_pos = True
            entry_price = row['Close']
            max_high = row['High']
            entry_date = date
        elif in_pos:
            max_high = max(max_high, row['High'])
            if row['Exit']:
                max_ret = (max_high - entry_price) / entry_price * 100
                final_ret = (row['Close'] - entry_price) / entry_price * 100
                duration = (date - entry_date).days
                cycles.append({
                    '진입일': entry_date.date(),
                    '이탈일': date.date(),
                    '기간(일)': duration,
                    '진입가': round(entry_price, 2),
                    '최고점 수익률(%)': round(max_ret, 1),
                    '최종 수익률(%)': round(final_ret, 1),
                })
                in_pos = False

    if in_pos:
        max_ret = (max_high - entry_price) / entry_price * 100
        cycles.append({
            '진입일': entry_date.date(),
            '이탈일': '진행중',
            '기간(일)': (df.index[-1] - entry_date).days,
            '진입가': round(entry_price, 2),
            '최고점 수익률(%)': round(max_ret, 1),
            '최종 수익률(%)': round((df['Close'].iloc[-1] - entry_price) / entry_price * 100, 1),
        })

    cycle_df = pd.DataFrame(cycles)
    cycle_df.index = range(1, len(cycle_df)+1)

    total = len(cycle_df)
    print(f"\n총 사이클 수: {total}회\n")
    print(cycle_df.to_string())
    
    print("\n\n--- 최고점 수익률 분포 요약 ---")
    thresholds = [10, 25, 35, 50, 65, 90, 100, 105, 135, 140, 230, 250]
    for t in thresholds:
        count = len(cycle_df[cycle_df['최고점 수익률(%)'] >= t])
        print(f"+{t:3}% 이상 달성: {count}/{total}회 ({count/total*100:.1f}%)")

if __name__ == "__main__":
    analyze_tqqq_cycle_detail()
