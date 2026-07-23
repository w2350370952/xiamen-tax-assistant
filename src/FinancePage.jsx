import { lazy, Suspense, useMemo, useState } from "react";
import { Activity, AlertTriangle, ArrowRight, BarChart3, CandlestickChart, ChevronDown, Clock3, Gauge, Info, Landmark, LineChart, RefreshCw, ShieldAlert, Star, TrendingDown, TrendingUp } from "lucide-react";

const ranges = [
  { id: "1m", label: "1个月", days: 31 },
  { id: "3m", label: "3个月", days: 93 },
  { id: "6m", label: "半年", days: 186 },
  { id: "1y", label: "1年", days: 370 },
  { id: "3y", label: "3年", days: 1100 },
  { id: "5y", label: "5年", days: 1830 },
  { id: "10y", label: "10年", days: 3660 },
];

const NasdaqChart = lazy(() => import("./NasdaqChart"));

// 与后端 DEFAULT_FINANCE_SETTINGS 保持一致，仅在网络异常时兜底使用
const fallbackBands = [
  { max: 25, label: "低估", icon: "🟢", tone: "low", advice: "估值处于低位，保持定投的同时可关注分批布局机会。" },
  { max: 35, label: "合理", icon: "🟡", tone: "fair", advice: "估值处于合理区间，保持正常定投节奏。" },
  { max: 45, label: "偏高估", icon: "🟠", tone: "elevated", advice: "保持正常定投，不建议一次性大额买入。" },
  { max: null, label: "高估", icon: "🔴", tone: "high", advice: "估值处于高位，建议控制投入节奏，保留现金应对波动。" },
];
const fallbackZones = [
  { min: 29000, max: null, state: "估值偏高", advice: "正常定投，不建议大额买入", tone: "elevated" },
  { min: 27000, max: 29000, state: "正常调整", advice: "增加20%定投", tone: "fair" },
  { min: 25000, max: 27000, state: "机会区域", advice: "增加50%定投", tone: "low" },
  { min: 22000, max: 25000, state: "明显低估", advice: "分批增加仓位", tone: "low" },
  { min: null, max: 22000, state: "历史极端机会", advice: "考虑大额买入", tone: "deep" },
];

const drawdowns = [
  { name: "2000 互联网泡沫", period: "2000.03 – 2002.10", drop: "约 -83%", recovery: "约13年后（2015年）重回前高" },
  { name: "2008 金融危机", period: "2007.10 – 2008.11", drop: "约 -53%", recovery: "约3年半（2011年）重回前高" },
  { name: "2020 疫情冲击", period: "2020.02 – 2020.03", drop: "约 -28%", recovery: "约3个月（2020年6月）重回前高" },
  { name: "2022 加息周期", period: "2021.11 – 2022.10", drop: "约 -35%", recovery: "约2年（2024年初）重回前高" },
];

const number = (value, digits = 2) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits }) : "—";
};

const percent = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${parsed > 0 ? "+" : ""}${parsed.toFixed(2)}%` : "—";
};

const toneOf = (bands, pe) => bandOf(bands, pe)?.tone || "neutral";

function bandOf(bands, pe) {
  const value = Number(pe);
  if (!Number.isFinite(value)) return null;
  return bands.find((band) => band.max === null || value <= band.max) || bands.at(-1) || null;
}

function zoneOf(zones, price) {
  const value = Number(price);
  if (!Number.isFinite(value)) return null;
  return zones.find((zone) => (zone.min === null || value >= zone.min) && (zone.max === null || value < zone.max)) || null;
}

const zoneRangeText = (zone) => {
  if (zone.min === null && zone.max === null) return "全部区间";
  if (zone.min === null) return `${number(zone.max, 0)}点以下`;
  if (zone.max === null) return `${number(zone.min, 0)}点以上`;
  return `${number(zone.min, 0)} – ${number(zone.max, 0)}点`;
};

function rangeSlice(history, rangeId) {
  const choice = ranges.find((item) => item.id === rangeId) || ranges[1];
  const from = Date.now() - choice.days * 86400000;
  return (Array.isArray(history) ? history : []).filter((item) => new Date(`${item.date}T12:00:00Z`).getTime() >= from);
}

function statsOf(history) {
  if (!history?.length) return null;
  const closes = history.map((item) => Number(item.close ?? item.price)).filter(Number.isFinite);
  if (!closes.length) return null;
  return {
    current: closes.at(-1),
    high: Math.max(...closes),
    low: Math.min(...closes),
    change: closes.length > 1 ? (closes.at(-1) / closes[0] - 1) * 100 : null,
  };
}

const peKindMeta = {
  real: { label: "实时数据", tone: "low" },
  manual: { label: "管理员录入", tone: "fair" },
  estimated: { label: "模型估算", tone: "elevated" },
};

export function valuationState(pe, bands = fallbackBands) {
  const band = bandOf(bands, pe);
  if (!band) return { label: "估值数据待更新", tone: "neutral", icon: "⚪" };
  return { label: band.label, tone: band.tone, icon: band.icon };
}

export function FinanceShortcut({ data, loading, onOpen }) {
  const bands = data?.settings?.valuation_bands || fallbackBands;
  const valuation = valuationState(data?.pe, bands);
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
  const [chartMode, setChartMode] = useState("single");
  const [chartType, setChartType] = useState("line");
  const bands = data?.settings?.valuation_bands || fallbackBands;
  const zones = data?.settings?.strategy_zones || fallbackZones;
  const band = bandOf(bands, data?.pe);
  const zone = zoneOf(zones, data?.price);
  const change = Number(data?.change);
  const history = Array.isArray(data?.history) ? data.history : [];
  const shHistory = Array.isArray(data?.shanghai?.history) ? data.shanghai.history : [];
  const ndxSlice = useMemo(() => rangeSlice(history, range), [history, range]);
  const shSlice = useMemo(() => rangeSlice(shHistory, range), [shHistory, range]);
  const ndxStats = useMemo(() => statsOf(ndxSlice), [ndxSlice]);
  const shStats = useMemo(() => statsOf(shSlice), [shSlice]);
  const riskStars = band ? Math.min(5, bands.indexOf(band) + 2) : 0;
  const peKind = peKindMeta[data?.pe_kind] || null;

  return <section className="page finance-page">
    <header className="finance-header">
      <div><em>FINANCE ASSISTANT</em><h1>📈 纳斯达克100投资分析</h1><p>实时行情 · 历史走势 · 估值分析 · 投资参考</p></div>
      <button className="finance-refresh" disabled={loading} onClick={onReload}><RefreshCw className={loading ? "spin" : ""}/>{loading ? "更新中" : "刷新数据"}</button>
    </header>

    {error && !data && <div className="finance-error"><AlertTriangle/><span><strong>行情暂时不可用</strong><small>{error}</small></span></div>}
    {data?.stale && <div className="finance-stale"><Clock3/>外部行情源暂时不可用，当前显示最近一次有效数据{data?.update_time ? `（${formatTime(data.update_time, true)}）` : ""}。</div>}

    <section className="finance-dashboard">
      <article className="dash-primary">
        <small>NASDAQ-100 INDEX · NDX</small>
        <div className="dash-price"><strong>{number(data?.price)}</strong><span className={change > 0 ? "up" : change < 0 ? "down" : ""}>{change >= 0 ? <TrendingUp/> : <TrendingDown/>}{percent(data?.change)}</span></div>
        <p>数据更新：{data?.update_time ? formatTime(data.update_time, true) : "等待更新"}{data?.source ? ` · 来源 ${data.source}` : ""}</p>
      </article>
      <div className="dash-perf">
        {[["近1个月", data?.performance?.month_1], ["近3个月", data?.performance?.month_3], ["近1年", data?.performance?.year_1]].map(([label, value]) =>
          <article key={label}><small>{label}</small><strong className={Number(value) > 0 ? "up" : Number(value) < 0 ? "down" : ""}>{percent(value)}</strong></article>)}
      </div>
      <article className="dash-advice">
        <div className="dash-advice-row"><small>市场状态</small><span className={`valuation-chip ${band?.tone || "neutral"}`}>{band ? `${band.icon} ${band.label}` : "⚪ 待更新"}</span></div>
        <div className="dash-advice-row"><small>风险等级</small><span className="dash-stars">{riskStars ? Array.from({ length: 5 }, (_, index) => <Star key={index} className={index < riskStars ? "filled" : ""}/>) : "—"}</span></div>
        <div className="dash-advice-tip"><small>投资建议</small><p>{band ? band.advice : "等待估值数据后生成参考建议。"}</p></div>
      </article>
    </section>

    <section className="finance-card finance-chart-card">
      <div className="finance-card-head chart-head">
        <div><small>PRICE HISTORY</small><h2>{chartMode === "compare" ? "纳指 VS 上证指数" : "指数历史走势"}</h2></div>
        <div className="chart-controls">
          <div className="finance-range mode-tabs">
            <button className={chartMode === "single" ? "active" : ""} onClick={() => setChartMode("single")}>指数走势</button>
            <button className={chartMode === "compare" ? "active" : ""} onClick={() => setChartMode("compare")}>对比上证</button>
          </div>
          {chartMode === "single" && <div className="finance-range type-tabs">
            <button className={chartType === "line" ? "active" : ""} onClick={() => setChartType("line")}><LineChart/>折线</button>
            <button className={chartType === "candle" ? "active" : ""} onClick={() => setChartType("candle")}><CandlestickChart/>K线</button>
          </div>}
          <div className="finance-range">{ranges.map((item) => <button key={item.id} className={range === item.id ? "active" : ""} onClick={() => setRange(item.id)}>{item.label}</button>)}</div>
        </div>
      </div>

      {chartMode === "single" && ndxStats && <div className="market-stats">
        <article><small>当前点位</small><strong>{number(ndxStats.current)}</strong></article>
        <article><small>阶段最高</small><strong className="up">{number(ndxStats.high)}</strong></article>
        <article><small>阶段最低</small><strong className="down">{number(ndxStats.low)}</strong></article>
        <article><small>累计涨跌</small><strong className={Number(ndxStats.change) > 0 ? "up" : Number(ndxStats.change) < 0 ? "down" : ""}>{percent(ndxStats.change)}</strong></article>
      </div>}

      {chartMode === "compare" && (ndxStats || shStats) && <div className="market-stats compare-stats">
        <article><small>纳指区间高/低</small><strong>{ndxStats ? `${number(ndxStats.high)} / ${number(ndxStats.low)}` : "—"}</strong><em className={Number(ndxStats?.change) > 0 ? "up" : Number(ndxStats?.change) < 0 ? "down" : ""}>累计 {percent(ndxStats?.change)}</em></article>
        <article><small>上证区间高/低</small><strong>{shStats ? `${number(shStats.high)} / ${number(shStats.low)}` : "暂无数据"}</strong><em className={Number(shStats?.change) > 0 ? "up" : Number(shStats?.change) < 0 ? "down" : ""}>累计 {percent(shStats?.change)}</em></article>
      </div>}

      {chartMode === "compare" && !shHistory.length && <div className="finance-chart-empty"><BarChart3/><p>上证指数数据暂不可用，仅展示纳斯达克100走势。</p></div>}
      {ndxSlice.length > 1
        ? <Suspense fallback={<div className="finance-chart-empty"><BarChart3/><p>正在加载走势图…</p></div>}>
            <NasdaqChart mode={chartMode} chartType={chartType} ndx={ndxSlice} sh={chartMode === "compare" ? shSlice : []}/>
          </Suspense>
        : <div className="finance-chart-empty"><BarChart3/><p>暂无数据：历史行情正在积累，获得至少两个交易日数据后显示走势图。</p></div>}
    </section>

    <Collapsible eyebrow="VALUATION" title="估值分析" icon={<Gauge/>}>
      <section className="finance-card valuation-card flat">
        <div className="finance-card-head">
          <div><small>VALUATION</small><h2>纳斯达克100估值</h2></div>
          <div className="valuation-head-tags">
            {peKind && <span className={`pe-kind-tag ${peKind.tone}`}>{peKind.label}</span>}
            <span className={`valuation-chip ${band?.tone || "neutral"}`}>{band ? `${band.icon} ${band.label}` : "⚪ 待更新"}</span>
          </div>
        </div>
        <div className="valuation-numbers">
          <article><small>当前PE</small><strong>{typeof data?.pe === "number" ? <>{number(data.pe, 1)}<em>倍</em></> : "暂无数据"}</strong></article>
          <article><small>历史平均PE</small><strong>{number(data?.pe_average, 1)}<em>倍</em></strong></article>
          <article><small>历史估值分位</small><strong>{typeof data?.pe_percentile === "number" ? `${number(data.pe_percentile, 0)}%` : "样本积累中"}</strong></article>
        </div>
        <ValuationScale pe={data?.pe} bands={bands}/>
        <p className="valuation-source">当前PE口径：{data?.pe_source || "等待估值数据"}；平均PE参考：{data?.pe_average_source || "样本积累中"}。{data?.pe_kind === "estimated" ? "当前为模型估算结果，并非实时实测估值，请知悉。" : "PE 代理值与指数官方口径可能存在差异。"}</p>
      </section>
    </Collapsible>

    <Collapsible eyebrow="STRATEGY" title="纳斯达克100投资参考" icon={<Activity/>}>
      <section className="finance-card strategy-zones-card flat">
        <div className="finance-card-head"><div><small>STRATEGY ZONES</small><h2>按指数点位的投资参考</h2></div>{zone && <span className={`valuation-chip ${zone.tone}`}>当前 {number(data?.price, 0)} 点 · {zone.state}</span>}</div>
        <div className="zone-list">
          {zones.map((item, index) => {
            const current = zone === item;
            return <article key={index} className={`zone-row tone-${item.tone} ${current ? "current" : ""}`}>
              <div className="zone-range"><strong>{zoneRangeText(item)}</strong>{current && <em>当前位置</em>}</div>
              <div className="zone-state"><small>状态</small><strong>{item.state}</strong></div>
              <div className="zone-advice"><small>建议</small><p>{item.advice}</p></div>
            </article>;
          })}
        </div>
        <p className="valuation-source">策略区间由管理员在后台维护，仅供参考，不构成投资建议。</p>
      </section>
    </Collapsible>

    <Collapsible eyebrow="DRAWDOWNS" title="纳斯达克100历史机会" icon={<Landmark/>} collapsedOnMobile>
      <section className="finance-card drawdown-card flat">
        <div className="finance-card-head"><div><small>HISTORICAL DRAWDOWNS</small><h2>历史上的大幅回撤</h2></div></div>
        <div className="drawdown-grid">
          {drawdowns.map((item) => <article key={item.name}>
            <strong>{item.name}</strong>
            <small>{item.period}</small>
            <div><span><small>最大跌幅</small><b className="down">{item.drop}</b></span><span><small>修复过程</small><b>{item.recovery}</b></span></div>
          </article>)}
        </div>
        <p className="valuation-source">以上为约数，按指数历史公开行情整理，帮助理解市场回撤属于正常现象。</p>
      </section>
    </Collapsible>

    <Collapsible eyebrow="ABOUT NDX" title="关于纳斯达克100" icon={<Info/>} collapsedOnMobile>
      <section className="finance-card intro-card flat">
        <div className="intro-grid">
          <article><small>成立时间</small><strong>1985年1月31日</strong></article>
          <article><small>成分股数量</small><strong>约100家</strong></article>
          <article><small>主要行业</small><strong>科技 · 消费 · 医疗</strong></article>
          <article><small>代表企业</small><strong>Apple · Microsoft · NVIDIA · Amazon · Alphabet</strong></article>
        </div>
        <p className="valuation-source">纳斯达克100指数由纳斯达克交易所上市的约100家最大非金融公司组成，是全球科技股的重要风向标。</p>
      </section>
    </Collapsible>

    <div className="finance-risk"><ShieldAlert/><p><strong>风险提示</strong><span>本页面只提供行情展示和估值参考，不构成投资建议、收益承诺或价格预测。指数历史表现不代表未来结果。</span></p></div>
  </section>;
}

function Collapsible({ eyebrow, title, icon, children, collapsedOnMobile = false }) {
  const [open, setOpen] = useState(() => (typeof window === "undefined" || window.innerWidth > 820) ? true : !collapsedOnMobile);
  return <div className={`collapsible ${open ? "open" : ""}`}>
    <button type="button" className="collapsible-head" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <span>{icon}</span><div><small>{eyebrow}</small><h2>{title}</h2></div><ChevronDown/>
    </button>
    <div className="collapsible-body">{children}</div>
  </div>;
}

function ValuationScale({ pe, bands }) {
  const value = Number(pe);
  const finiteBands = bands.filter((band) => band.max !== null);
  const scaleMin = Math.min(15, ...finiteBands.map((band) => (band.max ?? 60) - 20));
  const scaleMax = Math.max(55, ...finiteBands.map((band) => (band.max ?? 45) + 10));
  const position = Number.isFinite(value) ? Math.max(0, Math.min(100, (value - scaleMin) / (scaleMax - scaleMin) * 100)) : null;
  return <div className="valuation-scale dynamic">
    <div className="valuation-scale-labels">{bands.map((band, index) => <span key={index}>{band.label}</span>)}</div>
    <div className="valuation-scale-track segmented">
      {bands.map((band, index) => <i key={index} className={`segment tone-${band.tone}`} style={{ left: `${index / bands.length * 100}%`, width: `${100 / bands.length}%` }}/>)}
      {position !== null && <b className="scale-marker" style={{ left: `${position}%` }}><em>当前</em></b>}
    </div>
    <div className="valuation-scale-values">{bands.map((band, index) => <span key={index}>{band.max === null ? `≥${bands[index - 1]?.max ?? ""}` : index === 0 ? `≤${band.max}` : `${bands[index - 1]?.max}–${band.max}`}</span>)}</div>
  </div>;
}

function formatTime(value, full = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: full ? "numeric" : undefined, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}
