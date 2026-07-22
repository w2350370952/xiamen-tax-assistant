import { useEffect, useState } from "react";
import { BookOpenCheck, CalendarDays, CalendarRange, ChevronLeft, ChevronRight, Clock3, Coffee, Database, GraduationCap, Home, MapPin, MoonStar, Search, ShieldCheck, Soup, UserRound, UtensilsCrossed, X } from "lucide-react";
import { initialCourses } from "./initialCourses";
import AdminApp from "./AdminApp";
// Student UI: course calendar, Beijing-time dining menu and mobile navigation.
const ADMIN_URL = "/?admin=1";

const weekNames = ["星期一","星期二","星期三","星期四","星期五","星期六","星期日"];
const majors = [
  {id:"tax",label:"税务",short:"MT",desc:"税务专硕课程安排"},
  {id:"accounting",label:"会计",short:"MPAcc",desc:"会计专硕课程安排"},
  {id:"audit",label:"审计",short:"MAud",desc:"审计专硕课程安排"},
  {id:"finance",label:"金融",short:"MF",desc:"金融专硕课程安排"},
];
// 国务院办公厅《国务院办公厅关于2026年部分节假日安排的通知》
const holidaySource="https://www.gov.cn/yaowen/liebiao/202511/content_7047099.htm";
const officialHolidays=[
  {name:"元旦",start:"2026-01-01",end:"2026-01-03",days:3},
  {name:"春节",start:"2026-02-15",end:"2026-02-23",days:9},
  {name:"清明节",start:"2026-04-04",end:"2026-04-06",days:3},
  {name:"劳动节",start:"2026-05-01",end:"2026-05-05",days:5},
  {name:"端午节",start:"2026-06-19",end:"2026-06-21",days:3},
  {name:"中秋节",start:"2026-09-25",end:"2026-09-27",days:3},
  {name:"国庆节",start:"2026-10-01",end:"2026-10-07",days:7},
];
const palette = { tax:{label:"税务课程",color:"#2f6fed",soft:"#eaf1ff"}, english:{label:"英语课程",color:"#15966f",soft:"#e7f7f1"}, digital:{label:"数字与智能",color:"#7657d6",soft:"#f0ecff"}, other:{label:"其他课程",color:"#7b8798",soft:"#eef1f4"} };
const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const dateOf = s => new Date(`${s}T12:00:00`);
const addDays = (d,n) => { const x=new Date(d); x.setDate(x.getDate()+n); return x; };
const monday = d => addDays(d,1-(d.getDay()||7));
const firstMonth = d => new Date(d.getFullYear(),d.getMonth(),1,12);
const addMonths = (d,n) => new Date(d.getFullYear(),d.getMonth()+n,1,12);
const storedMajor = () => { try { const value=localStorage.getItem("xnai_major"); if(majors.some(item=>item.id===value))return value; } catch {} const match=document.cookie.split(";").map(item=>item.trim()).find(item=>item.startsWith("xnai_major=")); const value=match?decodeURIComponent(match.slice(11)):null; return majors.some(item=>item.id===value)?value:null; };
const rememberMajor = value => { try { localStorage.setItem("xnai_major",value); } catch {} document.cookie=`xnai_major=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`; };
const beijingClock = value => { const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(value);const map=Object.fromEntries(parts.map(part=>[part.type,part.value]));return {date:`${map.year}-${map.month}-${map.day}`,hour:Number(map.hour),minute:Number(map.minute),time:`${map.hour}:${map.minute}`}; };
const mealForHour = hour => hour<9?"breakfast":hour<14?"lunch":"dinner";
const mealLabels = {breakfast:"早餐",lunch:"午餐",dinner:"晚餐"};

export default function App(){
  const adminMode = new URLSearchParams(window.location.search).has("admin");
  return adminMode ? <AdminApp/> : <StudentApp/>;
}

function StudentApp(){
  const remembered=storedMajor();
  const [major,setMajor]=useState(remembered);
  const [showMajorPicker,setShowMajorPicker]=useState(!remembered);
  const [tab,setTab]=useState("today");
  const [courses,setCourses]=useState(remembered==="tax"?initialCourses:[]);
  const [version,setVersion]=useState({label:"v1.0",updated_at:"2026-07-20T15:00:00Z"});
  const [selected,setSelected]=useState(null);
  const [now,setNow]=useState(new Date());
  const first=initialCourses[0].date;
  const initialFocus=iso(new Date())<first?dateOf(first):new Date();
  const [weekAnchor,setWeekAnchor]=useState(initialFocus);
  const [monthAnchor,setMonthAnchor]=useState(firstMonth(initialFocus));
  const [selectedDay,setSelectedDay]=useState(iso(initialFocus));
  const [synced,setSynced]=useState(false);
  const [searchQuery,setSearchQuery]=useState("");
  const [dayViewDate,setDayViewDate]=useState(null);
  const initialBeijing=beijingClock(new Date());
  const [menu,setMenu]=useState(null);
  const [menuVersion,setMenuVersion]=useState(null);
  const [menuDate,setMenuDate]=useState(initialBeijing.date);
  const [menuMeal,setMenuMeal]=useState(mealForHour(initialBeijing.hour));
  const [menuMealManual,setMenuMealManual]=useState(false);

  useEffect(()=>{const clock=setInterval(()=>setNow(new Date()),1000);return()=>clearInterval(clock);},[]);
  useEffect(()=>{
    const syncMenu=()=>fetch(`/api/live-menu?refresh=${Date.now()}`,{cache:"no-store"}).then(response=>response.ok?response.json():Promise.reject()).then(data=>{setMenu(data.menu||null);setMenuVersion(data.version||null);}).catch(()=>{});
    const onVisible=()=>{if(document.visibilityState==="visible")syncMenu();};
    syncMenu();const timer=setInterval(syncMenu,60000);document.addEventListener("visibilitychange",onVisible);window.addEventListener("focus",syncMenu);
    return()=>{clearInterval(timer);document.removeEventListener("visibilitychange",onVisible);window.removeEventListener("focus",syncMenu);};
  },[]);
  useEffect(()=>{
    if(!major)return undefined;
    const syncCourses=()=>fetch(`/api/live-courses/${encodeURIComponent(major)}?refresh=${Date.now()}`,{cache:"no-store"}).then(r=>r.ok?r.json():Promise.reject()).then(d=>{
      if(Array.isArray(d.courses))setCourses(d.courses);
      if(d.version)setVersion(d.version);
      setSynced(true);
    }).catch(()=>setSynced(false));
    const onVisible=()=>{if(document.visibilityState==="visible")syncCourses();};
    syncCourses();
    const courseTimer=setInterval(syncCourses,30000);
    document.addEventListener("visibilitychange",onVisible);
    window.addEventListener("focus",syncCourses);
    return()=>{clearInterval(courseTimer);document.removeEventListener("visibilitychange",onVisible);window.removeEventListener("focus",syncCourses);};
  },[major]);
  const today=iso(now), todayCourses=courses.filter(c=>c.date===today);
  const courseTime=(course,field)=>new Date(`${course.date}T${course[field]||"00:00"}:00`).getTime();
  const passedCourses=courses.filter(course=>courseTime(course,"end_time")<=now.getTime()).length;
  const remainingCourses=Math.max(courses.length-passedCourses,0);
  const next=[...courses].filter(course=>courseTime(course,"start_time")>now.getTime()).sort((a,b)=>courseTime(a,"start_time")-courseTime(b,"start_time"))[0];
  const weekStart=monday(weekAnchor), weekDays=Array.from({length:7},(_,i)=>addDays(weekStart,i));
  const monthStart=firstMonth(monthAnchor), gridStart=monday(monthStart), monthDays=Array.from({length:42},(_,i)=>addDays(gridStart,i));
  const nav=[{id:"today",label:"今日",icon:Home},{id:"menu",label:"菜单",icon:UtensilsCrossed},{id:"week",label:"周课表",icon:CalendarDays},{id:"month",label:"月视图",icon:CalendarRange},{id:"profile",label:"我的",icon:UserRound}];
  const keyword=searchQuery.trim().toLowerCase();
  const searchResults=keyword?courses.filter(c=>[c.course_name,c.teacher,c.date,c.weekday,c.classroom,c.class_name,c.remark,c.start_time,c.end_time].some(value=>String(value||"").toLowerCase().includes(keyword))):[];
  const majorInfo=majors.find(item=>item.id===major)||majors[0];
  const chooseMajor=id=>{rememberMajor(id);setMajor(id);setCourses(id==="tax"?initialCourses:[]);setVersion({label:"v1.0",updated_at:null});setSynced(false);setTab("today");setDayViewDate(null);setSearchQuery("");setShowMajorPicker(false);};
  const beijing=beijingClock(now), automaticMeal=mealForHour(beijing.hour);
  useEffect(()=>{setMenuDate(beijing.date);setMenuMealManual(false);setMenuMeal(automaticMeal);},[beijing.date]);
  useEffect(()=>{if(!menuMealManual)setMenuMeal(automaticMeal);},[automaticMeal,menuMealManual]);
  const openTab=id=>{setTab(id);setDayViewDate(null);if(id==="menu"){const current=beijingClock(new Date());setMenuDate(current.date);setMenuMeal(mealForHour(current.hour));setMenuMealManual(false);}};

  return <div className="shell">
    <aside className="sidebar"><button className="brand" onClick={()=>openTab("today")}><b>{majorInfo.short}</b><span><strong>厦国会</strong><small>{majorInfo.label}专硕助手</small></span></button><nav>{nav.map(n=><button key={n.id} className={tab===n.id?"active":""} onClick={()=>openTab(n.id)}><n.icon size={19}/>{n.label}</button>)}</nav><a className="admin" href={ADMIN_URL} target="_blank" rel="noreferrer"><ShieldCheck size={17}/>管理员入口</a></aside>
    <main>
      {tab==="today"&&<section className="page"><Header eyebrow="TODAY'S FOCUS" title={`${["星期日","星期一","星期二","星期三","星期四","星期五","星期六"][now.getDay()]}，专注当下。`} sub={`${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 · 厦门国家会计学院`} actions={<CourseSearch query={searchQuery} setQuery={setSearchQuery} results={searchResults} select={setSelected}/>}/><TermOverview total={courses.length} passed={passedCourses} remaining={remainingCourses} todayCount={todayCourses.length} next={next} now={now}/><HolidayCard now={now}/><Panel title="今日课程" count={todayCourses.length}>{todayCourses.length?<div className="course-list">{todayCourses.map(c=><CourseCard key={c.id} c={c} onClick={()=>setSelected(c)}/>)}</div>:<Empty first={courses[0]?.date} onGo={()=>setTab("week")}/>}</Panel></section>}
      {tab==="menu"&&<MenuPage menu={menu} version={menuVersion} date={menuDate} setDate={setMenuDate} meal={menuMeal} setMeal={value=>{setMenuMeal(value);setMenuMealManual(true)}} beijing={beijing} automaticMeal={automaticMeal} resetCurrent={()=>{setMenuDate(beijing.date);setMenuMeal(automaticMeal);setMenuMealManual(false)}}/>}
      {tab==="week"&&<section className="page"><Header eyebrow="WEEKLY SCHEDULE" title="周课表" sub={dayViewDate?`${dayViewDate} · ${["星期日","星期一","星期二","星期三","星期四","星期五","星期六"][dateOf(dayViewDate).getDay()]}`:`${weekDays[0].getMonth()+1}月${weekDays[0].getDate()}日 – ${weekDays[6].getMonth()+1}月${weekDays[6].getDate()}日`} actions={<Pager selectedDate={dayViewDate} anchor={dayViewDate?dateOf(dayViewDate):weekAnchor} courses={courses} prev={()=>dayViewDate?setDayViewDate(iso(addDays(dateOf(dayViewDate),-1))):setWeekAnchor(addDays(weekAnchor,-7))} next={()=>dayViewDate?setDayViewDate(iso(addDays(dateOf(dayViewDate),1))):setWeekAnchor(addDays(weekAnchor,7))} onSelectDate={date=>{setWeekAnchor(date);setDayViewDate(iso(date));}}/>}/>{dayViewDate?<DaySchedule date={dayViewDate} courses={courses} select={setSelected} onBack={()=>setDayViewDate(null)} backLabel="返回完整周课表"/>:<><div className="week-scroll"><div className="week-grid"><div className="corner">时段</div>{weekDays.map((d,i)=><div className={`day-head ${iso(d)===today?"today":""}`} key={iso(d)}><span>{weekNames[i]}</span><b>{d.getDate()}</b></div>)}{["上午","下午"].map(period=><WeekRow key={period} period={period} days={weekDays} courses={courses} select={setSelected}/>)}</div></div><MobileWeek days={weekDays} courses={courses} today={today} select={setSelected}/><Legend/></>}</section>}
      {tab==="month"&&<section className="page"><Header eyebrow="MONTHLY CALENDAR" title={dayViewDate?"单日课程":`${monthStart.getFullYear()}年${monthStart.getMonth()+1}月`} sub={dayViewDate?`${dayViewDate} · ${["星期日","星期一","星期二","星期三","星期四","星期五","星期六"][dateOf(dayViewDate).getDay()]}`:"按月查看全部课程安排"} actions={<Pager selectedDate={dayViewDate} anchor={dayViewDate?dateOf(dayViewDate):dateOf(selectedDay)} courses={courses} prev={()=>{if(dayViewDate){const d=addDays(dateOf(dayViewDate),-1);setDayViewDate(iso(d));setMonthAnchor(firstMonth(d));}else{const d=addMonths(monthAnchor,-1);setMonthAnchor(d);setSelectedDay(iso(d));}}} next={()=>{if(dayViewDate){const d=addDays(dateOf(dayViewDate),1);setDayViewDate(iso(d));setMonthAnchor(firstMonth(d));}else{const d=addMonths(monthAnchor,1);setMonthAnchor(d);setSelectedDay(iso(d));}}} onSelectDate={date=>{setMonthAnchor(firstMonth(date));setSelectedDay(iso(date));setDayViewDate(iso(date));}}/>}/>{dayViewDate?<DaySchedule date={dayViewDate} courses={courses} select={setSelected} onBack={()=>setDayViewDate(null)} backLabel="返回完整月视图"/>:<><div className="month-calendar"><div className="weekdays">{weekNames.map(x=><span key={x}>{x.replace("星期","周")}</span>)}</div><div className="month-grid">{monthDays.map(d=>{const key=iso(d), dayCourses=courses.filter(c=>c.date===key);return <div key={key} className={`month-cell ${d.getMonth()!==monthStart.getMonth()?"outside":""} ${key===today?"today":""} ${key===selectedDay?"selected":""}`}><button className="date-btn" onClick={()=>setSelectedDay(key)}><b>{d.getDate()}</b>{dayCourses.length>0&&<small>{dayCourses.length}节</small>}</button><div className="month-courses">{dayCourses.map(c=>{const p=palette[c.course_type]||palette.other;return <button aria-label={c.course_name} title={c.course_name} key={c.id} style={{"--color":p.color,"--soft":p.soft}} onClick={()=>{setSelectedDay(key);setSelected(c)}}><i/><span>{c.course_name}</span></button>})}</div></div>})}</div></div><Panel title={`${selectedDay.replaceAll("-",".")} 课程`} count={courses.filter(c=>c.date===selectedDay).length}>{courses.some(c=>c.date===selectedDay)?<div className="course-list">{courses.filter(c=>c.date===selectedDay).map(c=><CourseCard key={c.id} c={c} onClick={()=>setSelected(c)}/>)}</div>:<div className="day-empty">当天暂无课程</div>}</Panel><Legend/></>}</section>}
      {tab==="profile"&&<section className="page"><div className="hero"><GraduationCap size={34}/><div><small>2025级全日制 {majorInfo.short}</small><h1>{majorInfo.label}专硕课程空间</h1><p>把课程安排变成清晰、可靠的日常。</p></div></div><div className="stats"><Stat icon={<BookOpenCheck/>} label="当前课程" value={courses.length} note="条已发布安排"/><Stat icon={<Database/>} label="当前版本" value={version?.label||"v1.0"} note={synced?"已连接最新数据":"正在同步专业课程"}/><Stat icon={<Clock3/>} label="更新时间" value={(version?.updated_at||"").slice(0,10).replaceAll("-",".")||"—"} note="管理员审核后生效"/></div><div className="major-profile"><GraduationCap/><span><strong>当前专业：{majorInfo.label}</strong><small>系统会在微信浏览器中记住本次选择。</small></span><button onClick={()=>setShowMajorPicker(true)}>切换专业</button></div><div className="safe"><ShieldCheck/><span><strong>管理员专属发布</strong><small>只有管理员可以上传、审核和发布PDF。</small></span><a href={ADMIN_URL} target="_blank" rel="noreferrer">进入后台</a></div></section>}
    </main>
    <nav className="bottom">{nav.map(n=><button key={n.id} className={tab===n.id?"active":""} onClick={()=>openTab(n.id)}><n.icon size={20}/><span>{n.label}</span></button>)}</nav>
    {selected&&<Modal c={selected} close={()=>setSelected(null)}/>} 
    {showMajorPicker&&<MajorPicker current={major} choose={chooseMajor} close={major?()=>setShowMajorPicker(false):null}/>} 
  </div>;
}

function Header({eyebrow,title,sub,actions}){return <header><div><em>{eyebrow}</em><h1>{title}</h1><p>{sub}</p></div>{actions}</header>}
function MenuPage({menu,version,date,setDate,meal,setMeal,beijing,automaticMeal}){const menuDays=menu?.days||[];useEffect(()=>{if(menuDays.length&&!menuDays.some(item=>item.date===date)){const target=menuDays.find(item=>item.date===beijing.date)||menuDays[0];setDate(target.date)}},[menu?.week_start,date,beijing.date]);const selectedDate=dateOf(date);const day=menuDays.find(item=>item.date===date);const categories=day?.meals?.[meal]||{};const itemCount=Object.values(categories).reduce((total,items)=>total+items.length,0);const mealMeta={breakfast:{icon:Coffee,note:"00:00–09:00"},lunch:{icon:Soup,note:"09:00–14:00"},dinner:{icon:MoonStar,note:"14:00–24:00"}};return <section className="page menu-page"><Header eyebrow="TODAY'S MENU" title="今天吃什么？" sub={`北京时间 ${beijing.time} · ${date===beijing.date?"今日菜单":`${selectedDate.getMonth()+1}月${selectedDate.getDate()}日菜单`}`} actions={<label className="menu-week-select"><CalendarDays/><span><small>选择本周日期</small><strong>{day?.weekday||"本周"} · {date.slice(5).replace("-","/")}</strong></span><select value={day?.date||""} onChange={event=>setDate(event.target.value)} disabled={!menuDays.length}>{menuDays.map(item=><option key={item.date} value={item.date}>{item.weekday} · {item.date.slice(5).replace("-","月")}日</option>)}</select></label>}/><div className="menu-banner"><div><span><UtensilsCrossed/></span><div><small>{day?.weekday||["星期日","星期一","星期二","星期三","星期四","星期五","星期六"][selectedDate.getDay()]}</small><h2>{date.replaceAll("-",".")}</h2><p>{date===beijing.date?`${mealLabels[automaticMeal]}时段 · 系统已按北京时间自动定位`:"点击上方日期可选择本周星期一至星期日"}</p></div></div><aside><small>菜单版本</small><strong>{version?.label||"—"}</strong></aside></div><div className="meal-tabs">{Object.entries(mealLabels).map(([key,label])=>{const MetaIcon=mealMeta[key].icon;return <button key={key} className={meal===key?"active":""} onClick={()=>setMeal(key)}><MetaIcon/><span><strong>{label}</strong><small>{mealMeta[key].note}</small></span>{date===beijing.date&&key===automaticMeal&&<em>当前</em>}</button>})}</div>{day&&itemCount?<div className="menu-sheet"><div className="menu-sheet-head"><div><small>{mealLabels[meal].toUpperCase()} MENU</small><h2>{day.weekday} · {mealLabels[meal]}</h2></div><span>{itemCount} 道</span></div><div className="menu-category-list">{Object.entries(categories).map(([category,items],index)=>items.length?<article key={category} className={index%2?"alternate":""}><div><i>{String(index+1).padStart(2,"0")}</i><strong>{category}</strong></div><ul>{items.map((item,itemIndex)=><li key={`${item}-${itemIndex}`}>{item}</li>)}</ul></article>:null)}</div><footer>菜单以食堂当天实际供应为准</footer></div>:<div className="menu-empty"><Soup/><h2>当天暂无{mealLabels[meal]}菜单</h2><p>{menu?"可以选择本周其他日期或切换早餐、午餐、晚餐。":"管理员发布一周菜单后，这里会自动显示每日菜品。"}</p></div>}</section>}
function TermOverview({total,passed,remaining,todayCount,next,now}){const progress=total?Math.round(passed/total*100):0;const diff=next?new Date(`${next.date}T${next.start_time}:00`).getTime()-now.getTime():null;const countdown=diff===null?(total?"本学期已结束":"暂无课程"):diff>=86400000?`${Math.floor(diff/86400000)}天${Math.floor(diff%86400000/3600000)||""}${Math.floor(diff%86400000/3600000)?"小时":""}`:diff>=3600000?`${Math.floor(diff/3600000)}小时${Math.floor(diff%3600000/60000)||""}${Math.floor(diff%3600000/60000)?"分钟":""}`:`${Math.max(1,Math.ceil(diff/60000))}分钟`;return <section className="term-overview"><div className="term-overview-head"><span><small>SEMESTER OVERVIEW</small><strong>本学期进度</strong></span><b>{progress}%</b></div><div className="term-progress"><i style={{width:`${progress}%`}}/></div><div className="term-metrics"><article><small>已上课程</small><strong>{passed}<em>门</em></strong></article><article><small>剩余课程</small><strong>{remaining}<em>门</em></strong></article><article><small>今日课程</small><strong>{todayCount}<em>节</em></strong></article><article className="countdown"><small>距离下一节课</small><strong>{countdown}</strong></article></div>{next&&<div className="term-next"><Clock3/><span><small>下一节 · {next.course_name}</small><strong>{next.date} {next.weekday} · {next.start_time}{next.classroom?` · ${next.classroom}`:""}</strong></span></div>}</section>}
function HolidayCard({now}){const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());const holiday=officialHolidays.find(item=>new Date(`${item.end}T23:59:59`)>=today);if(!holiday)return <section className="holiday-card holiday-empty"><div className="holiday-icon">🎉</div><div className="holiday-info"><small>法定节假日</small><h2>本年度假期已结束</h2><p>下一年度安排以国务院办公厅发布为准</p></div><a href={holidaySource} target="_blank" rel="noreferrer">查看官方安排</a></section>;const start=new Date(`${holiday.start}T00:00:00`);const days=Math.max(0,Math.ceil((start-today)/86400000));const [year,month,date]=holiday.start.split("-").map(Number);const [,endMonth,endDate]=holiday.end.split("-").map(Number);return <section className="holiday-card"><div className="holiday-icon">🎉</div><div className="holiday-info"><small>下一个假期</small><h2>{holiday.name}</h2><p>{year}年{month}月{date}日 · {month===endMonth?`${month}月${date}日至${endDate}日`:`${month}月${date}日至${endMonth}月${endDate}日`} · 共{holiday.days}天</p><a href={holidaySource} target="_blank" rel="noreferrer">国务院办公厅官方安排</a></div><div className={`holiday-countdown ${days===0?"active":""}`}>{days===0?<><small>现在</small><strong>假期进行中</strong></>:<><small>还有</small><strong>{days}<em>天</em></strong></>}</div></section>}
function CourseSearch({query,setQuery,results,select}){const active=query.trim().length>0;return <div className="today-search"><label>搜索课程</label><div><Search/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="课程、教师、日期或教室"/>{active&&<button aria-label="清空搜索" onClick={()=>setQuery("")}><X/></button>}</div>{active&&<div className="search-results-popover">{results.length?results.map(course=><button key={course.id} onClick={()=>select(course)}><span><strong>{course.course_name}</strong><small>{course.date} · {course.teacher||"教师待定"}{course.classroom?` · ${course.classroom}`:""}</small></span><ChevronRight/></button>):<p>没有找到相关课程</p>}</div>}</div>}
function Pager({prev,next,anchor,courses,onSelectDate,selectedDate}){const [open,setOpen]=useState(false);const [pickerMonth,setPickerMonth]=useState(firstMonth(anchor));const anchorKey=iso(anchor);useEffect(()=>{if(open)setPickerMonth(firstMonth(anchor));},[open,anchorKey]);const start=monday(firstMonth(pickerMonth)),days=Array.from({length:42},(_,i)=>addDays(start,i)),courseDates=new Set(courses.map(c=>c.date));const pickerLabel=selectedDate?`${dateOf(selectedDate).getMonth()+1}月${dateOf(selectedDate).getDate()}日`:"选日期";return <div className="pager"><button aria-label="上一页" onClick={prev}><ChevronLeft/></button><button className="current-picker" aria-expanded={open} onClick={()=>setOpen(value=>!value)}><CalendarDays size={17}/>{pickerLabel}</button><button aria-label="下一页" onClick={next}><ChevronRight/></button>{open&&<div className="date-popover"><div className="date-popover-head"><button aria-label="上个月" onClick={()=>setPickerMonth(addMonths(pickerMonth,-1))}><ChevronLeft/></button><strong>{pickerMonth.getFullYear()}年{pickerMonth.getMonth()+1}月</strong><button aria-label="下个月" onClick={()=>setPickerMonth(addMonths(pickerMonth,1))}><ChevronRight/></button></div><div className="mini-weekdays">{["一","二","三","四","五","六","日"].map(x=><span key={x}>{x}</span>)}</div><div className="mini-calendar">{days.map(day=>{const key=iso(day);return <button key={key} className={`${day.getMonth()!==pickerMonth.getMonth()?"outside":""} ${key===anchorKey?"selected":""} ${key===iso(new Date())?"today":""}`} onClick={()=>{onSelectDate(day);setOpen(false)}}><span>{day.getDate()}</span>{courseDates.has(key)&&<i/>}</button>})}</div><button className="date-today" onClick={()=>{const date=new Date();onSelectDate(date);setOpen(false)}}>回到今天</button></div>}</div>}
function Panel({title,count,children}){return <div className="panel"><div className="panel-head"><h2>{title}</h2><span>{count} 节</span></div>{children}</div>}
function DaySchedule({date,courses,select,onBack,backLabel}){const dayCourses=courses.filter(course=>course.date===date);return <div className="day-view"><div className="day-view-toolbar"><span><CalendarDays/>已选择 {date}</span><button onClick={onBack}>{backLabel}</button></div><Panel title={`${date.replaceAll("-",".")} 课程`} count={dayCourses.length}>{dayCourses.length?<div className="course-list">{dayCourses.map(course=><CourseCard key={course.id} c={course} onClick={()=>select(course)}/>)}</div>:<div className="selected-day-empty"><CalendarDays/><h3>当天暂无课程</h3><p>可以点击上方日期，继续选择其他日期。</p></div>}</Panel></div>}
function Empty({first,onGo}){return <div className="empty"><BookOpenCheck/><h3>今日暂无课程</h3><p>{first?`本学期课程将于 ${first} 开始`:"暂无课程安排"}</p><button onClick={onGo}>浏览本学期安排</button></div>}
function CourseCard({c,onClick}){const p=palette[c.course_type]||palette.other;return <button className="course" style={{"--color":p.color,"--soft":p.soft}} onClick={onClick}><i/><div><small>{p.label}</small><h3>{c.course_name}</h3><p><span><UserRound size={14}/>{c.teacher||"教师待定"}</span><span><Clock3 size={14}/>{c.start_time}–{c.end_time}</span>{c.classroom&&<span><MapPin size={14}/>{c.classroom}</span>}</p></div><b>{c.period}</b></button>}
function WeekRow({period,days,courses,select}){return <><div className="period"><b>{period}</b><small>{period==="上午"?"08:30":"14:30"}</small></div>{days.map(d=><div className="week-cell" key={`${iso(d)}${period}`}>{courses.filter(c=>c.date===iso(d)&&c.period===period).map(c=>{const p=palette[c.course_type]||palette.other;return <button key={c.id} style={{"--color":p.color,"--soft":p.soft}} onClick={()=>select(c)}><b>{c.course_name}</b><span>{c.teacher}</span></button>})}</div>)}</>}
function MobileWeek({days,courses,today,select}){return <div className="mobile-week">{days.map((d,index)=>{const date=iso(d), dayCourses=courses.filter(c=>c.date===date);return <article className={date===today?"today":""} key={date}><div className="mobile-day-head"><span><b>{weekNames[index]}</b><small>{d.getMonth()+1}月{d.getDate()}日</small></span><em>{dayCourses.length} 节</em></div>{dayCourses.length?<div className="mobile-day-courses">{dayCourses.map(c=>{const p=palette[c.course_type]||palette.other;return <button key={c.id} style={{"--color":p.color,"--soft":p.soft}} onClick={()=>select(c)}><i/><span><strong>{c.course_name}</strong><small>{c.period} {c.start_time}–{c.end_time} · {c.teacher||"教师待定"}</small></span></button>})}</div>:<p className="mobile-no-course">暂无课程</p>}</article>})}</div>}
function Legend(){return <div className="legend">{Object.values(palette).map(p=><span key={p.label}><i style={{background:p.color}}/>{p.label}</span>)}</div>}
function Stat({icon,label,value,note}){return <article><span>{icon}</span><small>{label}</small><strong>{value}</strong><em>{note}</em></article>}
function MajorPicker({current,choose,close}){return <div className="major-backdrop"><section className="major-picker">{close&&<button className="major-close" onClick={close}><X/></button>}<em>SELECT YOUR PROGRAM</em><h2>选择你的专业</h2><p>首次选择后系统会自动记住，下次从微信打开无需重复选择。</p><div>{majors.map(item=><button key={item.id} className={current===item.id?"active":""} onClick={()=>choose(item.id)}><b>{item.short}</b><span><strong>{item.label}专业</strong><small>{item.desc}</small></span><ChevronRight/></button>)}</div><small className="major-hint">可在“我的”页面随时切换专业</small></section></div>}
function Modal({c,close}){const p=palette[c.course_type]||palette.other;return <div className="backdrop" onMouseDown={e=>e.target===e.currentTarget&&close()}><div className="modal"><button className="close" onClick={close}><X/></button><small style={{color:p.color}}>{p.label}</small><h2>{c.course_name}</h2><dl><div><dt>日期</dt><dd>{c.date} · {c.weekday}</dd></div><div><dt>时间</dt><dd>{c.start_time}–{c.end_time}</dd></div><div><dt>教师</dt><dd>{c.teacher||"未填写"}</dd></div><div><dt>班级</dt><dd>{c.class_name||"未填写"}</dd></div><div><dt>教室</dt><dd>{c.classroom||"未填写"}</dd></div><div><dt>备注</dt><dd>{c.remark||"无"}</dd></div></dl></div></div>}
