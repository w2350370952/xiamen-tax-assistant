const MEAL_LAYOUT = {
  breakfast: {
    label: "早餐",
    range: [0.055, 0.37],
    categories: [
      [0.065, 0.105, "小菜"],
      [0.105, 0.145, "热菜"],
      [0.145, 0.255, "中点"],
      [0.255, 0.285, "主食"],
      [0.285, 0.35, "西点"],
      [0.35, 0.38, "饮料"],
    ],
  },
  lunch: {
    label: "午餐",
    range: [0.37, 0.72],
    categories: [
      [0.395, 0.555, "热菜"],
      [0.555, 0.585, "炖罐汤"],
      [0.585, 0.61, "快汤"],
      [0.61, 0.63, "主食"],
      [0.63, 0.655, "面档"],
      [0.655, 0.68, "佐品"],
      [0.68, 0.715, "煎扒档"],
      [0.715, 0.735, "水果/饮料"],
    ],
  },
  dinner: {
    label: "晚餐",
    range: [0.72, 0.985],
    categories: [
      [0.75, 0.875, "热菜"],
      [0.875, 0.9, "炖罐汤"],
      [0.9, 0.92, "主食"],
      [0.92, 0.945, "面档"],
      [0.945, 0.978, "煎扒档"],
      [0.978, 1.01, "水果"],
    ],
  },
};

const WEEKDAYS = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"];

const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const addDays = (date, count) => { const next = new Date(date); next.setDate(next.getDate() + count); return next; };

function emptyMeals() {
  return Object.fromEntries(Object.entries(MEAL_LAYOUT).map(([meal, config]) => [meal, Object.fromEntries(config.categories.map(([, , category]) => [category, []]))]));
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[|丨\[\]【】<>《》_=~^]+/g, "")
    .replace(/^[,，.。:：;；、\-—]+|[,，.。:：;；、\-—]+$/g, "")
    .trim();
}

function ignoredText(value) {
  return !value || value.length < 2 || /星期[一二三四五六日]|研究生|餐厅|菜[单谱]|20\d{2}年|早餐|午餐|晚餐|送餐|D厅/.test(value);
}

function flattenLines(blocks = []) {
  return blocks.flatMap((block) => block.paragraphs || []).flatMap((paragraph) => paragraph.lines || []).map((line) => ({
    text: cleanText(line.text),
    confidence: Number(line.confidence || 0),
    bbox: line.bbox,
  }));
}

function categoryAt(meal, yRatio) {
  return MEAL_LAYOUT[meal].categories.find(([start, end]) => yRatio >= start && yRatio < end)?.[2] || null;
}

function mealAt(yRatio) {
  return Object.keys(MEAL_LAYOUT).find((meal) => yRatio >= MEAL_LAYOUT[meal].range[0] && yRatio < MEAL_LAYOUT[meal].range[1]) || null;
}

function normalizeImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      const portrait = image.naturalHeight > image.naturalWidth * 1.05;
      const rawWidth = portrait ? image.naturalHeight : image.naturalWidth;
      const rawHeight = portrait ? image.naturalWidth : image.naturalHeight;
      const scale = Math.min(1.8, 2600 / rawWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(rawWidth * scale);
      canvas.height = Math.round(rawHeight * scale);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      if (portrait) {
        context.translate(0, canvas.height);
        context.rotate(-Math.PI / 2);
        context.drawImage(image, 0, 0, canvas.height, canvas.width);
      } else {
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
      }
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let index = 0; index < pixels.data.length; index += 4) {
        const grey = pixels.data[index] * 0.299 + pixels.data[index + 1] * 0.587 + pixels.data[index + 2] * 0.114;
        const enhanced = grey > 225 ? 255 : Math.max(0, Math.min(255, (grey - 128) * 1.22 + 128));
        pixels.data[index] = enhanced;
        pixels.data[index + 1] = enhanced;
        pixels.data[index + 2] = enhanced;
      }
      context.putImageData(pixels, 0, 0);
      resolve(canvas);
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("菜单图片无法读取，请重新拍摄或选择其他图片")); };
    image.src = url;
  });
}

export async function parseMenuImage(file, weekStart, onProgress = () => {}) {
  if (!file?.type?.startsWith("image/")) throw new Error("请选择 JPG、PNG 或 HEIC 转换后的菜单图片");
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(weekStart || "")) throw new Error("请先选择菜单所属周的星期一日期");
  onProgress(3);
  const canvas = await normalizeImage(file);
  onProgress(10);
  const { createWorker, PSM } = await import("tesseract.js");
  const worker = await createWorker("chi_sim", 1, {
    workerPath: "/assets/ocr/worker.min.js",
    corePath: "/assets/ocr/tesseract-core-lstm.wasm.js",
    langPath: "/assets/ocr",
    cacheMethod: "write",
    logger: (message) => {
      if (message.status === "recognizing text") onProgress(20 + Math.round((message.progress || 0) * 72));
      else if (message.status === "loading language traineddata") onProgress(10 + Math.round((message.progress || 0) * 9));
    },
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: "1" });
    const result = await worker.recognize(canvas, {}, { text: true, blocks: true });
    const monday = new Date(`${weekStart}T12:00:00`);
    const days = Array.from({ length: 7 }, (_, index) => ({ date: iso(addDays(monday, index)), weekday: WEEKDAYS[index], meals: emptyMeals() }));
    const width = canvas.width;
    const height = canvas.height;
    const dayStart = width * 0.06;
    const dayEnd = width * 0.985;
    const dayWidth = (dayEnd - dayStart) / 7;
    let accepted = 0;

    for (const line of flattenLines(result.data.blocks)) {
      if (!line.bbox || line.confidence < 12 || ignoredText(line.text)) continue;
      const centerX = (line.bbox.x0 + line.bbox.x1) / 2;
      const centerY = (line.bbox.y0 + line.bbox.y1) / 2;
      const yRatio = centerY / height;
      const meal = mealAt(yRatio);
      if (!meal) continue;
      const category = categoryAt(meal, yRatio);
      if (!category) continue;
      const broad = line.bbox.x1 - line.bbox.x0 > dayWidth * 1.55;
      const dayIndex = Math.max(0, Math.min(6, Math.floor((centerX - dayStart) / dayWidth)));
      const targets = broad ? days : [days[dayIndex]];
      for (const day of targets) {
        const items = day.meals[meal][category];
        if (!items.includes(line.text)) items.push(line.text);
      }
      accepted += 1;
    }
    onProgress(100);
    const warnings = ["图片表格已自动旋转并完成本机 OCR；照片倾斜、反光或小字可能导致错别字，请务必逐日校对后再发布。"];
    if (accepted < 20) warnings.push("本次识别到的有效菜单较少，建议上传更清晰、正对表格拍摄的图片，或在审核区手动补充。");
    return {
      menu: { week_start: weekStart, days },
      warnings,
      recognized_lines: accepted,
    };
  } finally {
    await worker.terminate();
  }
}

export const menuMealLabels = { breakfast: "早餐", lunch: "午餐", dinner: "晚餐" };
