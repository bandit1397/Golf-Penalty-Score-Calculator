import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeHole, computeRound, scoreName } from '../js/engine.js';
import { CATEGORIES, SITUATIONS, DEFAULT_LOCAL, allOptions, availability, buildEvent, findOption } from '../js/rules.js';

const ctx = (o = {}) => ({ local: { ...DEFAULT_LOCAL, ...(o.local || {}) }, casual: false, provisionalActive: false, par: 4, ...o });
const S = { type: 'stroke' };
const P = { type: 'stroke', putt: true };
const H = { type: 'holeout' };
const ev = (sit, opt, path = [], c = ctx(), params) => buildEvent(sit, findOption(sit, opt, path), c, params);
const hole = (events, par = 4, opts) => computeHole({ par, events }, opts);

test('정상 플레이: 4타 파', () => {
  const r = hole([S, S, P, P, H]);
  assert.equal(r.total, 4);
  assert.equal(r.toPar, 0);
  assert.equal(r.putts, 2);
  assert.equal(scoreName(r.total, 4), '파');
});

test('사례 A — 티샷 OB → 1벌타 → 재티샷은 3타째, 그다음은 4타째', () => {
  const ob = ev('ob', 'sd');
  assert.equal(ob.n, 1);
  let r = hole([S, ob]);
  assert.equal(r.next, 3);
  r = hole([S, ob, S]);
  assert.equal(r.next, 4);
  r = hole([S, ob, S, S, P, H]);
  assert.equal(r.total, 5);
  assert.equal(r.penalties, 1);
  assert.equal(r.mode, 'official');
});

test('사례 B — 잠정구를 쳤는데 원구를 찾음 → 잠정구 타수 취소', () => {
  const prov = ev('prov', 'prov', ['네']);
  let r = hole([S, prov, S]);
  assert.equal(r.provisional.next, 4, '잠정구 두 번째 샷은 4타째');
  assert.equal(r.provisional.originalNext, 2, '원구를 찾으면 2타째');
  r = hole([S, prov, S, ev('provres', 'found', [], ctx({ provisionalActive: true }))]);
  assert.equal(r.provisional, null);
  assert.equal(r.next, 2);
  assert.equal(r.penalties, 0);
});

test('잠정구가 인플레이로 확정 → 1벌타 + 잠정구 타수 인정', () => {
  const c = ctx({ provisionalActive: true });
  const r = hole([S, ev('prov', 'prov', ['네']), S, S, ev('provres', 'notfound', [], c)]);
  assert.equal(r.strokes, 3);
  assert.equal(r.penalties, 1);
  assert.equal(r.next, 5, '티샷, 잠정구 3타·4타 → 다음 5타째');
});

test('원구 추정 지점보다 홀 쪽에서 잠정구를 치면 잠정구가 인플레이', () => {
  const r = hole([S, ev('prov', 'prov', ['네']), S, S, ev('provres', 'nearer', [], ctx({ provisionalActive: true })), P, H]);
  // 티샷 1, 잠정구 3·4타, 퍼트 5타
  assert.equal(r.total, 5);
});

test('잠정구의 잠정구 (둘 다 확정)', () => {
  const prov = ev('prov', 'prov', ['네']);
  const r = hole([S, prov, S, prov, S, ev('provres', 'notfound', [], ctx({ provisionalActive: true }))]);
  // 1타 OB, 3타 OB, 5타째 → 다음 6타째
  assert.equal(r.next, 6);
});

test('잠정구 미정리 상태에서는 홀아웃 불가', () => {
  const r = hole([S, ev('prov', 'prov', ['네']), S, H]);
  assert.equal(r.holed, false);
  assert.ok(r.warnings.length);
});

test('선언 없이 다시 친 공 → 스트로크와 거리', () => {
  const r = hole([S, ev('prov', 'sd', ['아니요']), S]);
  assert.equal(r.next, 4);
});

test('사례 C — 빨간 페널티구역: 구제하면 4타째, 그대로 치면 3타째', () => {
  const lat = ev('pa', 'lat', ['빨간색']);
  assert.equal(hole([S, S, lat]).next, 4);
  assert.equal(hole([S, S, ev('pa', 'play', ['빨간색'])]).next, 3);
});

test('노란 페널티구역에는 측면 구제가 없음', () => {
  const yellow = allOptions(SITUATIONS.pa.node.answers[0].node).map((o) => o.option.id);
  assert.ok(!yellow.includes('lat'));
  const red = allOptions(SITUATIONS.pa.node.answers[1].node).map((o) => o.option.id);
  assert.ok(red.includes('lat'));
});

test('벙커 언플레이어블: 벙커 안 1벌타, 벙커 밖 2벌타', () => {
  assert.equal(ev('unplayable', 'blat', ['벙커']).n, 1);
  assert.equal(ev('unplayable', 'bout', ['벙커']).n, 2);
  assert.equal(hole([S, S, ev('unplayable', 'bout', ['벙커'])]).next, 5);
});

test('E-5 미채택이면 선택 불가, 잠정구를 쳤어도 불가', () => {
  const e5 = findOption('ob', 'e5');
  assert.equal(availability(e5, ctx()).ok, false);
  assert.equal(availability(e5, ctx({ local: { e5: true } })).ok, true);
  assert.equal(availability(e5, ctx({ local: { e5: true }, provisionalActive: true })).ok, false);
  const r = hole([S, ev('ob', 'e5', [], ctx({ local: { e5: true } }))]);
  assert.equal(r.next, 4);
  assert.equal(r.mode, 'local');
});

test('사례 D — OB 특설티: 골프장 설정 벌타에 따라 타순 결정', () => {
  const t = findOption('ob', 'obtee');
  assert.equal(availability(t, ctx()).ok, false, '특설티 미설정이면 선택 불가');
  const c2 = ctx({ local: { obTee: true, obTeePenalty: 2 } });
  assert.equal(hole([S, ev('ob', 'obtee', [], c2)]).next, 4, 'OB티 4타째');
  const c1 = ctx({ local: { obTee: true, obTeePenalty: 1 } });
  assert.equal(hole([S, ev('ob', 'obtee', [], c1)]).next, 3, '1벌타 골프장이면 3타째');
});

test('해저드 특설티', () => {
  const c = ctx({ local: { hazardTee: true, hazardTeePenalty: 1 } });
  const r = hole([S, ev('pa', 'htee', ['노란색'], c)]);
  assert.equal(r.next, 3);
  assert.equal(r.mode, 'local');
});

test('잘못된 공: 2벌타 + 입력한 잘못된 공 타수 무효', () => {
  const wb = ev('wrongball', 'wb', [], ctx(), { count: 2 });
  const r = hole([S, S, S, wb]);
  // 1타 후 잘못된 공 2타 → 무효, 2벌타 → 내 공으로 4타째
  assert.equal(r.strokes, 1);
  assert.equal(r.penalties, 2);
  assert.equal(r.next, 4);
  assert.ok(r.warnings.some((w) => w.includes('실격')));
});

test('티잉구역 밖 티샷: 그 샷 무효 + 2벌타 → 다시 치는 티샷은 3타째', () => {
  assert.equal(hole([S, ev('teeout', 'to')]).next, 3);
});

test('헛스윙은 1타로 계산', () => {
  assert.equal(hole([S, ev('whiff', 'w1')]).next, 3);
});

test('홀 가장자리 10초 초과 후 떨어짐: 1벌타 홀인', () => {
  const r = hole([S, S, P, ev('flag', 'h11', ['홀 가장자리'])]);
  assert.equal(r.holed, true);
  assert.equal(r.total, 4);
});

test('그린에서 친 공이 사람에 맞음: 스트로크 무효 후 다시', () => {
  assert.equal(hole([S, S, P, ev('deflect', 'd2')]).next, 3);
});

test('페널티구역에서 친 공이 OB → 총 2벌타 옵션', () => {
  assert.equal(ev('pa2', 'pa2out', ['OB']).n, 2);
});

test('친선 전용 기능은 친선 모드에서만', () => {
  const ok = findOption('ok', 'ok');
  assert.equal(availability(ok, ctx()).ok, false);
  const c = ctx({ casual: true });
  assert.equal(availability(ok, c).ok, true);
  const r = hole([S, S, P, ev('ok', 'ok', [], c)]);
  assert.equal(r.total, 4);
  assert.equal(r.mode, 'casual');
});

test('기브업은 더블파', () => {
  const r = hole([S, S, S, ev('pickup', 'pu', [], ctx({ casual: true }))], 4);
  assert.equal(r.total, 8);
});

test('더블파 상한 설정', () => {
  const ten = Array(10).fill(S);
  const r = hole([...ten, H], 3, { doubleParCap: true });
  assert.equal(r.total, 6);
  assert.equal(r.capped, true);
});

test('일파만파 → 파 기록', () => {
  const r = hole([S, S, S, S, S, S, ev('ilpa', 'ip', [], ctx({ casual: true, par: 4 }))]);
  assert.equal(r.total, 4);
});

test('최종 타수 직접 입력', () => {
  const r = hole([S, S, { type: 'set_total', value: 7 }]);
  assert.equal(r.total, 7);
  assert.equal(r.holed, true);
});

test('홀아웃 후 기록 수정 → 전체 합계 재계산', () => {
  const pars = Array(18).fill(4);
  const holes = pars.map(() => ({ events: [S, S, S, S, H] }));
  const round = { pars, holes };
  assert.equal(computeRound(round).all.total, 72);
  holes[0].events.splice(1, 0, ev('ob', 'sd'), S);
  const r = computeRound(round);
  assert.equal(r.holes[0].total, 6);
  assert.equal(r.all.total, 74);
  assert.equal(r.all.toPar, 2);
  assert.equal(r.front.total, 38);
});

test('홀아웃 이후 입력은 무시', () => {
  const r = hole([S, S, S, S, H, S]);
  assert.equal(r.total, 4);
});

test('카탈로그 무결성: 모든 처리에 id·label, goto/then 대상 존재', () => {
  for (const c of CATEGORIES)
    for (const s of c.situations)
      for (const { option } of allOptions(s.node)) {
        assert.ok(option.id && option.label, `${s.id}`);
        if (option.goto) assert.ok(SITUATIONS[option.goto], `${s.id}.${option.id} → ${option.goto}`);
        if (option.then) assert.ok(SITUATIONS[option.then], `${s.id}.${option.id} → ${option.then}`);
        if (option.action !== 'goto') {
          const e = buildEvent(s.id, option, ctx({ local: { ...DEFAULT_LOCAL }, casual: true }), { count: 1 });
          assert.ok(e && e.type, `${s.id}.${option.id}`);
        }
      }
});
