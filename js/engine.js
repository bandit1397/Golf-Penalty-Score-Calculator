// 스코어 엔진
// 홀마다 "무슨 일이 있었는가"(사건 기록)만 저장하고, 점수는 항상 사건을 처음부터 재생해서 계산한다.
// 그래서 중간 기록을 고치거나 되돌려도 다음 타순·벌타·합계가 자동으로 다시 맞춰진다.
//
// 사건 종류
//   stroke      {putt?}                      실제 스트로크 1타 (헛스윙 포함)
//   penalty     {n, void?, holeout?}         벌타 n타. void = 무효가 되는 스트로크 수(잘못된 공 등)
//   provisional {}                           잠정구 선언 후 플레이 시작
//   resolve     {keep:'original'|'provisional'}  잠정구 정리
//   holeout     {}                           홀아웃
//   concede     {}                           OK(컨시드) — 친선 전용, +1타 후 홀아웃
//   mulligan    {}                           멀리건 — 친선 전용, 직전 1타 무효
//   pickup      {}                           기브업(양파) — 친선 전용
//   set_total   {value}                      최종 타수 직접 입력
//   note        {}                           벌타 없는 안내·경고 기록
// 모든 사건은 mode('official' | 'local' | 'casual')와 label(설명)을 가질 수 있다.

export const MODES = ['official', 'local', 'casual'];
export const MODE_LABEL = { official: '공식 규칙', local: '로컬룰 적용', casual: '친선(비공식)' };

const worse = (a, b) => (MODES.indexOf(b) > MODES.indexOf(a) ? b : a);

function newState() {
  return {
    strokes: 0, // 인정되는 실제 스트로크
    penalties: 0, // 벌타
    putts: 0,
    prov: null, // 진행 중인 잠정구 {strokes, penalties}
    holed: false,
    pickedUp: false,
    manual: null,
    mode: 'official',
    warnings: [],
    log: [],
  };
}

// 현재 공(잠정구 진행 중이면 잠정구) 기준으로 다음 샷이 몇 타째인지
function nextOf(s) {
  const base = s.strokes + s.penalties + 1;
  if (!s.prov) return base;
  return base + 1 + s.prov.penalties + s.prov.strokes;
}

function apply(s, e, par) {
  const mode = e.mode || 'official';
  const label = e.label || '';
  const push = (text, extra = {}) => s.log.push({ text, label, mode, next: nextOf(s), ...extra });

  if (s.holed && !['set_total', 'note'].includes(e.type)) {
    s.warnings.push('홀아웃 이후에 입력된 기록은 계산에서 제외했습니다.');
    return;
  }
  s.mode = worse(s.mode, mode);
  if (e.warn) s.warnings.push(e.warn);

  switch (e.type) {
    case 'stroke': {
      if (s.prov) {
        const n = nextOf(s);
        s.prov.strokes++;
        push(`잠정구 ${n}타째 샷`, { kind: 'prov' });
      } else {
        const n = nextOf(s);
        s.strokes++;
        if (e.putt) s.putts++;
        push(e.putt ? `${n}타째 퍼트` : label || `${n}타째 샷`, { kind: e.putt ? 'putt' : 'stroke' });
      }
      break;
    }
    case 'penalty': {
      const t = s.prov || s;
      const n = e.n || 0;
      const v = e.void || 0;
      if (v > t.strokes) s.warnings.push('무효 처리할 스트로크가 기록보다 많아 0타까지만 뺐습니다.');
      t.strokes = Math.max(0, t.strokes - v);
      if (v && t === s) s.putts = Math.min(s.putts, s.strokes);
      t.penalties += n;
      let text = n ? `${n}벌타` : '벌타 없음';
      if (v) text += ` · ${v}타 무효`;
      if (s.prov) text = `잠정구: ${text}`;
      if (e.holeout && !s.prov) s.holed = true;
      push(text, { kind: n ? 'penalty' : 'free', pen: n });
      break;
    }
    case 'provisional': {
      if (s.prov) {
        // 잠정구도 OB·분실 가능성이 있어 다시 잠정구를 친 경우
        s.prov.penalties += 1;
        push('잠정구를 다시 플레이 (잠정구 기준 1벌타 추가)', { kind: 'prov' });
      } else {
        s.prov = { strokes: 0, penalties: 0 };
        push('잠정구 선언 — 원구 판정 전까지 따로 계산', { kind: 'prov' });
      }
      break;
    }
    case 'resolve': {
      if (!s.prov) break;
      const p = s.prov;
      s.prov = null;
      if (e.keep === 'provisional') {
        s.strokes += p.strokes;
        s.penalties += 1 + p.penalties;
        push(`잠정구가 인플레이 — 1벌타${p.penalties ? ` + ${p.penalties}벌타` : ''}, 잠정구 ${p.strokes}타 인정`, { kind: 'penalty', pen: 1 + p.penalties });
      } else {
        push(`원구로 계속 — 잠정구 ${p.strokes}타와 관련 벌타 모두 취소`, { kind: 'free' });
      }
      break;
    }
    case 'holeout': {
      if (s.prov) {
        s.warnings.push('잠정구가 정리되지 않았습니다. 원구 발견 여부를 먼저 선택하세요.');
        return;
      }
      s.holed = true;
      push('홀아웃', { kind: 'hole' });
      break;
    }
    case 'concede': {
      if (s.prov) return;
      s.strokes++;
      s.holed = true;
      push('OK(컨시드) — 1타 추가 후 홀아웃', { kind: 'hole' });
      break;
    }
    case 'mulligan': {
      const t = s.prov || s;
      if (t.strokes > 0) t.strokes--;
      push('멀리건 — 직전 샷 무효, 벌타 없이 다시 치기', { kind: 'free' });
      break;
    }
    case 'pickup': {
      s.prov = null;
      s.pickedUp = true;
      s.holed = true;
      push('기브업 — 홀 포기 (양파 처리)', { kind: 'hole' });
      break;
    }
    case 'set_total': {
      s.manual = e.value;
      s.holed = true;
      s.prov = null;
      push(`최종 타수 직접 입력: ${e.value}타`, { kind: 'hole' });
      break;
    }
    case 'note': {
      push(label || '기록', { kind: 'note' });
      break;
    }
    default:
      break;
  }
}

/**
 * 한 홀의 점수를 계산한다.
 * @param {{par:number, events:object[]}} hole
 * @param {{doubleParCap?:boolean}} opts
 */
export function computeHole(hole, opts = {}) {
  const par = hole.par;
  const s = newState();
  for (const e of hole.events || []) apply(s, e, par);

  let total = s.strokes + s.penalties;
  if (s.pickedUp) total = Math.max(par * 2, total);
  if (s.manual != null) total = s.manual;
  let capped = false;
  if (opts.doubleParCap && total > par * 2) {
    total = par * 2;
    capped = true;
    s.mode = worse(s.mode, 'casual');
  }

  const started = (hole.events || []).length > 0;
  return {
    par,
    strokes: s.strokes,
    penalties: s.penalties,
    putts: s.putts,
    total: started ? total : null,
    toPar: started && s.holed ? total - par : null,
    holed: s.holed,
    started,
    capped,
    pickedUp: s.pickedUp,
    manual: s.manual != null,
    mode: s.mode,
    next: nextOf(s),
    provisional: s.prov
      ? {
          strokes: s.prov.strokes,
          penalties: s.prov.penalties,
          next: nextOf(s),
          // 원구를 찾으면 원구 기준 다음 타순
          originalNext: s.strokes + s.penalties + 1,
        }
      : null,
    warnings: [...new Set(s.warnings)],
    log: s.log,
  };
}

/** 라운드 전체 합계 */
export function computeRound(round) {
  const opts = { doubleParCap: !!round.doubleParCap };
  const holes = round.holes.map((h, i) => computeHole({ par: round.pars[i], events: h.events }, opts));
  const sum = (arr, f) => arr.reduce((a, h) => a + (f(h) || 0), 0);
  const part = (arr, from) => {
    const done = arr.filter((h) => h.holed);
    return {
      par: sum(arr, (h) => h.par),
      total: sum(done, (h) => h.total),
      playedPar: sum(done, (h) => h.par),
      toPar: sum(done, (h) => h.total) - sum(done, (h) => h.par),
      done: done.length,
      putts: sum(arr, (h) => h.putts),
      penalties: sum(arr, (h) => h.penalties),
      from,
    };
  };
  const mode = holes.reduce((m, h) => (h.started ? worse(m, h.mode) : m), 'official');
  return {
    holes,
    front: part(holes.slice(0, 9), 0),
    back: part(holes.slice(9, 18), 9),
    all: part(holes, 0),
    mode,
  };
}

export function scoreName(total, par) {
  if (total == null) return '';
  if (total === 1) return '홀인원';
  const d = total - par;
  return (
    { [-4]: '콘도르', [-3]: '알바트로스', [-2]: '이글', [-1]: '버디', 0: '파', 1: '보기', 2: '더블보기', 3: '트리플보기', 4: '쿼드러플보기' }[d] ??
    (d > 0 ? `+${d}` : `${d}`)
  );
}

export function fmtToPar(d) {
  if (d == null) return '–';
  return d === 0 ? 'E' : d > 0 ? `+${d}` : `${d}`;
}
