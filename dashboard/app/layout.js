import './globals.css';

export const metadata = {
  title: 'Strategy Simulator',
  description: 'TQQQ, BULZ, and Snowball strategy backtests',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
