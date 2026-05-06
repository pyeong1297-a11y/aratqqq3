'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Clock3,
  RefreshCw,
  Target,
  TrendingUp,
  Trash2,
  WalletCards,
} from 'lucide-react';
import styles from './page.module.css';

const EMPTY_POSITIONS = {
  tqqq: { entry: '', shares: '' },
  bulz: { entry: '', shares: '' },
};

const STORAGE_KEY = 'ara_signal_positions_v1';

function formatCurrency(value, decimals = 2) {
  if (!Number.isFinite(value)) return '-';
  const digits = Math.abs(value) >= 1000 ? 0 : decimals;
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function formatPercent(value, decimals = 1, signed = false) {
  if (!Number.isFinite(value)) return '-';
  const sign = signed && value > 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(decimals)}%`;
}

function formatNumber(value, decimals = 1) {
  if (!Number.isFinite(value)) return '-';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatMetric(metric) {
  if (metric.type === 'currency') return formatCurrency(metric.value);
  if (metric.type === 'percent') return formatPercent(metric.value, metric.decimals ?? 1, true);
  if (metric.type === 'currencyPair') {
    return `${formatCurrency(metric.value)} / ${formatCurrency(metric.secondValue)}`;
  }
  if (!Number.isFinite(metric.value)) return '-';
  return `${formatNumber(metric.value, metric.decimals ?? 0)}${metric.suffix || ''}`;
}

function parseInput(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeTpRules(strategy) {
  if (Array.isArray(strategy.tpRules) && strategy.tpRules.length > 0) {
    return strategy.tpRules.map((rule, index) => ({
      label: rule.label || `TP${index + 1}`,
      ...rule,
    }));
  }

  return (strategy.tpThresholds || []).map((threshold, index) => ({
    label: `TP${index + 1}`,
    threshold,
  }));
}

function formatTpPercent(rule) {
  const base = formatPercent(rule.threshold, 0);
  if (!Number.isFinite(rule.roundedThreshold) || rule.roundedThreshold === rule.threshold) {
    return base;
  }
  return `${base} (${formatPercent(rule.roundedThreshold, 0)})`;
}

function formatTpPrice(rule, entry) {
  const basePrice = entry * (1 + rule.threshold);
  if (!Number.isFinite(rule.roundedThreshold) || rule.roundedThreshold === rule.threshold) {
    return formatCurrency(basePrice);
  }

  return `${formatCurrency(basePrice)} (${formatCurrency(entry * (1 + rule.roundedThreshold))})`;
}

function formatSellRule(rule) {
  if (rule.fullExit || rule.sellFraction >= 1) return '전량 익절';
  if (!Number.isFinite(rule.sellFraction)) return '';

  const basis = rule.sellBasis === 'base' ? '기준수량' : '보유량';
  const sell = formatPercent(rule.sellFraction, 0);
  if (Number.isFinite(rule.roundedSellFraction) && rule.roundedSellFraction !== rule.sellFraction) {
    return `${basis} ${sell}(${formatPercent(rule.roundedSellFraction, 0)}) 매도`;
  }

  return `${basis} ${sell} 매도`;
}

function toneIcon(tone) {
  if (tone === 'danger') return <ArrowDownRight size={16} />;
  if (tone === 'positive' || tone === 'action') return <ArrowUpRight size={16} />;
  return <Activity size={16} />;
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipDate}>{label}</div>
      {payload.map((item) => (
        <div key={item.dataKey} className={styles.tooltipRow}>
          <span style={{ background: item.color }} />
          <strong>{item.name}</strong>
          <em>{formatCurrency(item.value)}</em>
        </div>
      ))}
    </div>
  );
}

function SignalChart({ strategy }) {
  const isSnowball = strategy.key === 'tqqq';
  const gradientId = `${strategy.key}-price-gradient`;

  return (
    <div className={styles.chartWrap}>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={strategy.chart} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#16a34a" stopOpacity={0.26} />
              <stop offset="100%" stopColor="#16a34a" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 5" vertical={false} />
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            minTickGap={34}
            tick={{ fill: '#64748b', fontSize: 11 }}
            tickFormatter={(value) => value?.slice(5)}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            width={58}
            tick={{ fill: '#64748b', fontSize: 11 }}
            tickFormatter={(value) => `$${Math.round(value)}`}
            domain={['auto', 'auto']}
          />
          <Tooltip content={<ChartTooltip />} />
          <Area
            type="monotone"
            dataKey="price"
            name={strategy.symbol}
            stroke="#16a34a"
            strokeWidth={3}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 5, stroke: '#ffffff', strokeWidth: 2 }}
          />
          {isSnowball ? (
            <>
              <Line type="monotone" dataKey="ma5" name="5MA" stroke="#0ea5e9" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="ma220" name="220MA" stroke="#f59e0b" strokeWidth={2} dot={false} />
            </>
          ) : (
            <Line type="monotone" dataKey="ma200" name="200MA" stroke="#f59e0b" strokeWidth={2} dot={false} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function MetricRows({ strategy }) {
  return (
    <div className={styles.metricRows}>
      {strategy.metrics.map((metric) => (
        <div key={metric.label} className={styles.metricRow}>
          <span>{metric.label}</span>
          <strong>{formatMetric(metric)}</strong>
        </div>
      ))}
    </div>
  );
}

function DipRows({ strategy }) {
  if (!strategy.dipLevels?.length) return null;

  return (
    <div className={styles.levelRows}>
      <div className={styles.levelHeader}>
        <Target size={15} />
        <span>{strategy.qqqBasis} 기준 매수 가격</span>
      </div>
      {strategy.dipLevels.map((level) => {
        const active = Number.isFinite(strategy.qqqPrice) && Number.isFinite(level.price) && strategy.qqqPrice <= level.price;
        return (
          <div key={level.key} className={`${styles.levelRow} ${active ? styles.levelActive : ''}`}>
            <span>{level.label}</span>
            <strong>{formatCurrency(level.price)}</strong>
            <em>{formatPercent(level.drawdown, 0)}</em>
          </div>
        );
      })}
    </div>
  );
}

function PositionPanel({ strategy, position, onPositionChange, onPositionClear }) {
  const entry = parseInput(position.entry);
  const shares = parseInput(position.shares);
  const hasEntry = entry > 0 && Number.isFinite(strategy.price);
  const hasShares = hasEntry && shares > 0;
  const gainPct = hasEntry ? strategy.price / entry - 1 : null;
  const pnlPerShare = hasEntry ? strategy.price - entry : null;
  const totalPnl = hasShares ? pnlPerShare * shares : null;
  const marketValue = hasShares ? strategy.price * shares : null;
  const tpRows = hasEntry
    ? normalizeTpRules(strategy).map((rule) => {
        const price = entry * (1 + rule.threshold);
        return {
          label: rule.label,
          threshold: rule.threshold,
          percentText: formatTpPercent(rule),
          priceText: formatTpPrice(rule, entry),
          sellText: formatSellRule(rule),
          price,
          reached: strategy.price >= price,
        };
      })
    : [];

  return (
    <div className={styles.positionBox}>
      <div className={styles.positionHeader}>
        <WalletCards size={16} />
        <span>내 포지션</span>
        <button
          type="button"
          className={styles.clearPositionButton}
          onClick={() => onPositionClear(strategy.key)}
          disabled={!position.entry && !position.shares}
          title="포지션 해지"
          aria-label={`${strategy.symbol} 포지션 해지`}
        >
          <Trash2 size={14} />
          해지
        </button>
      </div>

      <div className={styles.inputGrid}>
        <label>
          <span>내 매수가</span>
          <input
            inputMode="decimal"
            value={position.entry}
            placeholder="0.00"
            onChange={(event) => onPositionChange(strategy.key, 'entry', event.target.value)}
          />
        </label>
        <label>
          <span>보유 수량</span>
          <input
            inputMode="decimal"
            value={position.shares}
            placeholder="0"
            onChange={(event) => onPositionChange(strategy.key, 'shares', event.target.value)}
          />
        </label>
      </div>

      <div className={styles.positionStats}>
        <div>
          <span>수익률</span>
          <strong className={gainPct >= 0 ? styles.positiveText : styles.negativeText}>
            {formatPercent(gainPct, 2, true)}
          </strong>
        </div>
        <div>
          <span>주당 손익</span>
          <strong className={pnlPerShare >= 0 ? styles.positiveText : styles.negativeText}>
            {Number.isFinite(pnlPerShare) ? `${pnlPerShare >= 0 ? '+' : ''}${formatCurrency(pnlPerShare)}` : '-'}
          </strong>
        </div>
        <div>
          <span>총 손익</span>
          <strong className={totalPnl >= 0 ? styles.positiveText : styles.negativeText}>
            {Number.isFinite(totalPnl) ? `${totalPnl >= 0 ? '+' : ''}${formatCurrency(totalPnl)}` : '-'}
          </strong>
        </div>
        <div>
          <span>평가금액</span>
          <strong>{formatCurrency(marketValue)}</strong>
        </div>
      </div>

      <div className={styles.tpRows}>
        {tpRows.length ? (
          tpRows.map((row) => (
            <div key={row.label} className={`${styles.tpRow} ${row.reached ? styles.tpReached : ''}`}>
              <span className={styles.tpLabel}>
                <b>{row.label}</b>
                {row.sellText ? <small>{row.sellText}</small> : null}
              </span>
              <strong>{row.priceText}</strong>
              <em>{row.percentText}</em>
            </div>
          ))
        ) : (
          <div className={styles.tpEmpty}>매수가 입력 대기</div>
        )}
      </div>
    </div>
  );
}

function StrategyPanel({ strategy, position, onPositionChange, onPositionClear }) {
  return (
    <section className={styles.strategyPanel}>
      <div className={styles.panelTop}>
        <div>
          <div className={styles.kicker}>{strategy.symbol}</div>
          <h2>{strategy.title}</h2>
        </div>
        <div className={`${styles.signalBadge} ${styles[`tone_${strategy.status.tone}`]}`}>
          {toneIcon(strategy.status.tone)}
          <span>{strategy.status.label}</span>
        </div>
      </div>

      <div className={styles.priceLine}>
        <strong>{formatCurrency(strategy.price)}</strong>
        <span className={strategy.previousChange >= 0 ? styles.positiveText : styles.negativeText}>
          {formatPercent(strategy.previousChange, 2, true)}
        </span>
        <em>{strategy.updatedDate}</em>
      </div>

      <SignalChart strategy={strategy} />

      <div className={styles.panelGrid}>
        <div className={styles.infoBox}>
          <div className={styles.infoHeader}>
            <TrendingUp size={16} />
            <span>전략 기준</span>
          </div>
          <MetricRows strategy={strategy} />
          <div className={styles.statusDetail}>{strategy.status.detail}</div>
          <DipRows strategy={strategy} />
        </div>

        <PositionPanel
          strategy={strategy}
          position={position}
          onPositionChange={onPositionChange}
          onPositionClear={onPositionClear}
        />
      </div>
    </section>
  );
}

function SummaryTile({ strategy }) {
  return (
    <div className={styles.summaryTile}>
      <div className={styles.summaryIcon}>
        <Activity size={18} />
      </div>
      <div>
        <span>{strategy.title}</span>
        <strong>{strategy.status.label}</strong>
        <em>{formatCurrency(strategy.price)} · {strategy.updatedDate}</em>
      </div>
    </div>
  );
}

export default function SignalsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [positions, setPositions] = useState(EMPTY_POSITIONS);
  const [positionsReady, setPositionsReady] = useState(false);

  const loadSignals = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/signals', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '신호 데이터를 불러오지 못했습니다.');
      setData(payload);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSignals();
  }, [loadSignals]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        setPositions({ ...EMPTY_POSITIONS, ...JSON.parse(saved) });
      }
    } catch {
      setPositions(EMPTY_POSITIONS);
    } finally {
      setPositionsReady(true);
    }
  }, []);

  useEffect(() => {
    if (!positionsReady) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
  }, [positions, positionsReady]);

  const strategies = useMemo(() => {
    if (!data?.strategies) return [];
    return [data.strategies.tqqq, data.strategies.bulz].filter(Boolean);
  }, [data]);

  const updatePosition = (key, field, value) => {
    setPositions((current) => ({
      ...current,
      [key]: {
        ...current[key],
        [field]: value,
      },
    }));
  };

  const clearPosition = (key) => {
    setPositions((current) => ({
      ...current,
      [key]: { ...EMPTY_POSITIONS[key] },
    }));
  };

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.brandIcon}>
            <Activity size={22} />
          </div>
          <div>
            <span>ARA Signals</span>
            <strong>TQQQ / BULZ</strong>
          </div>
        </div>

        <nav className={styles.nav}>
          <Link href="/">Backtest</Link>
          <button type="button" onClick={loadSignals} disabled={loading} aria-label="Refresh signals">
            <RefreshCw size={17} className={loading ? styles.spinIcon : ''} />
          </button>
        </nav>
      </header>

      <main className={styles.main}>
        <section className={styles.titleRow}>
          <div>
            <h1>실전 신호 대시보드</h1>
            <p>눈덩이 TQQQ와 BULZ 전략 상태</p>
          </div>
          <div className={styles.updatedBox}>
            <Clock3 size={16} />
            <span>{data?.generatedAt ? new Date(data.generatedAt).toLocaleString('ko-KR') : '-'}</span>
          </div>
        </section>

        {error ? (
          <div className={styles.errorBox}>{error}</div>
        ) : null}

        {loading && !strategies.length ? (
          <div className={styles.loadingBox}>신호 계산 중...</div>
        ) : null}

        {strategies.length ? (
          <>
            <section className={styles.summaryGrid}>
              {strategies.map((strategy) => (
                <SummaryTile key={strategy.key} strategy={strategy} />
              ))}
            </section>

            <div className={styles.strategyGrid}>
              {strategies.map((strategy) => (
                <StrategyPanel
                  key={strategy.key}
                  strategy={strategy}
                  position={positions[strategy.key] || EMPTY_POSITIONS[strategy.key]}
                  onPositionChange={updatePosition}
                  onPositionClear={clearPosition}
                />
              ))}
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}
