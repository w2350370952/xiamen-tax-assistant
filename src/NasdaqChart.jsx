import { useEffect, useRef } from "react";
import { CandlestickChart, LineChart } from "echarts/charts";
import { DataZoomComponent, GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([LineChart, CandlestickChart, DataZoomComponent, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

const UP = "#15966f";
const DOWN = "#d9545c";
const SH_COLOR = "#b0722a";
const formatNumber = (value, digits = 2) => Number(value).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const closeOf = (item) => Number(item.close ?? item.price);

// X 轴：短周期显示 MM-DD，跨年或首个标签补年份；长周期显示 YYYY-MM
function dateAxisFormatter(dates, dense) {
  return (value, index) => {
    const date = dates[index];
    if (!date) return value;
    if (dense) return date.slice(0, 7);
    if (index === 0 || date.slice(0, 4) !== dates[index - 1]?.slice(0, 4)) return `${date.slice(0, 4)}年${date.slice(5)}`;
    return date.slice(5);
  };
}

function categoryAxis(dates) {
  const dense = dates.length > 400;
  return {
    type: "category",
    boundaryGap: false,
    data: dates,
    axisLine: { lineStyle: { color: "#dbe2eb" } },
    axisLabel: { color: "#8490a1", hideOverlap: true, formatter: dateAxisFormatter(dates, dense) },
  };
}

function valueAxis(formatter) {
  return { type: "value", scale: true, splitNumber: 4, axisLabel: { color: "#8490a1", formatter: formatter || ((value) => Number(value).toLocaleString("zh-CN")) }, splitLine: { lineStyle: { color: "#edf1f5" } } };
}

function baseGrid() {
  return { left: 12, right: 18, top: 24, bottom: 48, containLabel: true };
}

function baseZoom() {
  return [
    { type: "inside", zoomOnMouseWheel: true, moveOnMouseMove: true },
    { type: "slider", height: 18, bottom: 5, borderColor: "transparent", backgroundColor: "#eef2f6", fillerColor: "rgba(47,111,237,.16)" },
  ];
}

const animationOf = (points) => (points > 600 ? { animation: false } : { animationDuration: 400, animationDurationUpdate: 200 });

function lineOption(ndx) {
  const dates = ndx.map((item) => item.date);
  const prices = ndx.map(closeOf);
  const rising = prices.at(-1) >= prices[0];
  return {
    ...animationOf(prices.length),
    grid: baseGrid(),
    tooltip: { trigger: "axis", valueFormatter: (value) => formatNumber(value) },
    xAxis: categoryAxis(dates),
    yAxis: valueAxis(),
    dataZoom: baseZoom(),
    series: [{ type: "line", data: prices, showSymbol: false, smooth: 0.18, lineStyle: { width: 3, color: rising ? UP : DOWN }, areaStyle: { color: rising ? "rgba(21,150,111,.10)" : "rgba(217,84,92,.10)" } }],
  };
}

function candleOption(ndx) {
  const dates = ndx.map((item) => item.date);
  return {
    ...animationOf(ndx.length),
    grid: baseGrid(),
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      formatter: (params) => {
        const item = params.find((param) => param.seriesType === "candlestick");
        if (!item) return "";
        const [open, close, low, high] = item.data.slice(1);
        return `${item.axisValue}<br/>开盘：${formatNumber(open)}<br/>收盘：${formatNumber(close)}<br/>最高：${formatNumber(high)}<br/>最低：${formatNumber(low)}`;
      },
    },
    xAxis: { ...categoryAxis(dates), boundaryGap: true },
    yAxis: valueAxis(),
    dataZoom: baseZoom(),
    series: [{
      type: "candlestick",
      data: ndx.map((item) => [Number(item.open ?? closeOf(item)), closeOf(item), Number(item.low ?? closeOf(item)), Number(item.high ?? closeOf(item))]),
      itemStyle: { color: UP, color0: DOWN, borderColor: UP, borderColor0: DOWN },
    }],
  };
}

// 单 Y 轴真实点位对比：两指数共用同一坐标轴，直观呈现量级差距
function compareOption(ndx, sh) {
  const dateSet = new Set();
  ndx.forEach((item) => dateSet.add(item.date));
  sh.forEach((item) => dateSet.add(item.date));
  const dates = [...dateSet].sort();
  const ndxMap = new Map(ndx.map((item) => [item.date, closeOf(item)]));
  const shMap = new Map(sh.map((item) => [item.date, closeOf(item)]));
  const hasSh = sh.length > 0;
  const realSeries = (map) => dates.map((date) => {
    const value = map.get(date);
    return Number.isFinite(value) ? value : null;
  });
  return {
    ...animationOf(dates.length),
    grid: baseGrid(),
    legend: { top: 0, right: 8, itemWidth: 14, textStyle: { color: "#5b6b82", fontSize: 11 }, data: hasSh ? ["纳斯达克100", "上证指数"] : ["纳斯达克100"] },
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const lines = params.filter((param) => param.value !== null && param.value !== undefined && param.value !== "-")
          .map((param) => `${param.marker}${param.seriesName}：${formatNumber(param.value)} 点`);
        return lines.length ? `${params[0].axisValue}<br/>${lines.join("<br/>")}` : `${params[0]?.axisValue || ""}<br/>暂无数据`;
      },
    },
    xAxis: categoryAxis(dates),
    yAxis: valueAxis(),
    dataZoom: baseZoom(),
    series: [
      { name: "纳斯达克100", type: "line", data: realSeries(ndxMap), connectNulls: true, showSymbol: false, smooth: 0.15, lineStyle: { width: 2.5, color: UP }, itemStyle: { color: UP } },
      ...(hasSh ? [{ name: "上证指数", type: "line", data: realSeries(shMap), connectNulls: true, showSymbol: false, smooth: 0.15, lineStyle: { width: 2.5, color: SH_COLOR }, itemStyle: { color: SH_COLOR } }] : []),
    ],
  };
}

export default function NasdaqChart({ mode = "single", chartType = "line", ndx = [], sh = [] }) {
  const container = useRef(null);
  const chartRef = useRef(null);
  // 实例只在挂载/卸载时创建和销毁，数据变化时复用，避免图表反复重建导致跳动
  useEffect(() => {
    if (!container.current) return undefined;
    const chart = echarts.init(container.current, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); chart.dispose(); chartRef.current = null; };
  }, []);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || ndx.length < 2) return;
    const option = mode === "compare" ? compareOption(ndx, sh) : chartType === "candle" ? candleOption(ndx) : lineOption(ndx);
    chart.setOption(option, { notMerge: true });
  }, [mode, chartType, ndx, sh]);
  const label = mode === "compare" ? "纳斯达克100与上证指数真实点位对比图（共用单Y轴）" : chartType === "candle" ? "纳斯达克100历史K线图" : "纳斯达克100历史走势折线图";
  return <div ref={container} className="nasdaq-chart" role="img" aria-label={label}/>;
}
