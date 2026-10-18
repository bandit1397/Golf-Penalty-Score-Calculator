// 음성 명령 (브라우저가 지원할 때만). 버튼 입력이 기본이고 음성은 보조 수단이다.
import { CATEGORIES } from './rules.js';

const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
export const voiceSupported = !!Recognition;

const norm = (t) => t.toLowerCase().replace(/\s+/g, ' ').trim();

// 말 → 명령. 먼저 맞는 규칙이 이긴다.
const COMMANDS = [
  { re: /(되돌|취소|잘못 눌|빼)/, cmd: { type: 'undo' } },
  { re: /(다음 홀|넥스트)/, cmd: { type: 'next' } },
  { re: /(이전 홀|앞 홀)/, cmd: { type: 'prev' } },
  { re: /(홀아웃|홀인|들어갔|땡그랑|컵인)/, cmd: { type: 'holeout' } },
  { re: /(원구.*(찾|발견)|찾았)/, cmd: { type: 'resolve', keep: 'original' } },
  { re: /(원구.*(오비|ob|분실|없)|잠정구.*(살|인플레이|확정))/, cmd: { type: 'resolve', keep: 'provisional' } },
  { re: /(퍼트|퍼팅)/, cmd: { type: 'stroke', putt: true } },
  { re: /(몇 타|스코어|점수)/, cmd: { type: 'readout' } },
];

const SIT_WORDS = CATEGORIES.flatMap((c) => c.situations.filter((s) => s.voice).map((s) => ({ words: s.voice, sit: s.id })));

export function parseCommand(text) {
  const t = norm(text);
  for (const c of COMMANDS) if (c.re.test(t)) return c.cmd;
  for (const s of SIT_WORDS) if (s.words.some((w) => t.includes(w))) return { type: 'situation', sit: s.sit };
  if (/(샷|쳤|한 타|타 추가|티샷|어프로치|드라이버|아이언)/.test(t)) return { type: 'stroke' };
  return null;
}

export function listenOnce({ onResult, onError, onEnd }) {
  if (!Recognition) return null;
  const r = new Recognition();
  r.lang = 'ko-KR';
  r.interimResults = false;
  r.maxAlternatives = 3;
  r.onresult = (e) => {
    const alts = [...e.results[0]].map((a) => a.transcript);
    const hit = alts.map((a) => ({ text: a, cmd: parseCommand(a) })).find((x) => x.cmd) || { text: alts[0], cmd: null };
    onResult(hit);
  };
  r.onerror = (e) => onError?.(e.error);
  r.onend = () => onEnd?.();
  r.start();
  return r;
}

export function speak(text) {
  if (!globalThis.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ko-KR';
  speechSynthesis.speak(u);
}
