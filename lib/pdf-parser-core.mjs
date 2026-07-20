const DATE_RE = /^20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}$/;
const WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

function clean(value) {
  return String(value ?? "").replace(/\s+/g, "").trim();
}

function normalizeDate(value) {
  const parts = clean(value).replaceAll("/", "-").replaceAll(".", "-").split("-");
  if (parts.length !== 3) return "";
  return `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
}

function weekdayFor(date, numeric) {
  const number = clean(numeric);
  if (/^[0-6]$/.test(number)) return WEEKDAYS[Number(number)];
  const day = new Date(`${date}T12:00:00`).getDay();
  return WEEKDAYS[day];
}

function courseType(name) {
  if (name.includes("英语")) return "english";
  if (["人工智能", "大数据", "数字经济", "数据资产"].some((word) => name.includes(word))) return "digital";
  if (["税", "纳税", "税费"].some((word) => name.includes(word))) return "tax";
  return "other";
}

function columnText(items, minX, maxX) {
  return items
    .filter((item) => item.x >= minX && item.x < maxX && clean(item.str))
    .sort((a, b) => (Math.abs(b.y - a.y) > 1 ? b.y - a.y : a.x - b.x))
    .map((item) => clean(item.str))
    .join("");
}

function extractPeriodsFromText(items) {
  const header = items.map((item) => clean(item.str)).join("");
  const normalized = header.replaceAll("：", ":").replace(/[—–]/g, "-");
  const result = {
    上午: ["08:30", "11:30"],
    下午: ["14:30", "17:30"],
    晚上: ["18:30", "21:30"],
  };
  for (const name of Object.keys(result)) {
    const match = normalized.match(new RegExp(`${name}:?(\\d{1,2}):(\\d{2})-(\\d{1,2}):(\\d{2})`));
    if (match) result[name] = [`${match[1].padStart(2, "0")}:${match[2]}`, `${match[3].padStart(2, "0")}:${match[4]}`];
  }
  return result;
}

export function parseExtractedPages(pages) {
  const warnings = [];
  const courses = [];
  const seen = new Set();
  const allItems = pages.flatMap((page) => page.items);
  const periods = extractPeriodsFromText(allItems);

  for (const page of pages) {
    const items = page.items.filter((item) => clean(item.str));
    const dates = items
      .filter((item) => item.x < 130 && DATE_RE.test(clean(item.str)))
      .sort((a, b) => b.y - a.y);

    if (!dates.length) {
      warnings.push(`第 ${page.pageNumber} 页未识别到日期行，请人工复核`);
      continue;
    }

    dates.forEach((dateItem, index) => {
      const upper = index === 0 ? dateItem.y + 24 : (dates[index - 1].y + dateItem.y) / 2;
      const lower = index === dates.length - 1 ? dateItem.y - 24 : (dateItem.y + dates[index + 1].y) / 2;
      const block = items.filter((item) => item.y <= upper && item.y > lower);
      const date = normalizeDate(dateItem.str);
      const weekday = weekdayFor(date, columnText(block, 130, 170));
      const periodItems = block
        .filter((item) => item.x >= 170 && item.x < 210 && ["上午", "下午", "晚上"].includes(clean(item.str)))
        .sort((a, b) => b.y - a.y);

      periodItems.forEach((periodItem) => {
        const period = clean(periodItem.str);
        const assigned = block.filter((item) => {
          if (item.x < 170) return false;
          const closest = periodItems.reduce((best, candidate) =>
            Math.abs(candidate.y - item.y) < Math.abs(best.y - item.y) ? candidate : best,
          periodItems[0]);
          return closest === periodItem;
        });
        const name = columnText(assigned, 205, 350);
        if (!name) return;
        const [startTime, endTime] = periods[period] ?? ["00:00", "00:00"];
        const course = {
          date,
          weekday,
          period,
          start_time: startTime,
          end_time: endTime,
          course_name: name,
          teacher: columnText(assigned, 350, 400),
          class_name: columnText(assigned, 400, 445),
          classroom: columnText(assigned, 445, 490),
          remark: columnText(assigned, 490, 560),
          course_type: courseType(name),
          source_page: page.pageNumber,
        };
        const key = `${course.date}|${course.start_time}|${course.course_name}|${course.teacher}`;
        if (!seen.has(key)) {
          seen.add(key);
          courses.push(course);
        }
      });
    });
  }

  courses.sort((a, b) => `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`));
  if (!courses.length) warnings.push("未识别到课程，请确认PDF为学校课程总表");
  return { courses, warnings };
}

