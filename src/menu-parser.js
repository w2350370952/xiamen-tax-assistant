export const MENU_CATEGORIES = {
  breakfast: ["热菜", "中点", "主食", "西点", "饮料"],
  lunch: ["热菜", "免费汤", "炖汤", "主食", "面档", "饮品", "煎扒档", "饮料"],
  dinner: ["热菜", "免费汤", "主食", "面档", "煎扒档"],
};

const MEAL_LAYOUT = {
  breakfast: {
    label: "早餐",
    range: [0.055, 0.37],
    categories: [
      [0.065, 0.105, "热菜"],
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
      [0.555, 0.585, "炖汤"],
      [0.585, 0.61, "免费汤"],
      [0.61, 0.63, "主食"],
      [0.63, 0.655, "面档"],
      [0.655, 0.68, "饮品"],
      [0.68, 0.715, "煎扒档"],
      [0.715, 0.735, "饮料"],
    ],
  },
  dinner: {
    label: "晚餐",
    range: [0.72, 0.985],
    categories: [
      [0.75, 0.875, "热菜"],
      [0.875, 0.9, "免费汤"],
      [0.9, 0.92, "主食"],
      [0.92, 0.945, "面档"],
      [0.945, 0.978, "煎扒档"],
    ],
  },
};

const WEEKDAYS = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"];

const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const addDays = (date, count) => { const next = new Date(date); next.setDate(next.getDate() + count); return next; };

function emptyMeals() {
  return Object.fromEntries(Object.entries(MENU_CATEGORIES).map(([meal, categories]) => [meal, Object.fromEntries(categories.map((category) => [category, []]))]));
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[|丨\[\]【】<>《》_=~^]+/g, "")
    .replace(/^[,，.。:：;；、\-—]+|[,，.。:：;；、\-—]+$/g, "")
    .trim();
}

function ignoredText(value) {
  return !value || value.length < 2 || /星期[一二三四五六日]|研究生|餐厅|菜[单谱]|20\d{2}年|早餐|午餐|晚餐|送餐|D厅|^(小菜|热菜|中点|主食|西点|饮料|免费汤|炖汤|炖罐汤|快汤|面档|饮品|佐品|煎扒档|水果|水果\/饮料)$/.test(value);
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
    const dayStart = width * 0.082;
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

const CATEGORY_ALIASES = {
  breakfast: { 热菜: ["热菜", "小菜"], 中点: ["中点"], 主食: ["主食"], 西点: ["西点"], 饮料: ["水果饮料", "饮料", "水果"] },
  lunch: { 热菜: ["热菜"], 免费汤: ["免费汤", "快汤"], 炖汤: ["炖罐汤", "炖汤"], 主食: ["主食"], 面档: ["面档"], 饮品: ["饮品", "佐品"], 煎扒档: ["煎扒档"], 饮料: ["水果饮料", "饮料", "水果"] },
  dinner: { 热菜: ["热菜"], 免费汤: ["免费汤", "炖罐汤", "炖汤", "快汤"], 主食: ["主食"], 面档: ["面档"], 煎扒档: ["煎扒档"] },
};

function matchedCategory(value, meal) {
  const text = cleanText(value).replace(/\//g, "");
  const entries = Object.entries(CATEGORY_ALIASES[meal] || {}).flatMap(([category, aliases]) => aliases.map((alias) => [category, alias])).sort((a, b) => b[1].length - a[1].length);
  return entries.find(([, alias]) => text.includes(alias))?.[0] || null;
}

const TEXT_MEALS = [
  { meal: "breakfast", names: ["早餐", "早饭", "早点"] },
  { meal: "lunch", names: ["午餐", "午饭", "中餐"] },
  { meal: "dinner", names: ["晚餐", "晚饭"] },
];

function splitTypedDishes(value) {
  return String(value || "")
    .split(/、|，|,|；|;|\t|\s{2,}/)
    .map((item) => item.replace(/^\s*(?:[-•·]|(?:\d+|[①-⑳])[.、)）])\s*/, "").trim())
    .filter(Boolean);
}

function consumeCategoryPrefix(value, meal) {
  const candidates = Object.entries(CATEGORY_ALIASES[meal] || {})
    .flatMap(([category, names]) => names.map((name) => ({ category, name })))
    .sort((left, right) => right.name.length - left.name.length);
  for (const candidate of candidates) {
    if (value === candidate.name) return { category: candidate.category, rest: "" };
    if (!value.startsWith(candidate.name)) continue;
    const suffix = value.slice(candidate.name.length);
    const separator = suffix.match(/^\s*(?:[:：\-—]\s*|\s+)/);
    if (separator) return { category: candidate.category, rest: suffix.slice(separator[0].length) };
  }
  return null;
}

export function parseWeeklyMenuText(source) {
  const patches = {};
  const foundDays = new Set(), foundMeals = new Set(), foundCategories = new Set();
  let dayIndex = null, meal = null, category = null, ignored = 0;
  const addItems = (value) => {
    if (dayIndex === null || !meal || !category) { if (String(value || "").trim()) ignored += 1; return; }
    const key = `${dayIndex}:${meal}:${category}`;
    patches[key] ||= [];
    for (const item of splitTypedDishes(value)) if (!patches[key].includes(item)) patches[key].push(item);
  };

  for (const rawLine of String(source || "").split(/\r?\n/)) {
    let rest = rawLine.replace(/[【】\[\]]/g, " ").trim();
    if (!rest) continue;

    const dayMatch = rest.match(/^(?:星期|周|礼拜)\s*([一二三四五六日天])\s*(?:[:：\-—]\s*)?/);
    if (dayMatch) {
      dayIndex = "一二三四五六日".indexOf(dayMatch[1] === "天" ? "日" : dayMatch[1]);
      meal = null; category = null; foundDays.add(dayIndex); rest = rest.slice(dayMatch[0].length).trim();
    }

    const mealMatch = TEXT_MEALS.flatMap((entry) => entry.names.map((name) => ({ meal: entry.meal, name }))).sort((left, right) => right.name.length - left.name.length).find((entry) => rest === entry.name || rest.startsWith(entry.name));
    if (mealMatch) {
      meal = mealMatch.meal; category = null;
      if (dayIndex !== null) foundMeals.add(`${dayIndex}:${meal}`);
      rest = rest.slice(mealMatch.name.length).replace(/^\s*[:：\-—]?\s*/, "");
    }

    if (meal) {
      const categoryMatch = consumeCategoryPrefix(rest, meal);
      if (categoryMatch) {
        category = categoryMatch.category;
        if (dayIndex !== null) foundCategories.add(`${dayIndex}:${meal}:${category}`);
        rest = categoryMatch.rest.trim();
      }
    }

    addItems(rest);
  }

  return {
    patches,
    days: foundDays.size,
    meals: foundMeals.size,
    categories: foundCategories.size,
    count: Object.values(patches).reduce((sum, items) => sum + items.length, 0),
    ignored,
  };
}

function tableTop(table) {
  return Math.min(...(table.TableCoordPoint || []).map((point) => Number(point.Y || 0)), Number.MAX_SAFE_INTEGER);
}

function cellText(cell) {
  return cleanText(cell?.Text).replace(/[“”'‘’]+/g, "");
}

function cellCenterRow(cell) {
  return (Number(cell.RowTl || 0) + Number(cell.RowBr || cell.RowTl || 0)) / 2;
}

function cellOverlapsColumn(cell, column) {
  const start = Number(cell.ColTl || 0), end = Number(cell.ColBr ?? start);
  return column >= start && column <= end;
}

function detectMeal(cells, fallbackIndex) {
  const allText = cells.map((cell) => cellText(cell)).join("");
  if (allText.includes("早餐")) return "breakfast";
  if (allText.includes("午餐")) return "lunch";
  if (allText.includes("晚餐") || allText.includes("晚饭")) return "dinner";
  return ["breakfast", "lunch", "dinner"][fallbackIndex] || null;
}

function nearestCategory(cell, categoryCells, meal) {
  const row = cellCenterRow(cell);
  const containing = categoryCells.filter((entry) => row >= Number(entry.cell.RowTl || 0) - 0.2 && row <= Number(entry.cell.RowBr ?? (entry.cell.RowTl || 0)) + 0.2);
  if (containing.length) return containing.sort((a, b) => Math.abs(cellCenterRow(a.cell) - row) - Math.abs(cellCenterRow(b.cell) - row))[0].category;
  const previous = categoryCells.filter((entry) => Number(entry.cell.RowTl || 0) <= row).sort((a, b) => Number(b.cell.RowTl || 0) - Number(a.cell.RowTl || 0))[0];
  const category = previous?.category;
  return Object.prototype.hasOwnProperty.call(emptyMeals()[meal], category) ? category : null;
}

export function parseTencentMenuTables(tableDetections, weekStart) {
  if (!Array.isArray(tableDetections) || !tableDetections.length) throw new Error("腾讯云没有检测到表格，请重新正对菜单拍摄");
  const monday = new Date(`${weekStart}T12:00:00`);
  const days = Array.from({ length: 7 }, (_, index) => ({ date: iso(addDays(monday, index)), weekday: WEEKDAYS[index], meals: emptyMeals() }));
  const tables = [...tableDetections].filter((table) => Array.isArray(table.Cells) && table.Cells.length).sort((a, b) => tableTop(a) - tableTop(b));
  let accepted = 0, lowConfidence = 0, mealIndex = 0;

  for (const table of tables) {
    const cells = table.Cells || [];
    const headers = cells.map((cell) => {
      const match = cellText(cell).match(/星期\s*([一二三四五六日])/);
      const index = match ? "一二三四五六日".indexOf(match[1]) : -1;
      return index >= 0 ? { index, column: Number(cell.ColTl || 0), cell } : null;
    }).filter(Boolean).sort((a, b) => a.index - b.index);
    if (headers.length < 5) continue;
    const meal = detectMeal(cells, mealIndex);
    if (!meal) continue;
    mealIndex += 1;
    const columns = Array.from({ length: 7 }, (_, index) => headers.find((header) => header.index === index)?.column ?? null);
    if (columns.some((column) => column === null)) {
      const known = headers.map((header) => header.column).sort((a, b) => a - b);
      const start = known[0], step = known.length > 1 ? (known[known.length - 1] - start) / 6 : 1;
      for (let index = 0; index < 7; index += 1) if (columns[index] === null) columns[index] = Math.round(start + step * index);
    }
    const firstDayColumn = Math.min(...columns);
    const categoryCells = cells.map((cell) => ({ cell, category: matchedCategory(cell.Text, meal) })).filter((entry) => entry.category && Number(entry.cell.ColTl || 0) < firstDayColumn);

    for (const cell of cells) {
      const text = cellText(cell);
      if (ignoredText(text) || matchedCategory(text, meal) || Number(cell.ColBr ?? (cell.ColTl || 0)) < firstDayColumn) continue;
      const category = nearestCategory(cell, categoryCells, meal);
      if (!category || !Object.prototype.hasOwnProperty.call(days[0].meals[meal], category)) continue;
      const targets = columns.map((column, index) => cellOverlapsColumn(cell, column) ? index : -1).filter((index) => index >= 0);
      if (!targets.length) continue;
      const items = String(cell.Text || "").split(/\n|、|；|;/).map(cleanText).filter((item) => !ignoredText(item) && !matchedCategory(item, meal));
      if (!items.length) continue;
      if (Number(cell.Confidence || 0) < 70) lowConfidence += items.length;
      for (const dayIndex of targets) {
        const bucket = days[dayIndex].meals[meal][category];
        for (const item of items) if (!bucket.includes(item)) bucket.push(item);
      }
      accepted += items.length;
    }
  }
  if (accepted < 20) throw new Error("腾讯云已识别图片，但没有成功还原星期与餐次结构，请上传更清晰、完整的菜单照片");
  const warnings = [`已使用腾讯云表格识别 V3 提取 ${accepted} 道菜品，请重点检查标记为低置信度的文字。`];
  if (lowConfidence) warnings.push(`其中约 ${lowConfidence} 道菜品识别置信度偏低，建议对照原图校对。`);
  return { menu: { week_start: weekStart, days }, warnings, recognized_lines: accepted, engine: "tencent-table-v3" };
}

export async function imageFileToBase64(file) {
  const canvas = await normalizeImage(file);
  return canvas.toDataURL("image/jpeg", 0.86).split(",")[1] || "";
}
