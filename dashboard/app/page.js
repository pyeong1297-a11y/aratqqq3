'use client';

import Link from 'next/link';
import { useState, useCallback } from 'react';
import styles from './page.module.css';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
  ComposedChart, Line, LineChart
} from 'recharts';
import { 
  Settings, Play, TrendingUp, BarChart2, DollarSign, Calendar,
  ChevronDown, ChevronRight, CheckCircle, AlertTriangle, Info,
  Plus, X, Percent, Target, Activity, ShieldAlert, BarChart, Layers
} from 'lucide-react';

// ─── Strategy presets ───────────────────────────────────
const PRESETS = {
  tqqq: {
    label: 'TQQQ (나스닥 3배)',
    defaults: {
      startDate: '',
      endDate: '',
      confirmDays: 3,
      initialCapital: 100000,
      monthlyDCA: 0,
      stopLossEnabled: false,
      stopLossThreshold: -5,
      profitTakeEnabled: true,
      profitTakeSteps: [
        { threshold: 0.5, sellFraction: 0.2, spymRatio: 100 },
        { threshold: 1.0, sellFraction: 0.5, spymRatio: 100 },
        { threshold: 2.0, sellFraction: 1.0, spymRatio: 100 },
      ],
    },
  },
  bulz: {
    label: 'BULZ (혁신기업 3배)',
    defaults: {
      startDate: '',
      endDate: '',
      confirmDays: 2,
      initialCapital: 100000,
      monthlyDCA: 0,
      stopLossEnabled: false,
      stopLossThreshold: -5,
      profitTakeEnabled: true,
      profitTakeSteps: [
        { threshold: 0.5, sellFraction: 0.1, spymRatio: 0 },
        { threshold: 1.0, sellFraction: 1.0, spymRatio: 0 },
      ],
    },
  },
  bitu: {
    label: 'BITU (비트코인 2배)',
    defaults: {
      startDate: '',
      endDate: '',
      confirmDays: 2,
      initialCapital: 100000,
      monthlyDCA: 0,
      stopLossEnabled: false,
      stopLossThreshold: -10,
      profitTakeEnabled: true,
      profitTakeSteps: [
        { threshold: 1.0, sellFraction: 0.5, spymRatio: 100 },
        { threshold: 2.0, sellFraction: 1.0, spymRatio: 0 },
      ],
    },
  },
  snowball: {
    label: '눈덩이 TQQQ',
    defaults: {
      startDate: '',
      endDate: '',
      initialCapital: 100000,
      dip1Drawdown: -0.11,
      dip2Drawdown: -0.22,
      dip1Weight: 0.20,
      dip2Weight: 0.70,
      bonusWeight: 0.10,
      tp1Threshold: 0.37,
      tp1SellFractionOfBase: 0.53,
      tp2Threshold: 0.87,
      tp2SellFractionOfBase: 0.47,
      tp3Threshold: 3.55,
      gcShort: 5,
      gcLong: 220,
      cooldownDays: 5,
    },
  },
  manual: {
    label: '직접 입력',
    defaults: {
      startDate: '',
      endDate: '',
      symbol: 'TQQQ',
      confirmDays: 3,
      initialCapital: 100000,
      monthlyDCA: 0,
      stopLossEnabled: false,
      stopLossThreshold: -5,
      profitTakeEnabled: false,
      profitTakeSteps: [],
    },
  },
  isa_qld: {
    label: 'ISA 나스닥 (KRW)',
    defaults: {
      startDate: '',
      endDate: '',
      confirmDays: 3,
      initialCapital: 10000,
      monthlyDCA: 1666, // Roughly 20M KRW / 12 months in USD terms if USD=1200
      annualContributionLimit: 20000, // Year limit
      stopLossEnabled: false,
      profitTakeEnabled: true,
      profitTakeSteps: [
        { threshold: 0.5, sellFraction: 0.2, spymRatio: 100 },
        { threshold: 1.0, sellFraction: 0.5, spymRatio: 100 },
        { threshold: 2.0, sellFraction: 1.0, spymRatio: 0 },
      ],
    },
  }
};

// ─── Formatters ─────────────────────────────────────────
const fmtUSD = v => v >= 1_000_000 
  ? `$${(v / 1_000_000).toFixed(2)}M` 
  : `$${Math.round(v).toLocaleString()}`;
const fmtPct = v => `${(v * 100).toFixed(2)}%`;
const fmtDate = d => d ? d.slice(0, 7) : '';

// ─── Component ───────────────────────────────────────────
export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('single'); // 'single' or 'compare'
  const [activeStrategy, setActiveStrategy] = useState('tqqq');
  const [params, setParams] = useState(PRESETS.tqqq.defaults);
  
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [compareResult, setCompareResult] = useState(null);
  const [compareSelection, setCompareSelection] = useState({ a: 'tqqq', b: 'bulz' });

  // Accordion states
  const [openSections, setOpenSections] = useState({
    basic: true,
    strategy: true,
    profit: true,
    snowballDip: true,
    snowballTrend: true
  });

  const toggleSection = (key) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleStrategyChange = (key) => {
    setActiveStrategy(key);
    setParams(PRESETS[key].defaults);
    setResult(null);
    setError(null);
  };

  const handleRun = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategyType: activeStrategy, params }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unknown error');
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [activeStrategy, params]);

  const handleCompare = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCompareResult(null);
    try {
      const [resA, resB] = await Promise.all([
        fetch('/api/backtest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ strategyType: compareSelection.a, params: PRESETS[compareSelection.a].defaults }),
        }),
        fetch('/api/backtest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ strategyType: compareSelection.b, params: PRESETS[compareSelection.b].defaults }),
        }),
      ]);

      const dataA = await resA.json();
      const dataB = await resB.json();

      if (!resA.ok) throw new Error(dataA.error || 'A error');
      if (!resB.ok) throw new Error(dataB.error || 'B error');

      // Merge equity curves
      const merged = dataA.equityCurve.map((p, i) => {
        const pB = dataB.equityCurve.find(b => b.date === p.date) || dataB.equityCurve[i] || { value: 100000 };
        return {
          date: p.date,
          valA: p.value,
          valB: pB.value,
        };
      });

      setCompareResult({
        curve: merged,
        metricsA: dataA.metrics,
        metricsB: dataB.metrics,
        labelA: PRESETS[compareSelection.a].label,
        labelB: PRESETS[compareSelection.b].label,
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [compareSelection]);

  const updateParam = (key, value) => setParams(p => ({ ...p, [key]: value }));
  const updateStep = (idx, field, value) => {
    const steps = [...(params.profitTakeSteps || [])];
    steps[idx] = { ...steps[idx], [field]: value };
    updateParam('profitTakeSteps', steps);
  };
  const addStep = () => {
    const steps = [...(params.profitTakeSteps || []), { threshold: 1.0, sellFraction: 0.5, spymRatio: 100 }];
    updateParam('profitTakeSteps', steps);
  };
  const removeStep = (idx) => {
    updateParam('profitTakeSteps', params.profitTakeSteps.filter((_, i) => i !== idx));
  };


  const marketStatus = result?.events?.some(e => e.type === 'status-holding') ? '투자중' : '대기';

  return (
    <div className={styles.root}>
      {/* ── Sidebar ── */}
      <aside className={styles.sidebar}>
        <div className={styles.logo}>
          <div className={styles.logoIconWrapper}>
            <TrendingUp size={24} color="#3b82f6" />
          </div>
          <div>
            <div className={styles.logoText}>ARA Backtester</div>
            <div className={styles.logoSub}>레버리지 ETF 200일선 투자법</div>
          </div>
        </div>

        <div className={styles.sidebarContent}>
          {/* ETF Selection */}
          <div className={styles.sectionBlock}>
            <h3 className={styles.sectionTitle}><Layers size={14} /> 레버리지 ETF 선택</h3>
            <div className={styles.etfGrid}>
              {Object.entries(PRESETS).map(([key, p]) => (
                <button
                  key={key}
                  className={`${styles.etfBtn} ${activeStrategy === key ? styles.etfBtnActive : ''}`}
                  onClick={() => handleStrategyChange(key)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Basic Settings (Always shown) */}
          <div className={styles.accordion}>
            <button className={styles.accordionHeader} onClick={() => toggleSection('basic')}>
              <div className={styles.accordionTitle}><Settings size={14}/> 기본 설정</div>
              {openSections.basic ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
            </button>
            {openSections.basic && (
              <div className={styles.accordionBody}>
                <div className={styles.inputGroup}>
                  <label>시작일</label>
                  <input className={styles.input} type="date" value={params.startDate || ''} onChange={e => updateParam('startDate', e.target.value)} />
                </div>
                <div className={styles.inputGroup}>
                  <label>종료일</label>
                  <input className={styles.input} type="date" value={params.endDate || ''} onChange={e => updateParam('endDate', e.target.value)} />
                </div>
                {activeStrategy === 'manual' && (
                  <div className={styles.inputGroup}>
                    <label>레버리지 ETF 심볼</label>
                    <input className={styles.input} type="text" placeholder="e.g. TQQQ, SOXL, NVLX" value={params.symbol || ''} onChange={e => updateParam('symbol', e.target.value.toUpperCase())} />
                  </div>
                )}
                <div className={styles.inputGroup}>
                  <label>초기 투자금 (USD)</label>
                  <input className={styles.input} type="number" value={params.initialCapital} onChange={e => updateParam('initialCapital', parseFloat(e.target.value) || 0)} />
                </div>
                {activeStrategy !== 'snowball' && (
                  <div className={styles.inputGroup}>
                    <label>월 적립금 (USD)</label>
                    <input className={styles.input} type="number" value={params.monthlyDCA || 0} onChange={e => updateParam('monthlyDCA', parseFloat(e.target.value) || 0)} />
                  </div>
                )}
                {activeStrategy === 'isa_qld' && (
                  <div className={styles.inputGroup}>
                    <label>연간 납입 한도 (USD)</label>
                    <input className={styles.input} type="number" value={params.annualContributionLimit || 20000} onChange={e => updateParam('annualContributionLimit', parseFloat(e.target.value) || 0)} />
                  </div>
                )}
              </div>
            )}
          </div>

          {activeStrategy === 'snowball' ? (
            <>
              {/* Snowball DIP Settings */}
              <div className={styles.accordion}>
                <button className={styles.accordionHeader} onClick={() => toggleSection('snowballDip')}>
                  <div className={styles.accordionTitle}>
                    <Target size={14}/> 하락장 매수 (DIP)
                    <span className={styles.badgeSmall} style={{ marginLeft: '8px', fontSize: '10px', background: '#eff6ff', color: '#3b82f6' }}>장중 시장가 주문</span>
                  </div>
                  {openSections.snowballDip ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
                </button>
                {openSections.snowballDip && (
                  <div className={styles.accordionBody}>
                    <div className={styles.inputGroup}>
                      <label>DIP 1 낙폭 / 비중</label>
                      <div className={styles.grid2}>
                        <div className={styles.stepInputWrap}>
                          <input type="number" value={Math.round(params.dip1Drawdown * 100)} onChange={e => updateParam('dip1Drawdown', parseFloat(e.target.value)/100)} className={styles.input} />
                          <span>%</span>
                        </div>
                        <div className={styles.stepInputWrap}>
                          <input type="number" value={Math.round(params.dip1Weight * 100)} onChange={e => updateParam('dip1Weight', parseFloat(e.target.value)/100)} className={styles.input} />
                          <span>%</span>
                        </div>
                      </div>
                    </div>
                    <div className={styles.inputGroup}>
                      <label>DIP 2 낙폭 / 비중</label>
                      <div className={styles.grid2}>
                        <div className={styles.stepInputWrap}>
                          <input type="number" value={Math.round(params.dip2Drawdown * 100)} onChange={e => updateParam('dip2Drawdown', parseFloat(e.target.value)/100)} className={styles.input} />
                          <span>%</span>
                        </div>
                        <div className={styles.stepInputWrap}>
                          <input type="number" value={Math.round(params.dip2Weight * 100)} onChange={e => updateParam('dip2Weight', parseFloat(e.target.value)/100)} className={styles.input} />
                          <span>%</span>
                        </div>
                      </div>
                    </div>
                    <div className={styles.inputGroup}>
                      <label>RSI 보너스 비중 (%)</label>
                      <input type="number" value={Math.round(params.bonusWeight * 100)} onChange={e => updateParam('bonusWeight', parseFloat(e.target.value)/100)} className={styles.input} />
                    </div>
                  </div>
                )}
              </div>

              {/* Snowball Trend & TP Settings */}
              <div className={styles.accordion}>
                <button className={styles.accordionHeader} onClick={() => toggleSection('snowballTrend')}>
                  <div className={styles.accordionTitle}><TrendingUp size={14}/> 추세 및 익절</div>
                  {openSections.snowballTrend ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
                </button>
                {openSections.snowballTrend && (
                  <div className={styles.accordionBody}>
                    <div className={styles.inputGroup}>
                      <label>골든크로스 (단기/장기)</label>
                      <div className={styles.grid2}>
                        <input type="number" value={params.gcShort} onChange={e => updateParam('gcShort', parseInt(e.target.value) || 0)} className={styles.input} />
                        <input type="number" value={params.gcLong} onChange={e => updateParam('gcLong', parseInt(e.target.value) || 0)} className={styles.input} />
                      </div>
                    </div>
                    <div className={styles.inputGroup}>
                      <label>1차 익절 (수익률 / 비중)</label>
                      <div className={styles.grid2}>
                        <div className={styles.stepInputWrap}>
                          <input type="number" value={Math.round(params.tp1Threshold * 100)} onChange={e => updateParam('tp1Threshold', parseFloat(e.target.value)/100)} className={styles.input} />
                          <span>%</span>
                        </div>
                        <div className={styles.stepInputWrap}>
                          <input type="number" value={Math.round(params.tp1SellFractionOfBase * 100)} onChange={e => updateParam('tp1SellFractionOfBase', parseFloat(e.target.value)/100)} className={styles.input} />
                          <span>%</span>
                        </div>
                      </div>
                    </div>
                    <div className={styles.inputGroup}>
                      <label>2차 익절 (수익률 / 비중)</label>
                      <div className={styles.grid2}>
                        <div className={styles.stepInputWrap}>
                          <input type="number" value={Math.round(params.tp2Threshold * 100)} onChange={e => updateParam('tp2Threshold', parseFloat(e.target.value)/100)} className={styles.input} />
                          <span>%</span>
                        </div>
                        <div className={styles.stepInputWrap}>
                          <input type="number" value={Math.round(params.tp2SellFractionOfBase * 100)} onChange={e => updateParam('tp2SellFractionOfBase', parseFloat(e.target.value)/100)} className={styles.input} />
                          <span>%</span>
                        </div>
                      </div>
                    </div>
                    <div className={styles.inputGroup}>
                      <label>3차 익절 (수익률 %)</label>
                      <input type="number" value={Math.round(params.tp3Threshold * 100)} onChange={e => updateParam('tp3Threshold', parseFloat(e.target.value)/100)} className={styles.input} />
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Trend Strategy Settings */}
              <div className={styles.accordion}>
                <button className={styles.accordionHeader} onClick={() => toggleSection('strategy')}>
                  <div className={styles.accordionTitle}><Activity size={14}/> 진입/청산 전략</div>
                  {openSections.strategy ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
                </button>
                {openSections.strategy && (
                  <div className={styles.accordionBody}>
                    <div className={styles.inputGroup}>
                      <label>연속 상승 일수 (진입 기준)</label>
                      <div className={styles.sliderRow}>
                        <input type="number" min={1} max={20} value={params.confirmDays || 1} onChange={e => updateParam('confirmDays', parseInt(e.target.value) || 1)} className={styles.input} style={{ width: '80px' }} />
                        <span>일차</span>
                      </div>
                    </div>

                    <div className={styles.toggleGroup}>
                      <label>스탑로스 사용</label>
                      <label className={styles.switch}>
                        <input type="checkbox" checked={params.stopLossEnabled} onChange={e => updateParam('stopLossEnabled', e.target.checked)} />
                        <span className={styles.switchSlider}></span>
                      </label>
                    </div>

                    {params.stopLossEnabled && (
                      <div className={styles.inputGroup}>
                        <label>스탑로스 임계값 (%)</label>
                        <div className={styles.sliderRow}>
                          <input type="number" value={params.stopLossThreshold} onChange={e => updateParam('stopLossThreshold', parseFloat(e.target.value) || 0)} className={styles.input} style={{ width: '80px' }} />
                          <span>%</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Take Profit Settings */}
              <div className={styles.accordion}>
                <button className={styles.accordionHeader} onClick={() => toggleSection('profit')}>
                  <div className={styles.accordionTitle}><Target size={14}/> 다단계 배수 익절</div>
                  {openSections.profit ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
                </button>
                {openSections.profit && (
                  <div className={styles.accordionBody}>
                    <div className={styles.toggleGroup}>
                      <label>익절 전략 사용</label>
                      <label className={styles.switch}>
                        <input type="checkbox" checked={params.profitTakeEnabled} onChange={e => updateParam('profitTakeEnabled', e.target.checked)} />
                        <span className={styles.switchSlider}></span>
                      </label>
                    </div>

                    {params.profitTakeEnabled && (
                      <>
                        <div className={styles.stepsContainer}>
                          <label className={styles.stepLabel}>단계별 익절 설정</label>
                          {(params.profitTakeSteps || []).map((step, idx) => (
                            <div key={idx} className={styles.stepCard}>
                              <div className={styles.stepHeader}>
                                <span className={styles.stepBadge}>Step {idx + 1}</span>
                                <button className={styles.removeStepBtn} onClick={() => removeStep(idx)}><X size={14}/></button>
                              </div>
                              <div className={styles.stepGrid}>
                                <div>
                                  <span className={styles.stepSubLabel}>목표 수익률</span>
                                  <div className={styles.stepInputWrap}>
                                    <input type="number" value={Math.round(step.threshold * 100)} onChange={e => updateStep(idx, 'threshold', parseFloat(e.target.value)/100)} className={styles.input} />
                                    <span>%</span>
                                  </div>
                                </div>
                                <div>
                                  <span className={styles.stepSubLabel}>매도 비율</span>
                                  <div className={styles.stepInputWrap}>
                                    <input type="number" value={Math.round(step.sellFraction * 100)} onChange={e => updateStep(idx, 'sellFraction', parseFloat(e.target.value)/100)} className={styles.input} />
                                    <span>%</span>
                                  </div>
                                </div>
                                <div style={{ gridColumn: 'span 2', marginTop: '4px' }}>
                                  <span className={styles.stepSubLabel}>SPYM 재투자 비율 ({step.spymRatio ?? 100}% SPYM / {100 - (step.spymRatio ?? 100)}% SGOV)</span>
                                  <input type="range" min={0} max={100} step={10} value={step.spymRatio ?? 100} onChange={e => updateStep(idx, 'spymRatio', parseInt(e.target.value))} className={styles.rangeInput} style={{ width: '100%', marginTop: '6px' }} />
                                </div>
                              </div>
                            </div>
                          ))}
                          <button className={styles.addStepBtn} onClick={addStep}><Plus size={14}/> 단계 추가</button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className={styles.sidebarFooter}>
          <button className={`${styles.runBtn} ${loading ? styles.runBtnLoading : ''}`} onClick={handleRun} disabled={loading}>
            {loading ? <div className={styles.loader}></div> : <Play size={16} fill="currentColor" />}
            {loading ? '백테스트 실행 중...' : '백테스트 실행'}
          </button>
        </div>
      </aside>

      {/* ── Main Panel ── */}
      <main className={styles.main}>
        {/* Top Header & Tabs */}
        <header className={styles.topHeader}>
          <div className={styles.tabs}>
            <button className={`${styles.tab} ${activeTab === 'single' ? styles.tabActive : ''}`} onClick={() => setActiveTab('single')}>
              <BarChart2 size={16}/> 단일 분석
            </button>
            <button className={`${styles.tab} ${activeTab === 'compare' ? styles.tabActive : ''}`} onClick={() => setActiveTab('compare')}>
              <Activity size={16}/> ETF 비교
            </button>
            <Link href="/signals" className={styles.tab}>
              <TrendingUp size={16}/> Signals
            </Link>
          </div>
        </header>

        {activeTab === 'compare' ? (
          <div className={styles.content}>
            <div className={styles.comparisonHeader}>
              <div className={styles.comparePickers}>
                <div className={styles.compareBox}>
                  <label>전략 A</label>
                  <select value={compareSelection.a} onChange={e => setCompareSelection(prev => ({ ...prev, a: e.target.value }))} className={styles.select}>
                    {Object.entries(PRESETS).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
                <div className={styles.compareVs}>VS</div>
                <div className={styles.compareBox}>
                  <label>전략 B</label>
                  <select value={compareSelection.b} onChange={e => setCompareSelection(prev => ({ ...prev, b: e.target.value }))} className={styles.select}>
                    {Object.entries(PRESETS).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
                <button className={styles.compareBtn} onClick={handleCompare} disabled={loading}>
                  {loading ? '분석 중...' : '비교 실행'}
                </button>
              </div>
            </div>

            {compareResult && (
              <div className={styles.compareBody}>
                <div className={styles.compareMetricsGrid}>
                  <div className={styles.compareMetricCard}>
                    <h4>{compareResult.labelA}</h4>
                    <div className={styles.compVal}>최종: {fmtUSD(compareResult.metricsA.finalValue)}</div>
                    <div className={styles.compCagr}>CAGR: {fmtPct(compareResult.metricsA.cagr)}</div>
                    <div className={styles.compMdd}>MDD: {fmtPct(compareResult.metricsA.mdd)}</div>
                  </div>
                  <div className={styles.compareMetricCard}>
                    <h4>{compareResult.labelB}</h4>
                    <div className={styles.compVal}>최종: {fmtUSD(compareResult.metricsB.finalValue)}</div>
                    <div className={styles.compCagr}>CAGR: {fmtPct(compareResult.metricsB.cagr)}</div>
                    <div className={styles.compMdd}>MDD: {fmtPct(compareResult.metricsB.mdd)}</div>
                  </div>
                </div>

                <div className={styles.chartPanel} style={{ marginTop: '20px' }}>
                  <div className={styles.panelHeader}>
                    <h3 className={styles.panelTitle}>상대 수익률 곡선</h3>
                  </div>
                  <div className={styles.panelBody}>
                    <ResponsiveContainer width="100%" height={400}>
                      <LineChart data={compareResult.curve}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="date" tickFormatter={d => d?.slice(0,4)} tick={{ fill: '#64748b', fontSize: 12 }} />
                        <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fill: '#64748b', fontSize: 12 }} />
                        <Tooltip formatter={v => fmtUSD(v)} />
                        <Legend />
                        <Line type="monotone" dataKey="valA" name={compareResult.labelA} stroke="#3b82f6" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="valB" name={compareResult.labelB} stroke="#ef4444" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className={styles.content}>
            {error && (
              <div className={styles.alertBox}>
                <ShieldAlert size={20}/> {error}
              </div>
            )}

            {!result && !loading && !error && (
              <div className={styles.emptyState}>
                <BarChart size={48} color="#cbd5e1" />
                <h2>백테스트를 시작해보세요</h2>
                <p>좌측 패널에서 전략과 파라미터를 설정한 후 <strong>실행</strong> 버튼을 클릭하세요.</p>
              </div>
            )}

            {loading && (
              <div className={styles.emptyState}>
                <div className={styles.largeSpinner}></div>
                <p>데이터를 불러오고 계산 중입니다...</p>
              </div>
            )}

            {result && (
              <>
                {/* Market Status Banner */}
                <div className={`${styles.statusBanner} ${marketStatus === '투자중' ? styles.statusActive : styles.statusWait}`}>
                  <div className={styles.statusIndicator}>
                    {marketStatus === '투자중' ? <span className={styles.pulseGreen}></span> : <span className={styles.pulseOrange}></span>}
                  </div>
                  <span className={styles.statusText}>
                    현재 시장은 <strong>{marketStatus}</strong> 상태입니다!
                  </span>
                  <span className={styles.statusSub}>※ {fmtDate(result.metrics.endDate)} 기준 분석 결과</span>
                </div>

                {/* Metrics Grid */}
                <div className={styles.metricsGrid}>
                  <div className={styles.metricCard}>
                    <div className={styles.metricIcon} style={{ background: '#ecfdf5', color: '#10b981' }}><DollarSign size={20}/></div>
                    <div className={styles.metricInfo}>
                      <div className={styles.metricLabel}>최종 자산</div>
                      <div className={styles.metricValue}>{fmtUSD(result.metrics.finalValue)}</div>
                      <div className={styles.metricBench}>B&H: {fmtUSD(result.benchmarkMetrics.finalValue)}</div>
                    </div>
                  </div>
                  <div className={styles.metricCard}>
                    <div className={styles.metricIcon} style={{ background: '#eff6ff', color: '#3b82f6' }}><TrendingUp size={20}/></div>
                    <div className={styles.metricInfo}>
                      <div className={styles.metricLabel}>총 수익률</div>
                      <div className={styles.metricValue}>{fmtPct(result.metrics.totalReturn)}</div>
                      <div className={styles.metricBench}>B&H: {fmtPct(result.benchmarkMetrics.totalReturn)}</div>
                    </div>
                  </div>
                  <div className={styles.metricCard}>
                    <div className={styles.metricIcon} style={{ background: '#f5f3ff', color: '#8b5cf6' }}><Percent size={20}/></div>
                    <div className={styles.metricInfo}>
                      <div className={styles.metricLabel}>CAGR (연평균 수익률)</div>
                      <div className={styles.metricValue}>{fmtPct(result.metrics.cagr)}</div>
                      <div className={styles.metricBench}>B&H: {fmtPct(result.benchmarkMetrics.cagr)}</div>
                    </div>
                  </div>
                  <div className={styles.metricCard}>
                    <div className={styles.metricIcon} style={{ background: '#fef2f2', color: '#ef4444' }}><Activity size={20}/></div>
                    <div className={styles.metricInfo}>
                      <div className={styles.metricLabel}>MDD (최대 낙폭)</div>
                      <div className={styles.metricValue}>{fmtPct(result.metrics.mdd)}</div>
                      <div className={styles.metricBench}>B&H: {fmtPct(result.benchmarkMetrics.mdd)}</div>
                    </div>
                  </div>

                  {activeStrategy === 'isa_qld' && (
                    <div className={styles.metricCard}>
                      <div className={styles.metricIcon} style={{ background: '#fff7ed', color: '#f97316' }}><Layers size={20}/></div>
                      <div className={styles.metricInfo}>
                        <div className={styles.metricLabel}>납입 가능 잔액 (올해)</div>
                        <div className={styles.metricValue}>
                          {fmtUSD(Math.max(0, (params.annualContributionLimit || 20000) - (result.metrics.currentYearContribution || 0)))}
                        </div>
                        <div className={styles.metricBench}>한도: {fmtUSD(params.annualContributionLimit || 20000)}</div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Main Charts */}
                <div className={styles.chartsGrid}>
                  <div className={styles.chartPanel}>
                    <div className={styles.panelHeader}>
                      <h3 className={styles.panelTitle}>자산 성장 곡선</h3>
                      <div className={styles.panelAction}>비교: 전략 vs 단순 장기보유</div>
                    </div>
                    <div className={styles.panelBody}>
                      <ResponsiveContainer width="100%" height={320}>
                        <AreaChart data={result.equityCurve} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="colorStrategy" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2}/>
                              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                          <XAxis dataKey="date" tickFormatter={d => d?.slice(0,4)} tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} minTickGap={30} />
                          <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} width={60} />
                          <Tooltip
                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                            labelStyle={{ fontWeight: 'bold', color: '#0f172a', marginBottom: '8px' }}
                            formatter={(v, name) => [fmtUSD(v), name === 'value' ? 'ARA 전략' : 'B&H (보유)']}
                          />
                          <Legend iconType="circle" wrapperStyle={{ fontSize: '13px', paddingTop: '10px' }}/>
                          <Area type="monotone" dataKey="benchmark" name="B&H (보유)" stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 5" fill="none" dot={false} />
                          <Area type="monotone" dataKey="value" name="ARA 전략" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorStrategy)" dot={false} activeDot={{ r: 6, fill: '#3b82f6', stroke: '#fff', strokeWidth: 2 }} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                </div>

                {/* Current Status Cards */}
                {(() => {
                  const statusHolding = result.events?.find(e => e.type === 'status-holding');
                  const statusSgov    = result.events?.find(e => e.type === 'status-sgov');
                  const statusSpym    = result.events?.find(e => e.type === 'status-spym');
                  if (!statusHolding && !statusSgov && !statusSpym) return null;
                  return (
                    <div className={styles.statusCards}>
                      {statusHolding && (
                        <div className={styles.statusCard} style={{ borderColor: '#10b981' }}>
                          <div className={styles.statusCardLabel}>📈 현재 보유 중</div>
                          <div className={styles.statusCardRow}>
                            <span>평가금액</span>
                            <strong>{fmtUSD(statusHolding.amount)}</strong>
                          </div>
                          <div className={styles.statusCardRow}>
                            <span>진입가 대비 수익률</span>
                            <strong className={statusHolding.gain >= 0 ? styles.textGreen : styles.textRed}>
                              {statusHolding.gain >= 0 ? '+' : ''}{(statusHolding.gain * 100).toFixed(2)}%
                            </strong>
                          </div>
                          <div className={styles.statusCardRow}>
                            <span>보유 수량</span>
                            <strong>{statusHolding.shares?.toFixed(4)}주</strong>
                          </div>
                        </div>
                      )}
                      {statusSgov && (
                        <div className={styles.statusCard} style={{ borderColor: '#3b82f6' }}>
                          <div className={styles.statusCardLabel}>💵 {statusSgov.asset || 'SGOV'} 주차 중</div>
                          <div className={styles.statusCardRow}>
                            <span>평가금액</span>
                            <strong>{fmtUSD(statusSgov.amount)}</strong>
                          </div>
                          <div className={styles.statusCardRow}>
                            <span>누적 이자 수익</span>
                            <strong className={styles.textGreen}>+{fmtUSD(statusSgov.interest)}</strong>
                          </div>
                          <div className={styles.statusCardRow}>
                            <span>원금 대비</span>
                            <strong className={styles.textGreen}>
                              +{statusSgov.costBasis > 0 ? ((statusSgov.interest / statusSgov.costBasis) * 100).toFixed(2) : '0.00'}%
                            </strong>
                          </div>
                        </div>
                      )}
                      {statusSpym && (
                        <div className={styles.statusCard} style={{ borderColor: '#8b5cf6' }}>
                          <div className={styles.statusCardLabel}>📊 SPYM 보유 중</div>
                          <div className={styles.statusCardRow}>
                            <span>평가금액</span>
                            <strong>{fmtUSD(statusSpym.amount)}</strong>
                          </div>
                          <div className={styles.statusCardRow}>
                            <span>평가손익</span>
                            <strong className={statusSpym.interest >= 0 ? styles.textGreen : styles.textRed}>
                              {statusSpym.interest >= 0 ? '+' : ''}{fmtUSD(statusSpym.interest)}
                            </strong>
                          </div>
                          <div className={styles.statusCardRow}>
                            <span>수익률</span>
                            <strong className={statusSpym.interest >= 0 ? styles.textGreen : styles.textRed}>
                              +{statusSpym.costBasis > 0 ? ((statusSpym.interest / statusSpym.costBasis) * 100).toFixed(2) : '0.00'}%
                            </strong>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Event Table */}
                <div className={styles.tablePanel}>
                  <div className={styles.panelHeader}>
                    <h3 className={styles.panelTitle}>상세 거래 내역</h3>
                    <div className={styles.badge}>{result.events?.filter(e => !e.type.startsWith('status')).length || 0}건</div>
                  </div>
                  <div className={styles.tableWrapper}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>날짜</th>
                          <th>거래 유형</th>
                          <th>체결가</th>
                          <th>상세 내역</th>
                          <th>참고</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.events?.filter(e => !e.type.startsWith('status')).slice().reverse().map((ev, i) => (
                          <tr key={i}>
                            <td className={styles.tdDate}>{ev.date}</td>
                            <td>
                              <span className={`${styles.tag} ${
                                ev.type === 'entry' || ev.type === 'entry-half1' || ev.type === 'entry-half2' ? styles.tag_entry
                                : ev.type.startsWith('tp') ? styles.tag_tp
                                : ev.type === 'exit' || ev.type === 'stoploss' ? styles.tag_exit
                                : styles.tag_default
                              }`}>
                                {ev.type === 'entry'        ? '진입 (매수)'
                                : ev.type === 'entry-half1' ? '1차 진입 (50%)'
                                : ev.type === 'entry-half2' ? '2차 진입 (50%)'
                                : ev.type.startsWith('tp')  ? `익절 ${ev.type.replace('tp', 'TP')}`
                                : ev.type === 'exit'        ? 'MA 이탈 (청산)'
                                : ev.type === 'stoploss'    ? '스탑로스 (청산)'
                                : ev.type === 'parking-init' ? `${ev.parkingAsset || 'SGOV'} 초기 매수`
                                : ev.type === 'contribution' ? `${ev.parkingAsset || 'SGOV'} 적립`
                                : ev.type}
                              </span>
                            </td>
                            <td className={styles.tdPrice}>${ev.price?.toFixed(2)}</td>
                            <td className={styles.tdDetail}>
                              {ev.amount  != null && !ev.type.startsWith('tp') ? <span>{fmtUSD(ev.amount)} 매수 </span> : ''}
                              {ev.proceeds != null ? <span>{fmtUSD(ev.proceeds)} 매도 </span> : ''}
                              {ev.parkingAmount != null && ev.parkingAmount > 0 ? <span>{fmtUSD(ev.parkingAmount)} {ev.parkingAsset || 'SGOV'} 주차 </span> : ''}
                              {ev.profitAmount != null && ev.profitAmount > 0 ? <span>{fmtUSD(ev.profitAmount)} {ev.profitAsset || 'SPYM'} 이동 </span> : ''}
                              {ev.gain    != null ? (
                                <span className={ev.gain >= 0 ? styles.textGreen : styles.textRed}>
                                  {ev.gain >= 0 ? '+' : ''}{(ev.gain * 100).toFixed(2)}%
                                </span>
                              ) : ''}
                            </td>
                            <td className={styles.tdExtra}>
                              {ev.refPrice != null ? `기준가 $${ev.refPrice.toFixed(2)}` : ''}
                              {ev.fundingAsset ? `${ev.refPrice != null ? ' / ' : ''}${ev.fundingAsset} 매도 후 진입` : ''}
                              {!ev.fundingAsset && ev.parkingAsset && (ev.type === 'parking-init' || ev.type === 'contribution') ? `${ev.parkingAsset} 보유 시작` : ''}
                              {ev.drawdown != null ? `MDD ${(ev.drawdown * 100).toFixed(1)}%` : ''}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
