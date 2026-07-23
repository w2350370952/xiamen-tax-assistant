import { useEffect, useRef } from "react";
import { LineChart } from "echarts/charts";
import { DataZoomComponent, GridComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([LineChart, DataZoomComponent, GridComponent, TooltipComponent, CanvasRenderer]);

const formatNumber = (value) => Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function NasdaqChart({ history }) {
  const container = useRef(null);
  useEffect(() => {
    if (!container.current) return undefined;
    const chart = echarts.init(container.current, undefined, { renderer: "canvas" });
    const prices = history.map(item => Number(item.price));
    const rising = prices.at(-1) >= prices[0];
    chart.setOption({
      animationDuration: 500,
      grid: { left: 12, right: 18, top: 24, bottom: 48, containLabel: true },
      tooltip: { trigger: "axis", valueFormatter: value => formatNumber(value) },
      xAxis: { type: "category", boundaryGap: false, data: history.map(item => item.date.slice(5)), axisLine: { lineStyle: { color: "#dbe2eb" } }, axisLabel: { color: "#8490a1", hideOverlap: true } },
      yAxis: { type: "value", scale: true, splitNumber: 4, axisLabel: { color: "#8490a1", formatter: value => Number(value).toLocaleString("zh-CN") }, splitLine: { lineStyle: { color: "#edf1f5" } } },
      dataZoom: [{ type: "inside", zoomOnMouseWheel: true, moveOnMouseMove: true }, { type: "slider", height: 18, bottom: 5, borderColor: "transparent", backgroundColor: "#eef2f6", fillerColor: "rgba(47,111,237,.16)" }],
      series: [{ type: "line", data: prices, showSymbol: false, smooth: 0.18, lineStyle: { width: 3, color: rising ? "#1c9b70" : "#db5b62" }, areaStyle: { color: rising ? "rgba(28,155,112,.10)" : "rgba(219,91,98,.10)" } }],
    });
    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); chart.dispose(); };
  }, [history]);
  return <div ref={container} className="nasdaq-chart" role="img" aria-label="纳斯达克100历史走势折线图"/>;
}
