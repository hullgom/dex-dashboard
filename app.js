/* DEX 대시보드 — 키 없이 동작하는 무료 데이터만 사용
 * 날씨: Open-Meteo (open-meteo.com)
 * 캘린더: Google Calendar 공식 임베드
 * 국내 주식: 네이버 금융 차트 이미지 (TradingView 위젯은 KRX 종목을 지원하지 않음)
 * SOXL: TradingView 심볼 개요 위젯
 */
'use strict';

const TZ = 'Asia/Seoul';
const DEFAULTS = {
  place: '서울', lat: 37.5665, lon: 126.978,
  cals: '', calMode: 'AGENDA', calDark: true, chartDark: false,
  krRange: {},
};
const store = {
  get() {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('dex-dash') || '{}') }; }
    catch { return { ...DEFAULTS }; }
  },
  set(patch) {
    const next = { ...store.get(), ...patch };
    localStorage.setItem('dex-dash', JSON.stringify(next));
    return next;
  },
};
let cfg = store.get();
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

/* ---------- 시계 / 날짜 ---------- */
const fmtTime = new Intl.DateTimeFormat('ko-KR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const fmtSec = new Intl.DateTimeFormat('ko-KR', { timeZone: TZ, second: '2-digit' });
const fmtDate = new Intl.DateTimeFormat('ko-KR', { timeZone: TZ, year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

function partsIn(tz, d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit',
  }).formatToParts(d).map(x => [x.type, x.value]));
  return { wd: p.weekday, min: (+p.hour % 24) * 60 + +p.minute };
}
function marketPill(label, tz, openMin, closeMin) {
  const { wd, min } = partsIn(tz);
  const weekday = !['Sat', 'Sun'].includes(wd);
  const open = weekday && min >= openMin && min < closeMin;
  return `<span class="pill ${open ? 'open' : ''}">${label} ${open ? '장중' : '장마감'}</span>`;
}
let lastDay = '';
function tickClock() {
  const now = new Date();
  $('#time').textContent = fmtTime.format(now);
  $('#seconds').textContent = fmtSec.format(now).padStart(2, '0') + '초';
  const day = fmtDate.format(now);
  if (day !== lastDay) { // 자정이 지나면 날짜 갱신
    if (lastDay) { loadWeather(); renderCalendar(); }
    $('#date').textContent = day; lastDay = day;
  }
  // 공휴일은 반영하지 않음(평일 기준)
  $('#market').innerHTML =
    marketPill('🇰🇷 코스피', TZ, 9 * 60, 15 * 60 + 30) +
    marketPill('🇺🇸 미국', 'America/New_York', 9 * 60 + 30, 16 * 60);
}

/* ---------- 날씨 ---------- */
const WMO = {
  0: ['맑음', '☀️', '🌙'], 1: ['대체로 맑음', '🌤️', '🌙'], 2: ['구름 조금', '⛅', '☁️'], 3: ['흐림', '☁️', '☁️'],
  45: ['안개', '🌫️'], 48: ['짙은 안개', '🌫️'],
  51: ['약한 이슬비', '🌦️'], 53: ['이슬비', '🌦️'], 55: ['강한 이슬비', '🌧️'],
  56: ['어는 이슬비', '🌧️'], 57: ['어는 이슬비', '🌧️'],
  61: ['약한 비', '🌦️'], 63: ['비', '🌧️'], 65: ['강한 비', '🌧️'],
  66: ['어는 비', '🌧️'], 67: ['어는 비', '🌧️'],
  71: ['약한 눈', '🌨️'], 73: ['눈', '🌨️'], 75: ['폭설', '❄️'], 77: ['싸락눈', '🌨️'],
  80: ['소나기', '🌦️'], 81: ['소나기', '🌧️'], 82: ['강한 소나기', '⛈️'],
  85: ['눈 소나기', '🌨️'], 86: ['강한 눈 소나기', '❄️'],
  95: ['뇌우', '⛈️'], 96: ['우박 동반 뇌우', '⛈️'], 99: ['우박 동반 뇌우', '⛈️'],
};
const wx = (code, isDay = 1) => {
  const w = WMO[code] || ['-', '·'];
  return { text: w[0], icon: (!isDay && w[2]) ? w[2] : w[1] };
};
// 한국 환경부 기준 등급
const pmGrade = (v, kind) => {
  if (v == null) return '--';
  const [g, n, b] = kind === 'pm10' ? [30, 80, 150] : [15, 35, 75];
  const label = v <= g ? '좋음' : v <= n ? '보통' : v <= b ? '나쁨' : '매우나쁨';
  const color = v <= g ? '#5fa8ff' : v <= n ? '#5fdc8f' : v <= b ? '#ffb454' : '#ff5a5f';
  return `<span style="color:${color}">${label}</span> ${Math.round(v)}`;
};
const WD = ['일', '월', '화', '수', '목', '금', '토'];

async function loadWeather() {
  const { lat, lon } = cfg;
  const q = new URLSearchParams({
    latitude: lat, longitude: lon, timezone: TZ, forecast_days: 7,
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day',
    hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    wind_speed_unit: 'ms',
  });
  try {
    const [w, a] = await Promise.all([
      fetch(`https://api.open-meteo.com/v1/forecast?${q}`).then(r => r.json()),
      fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&timezone=${TZ}&current=pm10,pm2_5`)
        .then(r => r.json()).catch(() => null),
    ]);
    const c = w.current, now = wx(c.weather_code, c.is_day);
    $('#w-place').textContent = cfg.place || '';
    $('#w-icon').textContent = now.icon;
    $('#w-temp').textContent = `${Math.round(c.temperature_2m)}°`;
    $('#w-desc').textContent = now.text;
    $('#w-feel').textContent = `${Math.round(c.apparent_temperature)}°`;
    $('#w-hilo').textContent = `${Math.round(w.daily.temperature_2m_max[0])}° / ${Math.round(w.daily.temperature_2m_min[0])}°`;
    $('#w-hum').textContent = `${c.relative_humidity_2m}%`;
    $('#w-wind').textContent = `${c.wind_speed_10m.toFixed(1)}m/s`;
    $('#w-pm10').innerHTML = pmGrade(a?.current?.pm10, 'pm10');
    $('#w-pm25').innerHTML = pmGrade(a?.current?.pm2_5, 'pm25');

    // 앞으로 18시간, 3시간 간격 6칸
    const start = w.hourly.time.findIndex(t => t >= c.time.slice(0, 13));
    const hours = [];
    for (let i = Math.max(start, 0) + 1; hours.length < 6 && i < w.hourly.time.length; i += 3) hours.push(i);
    $('#w-hourly').innerHTML = hours.map(i => {
      const h = +w.hourly.time[i].slice(11, 13);
      const p = w.hourly.precipitation_probability[i];
      return `<div><div class="muted">${h}시</div><div class="ic">${wx(w.hourly.weather_code[i], w.hourly.is_day[i]).icon}</div>
        <div>${Math.round(w.hourly.temperature_2m[i])}°</div><div class="pop">${p ? p + '%' : '&nbsp;'}</div></div>`;
    }).join('');

    $('#w-daily').innerHTML = w.daily.time.slice(1, 6).map((t, k) => {
      const i = k + 1, d = new Date(t + 'T00:00:00');
      const p = w.daily.precipitation_probability_max[i];
      return `<div class="d"><span>${i === 1 ? '내일' : WD[d.getDay()] + '요일'}</span>
        <span>${wx(w.daily.weather_code[i]).icon}</span>
        <span class="pop">${p ? '☔ ' + p + '%' : ''}</span>
        <span class="t">${Math.round(w.daily.temperature_2m_max[i])}° <span class="lo">/ ${Math.round(w.daily.temperature_2m_min[i])}°</span></span></div>`;
    }).join('');
    $('#w-updated').textContent = fmtTime.format(new Date()) + ' 갱신';
  } catch (e) {
    $('#w-desc').textContent = '날씨를 불러오지 못했어요 (10분 뒤 재시도)';
  }
}

/* ---------- 구글 캘린더 ---------- */
function renderCalendar() {
  const body = $('#cal-body');
  const ids = cfg.cals.split(',').map(s => s.trim()).filter(Boolean);
  $$('#cal-mode button').forEach(b => b.classList.toggle('on', b.dataset.mode === cfg.calMode));
  if (!ids.length) {
    body.className = 'cal-body empty';
    body.innerHTML = `오른쪽 아래 <b>⚙ 설정</b>에서 구글 캘린더 ID를 입력하세요.<br>
      <span class="small">기본 캘린더 ID는 보통 내 Gmail 주소입니다.</span>`;
    return;
  }
  const q = new URLSearchParams({
    ctz: TZ, hl: 'ko', mode: cfg.calMode, wkst: '1',
    showTitle: '0', showPrint: '0', showTabs: '0', showCalendars: '0', showTz: '0', showNav: '1', showDate: '1',
  });
  ids.forEach(id => q.append('src', id));
  body.className = 'cal-body' + (cfg.calDark ? ' dark' : '');
  body.innerHTML = `<iframe src="https://calendar.google.com/calendar/embed?${q}" loading="eager" title="Google Calendar"></iframe>`;
}
$$('#cal-mode button').forEach(b => b.addEventListener('click', () => {
  cfg = store.set({ calMode: b.dataset.mode }); renderCalendar();
}));

/* ---------- 국내 주식: 네이버 금융 차트 이미지 ---------- */
function renderKr(card) {
  const code = card.dataset.code;
  const range = cfg.krRange[code] || 'area/day';
  $$('.kr-range button', card).forEach(b => b.classList.toggle('on', b.dataset.r === range));
  const body = $('.stock-body', card);
  body.classList.toggle('dark', !!cfg.chartDark);
  const src = `https://ssl.pstatic.net/imgfinance/chart/item/${range}/${code}.png?t=${Date.now()}`;
  const link = `https://m.stock.naver.com/domestic/stock/${code}/total`;
  let img = $('img', body);
  if (!img) {
    body.innerHTML = '';
    img = new Image();
    img.alt = card.dataset.name + ' 차트';
    img.onerror = () => {
      body.innerHTML = `<div class="fail">차트 이미지를 불러오지 못했어요.<br><a href="${link}" target="_blank" rel="noopener">네이버 증권에서 보기</a></div>`;
    };
    img.onclick = () => window.open(link, '_blank', 'noopener');
    body.appendChild(img);
    const foot = document.createElement('div');
    foot.className = 'stock-foot'; foot.textContent = '네이버 금융';
    body.appendChild(foot);
  }
  img.src = src;
}
$$('.stock-card[data-stock=kr]').forEach(card => {
  $$('.kr-range button', card).forEach(b => b.addEventListener('click', () => {
    cfg = store.set({ krRange: { ...cfg.krRange, [card.dataset.code]: b.dataset.r } });
    renderKr(card);
  }));
});
const refreshKr = () => $$('.stock-card[data-stock=kr]').forEach(renderKr);

/* ---------- 해외 주식: TradingView 위젯 ---------- */
function renderTv(card) {
  const body = $('.stock-body', card);
  const sym = card.dataset.symbol;
  body.innerHTML = '<div class="tradingview-widget-container"><div class="tradingview-widget-container__widget"></div></div>';
  const s = document.createElement('script');
  s.src = 'https://s3.tradingview.com/external-embedding/embed-widget-symbol-overview.js';
  s.async = true;
  s.textContent = JSON.stringify({
    symbols: [[sym.split(':')[1], sym + '|1D']],
    chartOnly: false, width: '100%', height: '100%', autosize: true,
    locale: 'kr', colorTheme: 'dark', isTransparent: true,
    showVolume: false, showMA: false, hideDateRanges: false, hideMarketStatus: false, hideSymbolLogo: false,
    scalePosition: 'right', scaleMode: 'Normal', chartType: 'area',
    lineWidth: 2, lineType: 0, fontSize: '10', noTimeScale: false, valuesTracking: '1',
    changeMode: 'price-and-percent',
    dateRanges: ['1d|1', '5d|5', '1m|30', '3m|60', '12m|1D', '60m|1W'],
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    lineColor: '#6ea8ff', topColor: 'rgba(110,168,255,0.35)', bottomColor: 'rgba(110,168,255,0)',
    gridLineColor: 'rgba(255,255,255,0.04)',
  });
  $('.tradingview-widget-container', body).appendChild(s);
}

/* ---------- 설정 ---------- */
const dlg = $('#settings'), form = $('#settings-form');
$('#btn-settings').addEventListener('click', () => {
  form.place.value = cfg.place; form.lat.value = cfg.lat; form.lon.value = cfg.lon;
  form.cals.value = cfg.cals; form.calDark.checked = cfg.calDark; form.chartDark.checked = cfg.chartDark;
  dlg.showModal();
});
$('#btn-geo').addEventListener('click', () => {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(p => {
    form.lat.value = p.coords.latitude.toFixed(4);
    form.lon.value = p.coords.longitude.toFixed(4);
    if (!form.place.value || form.place.value === DEFAULTS.place) form.place.value = '현재 위치';
  }, () => alert('위치 권한을 허용해 주세요.'));
});
dlg.addEventListener('close', () => {
  if (dlg.returnValue !== 'save') return;
  const lat = parseFloat(form.lat.value), lon = parseFloat(form.lon.value);
  cfg = store.set({
    place: form.place.value.trim(),
    lat: Number.isFinite(lat) ? lat : DEFAULTS.lat,
    lon: Number.isFinite(lon) ? lon : DEFAULTS.lon,
    cals: form.cals.value, calDark: form.calDark.checked, chartDark: form.chartDark.checked,
  });
  loadWeather(); renderCalendar(); refreshKr();
});

/* ---------- 전체화면 / 화면 꺼짐 방지 / 커서 숨김 ---------- */
$('#btn-full').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => {});
});
let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen'); }
  catch { /* 지원 안 하면 무시 */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { keepAwake(); loadWeather(); refreshKr(); }
});
document.addEventListener('click', () => { if (!wakeLock) keepAwake(); }, { once: true });
let idleT;
const wake = () => { document.body.classList.remove('idle'); clearTimeout(idleT); idleT = setTimeout(() => document.body.classList.add('idle'), 4000); };
['mousemove', 'touchstart', 'keydown'].forEach(ev => document.addEventListener(ev, wake, { passive: true }));

/* ---------- 시작 ---------- */
tickClock(); setInterval(tickClock, 1000);
loadWeather(); setInterval(loadWeather, 10 * 60 * 1000);
renderCalendar(); setInterval(renderCalendar, 30 * 60 * 1000); // 30분마다 캘린더 새로고침
refreshKr(); setInterval(refreshKr, 60 * 1000);                 // 1분마다 국내 차트 새로고침
$$('.stock-card[data-stock=us]').forEach(renderTv);
keepAwake(); wake();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
