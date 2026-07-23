import { lazy, Suspense, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, BarChart3, Clock3, RefreshCw, ShieldAlert, TrendingDown, TrendingUp } from "lucide-react";

const ranges = [
  { id: "1m", label: "1个月", days: 31 },
  { id: "3m", label: "3个月", days: 93 },
  { id: "6m", label: "半年", days: 186 },
  { id: "1y", label: "1年", days: 370 },
];
const NasdaqChart = lazy(() => import("./NasdaqChart"));

const number = (value, digits = 2) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits }) : "—";
};

const percent = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${parsed > 0 ? "+" : ""}${parsed.toFixed(2)}%` : "—";
};

export function valuationState(pe) {
  const value = Number(pe);
  if (!Number.isFinite(value)) return { label: "估值数据待更新", tone: "neutral", icon: "⚪" };
  if (value <= 25) return { label: "相对低估", tone: "low", icon: "🟢" };
  if (value < 35) return { label: "相对合理", tone: "fair", icon: "🟡" };
  if (value < 45) return { label: "偏高估", tone: "elevated", icon: "🟠" };
  return { label: "高估", tone: "high", icon: "🔴" };
}

export function FinanceShortcut({ data, loading, onOpen }) {
  const valuation = valuationState(data?.pe);
  const change = Number(data?.change);
  return <aside className="finance-shortcut">
    <div className="finance-shortcut-title"><span>📈</span><div><small>FINANCE</small><h2>财经</h2></div></div>
    <div className="finance-shortcut-index">
      <span>纳斯达克100</span>
      <strong>{loading && !data ? "加载中…" : number(data?.price)}</strong>
      <em className={change > 0 ? "up" : change < 0 ? "down" : ""}>{percent(data?.change)}</em>
    </div>
    <div className={`valuation-chip ${valuation.tone}`}>{valuation.icon} {valuation.label}</div>
    <small className="finance-shortcut-time">{data?.update_time ? `更新于 ${formatTime(data.update_time)}` : "等待首次行情更新"}</small>
    <button onClick={onOpen}>查看详情<ArrowRight /></button>
  </aside>;
}

export default function FinancePage({ data, loading, error, onReload }) {
  const [range, setRange] = useState("3m");
  const valuation = valuationState(data?.pe);
  const change = Number(data?.change);
  const history = Array.isArray(data?.history) ? data.history : [];
  const selectedHistory = useMemo(() => {
    const choice = ranges.find(item => item.id === range) || ranges[1];
    const from = Date.now() - choice.days * 86400000;
    return history.filter(item => new Date(`${item.date}T12:00:00Z`).getTime() >= from);
  }, [history, range]);

  return <section className="page finance-page">
    <header className="finance-header">
      <div><em>FINANCE ASSISTANT</em><h1>📈 纳斯达克100</h1><p>行情、历史走势与估值参考</p></div>
      <button className="finance-refresh" disabled={loading} onClick={onReload}><RefreshCw className={loading ? "spin" : ""}/>{loading ? "更新中" : "刷新数据"}</button>
    </header>

    {error && !data && <div className="finance-error"><AlertTriangle/><span><strong>行情暂时不可用</strong><small>{error}</small></span></div>}
    {data?.stale && <div className="finance-stale"><Clock3/>外部行情源暂时不可用，当前显示最近一次有效数据。</div>}

    <div className="finance-overview">
      <article className="finance-primary-card">
        <small>NASDAQ-100 INDEX · NDX</small>
        <div><strong>{number(data?.price)}</strong><span className={change > 0 ? "up" : change < 0 ? "down" : ""}>{change >= 0 ? <TrendingUp/> : <TrendingDown/>}{percent(data?.change)}</span></div>
        <p>数据更新时间：{data?.update_time ? formatTime(data.update_time, true) : "等待更新"}</p>
      </article>
      <div className="finance-period-cards">
        {[["近1个月",data?.performance?.month_1],["近3个月",data?.performance?.month_3],["近1年",data?.performance?.year_1]].map(([label,value])=><article key={label}><small>{label}</small><strong className={Number(value)>0?"up":Number(value)<0?"down":""}>{percent(value)}</strong></article>)}
      </div>
    </div>

    <section className="finance-card finance-chart-card">
      <div className="finance-card-head"><div><small>PRICE HISTORY</small><h2>指数历史走势</h2></div><div className="finance-range">{ranges.map(item=><button key={item.id} className={range===item.id?"active":""} onClick={()=>setRange(item.id)}>{item.label}</button>)}</div></div>
      {selectedHistory.length > 1 ? <Suspense fallback={<div className="finance-chart-empty"><BarChart3/><p>正在加载走势图…</p></div>}><NasdaqChart history={selectedHistory}/></Suspense> : <div className="finance-chart-empty"><BarChart3/><p>历史行情正在积累，获得至少两个交易日数据后显示走势图。</p></div>}
    </section>

    <div className="finance-analysis-grid">
      <section className="finance-card valuation-card">
        <div className="finance-card-head"><div><small>VALUATION</small><h2>纳斯达克100估值</h2></div><span className={`valuation-chip ${valuation.tone}`}>{valuation.icon} {valuation.label}</span></div>
        <div className="valuation-numbers">
          <article><small>当前PE</small><strong>{number(data?.pe,1)}<em>倍</em></strong></article>
          <article><small>历史平均PE</small><strong>{number(data?.pe_average,1)}<em>倍</em></strong></article>
          <article><small>历史估值分位</small><strong>{Number.isFinite(Number(data?.pe_percentile))?`${number(data.pe_percentile,0)}%`:"积累中"}</strong></article>
        </div>
        <ValuationScale pe={data?.pe}/>
        <p className="valuation-source">估值口径：{data?.pe_source || "等待估值数据"}。PE 代理值与指数官方口径可能存在差异。</p>
      </section>

      <section className="finance-card strategy-card">
        <div className="finance-card-head"><div><small>REFERENCE</small><h2>估值参考</h2></div></div>
        <div className="strategy-status"><span>{valuation.icon}</span><div><small>当前状态</small><strong>{valuation.label}</strong></div></div>
        <ul>
          <li><span>✅</span><p><strong>保持长期定投</strong><small>分散时点，避免只依据单一估值指标决策。</small></p></li>
          <li><span>⚠️</span><p><strong>避免一次性大额投入</strong><small>偏高估阶段更应重视波动和回撤风险。</small></p></li>
          <li><span>🟢</span><p><strong>回撤 10%</strong><small>可结合自身风险承受能力适当调整定投节奏。</small></p></li>
          <li><span>🟢</span><p><strong>回撤 20%</strong><small>可考虑分批增加投入，仍需保留应急资金。</small></p></li>
          <li><span>🔥</span><p><strong>回撤 30%</strong><small>采用分批布局，避免试图一次判断最低点。</small></p></li>
        </ul>
      </section>
    </div>

    <div className="finance-risk"><ShieldAlert/><p><strong>风险提示</strong><span>本页面只提供行情展示和估值参考，不构成投资建议、收益承诺或价格预测。指数历史表现不代表未来结果。</span></p></div>
  </section>;
}

function ValuationScale({ pe }) {
  const value = Number(pe);
  const position = Number.isFinite(value) ? Math.max(0, Math.min(100, (value - 15) / 40 * 100)) : 50;
  return <div className="valuation-scale">
    <div className="valuation-scale-labels"><span>低估</span><span>合理</span><span>偏高估</span><span>高估</span></div>
    <div className="valuation-scale-track"><i style={{ left: `${position}%` }}/></div>
    <div className="valuation-scale-values"><span>≤25</span><span>25–35</span><span>35–45</span><span>≥45</span></div>
  </div>;
}

function formatTime(value, full = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: full ? "numeric" : undefined, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}
