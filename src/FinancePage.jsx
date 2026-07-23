import { lazy, Suspense, useMemo, useState } from "react";
import { Activity, AlertTriangle, ArrowLeftRight, ArrowRight, BarChart3, CandlestickChart, ChevronDown, Clock3, Cpu, Gauge, Info, Landmark, LineChart, PiggyBank, RefreshCw, Scale, ShieldAlert, Star, Target, TrendingDown, TrendingUp, Users } from "lucide-react";

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
  { max: 20, label: "低估", icon: "🟢", tone: "low", advice: "估值处于低位，保持定投的同时可关注分批布局机会。" },
  { max: 30, label: "合理", icon: "🟡", tone: "fair", advice: "估值处于合理区间，保持正常定投节奏。" },
  { max: 40, label: "偏高估", icon: "🟠", tone: "elevated", advice: "估值偏高，保持正常定投，不建议一次性大额买入。" },
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

// 点位区间与 PE 估值的综合判断：指数下跌但 PE 仍高不按低估处理；双低则提高买入等级
function combinedAdvice(band, zone) {
  if (!band || !zone) return null;
  const peHigh = band.tone === "elevated" || band.tone === "high";
  const peLow = band.tone === "low";
  const zoneLow = zone.tone === "low" || zone.tone === "deep";
  if (peHigh && zoneLow) return { tone: "elevated", text: "指数回落但 PE 估值仍偏高：不按低估处理，维持正常定投，暂不加仓。" };
  if (peHigh && !zoneLow) return { tone: "high", text: "点位与估值双高：控制投入节奏，保留现金应对波动。" };
  if (peLow && zoneLow) return { tone: "deep", text: "点位与估值双低：历史级机会区域，可提高买入等级、分批加仓。" };
  if (peLow) return { tone: "low", text: "PE 估值处于低位：可提高定投比例，分批布局。" };
  return { tone: "fair", text: "估值合理：按点位区间策略执行，保持正常定投节奏。" };
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
      <div className="finance-refresh-wrap">
        <button className="finance-refresh" disabled={loading} onClick={onReload}><RefreshCw className={loading ? "spin" : ""}/>{loading ? "更新中" : "刷新数据"}</button>
        <small className="finance-last-update">最后更新：{data?.update_time ? formatTime(data.update_time, true) : "—"}</small>
      </div>
    </header>

    {error && !data && <div className="finance-error"><AlertTriangle/><span><strong>行情暂时不可用</strong><small>{error}</small></span></div>}
    {error && data && <div className="finance-stale"><AlertTriangle/><span>{error}</span></div>}
    {data?.stale && <div className="finance-stale"><Clock3/>外部行情源暂时不可用，当前显示最近一次有效数据{data?.update_time ? `（${formatTime(data.update_time, true)}）` : ""}。</div>}

    <WhyInvestModule comparison={data?.comparison}/>

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

      {chartMode === "compare" && <p className="chart-note">单轴对比：两指数共用同一真实点位坐标轴，可直观看出纳斯达克100与上证指数的量级差距。</p>}
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
          <article><small>当前PE（Trailing 滚动）</small><strong>{typeof data?.pe === "number" ? <>{number(data.pe, 1)}<em>倍</em></> : "暂无数据"}</strong></article>
          <article><small>Forward PE（预测）</small><strong className="na">—</strong><em className="na-note">暂无可靠免费数据源，不展示以免误导</em></article>
          <article><small>历史平均PE</small><strong>{typeof data?.pe_average === "number" ? <>{number(data.pe_average, 1)}<em>倍</em></> : "样本积累中"}</strong></article>
          <article><small>历史估值分位</small><strong>{typeof data?.pe_percentile === "number" ? `${number(data.pe_percentile, 0)}%` : "样本积累中"}</strong></article>
        </div>
        <ValuationScale pe={data?.pe} bands={bands}/>
        <p className="valuation-source">当前PE口径：{data?.pe_source || "等待估值数据"}；平均PE参考：{data?.pe_average_source || "样本积累中"}。{data?.pe_kind === "estimated" ? "当前为模型估算结果，并非实时实测估值，请知悉。" : "PE 代理值与指数官方口径可能存在差异。"}</p>
      </section>
    </Collapsible>

    <Collapsible eyebrow="STRATEGY" title="纳斯达克100投资参考" icon={<Activity/>}>
      <section className="finance-card strategy-zones-card flat">
        <div className="finance-card-head"><div><small>STRATEGY ZONES</small><h2>按指数点位的投资参考</h2></div>{zone && <span className={`valuation-chip ${zone.tone}`}>当前 {number(data?.price, 0)} 点 · {zone.state}</span>}</div>
        {combinedAdvice(band, zone) && <div className={`combined-advice tone-${combinedAdvice(band, zone).tone}`}>
          <small>综合判断（点位 + PE估值）</small>
          <p>{combinedAdvice(band, zone).text}</p>
        </div>}
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
        <p className="valuation-source">策略区间按固定参考标准划分，随指数点位自动匹配，仅供参考，不构成投资建议。</p>
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

const wan = (value) => `${(value / 10000).toFixed(1).replace(/\.0$/, "")}万`;

function WhyInvestModule({ comparison }) {
  const rates = [6, 10, 14];
  const compoundRows = [10, 20].map((years) => {
    const months = years * 12;
    return {
      years,
      principal: 1000 * months,
      cells: rates.map((rate) => {
        const r = rate / 100 / 12;
        return { rate, fv: Math.round(1000 * ((Math.pow(1 + r, months) - 1) / r)) };
      }),
    };
  });
  const compareItems = [["纳斯达克100", "ndx"], ["上证指数", "shanghai"], ["沪深300", "csi300"]];
  return <Collapsible eyebrow="INVESTMENT LOGIC" title="📈 为什么长期定投纳斯达克100？" icon={<TrendingUp/>} collapsedOnMobile>
    <div className="why-module">
      <p className="why-subtitle">基于长期经济增长、企业盈利能力和指数机制的投资逻辑。</p>
      <div className="why-grid">
        <article className="why-card">
          <h3><Cpu/>美国科技企业盈利能力</h3>
          <p>纳斯达克100包含大量全球领先科技企业：</p>
          <div className="why-tags">{["Apple", "Microsoft", "NVIDIA", "Amazon", "Google"].map((name) => <span key={name}>{name}</span>)}</div>
          <p>这些企业长期受益于：</p>
          <div className="why-tags alt">{["科技创新", "数字化", "人工智能", "云计算"].map((name) => <span key={name}>{name}</span>)}</div>
          <div className="why-key">核心逻辑：企业盈利增长推动指数长期上涨。</div>
        </article>
        <article className="why-card">
          <h3><ArrowLeftRight/>指数优胜劣汰机制</h3>
          <p>为什么指数适合长期投资？</p>
          <ul>
            <li>纳斯达克100会定期调整成分股</li>
            <li>优秀企业权重提升</li>
            <li>竞争力下降企业退出</li>
          </ul>
          <div className="why-key">相比单个股票：降低企业永久衰退风险。</div>
        </article>
        <article className="why-card">
          <h3><PiggyBank/>长期复利优势</h3>
          <p>每月投入1000元的简单模拟（仅为测算示例，不构成收益承诺）：</p>
          <table className="why-table">
            <thead><tr><th>期限</th><th>本金</th><th>年化6%</th><th>年化10%</th><th>年化14%</th></tr></thead>
            <tbody>{compoundRows.map((row) => <tr key={row.years}><td>{row.years}年</td><td>{wan(row.principal)}</td>{row.cells.map((cell) => <td key={cell.rate}><strong>{wan(cell.fv)}</strong></td>)}</tr>)}</tbody>
          </table>
          <div className="why-key">长期收益主要来自：时间 + 持续投入 + 企业成长。</div>
        </article>
      </div>

      <div className="why-section-title"><Scale/><h3>A股市场长期投资面临的一些挑战</h3></div>
      <div className="why-grid">
        <article className="why-card">
          <h3><Users/>市场结构差异</h3>
          <ul>
            <li>A股市场散户占比较高，短期交易行为较多</li>
            <li>行情容易受到情绪、政策预期、资金流动影响</li>
          </ul>
        </article>
        <article className="why-card">
          <h3><BarChart3/>指数长期收益差异</h3>
          <table className="why-table compare-table">
            <thead><tr><th>指数</th><th>累计收益</th><th>年化收益</th><th>最大回撤</th></tr></thead>
            <tbody>{compareItems.map(([name, key]) => {
              const stats = comparison?.[key];
              return <tr key={key}><td>{name}</td>{stats
                ? <><td className={stats.total > 0 ? "up" : "down"}>{percent(stats.total)}</td><td className={stats.annual > 0 ? "up" : "down"}>{percent(stats.annual)}</td><td className="down">{stats.max_drawdown.toFixed(1)}%</td></>
                : <td colSpan={3} className="why-pending">数据计算中…</td>}</tr>;
            })}</tbody>
          </table>
          <small className="why-note">按真实历史行情计算（纳指近10年，A股指数以可得历史为准） · 历史表现不代表未来收益</small>
        </article>
        <article className="why-card">
          <h3><Target/>投资方式差异</h3>
          <ul>
            <li>A股很多投资者依靠择时、选股、热点交易，难度较高</li>
            <li>宽基指数投资通过长期持有优秀企业组合，降低个体风险</li>
          </ul>
        </article>
      </div>
      <div className="why-disclaimer">投资观点仅用于学习交流。历史收益不代表未来表现。投资有风险，请结合个人情况独立判断。</div>
    </div>
  </Collapsible>;
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
  const scaleMin = 15;
  const scaleMax = 55;
  const pct = (v) => Math.max(0, Math.min(100, (v - scaleMin) / (scaleMax - scaleMin) * 100));
  // 按 PE 边界真实比例分段，刻度与分段严格对齐
  const segments = [];
  let start = scaleMin;
  bands.forEach((band, index) => {
    const end = index === bands.length - 1 || band.max === null ? scaleMax : Math.max(start, Math.min(band.max, scaleMax));
    segments.push({ band, start, end });
    start = end;
  });
  const position = Number.isFinite(value) ? Math.max(1, Math.min(99, pct(value))) : null;
  return <div className="valuation-scale v2">
    <div className="scale-track">
      {segments.map((seg, index) => <div key={index} className={`seg tone-${seg.band.tone}`} style={{ left: `${pct(seg.start)}%`, width: `${pct(seg.end) - pct(seg.start)}%` }}>
        <span>{seg.band.icon} {seg.band.label}</span>
      </div>)}
      {position !== null && <b className="scale-marker" style={{ left: `${position}%` }}><em>当前 {number(value, 1)}</em></b>}
    </div>
    <div className="scale-ticks">
      {segments.map((seg, index) => <span key={index} className={index === 0 ? "first" : ""} style={{ left: `${pct(seg.start)}%` }}>{seg.start}</span>)}
      <span className="last" style={{ left: "100%" }}>{scaleMax}</span>
    </div>
  </div>;
}

function formatTime(value, full = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: full ? "numeric" : undefined, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}
