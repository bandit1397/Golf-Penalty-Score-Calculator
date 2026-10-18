import { computeHole, computeRound, scoreName, fmtToPar, MODE_LABEL } from './engine.js';
import { CATEGORIES, SITUATIONS, LOCAL_RULES, DEFAULT_LOCAL, availability, buildEvent, penaltyOf } from './rules.js';
import { voiceSupported, listenOnce, speak } from './voice.js';

// ───────────── 저장소 (기기 안에 자동 저장) ─────────────
const KEY = 'smart-golf-score/v1';
const DEFAULT_PARS = [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4];

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && typeof d === 'object') return { round: null, courses: [], history: [], prefs: {}, ...d };
  } catch {}
  return { round: null, courses: [], history: [], prefs: {} };
}
let db = load();
db.prefs = { vibrate: true, speak: false, voice: false, wake: true, big: false, theme: 'auto', ...db.prefs };

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    toast('저장 공간이 부족해 저장하지 못했습니다.');
  }
}

// ───────────── 화면 상태 ─────────────
const ui = { tab: 'play', sheet: null, armed: null, histOpen: null, ruleQuery: '' };
const $app = document.getElementById('app');
const $sheet = document.getElementById('sheet');
const $toast = document.getElementById('toast');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const buzz = (ms = 15) => db.prefs.vibrate && navigator.vibrate?.(ms);
let toastTimer;
function toast(msg) {
  $toast.textContent = msg;
  $toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($toast.hidden = true), 2600);
}

// ───────────── 라운드 계산 도우미 ─────────────
const R = () => db.round;
const curIdx = () => R().current;
const curHole = () => R().holes[curIdx()];
const holeRes = (i = curIdx()) => computeHole({ par: R().pars[i], events: R().holes[i].events }, { doubleParCap: R().doubleParCap });
const ctxFor = (i = curIdx()) => ({ local: R().local, casual: R().casual, provisionalActive: !!holeRes(i).provisional, par: R().pars[i] });

function addEvent(ev) {
  const before = holeRes();
  if (before.holed && !['set_total', 'note'].includes(ev.type)) {
    toast('이미 홀아웃한 홀입니다. 수정하려면 되돌리기를 사용하세요.');
    return false;
  }
  curHole().events.push({ ...ev, t: Date.now() });
  save();
  buzz();
  const after = holeRes();
  if (after.holed && !before.holed) announceHoleDone(after);
  else if (db.prefs.speak) speak(after.provisional ? `잠정구 ${after.provisional.next}타째` : `${after.next}타째`);
  return true;
}

function announceHoleDone(r) {
  const name = scoreName(r.total, r.par);
  toast(`${curIdx() + 1}번 홀 ${r.total}타 · ${name}`);
  if (db.prefs.speak) speak(`${r.total}타, ${name}`);
}

function undo() {
  const ev = curHole().events.pop();
  if (!ev) return toast('되돌릴 기록이 없습니다.');
  save();
  buzz(30);
  toast(`되돌림: ${ev.label || evName(ev)}`);
  render();
}

const evName = (e) => ({ stroke: e.putt ? '퍼트' : '샷', holeout: '홀아웃', set_total: '직접 입력' })[e.type] || e.type;

function goHole(i) {
  if (i < 0 || i > 17) return;
  R().current = i;
  save();
  render();
}

function nextUnplayed(from) {
  for (let k = 1; k <= 18; k++) {
    const i = (from + k) % 18;
    if (!holeRes(i).holed) return i;
  }
  return null;
}

// ───────────── 렌더링 ─────────────
function render() {
  document.documentElement.dataset.theme = db.prefs.theme;
  document.body.classList.toggle('big', !!db.prefs.big);
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === ui.tab);
  const view = { play: viewPlay, card: viewCard, rules: viewRules, settings: viewSettings }[ui.tab];
  $app.innerHTML = view();
  renderSheet();
}

function modeBadge(mode) {
  return `<span class="badge mode-${mode}">${MODE_LABEL[mode]}</span>`;
}

function viewStart() {
  const last = db.history[0];
  return `
  <section class="hero">
    <div class="logo">⛳</div>
    <h1>스마트 골프 스코어</h1>
    <p>샷마다 버튼 한 번. OB·해저드·잠정구·언플레이어블은 질문에 답하면<br>벌타와 <b>다음 몇 타째인지</b>, <b>어디서 칠지</b> 알려 드립니다.</p>
    <button class="btn primary xl" data-act="newRound">라운드 시작</button>
    ${last ? `<p class="muted small">최근 라운드: ${esc(last.courseName)} ${esc(last.date)} · ${last.total}타 (${fmtToPar(last.toPar)})</p>` : ''}
  </section>
  <section class="card">
    <h3>계산 원칙</h3>
    <ul class="plain">
      <li><b>스코어 = 실제로 친 타수 + 벌타</b></li>
      <li>OB·분실구는 1벌타 후 <b>직전 위치에서 다시</b> (티샷 OB → 재티샷은 3타째)</li>
      <li>잠정구는 원구를 찾으면 <b>잠정구 타수 전부 취소</b></li>
      <li>OB티·해저드티는 <b>골프장 로컬룰</b>대로 설정해서 계산</li>
      <li>기록을 고치면 전체 스코어가 자동으로 다시 계산됩니다</li>
    </ul>
  </section>`;
}

function viewPlay() {
  if (!R()) return viewStart();
  const i = curIdx();
  const r = holeRes(i);
  const all = computeRound(R());
  const par = R().pars[i];
  const quick = [
    ['ob', 'OB'],
    ['pa', '해저드'],
    ['lost', '분실구'],
    ['prov', '잠정구'],
    ['unplayable', '언플레이어블'],
    ['obstruction', '카트도로'],
  ];

  let center;
  if (r.holed) {
    center = `
      <section class="big done">
        <div class="label">${i + 1}번 홀 결과</div>
        <div class="num">${r.total}<small>타</small></div>
        <div class="scorename s${clampDiff(r.toPar)}">${scoreName(r.total, par)} ${r.toPar ? `(${fmtToPar(r.toPar)})` : ''}</div>
        <div class="breakdown">샷 ${r.strokes} · 벌타 ${r.penalties} · 퍼트 ${r.putts}${r.capped ? ' · 더블파 상한 적용' : ''}${r.manual ? ' · 직접 입력' : ''}</div>
      </section>
      <div class="row">
        <button class="btn" data-act="undo">↶ 되돌리기</button>
        <button class="btn" data-act="manual">✎ 타수 수정</button>
      </div>
      ${i < 17 || nextUnplayed(i) != null ? `<button class="btn primary xl" data-act="nextHole">다음 홀 ▶</button>` : `<button class="btn primary xl" data-act="tab" data-tab="card">스코어카드 보기</button>`}`;
  } else {
    const pv = r.provisional;
    center = `
      <section class="big">
        <div class="label">다음 샷은</div>
        <div class="num">${pv ? pv.next : r.next}<small>타째</small></div>
        <div class="breakdown">샷 ${r.strokes} · 벌타 ${r.penalties} · 퍼트 ${r.putts}</div>
      </section>
      ${
        pv
          ? `<section class="prov">
        <div class="prov-head">🟡 잠정구 진행 중</div>
        <div class="prov-grid">
          <div><span>원구를 찾으면</span><b>${pv.originalNext}타째</b><em>잠정구 ${pv.strokes}타 취소</em></div>
          <div><span>잠정구로 계속하면</span><b>${pv.next}타째</b><em>1벌타 포함</em></div>
        </div>
        <div class="row">
          <button class="btn ok" data-act="resolve" data-keep="original">원구 찾음<br><small>OB 아님·3분 내</small></button>
          <button class="btn warn" data-act="resolve" data-keep="provisional">원구 OB·분실<br><small>잠정구 인플레이</small></button>
        </div>
        <button class="btn ghost" data-act="sit" data-sit="provres">다른 경우 (해저드에서 발견 등)</button>
      </section>`
          : ''
      }
      <div class="pad">
        <button class="btn shot" data-act="stroke">샷 +1<small>${pv ? '잠정구' : `${r.next}타째 기록`}</small></button>
        <button class="btn putt" data-act="putt" ${pv ? 'disabled' : ''}>퍼트 +1</button>
      </div>
      <button class="btn alert xl" data-act="wizard">⚠ 상황 발생 <small>OB·해저드·벌타·구제</small></button>
      <div class="chips">${quick.map(([id, t]) => `<button class="chip" data-act="sit" data-sit="${id}">${t}</button>`).join('')}</div>
      <div class="row three">
        <button class="btn" data-act="undo">↶ 되돌리기</button>
        <button class="btn" data-act="manual">✎ 직접 입력</button>
        <button class="btn ok" data-act="holeout" ${r.strokes === 0 || pv ? 'disabled' : ''}>⛳ 홀아웃</button>
      </div>
      ${R().casual ? `<div class="row"><button class="btn ghost" data-act="sit" data-sit="ok">OK(컨시드)</button><button class="btn ghost" data-act="sit" data-sit="pickup">기브업(양파)</button></div>` : ''}`;
  }

  return `
  <header class="top">
    <div class="course">${esc(R().courseName)} ${modeBadge(all.mode)}</div>
    <div class="sum">
      <div><span>총 타수</span><b>${all.all.total}</b></div>
      <div><span>파 대비</span><b class="${all.all.toPar > 0 ? 'over' : all.all.toPar < 0 ? 'under' : ''}">${fmtToPar(all.all.done ? all.all.toPar : null)}</b></div>
      <div><span>완료</span><b>${all.all.done}/18</b></div>
    </div>
  </header>
  <section class="holehead">
    <button class="nav" data-act="prev" ${i === 0 ? 'disabled' : ''} aria-label="이전 홀">◀</button>
    <div class="ht">
      <div class="hn">${i + 1}<small>번 홀</small></div>
      <button class="par" data-act="cyclePar" title="눌러서 파 변경">PAR ${par} ✎</button>
    </div>
    <button class="nav" data-act="next" ${i === 17 ? 'disabled' : ''} aria-label="다음 홀">▶</button>
    ${db.prefs.voice && voiceSupported ? `<button class="mic" data-act="mic" aria-label="음성 명령">🎤</button>` : ''}
  </section>
  ${r.warnings.map((w) => `<div class="warnbox">⚠ ${esc(w)}</div>`).join('')}
  ${center}
  ${viewLog(r)}
  ${viewStrip(all)}`;
}

const clampDiff = (d) => (d == null ? 'x' : Math.max(-2, Math.min(3, d)));

function viewLog(r) {
  if (!r.log.length) return `<section class="log empty">첫 샷을 기록해 보세요. 문제가 생기면 <b>⚠ 상황 발생</b>을 누르세요.</section>`;
  const items = r.log
    .map(
      (l) => `<li class="k-${l.kind || ''} m-${l.mode}">
      <div class="lt">${esc(l.text)}${l.mode !== 'official' ? ` ${modeBadge(l.mode)}` : ''}</div>
      ${l.label && l.label !== l.text ? `<div class="ld">${esc(l.label)}</div>` : ''}
      <div class="ln">→ 다음 ${l.next}타째</div></li>`
    )
    .reverse()
    .join('');
  return `<section class="log"><h3>이 홀 기록</h3><ol>${items}</ol></section>`;
}

function viewStrip(all) {
  return `<section class="strip" aria-label="홀 이동">${all.holes
    .map(
      (h, i) => `<button class="hc ${i === curIdx() ? 'cur' : ''} ${h.holed ? 'done' : h.started ? 'go' : ''}" data-act="go" data-i="${i}">
      <span>${i + 1}H</span><b class="s${h.holed ? clampDiff(h.toPar) : 'x'}">${h.holed ? h.total : h.started ? '…' : '–'}</b><em>P${h.par}</em></button>`
    )
    .join('')}</section>`;
}

// ───────────── 스코어카드 ─────────────
function cardTable(round, res, from, live = false) {
  const idx = Array.from({ length: 9 }, (_, k) => from + k);
  const part = from === 0 ? res.front : res.back;
  const cell = (h) => (h.holed ? `<span class="sc s${clampDiff(h.toPar)}">${h.total}</span>` : h.started ? '…' : '');
  return `<div class="tablewrap"><table class="sctable">
    <tr><th>홀</th>${idx.map((i) => `<th>${i + 1}</th>`).join('')}<th>${from ? 'IN' : 'OUT'}</th></tr>
    <tr class="parrow"><td>파</td>${idx.map((i) => `<td>${round.pars[i]}</td>`).join('')}<td>${part.par}</td></tr>
    <tr class="scorerow"><td>타수</td>${idx.map((i) => (live ? `<td data-act="go" data-i="${i}">${cell(res.holes[i])}</td>` : `<td>${cell(res.holes[i])}</td>`)).join('')}<td><b>${part.done ? part.total : ''}</b></td></tr>
    <tr><td>±</td>${idx.map((i) => `<td>${res.holes[i].holed ? fmtToPar(res.holes[i].toPar) : ''}</td>`).join('')}<td>${part.done ? fmtToPar(part.toPar) : ''}</td></tr>
    <tr class="sub"><td>벌타</td>${idx.map((i) => `<td>${res.holes[i].penalties || ''}</td>`).join('')}<td>${part.penalties || ''}</td></tr>
    <tr class="sub"><td>퍼트</td>${idx.map((i) => `<td>${res.holes[i].putts || ''}</td>`).join('')}<td>${part.putts || ''}</td></tr>
  </table></div>`;
}

function stats(res) {
  const c = { eagle: 0, birdie: 0, par: 0, bogey: 0, double: 0 };
  for (const h of res.holes)
    if (h.holed) {
      const d = h.toPar;
      if (d <= -2) c.eagle++;
      else if (d === -1) c.birdie++;
      else if (d === 0) c.par++;
      else if (d === 1) c.bogey++;
      else c.double++;
    }
  return `<div class="stats">
    <div><b>${c.eagle}</b><span>이글↑</span></div><div><b>${c.birdie}</b><span>버디</span></div><div><b>${c.par}</b><span>파</span></div>
    <div><b>${c.bogey}</b><span>보기</span></div><div><b>${c.double}</b><span>더블↑</span></div></div>`;
}

function viewCard() {
  let html = '';
  if (R()) {
    const res = computeRound(R());
    html += `<section class="card">
      <div class="cardhead"><h2>${esc(R().courseName)}</h2>${modeBadge(res.mode)}</div>
      <div class="muted small">${esc(R().date)} · ${R().casual ? '친선 라운드' : '공식 규칙'}${R().doubleParCap ? ' · 더블파 상한' : ''}</div>
      <div class="total"><b>${res.all.total}</b>타 <span class="${res.all.toPar > 0 ? 'over' : 'under'}">${fmtToPar(res.all.done ? res.all.toPar : null)}</span> <small>(${res.all.done}/18홀)</small></div>
      ${cardTable(R(), res, 0, true)}${cardTable(R(), res, 9, true)}
      ${stats(res)}
      <div class="muted small">벌타 합계 ${res.all.penalties} · 퍼트 합계 ${res.all.putts}</div>
      <p class="muted small">점수를 누르면 그 홀로 이동합니다. ${res.mode !== 'official' ? '로컬룰·친선 처리가 포함된 홀이 있어 공식 기록과 다를 수 있습니다.' : ''}</p>
      <div class="row"><button class="btn" data-act="share">📤 결과 공유</button>
      <button class="btn ${ui.armed === 'finish' ? 'danger' : 'primary'}" data-act="finish">${ui.armed === 'finish' ? '한 번 더 누르면 종료' : '라운드 종료·저장'}</button></div>
    </section>`;
  } else {
    html += `<section class="card"><p>진행 중인 라운드가 없습니다.</p><button class="btn primary" data-act="newRound">라운드 시작</button></section>`;
  }
  html += `<section class="card"><h3>지난 라운드</h3>${
    db.history.length
      ? `<ul class="hist">${db.history
          .map((h) => {
            const open = ui.histOpen === h.id;
            const res = open ? computeRound(h) : null;
            return `<li><button class="histrow" data-act="hist" data-id="${h.id}"><span>${esc(h.date)}</span><span class="grow">${esc(h.courseName)}</span><b>${h.total}</b><span>${fmtToPar(h.toPar)}</span></button>
              ${open ? `${cardTable(h, res, 0)}${cardTable(h, res, 9)}<button class="btn small ${ui.armed === 'del' + h.id ? 'danger' : 'ghost'}" data-act="delHist" data-id="${h.id}">${ui.armed === 'del' + h.id ? '한 번 더 누르면 삭제' : '삭제'}</button>` : ''}</li>`;
          })
          .join('')}</ul>`
      : '<p class="muted">저장된 라운드가 없습니다.</p>'
  }</section>`;
  return html;
}

// ───────────── 규칙 안내 ─────────────
function viewRules() {
  const q = ui.ruleQuery.trim();
  const match = (s) => !q || (s.title + (s.summary || '')).includes(q);
  return `
  <section class="card">
    <h2>상황별 규칙 안내</h2>
    <p class="muted small">R&A·USGA 골프 규칙(2023년판) 기준. 상황을 누르면 질문에 따라 벌타·다음 타순·칠 위치를 알려 줍니다. 라운드 중이면 바로 현재 홀에 적용할 수 있습니다.</p>
    <input class="search" type="search" placeholder="검색: OB, 벙커, 카트도로…" value="${esc(q)}" data-input="ruleQuery">
  </section>
  ${CATEGORIES.map((c) => {
    const sits = c.situations.filter(match);
    if (!sits.length) return '';
    return `<section class="card"><h3>${c.icon} ${c.title}</h3><ul class="sitlist">${sits
      .map((s) => `<li><button data-act="sit" data-sit="${s.id}"><b>${esc(s.title)}</b>${s.summary ? `<span>${esc(s.summary)}</span>` : ''}</button></li>`)
      .join('')}</ul></section>`;
  }).join('')}
  <section class="card">
    <h3>알아 두면 좋은 기본</h3>
    <ul class="plain">
      <li><b>클럽 길이</b>: 퍼터를 제외한 가장 긴 클럽(보통 드라이버) 길이.</li>
      <li><b>드롭</b>: 무릎 높이에서 떨어뜨리고 구제구역 안에 멈춰야 함. 두 번 실패하면 플레이스.</li>
      <li><b>스트로크와 거리</b>: 1벌타 후 직전 샷 위치로. 어디서든 쓸 수 있는 최후의 수단.</li>
      <li><b>일반 페널티</b>: 스트로크 플레이 2벌타 (매치 플레이는 그 홀 패).</li>
      <li><b>분실구</b>: 찾기 시작 후 3분.</li>
      <li><b>OB티·해저드티</b>: 정식 규칙이 아니라 골프장 로컬룰. 몇 타째로 치는지는 골프장 안내를 따르세요.</li>
    </ul>
    <p class="muted small">이 앱은 아마추어 라운드용 안내 도구입니다. 공식 대회에서는 위원회 판정이 우선합니다.</p>
  </section>`;
}

// ───────────── 설정 ─────────────
function localRuleControls(local, prefix) {
  const row = (key, extra = '') => `
    <label class="tog"><input type="checkbox" data-act="${prefix}Local" data-key="${key}" ${local[key] ? 'checked' : ''}><span>${LOCAL_RULES[key].name}</span></label>${extra}`;
  const stepper = (key, label) =>
    `<div class="stepper sm"><span>${label}</span><button data-act="${prefix}Pen" data-key="${key}" data-d="-1">−</button><b>${local[key]}벌타</b><button data-act="${prefix}Pen" data-key="${key}" data-d="1">+</button></div>`;
  return `
    ${row('obTee', local.obTee ? stepper('obTeePenalty', `OB티 벌타 (티샷 OB → ${1 + local.obTeePenalty + 1}타째)`) : '')}
    ${row('hazardTee', local.hazardTee ? stepper('hazardTeePenalty', `해저드티 벌타 (티샷 → ${1 + local.hazardTeePenalty + 1}타째)`) : '')}
    ${row('e5')}${row('dropZone')}${row('oppositeSide')}${row('preferredLies')}`;
}

function viewSettings() {
  let html = '';
  if (R()) {
    html += `<section class="card">
      <h2>현재 라운드</h2>
      <label class="field"><span>골프장 이름</span><input type="text" value="${esc(R().courseName)}" data-input="courseName"></label>
      <div class="seg">
        <button class="${R().casual ? '' : 'on'}" data-act="setCasual" data-v="0">공식 규칙</button>
        <button class="${R().casual ? 'on' : ''}" data-act="setCasual" data-v="1">친선 라운드</button>
      </div>
      <p class="muted small">친선 라운드에서는 OK(컨시드)·멀리건·기브업(양파)·일파만파를 쓸 수 있고 기록에 ‘비공식’ 표시가 붙습니다.</p>
      <label class="tog"><input type="checkbox" data-act="toggleCap" ${R().doubleParCap ? 'checked' : ''}><span>홀당 최대 타수를 더블파로 제한 (양파 상한)</span></label>
      <h3>홀별 파 <small class="muted">(눌러서 3→4→5→6)</small></h3>
      <div class="pargrid">${R()
        .pars.map((p, i) => `<button data-act="parAt" data-i="${i}"><span>${i + 1}</span><b>${p}</b></button>`)
        .join('')}</div>
      <div class="muted small">합계 파 ${R().pars.reduce((a, b) => a + b, 0)}</div>
      <h3>이 골프장 로컬룰</h3>
      <p class="muted small">골프장 안내판·스코어카드·캐디에게 확인한 것만 켜세요. 켜진 항목만 ‘상황 발생’에서 선택할 수 있습니다.</p>
      ${localRuleControls(R().local, 'r')}
      <button class="btn" data-act="saveCourse">💾 이 골프장 설정 저장 (다음 라운드에 재사용)</button>
      <button class="btn ${ui.armed === 'abandon' ? 'danger' : 'ghost'}" data-act="abandon">${ui.armed === 'abandon' ? '한 번 더 누르면 저장 없이 삭제' : '현재 라운드 삭제'}</button>
    </section>`;
  }
  const p = db.prefs;
  html += `<section class="card">
    <h2>앱 설정</h2>
    <label class="tog"><input type="checkbox" data-act="pref" data-key="vibrate" ${p.vibrate ? 'checked' : ''}><span>버튼 진동</span></label>
    <label class="tog"><input type="checkbox" data-act="pref" data-key="speak" ${p.speak ? 'checked' : ''}><span>음성 안내 (다음 타순 읽어주기)</span></label>
    <label class="tog"><input type="checkbox" data-act="pref" data-key="voice" ${p.voice ? 'checked' : ''} ${voiceSupported ? '' : 'disabled'}><span>음성 명령 버튼 🎤 ${voiceSupported ? '' : '(이 브라우저는 지원 안 함)'}</span></label>
    ${p.voice ? `<p class="muted small">예: “샷”, “퍼트”, “티샷 오비”, “해저드”, “잠정구”, “원구 찾았어”, “홀아웃”, “다음 홀”, “취소”, “몇 타야?”</p>` : ''}
    <label class="tog"><input type="checkbox" data-act="pref" data-key="wake" ${p.wake ? 'checked' : ''}><span>라운드 중 화면 꺼짐 방지</span></label>
    <label class="tog"><input type="checkbox" data-act="pref" data-key="big" ${p.big ? 'checked' : ''}><span>큰 글씨</span></label>
    <div class="seg">${['auto', 'light', 'dark']
      .map((t) => `<button class="${p.theme === t ? 'on' : ''}" data-act="theme" data-v="${t}">${{ auto: '자동', light: '밝게(햇빛)', dark: '어둡게' }[t]}</button>`)
      .join('')}</div>
  </section>
  <section class="card">
    <h3>저장된 골프장</h3>
    ${
      db.courses.length
        ? `<ul class="hist">${db.courses
            .map(
              (c, i) =>
                `<li class="histrow static"><span class="grow">${esc(c.name)}</span><span>파 ${c.pars.reduce((a, b) => a + b, 0)}</span><button class="btn small ${ui.armed === 'delc' + i ? 'danger' : 'ghost'}" data-act="delCourse" data-i="${i}">${ui.armed === 'delc' + i ? '삭제 확인' : '삭제'}</button></li>`
            )
            .join('')}</ul>`
        : '<p class="muted small">라운드 설정에서 ‘이 골프장 설정 저장’을 누르면 여기에 추가됩니다.</p>'
    }
  </section>
  <section class="card">
    <h3>데이터</h3>
    <p class="muted small">모든 기록은 이 휴대폰 브라우저 안에만 저장됩니다(인터넷 없이도 동작). 기기를 바꾸기 전에 백업하세요.</p>
    <div class="row"><button class="btn" data-act="export">백업 파일 저장</button><label class="btn file">백업 불러오기<input type="file" accept="application/json" data-act="import" hidden></label></div>
  </section>
  <p class="muted small center">스마트 골프 스코어 · R&A/USGA 골프 규칙 2023 기준</p>`;
  return html;
}

// ───────────── 시트(팝업) ─────────────
function openSheet(s) {
  ui.sheet = s;
  renderSheet();
}
function closeSheet() {
  ui.sheet = null;
  renderSheet();
}

function renderSheet() {
  const s = ui.sheet;
  if (!s) {
    $sheet.hidden = true;
    $sheet.innerHTML = '';
    document.body.classList.remove('locked');
    return;
  }
  $sheet.hidden = false;
  document.body.classList.add('locked');
  const body = { wizard: sheetWizard, manual: sheetManual, newRound: sheetNewRound }[s.kind]();
  $sheet.innerHTML = `<div class="sheet-bg" data-act="closeSheet"></div><div class="sheet-panel" role="dialog" aria-modal="true">${body}</div>`;
}

const sheetHead = (title, back = true) =>
  `<div class="sheet-head">${back ? `<button class="iconbtn" data-act="wizBack" aria-label="뒤로">←</button>` : '<span></span>'}<h2>${title}</h2><button class="iconbtn" data-act="closeSheet" aria-label="닫기">✕</button></div>`;

// 마법사 스택: {t:'cats'} | {t:'sits', cat} | {t:'node', sit, path:[answerIndex...]} | {t:'confirm', sit, path, opt, count}
function nodeAt(sitId, path) {
  let n = SITUATIONS[sitId].node;
  for (const k of path) n = n.answers[k].node;
  return n;
}

function wizardContext() {
  if (!R()) return { local: DEFAULT_LOCAL, casual: true, provisionalActive: false, par: 4, noRound: true };
  return ctxFor();
}

function sheetWizard() {
  const st = ui.sheet.stack;
  const top = st[st.length - 1];
  const ctx = wizardContext();
  const provNote = ctx.provisionalActive ? `<div class="warnbox">🟡 잠정구 진행 중 — 원구 상태가 정해졌다면 먼저 <b>잠정구 정리</b>를 하세요. 여기서 고르는 벌타는 잠정구에 적용됩니다.</div>` : '';

  if (top.t === 'cats') {
    return `${sheetHead('어떤 상황인가요?', false)}${provNote}
      <div class="catgrid">${CATEGORIES.filter((c) => !c.casual || ctx.casual)
        .map((c) => `<button data-act="wizCat" data-cat="${c.id}"><span>${c.icon}</span>${c.title}</button>`)
        .join('')}</div>
      <p class="muted small">모르면 가장 비슷한 것을 고르세요. 질문에 답하면 벌타와 다음 타순을 계산합니다.</p>`;
  }
  if (top.t === 'sits') {
    const c = CATEGORIES.find((x) => x.id === top.cat);
    return `${sheetHead(`${c.icon} ${c.title}`)}${provNote}<ul class="sitlist">${c.situations
      .map((s) => `<li><button data-act="wizSit" data-sit="${s.id}"><b>${esc(s.title)}</b>${s.summary ? `<span>${esc(s.summary)}</span>` : ''}</button></li>`)
      .join('')}</ul>`;
  }
  const sit = SITUATIONS[top.sit];
  if (top.t === 'node') {
    const node = nodeAt(top.sit, top.path);
    const crumbs = top.path.map((k, d) => nodeAt(top.sit, top.path.slice(0, d)).answers[k].label);
    let html = `${sheetHead(esc(sit.title))}${provNote}`;
    if (sit.summary && !top.path.length) html += `<p class="summary">${esc(sit.summary)}</p>`;
    if (crumbs.length) html += `<div class="crumbs">${crumbs.map((c) => `<span>✓ ${esc(c)}</span>`).join('')}</div>`;
    if (node.question) {
      html += `<h3 class="q">${esc(node.question)}</h3><div class="answers">${node.answers
        .map((a, k) => `<button data-act="wizAns" data-k="${k}"><b>${esc(a.label)}</b>${a.desc ? `<span>${esc(a.desc)}</span>` : ''}</button>`)
        .join('')}</div>`;
    } else {
      html += `<h3 class="q">처리 방법을 고르세요</h3><div class="options">${node.options
        .map((o, k) => {
          const av = availability(o, ctx);
          const pen = penaltyOf(o, ctx);
          const tag =
            o.action === 'goto'
              ? '<em class="tag go">이동</em>'
              : o.action === 'stroke'
                ? '<em class="tag stroke">+1타</em>'
                : o.action === 'provisional' || o.action === 'resolve'
                  ? '<em class="tag prov">잠정구</em>'
                  : ['concede', 'mulligan', 'pickup', 'par'].includes(o.action)
                    ? '<em class="tag casual">친선</em>'
                    : pen
                      ? `<em class="tag pen">+${pen}벌타</em>`
                      : '<em class="tag free">무벌타</em>';
          return `<button class="opt ${av.ok ? '' : 'off'}" data-act="wizOpt" data-k="${k}" ${av.ok ? '' : 'aria-disabled="true"'}>
            <div class="opt-top"><b>${esc(o.label)}</b>${tag}</div>
            ${o.desc ? `<span>${esc(o.desc)}</span>` : ''}
            ${o.mode === 'local' ? '<span class="lr">골프장 로컬룰</span>' : ''}
            ${av.ok ? '' : `<span class="why">🔒 ${esc(av.reason)}</span>`}</button>`;
        })
        .join('')}</div>`;
    }
    return html;
  }
  if (top.t === 'confirm') {
    const o = nodeAt(top.sit, top.path).options[top.opt];
    const ev = buildEvent(top.sit, o, ctx, { count: top.count });
    let preview = '';
    if (!ctx.noRound) {
      const before = holeRes();
      const after = computeHole({ par: ctx.par, events: [...curHole().events, ev] }, { doubleParCap: R().doubleParCap });
      const pen = (after.penalties - before.penalties) + (after.provisional?.penalties ?? 0) - (before.provisional?.penalties ?? 0);
      preview = after.holed
        ? `<div class="result"><div>결과</div><b>${after.total}타 홀아웃</b><span>${scoreName(after.total, ctx.par)}</span></div>`
        : `<div class="result"><div>다음 샷은</div><b>${after.provisional ? after.provisional.next : after.next}타째</b>
           <span>${o.action === 'resolve' && o.keep === 'original' ? '잠정구 타수·벌타 취소' : ev.type === 'penalty' ? `벌타 +${ev.n}${ev.void ? ` · ${ev.void}타 무효` : ''}` : o.action === 'provisional' ? '잠정구 1타째 = 원구 기준 +1벌타 포함' : pen ? `벌타 +${pen}` : ''}</span></div>`;
    }
    return `${sheetHead('확인')}
      <div class="confirm">
        <div class="chosen">${esc(sit.title)}<br><b>${esc(o.label)}</b></div>
        ${o.count ? `<div class="stepper"><span>${esc(o.count.label)}</span><button data-act="wizCount" data-d="-1">−</button><b>${top.count}타</b><button data-act="wizCount" data-d="1">+</button></div>` : ''}
        ${preview}
        ${o.place ? `<div class="place"><div>📍 다음 샷 위치</div><p>${esc(o.place)}</p></div>` : ''}
        ${o.warn ? `<div class="warnbox">⚠ ${esc(o.warn)}</div>` : ''}
        ${o.rule ? `<div class="rule">근거: ${esc(o.rule)}${o.mode === 'local' ? ' · 골프장 로컬룰' : o.mode === 'casual' ? ' · 비공식' : ''}</div>` : ''}
        ${ctx.noRound ? '<p class="muted">라운드를 시작하면 현재 홀에 바로 적용할 수 있습니다.</p>' : `<button class="btn primary xl" data-act="wizApply">이대로 적용</button>`}
        <button class="btn ghost" data-act="wizBack">다른 방법 선택</button>
      </div>`;
  }
  return '';
}

function wizardPush(frame) {
  ui.sheet.stack.push(frame);
  renderSheet();
  $sheet.querySelector('.sheet-panel')?.scrollTo(0, 0);
}

function openSituation(sitId) {
  const c = SITUATIONS[sitId].category;
  openSheet({ kind: 'wizard', stack: [{ t: 'cats' }, { t: 'sits', cat: c }, { t: 'node', sit: sitId, path: [] }] });
}

function wizardChooseOption(k) {
  const top = ui.sheet.stack.at(-1);
  const o = nodeAt(top.sit, top.path).options[k];
  const ctx = wizardContext();
  const av = availability(o, ctx);
  if (!av.ok) return toast(av.reason);
  if (o.action === 'goto') return openSituation(o.goto);
  wizardPush({ t: 'confirm', sit: top.sit, path: top.path, opt: k, count: o.count ? 1 : 0 });
}

function wizardApply() {
  const top = ui.sheet.stack.at(-1);
  const o = nodeAt(top.sit, top.path).options[top.opt];
  const ev = buildEvent(top.sit, o, ctxFor(), { count: top.count });
  if (!ev || !addEvent(ev)) return;
  const r = holeRes();
  if (o.then) {
    toast('원구로 계속합니다. 이어서 처리 방법을 고르세요.');
    openSituation(o.then);
  } else {
    closeSheet();
    if (!r.holed) toast(`적용됨 → 다음 ${r.provisional ? `잠정구 ${r.provisional.next}` : r.next}타째`);
  }
  render();
}

function sheetManual() {
  const s = ui.sheet;
  return `${sheetHead('최종 타수 직접 입력', false)}
    <p class="muted">기록을 놓쳤을 때 홀을 마친 뒤의 최종 타수(벌타 포함)를 입력하세요. 기존 샷 기록은 남지만 이 값이 점수로 쓰입니다.</p>
    <div class="stepper big"><button data-act="manD" data-d="-1">−</button><b>${s.value}</b><button data-act="manD" data-d="1">+</button></div>
    <div class="muted center">${scoreName(s.value, R().pars[curIdx()])} (${fmtToPar(s.value - R().pars[curIdx()])})</div>
    <button class="btn primary xl" data-act="manSave">저장</button>
    <button class="btn ${ui.armed === 'clearHole' ? 'danger' : 'ghost'}" data-act="clearHole">${ui.armed === 'clearHole' ? '한 번 더 누르면 이 홀 기록 전부 삭제' : '이 홀 기록 전부 지우기'}</button>`;
}

function sheetNewRound() {
  const s = ui.sheet;
  return `${sheetHead('새 라운드', false)}
    ${db.courses.length ? `<label class="field"><span>저장된 골프장</span><select data-input="pickCourse"><option value="">— 새 골프장 —</option>${db.courses.map((c, i) => `<option value="${i}" ${s.courseIdx === i ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>` : ''}
    <label class="field"><span>골프장 이름</span><input type="text" value="${esc(s.name)}" placeholder="예: OO컨트리클럽" data-input="nrName"></label>
    <div class="field"><span>규칙 모드</span><div class="seg">
      <button class="${s.casual ? '' : 'on'}" data-act="nrCasual" data-v="0">공식 규칙</button>
      <button class="${s.casual ? 'on' : ''}" data-act="nrCasual" data-v="1">친선 라운드</button></div></div>
    <div class="field"><span>시작 홀</span><div class="seg">
      <button class="${s.start === 0 ? 'on' : ''}" data-act="nrStart" data-v="0">1번 홀 (전반)</button>
      <button class="${s.start === 9 ? 'on' : ''}" data-act="nrStart" data-v="9">10번 홀 (후반)</button></div></div>
    <details class="field"><summary>홀별 파 (합계 ${s.pars.reduce((a, b) => a + b, 0)}) — 눌러서 변경</summary>
      <div class="pargrid">${s.pars.map((p, i) => `<button data-act="nrPar" data-i="${i}"><span>${i + 1}</span><b>${p}</b></button>`).join('')}</div></details>
    <details class="field" ${s.courseIdx == null ? 'open' : ''}><summary>골프장 로컬룰 (OB티·해저드티 등)</summary>
      ${localRuleControls(s.local, 'nr')}
      <p class="muted small">모르면 꺼 두세요. 라운드 중에도 설정에서 바꿀 수 있습니다.</p></details>
    <button class="btn primary xl" data-act="nrGo">시작하기</button>`;
}

// ───────────── 동작 ─────────────
function newRoundDraft() {
  return { kind: 'newRound', courseIdx: null, name: '', casual: false, start: 0, pars: [...DEFAULT_PARS], local: { ...DEFAULT_LOCAL } };
}

function startRound(s) {
  const d = new Date();
  db.round = {
    id: `${d.getTime()}`,
    date: `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`,
    courseName: s.name.trim() || '골프장',
    casual: s.casual,
    doubleParCap: false,
    pars: [...s.pars],
    local: { ...s.local },
    holes: Array.from({ length: 18 }, () => ({ events: [] })),
    current: s.start,
  };
  save();
  closeSheet();
  ui.tab = 'play';
  wake();
  render();
}

function finishRound() {
  const res = computeRound(R());
  db.history.unshift({ ...R(), total: res.all.total, toPar: res.all.toPar, holesDone: res.all.done });
  db.round = null;
  save();
  toast('라운드를 저장했습니다.');
}

async function shareRound() {
  const res = computeRound(R());
  const line = (from) =>
    res.holes
      .slice(from, from + 9)
      .map((h) => (h.holed ? h.total : '-'))
      .join(' ');
  const text = `⛳ ${R().courseName} ${R().date}\n총 ${res.all.total}타 (${fmtToPar(res.all.toPar)}) · ${res.all.done}/18홀\nOUT ${line(0)} = ${res.front.total}\nIN  ${line(9)} = ${res.back.total}\n벌타 ${res.all.penalties} · 퍼트 ${res.all.putts}${res.mode !== 'official' ? `\n(${MODE_LABEL[res.mode]})` : ''}`;
  try {
    if (navigator.share) await navigator.share({ text });
    else {
      await navigator.clipboard.writeText(text);
      toast('결과를 복사했습니다.');
    }
  } catch {}
}

function exportData() {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `golf-score-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importData(file) {
  try {
    const d = JSON.parse(await file.text());
    if (!d || !Array.isArray(d.history)) throw new Error();
    db = { round: null, courses: [], history: [], prefs: db.prefs, ...d };
    save();
    toast('백업을 불러왔습니다.');
    render();
  } catch {
    toast('올바른 백업 파일이 아닙니다.');
  }
}

let wakeLock = null;
async function wake() {
  try {
    if (db.prefs.wake && R() && 'wakeLock' in navigator && document.visibilityState === 'visible' && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    } else if ((!db.prefs.wake || !R()) && wakeLock) {
      await wakeLock.release();
    }
  } catch {}
}
document.addEventListener('visibilitychange', wake);

let listening = false;
function startVoice() {
  if (listening) return;
  listening = true;
  document.querySelector('.mic')?.classList.add('on');
  toast('말씀하세요…');
  listenOnce({
    onResult: ({ text, cmd }) => runVoice(text, cmd),
    onError: (e) => toast(e === 'not-allowed' ? '마이크 권한이 필요합니다.' : '음성을 인식하지 못했습니다.'),
    onEnd: () => {
      listening = false;
      document.querySelector('.mic')?.classList.remove('on');
    },
  });
}

function runVoice(text, cmd) {
  if (!cmd || !R()) return toast(`“${text}” — 알아듣지 못했습니다.`);
  const r = holeRes();
  switch (cmd.type) {
    case 'stroke':
      addEvent({ type: 'stroke', putt: !!cmd.putt && !r.provisional });
      break;
    case 'undo':
      return undo();
    case 'next':
      return goHole(curIdx() + 1);
    case 'prev':
      return goHole(curIdx() - 1);
    case 'holeout':
      if (r.provisional) return toast('잠정구를 먼저 정리하세요.');
      addEvent({ type: 'holeout', label: '홀아웃' });
      break;
    case 'resolve':
      if (!r.provisional) return toast('진행 중인 잠정구가 없습니다.');
      addEvent(resolveEvent(cmd.keep));
      break;
    case 'readout': {
      const all = computeRound(R());
      speak(`${curIdx() + 1}번 홀 다음 ${r.provisional ? r.provisional.next : r.next}타째. 총 ${all.all.total}타, ${all.all.toPar === 0 ? '이븐' : fmtToPar(all.all.toPar)}`);
      break;
    }
    case 'situation':
      openSituation(cmd.sit);
      break;
  }
  toast(`“${text}”`);
  render();
}

function resolveEvent(keep) {
  const o = SITUATIONS.provres.node.options.find((x) => x.id === (keep === 'original' ? 'found' : 'notfound'));
  return buildEvent('provres', o, ctxFor());
}

// ───────────── 이벤트 위임 ─────────────
const cyclePar = (p) => (p >= 6 ? 3 : p + 1);
const clampPen = (v) => Math.max(0, Math.min(4, v));

document.addEventListener('click', (e) => {
  const tab = e.target.closest('#tabs button');
  if (tab) {
    ui.tab = tab.dataset.tab;
    ui.armed = null;
    render();
    window.scrollTo(0, 0);
    return;
  }
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled || el.tagName === 'INPUT') return;
  const act = el.dataset.act;
  const armedBefore = ui.armed;
  ui.armed = null;
  const arm = (key, fn) => {
    if (armedBefore === key) fn();
    else ui.armed = key;
  };

  switch (act) {
    case 'tab':
      ui.tab = el.dataset.tab;
      break;
    case 'newRound':
      if (R()) {
        ui.tab = 'card';
        toast('진행 중인 라운드를 먼저 종료하세요.');
        break;
      }
      openSheet(newRoundDraft());
      return;
    case 'stroke':
      addEvent({ type: 'stroke' });
      break;
    case 'putt':
      addEvent({ type: 'stroke', putt: true });
      break;
    case 'holeout':
      addEvent({ type: 'holeout', label: '홀아웃' });
      break;
    case 'undo':
      return undo();
    case 'resolve':
      addEvent(resolveEvent(el.dataset.keep));
      break;
    case 'prev':
      return goHole(curIdx() - 1);
    case 'next':
      return goHole(curIdx() + 1);
    case 'go':
      ui.tab = 'play';
      return goHole(+el.dataset.i);
    case 'nextHole': {
      const n = curIdx() < 17 && !holeRes(curIdx() + 1).holed ? curIdx() + 1 : nextUnplayed(curIdx());
      if (n == null) ui.tab = 'card';
      else return goHole(n);
      break;
    }
    case 'cyclePar':
      R().pars[curIdx()] = cyclePar(R().pars[curIdx()]);
      save();
      break;
    case 'mic':
      return startVoice();
    case 'wizard':
      openSheet({ kind: 'wizard', stack: [{ t: 'cats' }] });
      return;
    case 'sit':
      return openSituation(el.dataset.sit);
    case 'manual': {
      const r = holeRes();
      openSheet({ kind: 'manual', value: r.total || R().pars[curIdx()] });
      return;
    }
    case 'manD':
      ui.sheet.value = Math.max(1, Math.min(30, ui.sheet.value + +el.dataset.d));
      return renderSheet();
    case 'manSave': {
      const v = ui.sheet.value;
      const ev = { type: 'set_total', value: v, label: `최종 타수 직접 입력 ${v}타` };
      curHole().events.push({ ...ev, t: Date.now() });
      save();
      closeSheet();
      announceHoleDone(holeRes());
      break;
    }
    case 'clearHole':
      arm('clearHole', () => {
        curHole().events = [];
        save();
        closeSheet();
        toast('이 홀 기록을 지웠습니다.');
      });
      if (ui.sheet) return renderSheet();
      break;
    case 'closeSheet':
      closeSheet();
      return;
    case 'wizBack':
      if (ui.sheet.stack.length > 1) {
        ui.sheet.stack.pop();
        return renderSheet();
      }
      return closeSheet();
    case 'wizCat':
      return wizardPush({ t: 'sits', cat: el.dataset.cat });
    case 'wizSit':
      return wizardPush({ t: 'node', sit: el.dataset.sit, path: [] });
    case 'wizAns': {
      const top = ui.sheet.stack.at(-1);
      return wizardPush({ t: 'node', sit: top.sit, path: [...top.path, +el.dataset.k] });
    }
    case 'wizOpt':
      return wizardChooseOption(+el.dataset.k);
    case 'wizCount': {
      const top = ui.sheet.stack.at(-1);
      const o = nodeAt(top.sit, top.path).options[top.opt];
      top.count = Math.max(0, Math.min(o.count.max, top.count + +el.dataset.d));
      return renderSheet();
    }
    case 'wizApply':
      return wizardApply();
    // 새 라운드
    case 'nrCasual':
      ui.sheet.casual = el.dataset.v === '1';
      return renderSheet();
    case 'nrStart':
      ui.sheet.start = +el.dataset.v;
      return renderSheet();
    case 'nrPar':
      ui.sheet.pars[+el.dataset.i] = cyclePar(ui.sheet.pars[+el.dataset.i]);
      return renderSheet();
    case 'nrPen':
      ui.sheet.local[el.dataset.key] = clampPen(ui.sheet.local[el.dataset.key] + +el.dataset.d);
      return renderSheet();
    case 'nrGo':
      return startRound(ui.sheet);
    // 설정
    case 'setCasual':
      R().casual = el.dataset.v === '1';
      save();
      break;
    case 'parAt':
      R().pars[+el.dataset.i] = cyclePar(R().pars[+el.dataset.i]);
      save();
      break;
    case 'rPen':
      R().local[el.dataset.key] = clampPen(R().local[el.dataset.key] + +el.dataset.d);
      save();
      break;
    case 'saveCourse': {
      const c = { name: R().courseName, pars: [...R().pars], local: { ...R().local } };
      const i = db.courses.findIndex((x) => x.name === c.name);
      if (i >= 0) db.courses[i] = c;
      else db.courses.push(c);
      save();
      toast(`‘${c.name}’ 설정을 저장했습니다.`);
      break;
    }
    case 'delCourse':
      arm('delc' + el.dataset.i, () => {
        db.courses.splice(+el.dataset.i, 1);
        save();
      });
      break;
    case 'abandon':
      arm('abandon', () => {
        db.round = null;
        save();
        wake();
        toast('라운드를 삭제했습니다.');
      });
      break;
    case 'theme':
      db.prefs.theme = el.dataset.v;
      save();
      break;
    case 'export':
      return exportData();
    // 스코어카드
    case 'finish':
      arm('finish', () => {
        finishRound();
        wake();
      });
      break;
    case 'share':
      return shareRound();
    case 'hist':
      ui.histOpen = ui.histOpen === el.dataset.id ? null : el.dataset.id;
      break;
    case 'delHist':
      arm('del' + el.dataset.id, () => {
        db.history = db.history.filter((h) => h.id !== el.dataset.id);
        save();
      });
      break;
  }
  render();
});

document.addEventListener('change', (e) => {
  const el = e.target;
  const act = el.dataset.act;
  if (act === 'pref') {
    db.prefs[el.dataset.key] = el.checked;
    save();
    if (el.dataset.key === 'wake') wake();
    return render();
  }
  if (act === 'rLocal') {
    R().local[el.dataset.key] = el.checked;
    save();
    return render();
  }
  if (act === 'nrLocal') {
    ui.sheet.local[el.dataset.key] = el.checked;
    return renderSheet();
  }
  if (act === 'toggleCap') {
    R().doubleParCap = el.checked;
    save();
    return render();
  }
  if (act === 'import' && el.files[0]) return importData(el.files[0]);
  if (el.dataset.input === 'pickCourse') {
    const s = ui.sheet;
    if (el.value === '') Object.assign(s, { courseIdx: null });
    else {
      const c = db.courses[+el.value];
      Object.assign(s, { courseIdx: +el.value, name: c.name, pars: [...c.pars], local: { ...DEFAULT_LOCAL, ...c.local } });
    }
    return renderSheet();
  }
});

document.addEventListener('input', (e) => {
  const k = e.target.dataset.input;
  if (k === 'courseName') {
    R().courseName = e.target.value;
    save();
  } else if (k === 'nrName') ui.sheet.name = e.target.value;
  else if (k === 'ruleQuery') {
    ui.ruleQuery = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const box = document.querySelector('.search');
    box?.focus();
    box?.setSelectionRange(pos, pos);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ui.sheet) closeSheet();
});

// 오프라인 사용을 위한 서비스 워커
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

render();
wake();
