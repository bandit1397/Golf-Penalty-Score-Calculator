// 규칙 판단 데이터
// 골프 규칙(R&A·USGA 2023년판) + 위원회 로컬룰 + 국내 친선 관행을 "상황 → 질문 → 처리 선택" 트리로 정리했다.
// 화면(app.js)은 이 데이터를 그대로 그려 주고, 선택 결과를 buildEvent()로 스코어 엔진 사건으로 바꾼다.
//
// 처리 선택(option) 필드
//   label, desc         버튼 제목·설명
//   pen                 벌타 (숫자 또는 ctx => 숫자)
//   void                무효가 되는 스트로크 수
//   count               무효 스트로크 수를 사용자에게 물어볼 때 {label, max}
//   place               다음 샷을 할 위치 안내
//   rule                규칙 근거
//   mode                'official' | 'local' | 'casual'
//   action              'penalty'(기본) | 'stroke' | 'provisional' | 'resolve' | 'mulligan' | 'concede' | 'pickup' | 'par' | 'note' | 'goto'
//   keep                action 'resolve'일 때 'original' | 'provisional'
//   then                처리 후 이어서 열 상황 id
//   goto                action 'goto'일 때 열 상황 id
//   holeout             이 처리로 홀아웃
//   requires            사용 조건 목록 (availability 참고)
//   warn                기록에 남길 주의 문구

export const LOCAL_RULES = {
  e5: { name: '모델 로컬룰 E-5 (OB·분실구 2벌타 대안)', short: 'E-5' },
  obTee: { name: 'OB 특설티', short: 'OB티' },
  hazardTee: { name: '해저드(페널티구역) 특설티', short: '해저드티' },
  dropZone: { name: '드롭존 (모델 로컬룰 E-1)', short: '드롭존' },
  oppositeSide: { name: '빨간 페널티구역 반대편 구제 (B-2.1)', short: '반대편 구제' },
  preferredLies: { name: '프리퍼드 라이 (모델 로컬룰 E-3)', short: '프리퍼드 라이' },
};

export const DEFAULT_LOCAL = {
  e5: false,
  obTee: false,
  obTeePenalty: 2,
  hazardTee: false,
  hazardTeePenalty: 1,
  dropZone: false,
  oppositeSide: false,
  preferredLies: false,
};

const CL = '클럽 길이(퍼터를 제외한 가장 긴 클럽)';
const DROP = '무릎 높이에서 수직으로 드롭하고, 공이 구제구역 안에 멈춰야 합니다(두 번 실패하면 두 번째 드롭 때 땅에 닿은 지점에 플레이스).';

// ───── 자주 쓰는 처리 방법 ─────
const strokeAndDistance = (o = {}) => ({
  id: 'sd',
  label: '직전 샷 위치에서 다시 치기',
  desc: '스트로크와 거리 구제. 어떤 상황에서도 항상 쓸 수 있는 기본 방법입니다.',
  pen: 1,
  place: `직전 스트로크를 한 곳. 티샷이었다면 티잉구역 안 어디서든 티업, 일반구역·벙커는 그 지점 기준 1${CL} 이내 드롭, 그린은 그 자리에 플레이스.`,
  rule: '규칙 18.1',
  ...o,
});

const e5 = {
  id: 'e5',
  label: 'OB·분실 지점 근처 페어웨이에 드롭 (E-5)',
  desc: '돌아가서 다시 칠 시간을 줄이는 로컬룰. 2벌타. 잠정구를 이미 쳤다면 쓸 수 없고, 티샷 다시 치기와 점수가 같아지도록 만든 대안입니다.',
  pen: 2,
  place: `공이 OB 경계를 넘은 지점(분실구는 공이 멈췄을 것으로 추정되는 지점)과, 홀에서 같은 거리에 있는 가장 가까운 페어웨이 가장자리 사이 구역 + 바깥쪽 2${CL}. 기준점보다 홀에 가까우면 안 되고 그린·페널티구역 안은 안 됩니다. ${DROP}`,
  rule: '모델 로컬룰 E-5',
  mode: 'local',
  requires: ['e5', 'noProvisional'],
};

const obTee = {
  id: 'obtee',
  label: 'OB 특설티에서 치기',
  desc: '국내 골프장의 OB티. 벌타 수는 골프장 로컬룰을 따릅니다(설정에서 변경). 티샷 OB 기준으로 보통 "OB티에서 4타째"(2벌타).',
  pen: (ctx) => ctx.local.obTeePenalty ?? 2,
  place: '골프장이 지정한 OB 특설티에서 티업.',
  rule: '골프장 로컬룰',
  mode: 'local',
  requires: ['obTee'],
};

const PA_PASS = '공이 페널티구역 경계를 마지막으로 넘어간 지점';

const playAsLies = (o = {}) => ({
  id: 'play',
  label: '공이 있는 그대로 치기',
  desc: '벌타 없음. 페널티구역 안에서도 클럽을 지면·물에 대거나 낙엽 등을 치우는 것이 허용됩니다.',
  pen: 0,
  place: '공이 있는 그 자리.',
  rule: '규칙 17.1b',
  ...o,
});

const backOnLinePA = {
  id: 'bol',
  label: '후방선 구제',
  desc: '1벌타. 홀과 경계 통과 지점을 잇는 직선을 뒤로 연장해서 그 선 위에서 드롭합니다. 거리 제한 없음.',
  pen: 1,
  place: `홀과 ${PA_PASS}을 이은 직선의 후방(홀에서 멀어지는 쪽) 선상에 기준점을 정하고, 기준점에서 1${CL} 이내·홀에 가깝지 않게. ${DROP}`,
  rule: '규칙 17.1d(2)',
};

const lateralPA = {
  id: 'lat',
  label: '측면 구제 (2클럽 길이)',
  desc: '1벌타. 빨간 페널티구역에서만 가능합니다.',
  pen: 1,
  place: `${PA_PASS}에서 2${CL} 이내, 그 지점보다 홀에 가깝지 않게, 페널티구역 밖에. ${DROP}`,
  rule: '규칙 17.1d(3)',
};

const oppositePA = {
  id: 'opp',
  label: '반대편 측면 구제',
  desc: '1벌타. 위원회가 모델 로컬룰 B-2.1을 채택한 빨간 페널티구역에서만.',
  pen: 1,
  place: `${PA_PASS}에서 홀까지 같은 거리인 반대편 경계 지점에서 2${CL} 이내. ${DROP}`,
  rule: '모델 로컬룰 B-2.1',
  mode: 'local',
  requires: ['oppositeSide'],
};

const dropZonePA = {
  id: 'dz',
  label: '드롭존에서 치기',
  desc: '1벌타. 골프장이 드롭존을 지정한 경우.',
  pen: 1,
  place: '지정된 드롭존 안에 드롭 (공이 드롭존 안에 멈춰야 함).',
  rule: '모델 로컬룰 E-1',
  mode: 'local',
  requires: ['dropZone'],
};

const hazardTee = {
  id: 'htee',
  label: '해저드 특설티에서 치기',
  desc: '국내 골프장의 해저드티. 벌타 수는 골프장 로컬룰을 따릅니다(설정에서 변경, 보통 1벌타).',
  pen: (ctx) => ctx.local.hazardTeePenalty ?? 1,
  place: '골프장이 지정한 해저드 특설티.',
  rule: '골프장 로컬룰',
  mode: 'local',
  requires: ['hazardTee'],
};

const paYellow = [playAsLies(), strokeAndDistance({ rule: '규칙 17.1d(1)' }), backOnLinePA, dropZonePA, hazardTee];
const paRed = [playAsLies(), strokeAndDistance({ rule: '규칙 17.1d(1)' }), backOnLinePA, lateralPA, oppositePA, dropZonePA, hazardTee];

const freeRelief = (o = {}) => ({
  id: 'free',
  label: '무벌타 구제 받기',
  desc: '벌타 없음. 스탠스·스윙이 방해받을 때 받을 수 있습니다(단지 눈에 거슬리는 것은 해당 없음).',
  pen: 0,
  place: `가장 가까운 완전한 구제지점(같은 코스 구역, 홀에 가깝지 않게)에서 1${CL} 이내. ${DROP} 그린에서는 가장 가까운 지점에 플레이스.`,
  rule: '규칙 16.1',
  ...o,
});

const asItLies0 = (rule) => ({ id: 'asis', label: '구제받지 않고 그대로 치기', pen: 0, place: '공이 있는 그 자리.', rule });

// ───── 상황 카탈로그 ─────
// node: {question, answers:[{label, desc, node}]}  또는  {options:[...]}
export const CATEGORIES = [
  {
    id: 'ob',
    icon: '⛳',
    title: 'OB · 분실구 · 잠정구',
    situations: [
      {
        id: 'ob',
        title: '공이 OB(아웃 오브 바운즈)로 나감',
        voice: ['오비', 'ob', '아웃'],
        summary: '흰 말뚝·흰 선 밖으로 나갔음이 확실할 때. OB 여부가 불확실하면 먼저 잠정구를 치세요.',
        node: {
          options: [
            strokeAndDistance({ rule: '규칙 18.2b' }),
            e5,
            obTee,
            {
              id: 'goprov',
              label: 'OB인지 확실하지 않음 → 잠정구 치기',
              action: 'goto',
              goto: 'prov',
            },
          ],
        },
      },
      {
        id: 'lost',
        title: '공을 찾지 못함 (분실구)',
        voice: ['분실', '로스트', '못 찾'],
        summary: '찾기 시작한 뒤 3분 안에 찾지 못하면 분실구입니다.',
        node: {
          question: '공이 어디에서 없어졌는지 알 수 있나요?',
          answers: [
            {
              label: '모름 / 그냥 못 찾음',
              node: { options: [strokeAndDistance({ rule: '규칙 18.2b' }), e5, obTee] },
            },
            {
              label: '페널티구역(해저드) 안에 들어간 것이 확실',
              desc: '눈으로 봤거나 다른 곳일 가능성이 거의 없을 때',
              node: { options: [{ id: 'gopa', label: '페널티구역 처리로 이동', action: 'goto', goto: 'pa' }] },
            },
            {
              label: '수리지·카트도로 등 비정상 코스상태 안에서 없어진 것이 확실',
              node: {
                options: [
                  freeRelief({
                    label: '무벌타 구제 (대체 공 사용)',
                    place: `공이 그 구역 경계를 마지막으로 넘은 지점을 기준으로 가장 가까운 완전한 구제지점에서 1${CL} 이내. ${DROP}`,
                    rule: '규칙 16.1e',
                  }),
                ],
              },
            },
            {
              label: '동물·다른 사람이 가져갔거나 움직인 것이 확실',
              node: {
                options: [
                  {
                    id: 'outside',
                    label: '벌타 없이 원래 있던 곳에 다른 공 놓기',
                    pen: 0,
                    place: '공이 있었던 곳(추정 지점)에 다른 공을 리플레이스.',
                    rule: '규칙 9.6',
                  },
                ],
              },
            },
          ],
        },
      },
      {
        id: 'prov',
        title: '잠정구 치기',
        voice: ['잠정구', '프로비저널'],
        summary: '원구가 OB이거나 페널티구역 밖에서 분실됐을 가능성이 있을 때. 치기 전에 반드시 "잠정구 칩니다"라고 선언하세요.',
        node: {
          question: '치기 전에 "잠정구"라고 선언했나요?',
          answers: [
            {
              label: '네, 잠정구라고 말하고 쳤다 / 칠 예정',
              node: {
                options: [
                  {
                    id: 'prov',
                    label: '잠정구 플레이 시작',
                    desc: '원구가 판정될 때까지 앱이 원구와 잠정구 타수를 따로 계산합니다. 잠정구로 친 샷도 [샷 +1]로 기록하세요.',
                    action: 'provisional',
                    place: '직전 샷을 한 곳(티샷이면 티잉구역).',
                    rule: '규칙 18.3',
                  },
                ],
              },
            },
            {
              label: '아니요, 선언 없이 그냥 다시 쳤다',
              desc: '이 경우 새 공이 바로 인플레이가 되고 원구는 포기됩니다.',
              node: {
                options: [
                  strokeAndDistance({
                    label: '새 공이 인플레이 (스트로크와 거리)',
                    desc: '1벌타. 원구를 나중에 찾아도 칠 수 없습니다.',
                    place: '방금 친 새 공을 그대로 이어서 플레이.',
                    rule: '규칙 18.3b',
                  }),
                ],
              },
            },
          ],
        },
      },
      {
        id: 'provres',
        title: '잠정구 정리 (원구 찾음 / 못 찾음)',
        voice: ['찾았', '원구'],
        summary: '잠정구를 친 뒤 원구 상태가 확인되면 선택하세요.',
        node: {
          options: [
            {
              id: 'found',
              label: '원구를 3분 안에 코스 안(OB 아님)에서 찾음',
              desc: '잠정구는 포기. 잠정구로 친 타수와 1벌타가 모두 취소되고 원구로 계속합니다.',
              action: 'resolve',
              keep: 'original',
              place: '원구가 있는 그 자리.',
              rule: '규칙 18.3c(3)',
              requires: ['provisional'],
            },
            {
              id: 'notfound',
              label: '원구가 OB이거나 3분 안에 못 찾음',
              desc: '잠정구가 인플레이. 1벌타 + 잠정구로 친 타수가 모두 인정됩니다.',
              action: 'resolve',
              keep: 'provisional',
              place: '잠정구로 계속 플레이.',
              rule: '규칙 18.3c(2)',
              requires: ['provisional'],
            },
            {
              id: 'nearer',
              label: '원구가 있을 만한 곳보다 홀에 가까운 곳에서 잠정구를 쳤음',
              desc: '그 순간 잠정구가 자동으로 인플레이가 되고 원구는 분실구가 됩니다(나중에 찾아도 무효).',
              action: 'resolve',
              keep: 'provisional',
              place: '잠정구로 계속 플레이.',
              rule: '규칙 18.3c(2)',
              requires: ['provisional'],
            },
            {
              id: 'inpa',
              label: '원구를 페널티구역(해저드) 안에서 찾음',
              desc: '잠정구는 반드시 포기. 원구를 페널티구역 규칙으로 처리합니다.',
              action: 'resolve',
              keep: 'original',
              then: 'pa',
              rule: '규칙 18.3c(3)',
              requires: ['provisional'],
            },
            {
              id: 'unpl',
              label: '원구를 찾았지만 칠 수 없는 곳 (언플레이어블)',
              desc: '잠정구를 대신 쓸 수는 없습니다. 원구로 언플레이어블 처리를 합니다.',
              action: 'resolve',
              keep: 'original',
              then: 'unplayable',
              rule: '규칙 18.3c 해석',
              requires: ['provisional'],
            },
          ],
        },
      },
    ],
  },
  {
    id: 'pa',
    icon: '💧',
    title: '페널티구역 (해저드·물)',
    situations: [
      {
        id: 'pa',
        title: '공이 페널티구역(해저드)에 들어감',
        voice: ['해저드', '물', '페널티', '워터'],
        summary: '들어간 것이 확실하거나 거의 확실할 때만 적용. 확실하지 않으면 분실구로 처리해야 합니다.',
        node: {
          question: '말뚝·선의 색깔은?',
          answers: [
            { label: '노란색', desc: '구제 방법 3가지(+로컬룰)', node: { options: paYellow } },
            { label: '빨간색', desc: '측면 구제까지 가능', node: { options: paRed } },
            {
              label: '모르겠음',
              desc: '색 표시가 아예 없으면 빨간색으로 봅니다. 표시는 있는데 모르겠다면 노란색 기준(공통 방법)만 표시합니다.',
              node: { options: paYellow },
            },
          ],
        },
      },
      {
        id: 'pa2',
        title: '페널티구역 안에서 친 공이 또 문제가 됨',
        summary: '페널티구역 안에서 그대로 쳤는데 결과가 나쁠 때의 특별 규칙.',
        node: {
          question: '친 공이 어떻게 됐나요?',
          answers: [
            {
              label: '여전히(또는 다시) 같은 페널티구역 안',
              node: {
                options: [
                  playAsLies({ rule: '규칙 17.2a' }),
                  {
                    ...strokeAndDistance(),
                    label: '페널티구역 안 직전 위치에서 다시',
                    rule: '규칙 17.2a(1)',
                  },
                  {
                    id: 'lastout',
                    label: '페널티구역 밖에서 마지막으로 친 곳으로 돌아가기',
                    pen: 1,
                    place: `페널티구역 밖에서 마지막으로 스트로크한 지점 기준 1${CL} 이내. ${DROP}`,
                    rule: '규칙 17.2a(2)',
                  },
                  { ...backOnLinePA, desc: '1벌타. 이번에 경계를 넘은 지점 기준.', rule: '규칙 17.2a(1)' },
                  { ...lateralPA, desc: '1벌타. 빨간 구역일 때만.', rule: '규칙 17.2a(1)' },
                ],
              },
            },
            {
              label: 'OB가 됐거나 분실, 또는 언플레이어블 선언',
              node: {
                options: [
                  {
                    ...strokeAndDistance(),
                    label: '페널티구역 안 직전 위치에서 다시 (1벌타)',
                    rule: '규칙 17.2b',
                  },
                  {
                    id: 'pa2out',
                    label: '추가 1벌타로 페널티구역 밖에서 구제 (총 2벌타)',
                    desc: '직전 위치에서 1벌타 구제 후, 처음 들어간 경계 지점을 기준으로 한 번 더 1벌타 구제(후방선·측면·페널티구역 밖 마지막 위치).',
                    pen: 2,
                    place: `처음 ${PA_PASS} 기준 후방선 또는(빨간 구역) 측면 2${CL}, 또는 페널티구역 밖에서 마지막으로 친 곳.`,
                    rule: '규칙 17.2b',
                  },
                ],
              },
            },
          ],
        },
      },
    ],
  },
  {
    id: 'unpl',
    icon: '🌳',
    title: '언플레이어블 (나무·덤불·벙커)',
    situations: [
      {
        id: 'unplayable',
        title: '칠 수 없다고 판단 (언플레이어블)',
        voice: ['언플레이어블', '언플', '못 치'],
        summary: '나무 밑·덤불·바위 옆·벙커 턱 등. 선언은 본인만 할 수 있고, 페널티구역 안에서는 불가.',
        node: {
          question: '공이 어디에 있나요?',
          answers: [
            {
              label: '일반 구역 (페어웨이·러프·숲·나무 위 등)',
              node: {
                options: [
                  strokeAndDistance({ rule: '규칙 19.2a' }),
                  {
                    id: 'ubol',
                    label: '후방선 구제',
                    pen: 1,
                    place: `홀과 공을 잇는 직선의 후방 선상에 기준점, 기준점에서 1${CL} 이내. ${DROP}`,
                    rule: '규칙 19.2b',
                  },
                  {
                    id: 'ulat',
                    label: '측면 구제 (2클럽 길이)',
                    pen: 1,
                    place: `공이 있는 곳(나무 위라면 그 바로 아래 지면)에서 2${CL} 이내, 홀에 가깝지 않게. ${DROP}`,
                    rule: '규칙 19.2c',
                  },
                ],
              },
            },
            {
              label: '벙커 안',
              node: {
                options: [
                  strokeAndDistance({ desc: '1벌타. 직전 샷이 벙커 밖이었다면 벙커 밖으로 나갈 수 있습니다.', rule: '규칙 19.3a' }),
                  {
                    id: 'bbol',
                    label: '벙커 안 후방선 구제',
                    pen: 1,
                    place: `벙커 안, 홀과 공을 잇는 후방 선상에서 1${CL} 이내. ${DROP}`,
                    rule: '규칙 19.3a',
                  },
                  {
                    id: 'blat',
                    label: '벙커 안 측면 구제',
                    pen: 1,
                    place: `벙커 안, 공에서 2${CL} 이내·홀에 가깝지 않게. ${DROP}`,
                    rule: '규칙 19.3a',
                  },
                  {
                    id: 'bout',
                    label: '벙커 밖 후방선 구제',
                    desc: '2벌타. 벙커를 벗어날 수 있는 추가 선택지.',
                    pen: 2,
                    place: `벙커 밖, 홀과 공을 잇는 후방 선상에서 1${CL} 이내. ${DROP}`,
                    rule: '규칙 19.3b',
                  },
                ],
              },
            },
            {
              label: '페널티구역(해저드) 안',
              desc: '언플레이어블 선언 불가',
              node: { options: [{ id: 'gopa', label: '페널티구역 처리로 이동', desc: '그대로 치거나 1벌타 구제', action: 'goto', goto: 'pa' }] },
            },
          ],
        },
      },
      {
        id: 'bunkerstuck',
        title: '벙커에서 몇 번 쳐도 못 나옴',
        voice: ['벙커'],
        summary: '벙커 안에서 헛치거나 못 빠져나온 샷은 모두 타수로 셉니다. 계속 어렵다면 언플레이어블을 고려하세요.',
        node: {
          options: [
            { id: 'bstroke', label: '그냥 한 번 더 쳤음 (1타 기록)', action: 'stroke', pen: 0, place: '공이 있는 곳.', rule: '규칙 10.1' },
            { id: 'gounpl', label: '언플레이어블 처리로 이동', desc: '벙커 밖 후방선(2벌타) 등', action: 'goto', goto: 'unplayable' },
          ],
        },
      },
    ],
  },
  {
    id: 'free',
    icon: '🛞',
    title: '무벌타 구제 (카트도로·수리지 등)',
    situations: [
      {
        id: 'obstruction',
        title: '카트도로·스프링클러·배수구 등 (움직일 수 없는 장해물)',
        voice: ['카트', '도로', '카트도로'],
        summary: '공이 위에 있거나 스탠스·스윙에 방해될 때. 페널티구역 안에서는 무벌타 구제 불가.',
        node: {
          question: '공이 어디에 있나요?',
          answers: [
            { label: '일반 구역', node: { options: [freeRelief(), asItLies0('규칙 16.1')] } },
            {
              label: '벙커 안',
              node: {
                options: [
                  freeRelief({ label: '벙커 안에서 무벌타 구제', place: `벙커 안의 가장 가까운 완전한 구제지점에서 1${CL} 이내. ${DROP}`, rule: '규칙 16.1c(1)' }),
                  {
                    id: 'bout',
                    label: '벙커 밖 후방선 구제',
                    pen: 1,
                    place: `벙커 밖, 홀과 공을 잇는 후방 선상에서 1${CL} 이내. ${DROP}`,
                    rule: '규칙 16.1c(2)',
                  },
                  asItLies0('규칙 16.1'),
                ],
              },
            },
            {
              label: '퍼팅 그린',
              node: { options: [freeRelief({ place: '가장 가까운 완전한 구제지점에 플레이스(드롭 아님). 그린 밖이어도 됩니다.', rule: '규칙 16.1d' }), asItLies0('규칙 16.1')] },
            },
            { label: '페널티구역 안', node: { options: [{ id: 'gopa', label: '무벌타 구제 불가 → 페널티구역 처리', action: 'goto', goto: 'pa' }] } },
          ],
        },
      },
      {
        id: 'gur',
        title: '수리지(GUR)·일시적인 물(캐주얼 워터)·동물 구멍',
        voice: ['수리지', '캐주얼', '웅덩이'],
        summary: '흰 선이나 "수리지" 표시, 비 온 뒤 고인 물, 두더지 구멍 등.',
        node: {
          question: '공이 어디에 있나요?',
          answers: [
            { label: '일반 구역', node: { options: [freeRelief({ rule: '규칙 16.1b' }), asItLies0('규칙 16.1')] } },
            {
              label: '벙커 안 (벙커에 물 고임 등)',
              node: {
                options: [
                  freeRelief({ label: '벙커 안에서 무벌타 구제', place: `벙커 안의 가장 가까운 완전한 구제지점(완전한 곳이 없으면 최대한 덜 방해되는 곳)에서 1${CL} 이내. ${DROP}`, rule: '규칙 16.1c(1)' }),
                  { id: 'bout', label: '벙커 밖 후방선 구제', pen: 1, place: `벙커 밖, 홀과 공을 잇는 후방 선상. ${DROP}`, rule: '규칙 16.1c(2)' },
                  asItLies0('규칙 16.1'),
                ],
              },
            },
            { label: '퍼팅 그린 (그린 위 물 등)', node: { options: [freeRelief({ place: '가장 가까운 완전한 구제지점에 플레이스.', rule: '규칙 16.1d' })] } },
          ],
        },
      },
      {
        id: 'embedded',
        title: '공이 땅에 박힘 (박힌 공)',
        summary: '자기가 친 샷의 충격으로 생긴 자국에 박혀 일부가 지면 아래에 있을 때.',
        node: {
          question: '공이 어디에 박혔나요?',
          answers: [
            {
              label: '일반 구역 (페어웨이·러프)',
              node: {
                options: [
                  freeRelief({
                    label: '집어서 닦고 드롭',
                    place: `공 바로 뒤 지점에서 1${CL} 이내, 홀에 가깝지 않게, 일반 구역에. ${DROP}`,
                    rule: '규칙 16.3',
                  }),
                ],
              },
            },
            { label: '벙커 안 (에그 프라이)', desc: '무벌타 구제 없음', node: { options: [{ id: 'gounpl', label: '그대로 치거나 언플레이어블', action: 'goto', goto: 'unplayable' }] } },
            { label: '퍼팅 그린 (볼 마크)', node: { options: [{ id: 'repair', label: '마크하고 집어 볼 마크 수리 후 리플레이스', pen: 0, place: '원래 자리.', rule: '규칙 13.1c' }] } },
          ],
        },
      },
      {
        id: 'wronggreen',
        title: '공이 다른 홀 그린 위에 있음 (잘못된 그린)',
        summary: '구제가 의무입니다. 그대로 치면 2벌타.',
        node: {
          options: [
            freeRelief({ label: '무벌타 구제 (의무)', place: `그 그린 밖의 가장 가까운 완전한 구제지점에서 1${CL} 이내. ${DROP}`, rule: '규칙 13.1f' }),
            { id: 'played', label: '구제 없이 그대로 쳐버렸음', pen: 2, rule: '규칙 13.1f', place: '친 공이 멈춘 곳에서 계속.' },
          ],
        },
      },
      {
        id: 'nopl',
        title: '플레이 금지구역 (화단·보호구역 등)',
        summary: '위원회가 지정한 구역. 구제가 의무입니다.',
        node: {
          question: '플레이 금지구역이 어디에 있나요?',
          answers: [
            { label: '일반 구역 (비정상 코스상태)', node: { options: [freeRelief({ label: '무벌타 구제 (의무)', rule: '규칙 16.1f' })] } },
            { label: '페널티구역 안', node: { options: [{ id: 'gopa', label: '1벌타 페널티구역 구제 (의무)', action: 'goto', goto: 'pa' }] } },
          ],
        },
      },
      {
        id: 'movable',
        title: '움직일 수 있는 장해물 (고무래·캔·병·표지판 등)',
        summary: '어디에서든 치울 수 있습니다.',
        node: {
          options: [
            { id: 'remove', label: '치웠다 (공이 움직였어도 리플레이스)', pen: 0, place: '공이 움직였다면 원래 자리에 리플레이스.', rule: '규칙 15.2a' },
            {
              id: 'onit',
              label: '공이 장해물 위에 있었음 (고무래 등)',
              pen: 0,
              place: `공을 집고 장해물을 치운 뒤, 공 바로 아래 추정 지점 기준 1${CL} 이내 드롭(그린은 플레이스).`,
              rule: '규칙 15.2a(2)',
            },
          ],
        },
      },
      {
        id: 'loose',
        title: '루스임페디먼트 (낙엽·돌·나뭇가지·벌레)',
        summary: '어디서든 치울 수 있지만, 치우다가 공이 움직이면 장소에 따라 벌타.',
        node: {
          options: [
            { id: 'ok', label: '치웠고 공은 안 움직임', pen: 0, rule: '규칙 15.1a', place: '공이 있는 곳.' },
            { id: 'moved', label: '치우다 공이 움직임 (일반구역·벙커·페널티구역)', pen: 1, place: '원래 자리에 리플레이스.', rule: '규칙 15.1b' },
            { id: 'green', label: '그린 위에서 치우다 공이 움직임', pen: 0, place: '원래 자리에 리플레이스.', rule: '규칙 13.1d' },
          ],
        },
      },
      {
        id: 'unfit',
        title: '공이 깨지거나 금이 감 / 진흙이 묻음',
        node: {
          question: '공 상태는?',
          answers: [
            {
              label: '깨짐·금감 (플레이 중 손상)',
              node: { options: [{ id: 'swap', label: '마크하고 확인 후 다른 공으로 교체', pen: 0, place: '같은 자리에 새 공을 리플레이스.', rule: '규칙 4.2c' }] },
            },
            {
              label: '흠집·긁힘·진흙만 묻음',
              desc: '교체 불가',
              node: {
                options: [
                  { id: 'asis', label: '그대로 치기', pen: 0, rule: '규칙 4.2c', place: '공이 있는 곳.' },
                  {
                    id: 'pref',
                    label: '프리퍼드 라이: 집어서 닦고 놓기',
                    desc: '골프장이 E-3을 채택했을 때 일반구역(대개 잘 깎인 곳)에서만.',
                    pen: 0,
                    mode: 'local',
                    requires: ['preferredLies'],
                    place: '원래 자리에서 정해진 거리(보통 한 뼘 또는 1클럽) 이내에 플레이스.',
                    rule: '모델 로컬룰 E-3',
                  },
                ],
              },
            },
          ],
        },
      },
      {
        id: 'danger',
        title: '위험한 동물 근처 (벌집·뱀 등)',
        node: { options: [freeRelief({ label: '무벌타 구제', place: `위험하지 않은 가장 가까운 지점 기준 1${CL} 이내 드롭.`, rule: '규칙 16.2' })] },
      },
    ],
  },
  {
    id: 'move',
    icon: '🎯',
    title: '공이 움직임 · 맞음',
    situations: [
      {
        id: 'moved',
        title: '내가(내 캐디·장비가) 공을 움직임',
        summary: '어드레스 중 툭 건드림, 실수로 발로 참 등.',
        node: {
          question: '언제·어디서 움직였나요?',
          answers: [
            { label: '일반구역·벙커에서 (찾는 중 아님)', node: { options: [{ id: 'm1', label: '원래 자리에 리플레이스', pen: 1, place: '원래 자리(모르면 추정 지점).', rule: '규칙 9.4b' }, { id: 'm1x', label: '리플레이스하지 않고 그냥 쳤음', desc: '잘못된 장소 플레이. 1벌타 대신 총 2벌타.', pen: 2, rule: '규칙 9.4b·14.7', place: '친 공이 멈춘 곳에서 계속.' }] } },
            { label: '공을 찾다가', node: { options: [{ id: 'm2', label: '원래 자리에 리플레이스', pen: 0, place: '원래 자리(모르면 추정 지점).', rule: '규칙 7.4' }] } },
            { label: '퍼팅 그린 위에서', node: { options: [{ id: 'm3', label: '원래 자리에 리플레이스', pen: 0, place: '원래 자리.', rule: '규칙 13.1d' }] } },
            { label: '티 위의 공 (티샷 전)', desc: '아직 인플레이 아님', node: { options: [{ id: 'm4', label: '다시 티업', pen: 0, place: '티잉구역 안.', rule: '규칙 6.2b' }] } },
            { label: '마크·측정 등 규칙을 적용하다가', node: { options: [{ id: 'm5', label: '원래 자리에 리플레이스', pen: 0, place: '원래 자리.', rule: '규칙 9.4b 예외' }] } },
          ],
        },
      },
      {
        id: 'practice',
        title: '연습 스윙하다가 공을 맞힘',
        summary: '칠 의도가 없었으므로 스트로크가 아닙니다.',
        node: {
          question: '어디에서?',
          answers: [
            { label: '티 위의 공', node: { options: [{ id: 'p1', label: '다시 티업', pen: 0, place: '티잉구역 안.', rule: '규칙 6.2b' }] } },
            { label: '그 밖의 곳 (일반구역·벙커)', node: { options: [{ id: 'p2', label: '원래 자리에 리플레이스', pen: 1, place: '원래 자리.', rule: '규칙 9.4b' }] } },
            { label: '퍼팅 그린', node: { options: [{ id: 'p3', label: '원래 자리에 리플레이스', pen: 0, place: '원래 자리.', rule: '규칙 13.1d' }] } },
          ],
        },
      },
      {
        id: 'natural',
        title: '바람·경사 등 자연의 힘으로 공이 움직임',
        node: {
          question: '어떤 상황인가요?',
          answers: [
            { label: '일반적인 경우', node: { options: [{ id: 'n1', label: '새로 멈춘 곳에서 그대로 치기', pen: 0, place: '공이 새로 멈춘 곳 (OB로 나가면 OB 처리).', rule: '규칙 9.3' }] } },
            { label: '그린에서 마크 후 리플레이스한 공이 움직임', node: { options: [{ id: 'n2', label: '원래 자리에 다시 리플레이스', pen: 0, place: '원래 자리.', rule: '규칙 13.1d(2)' }] } },
          ],
        },
      },
      {
        id: 'outside',
        title: '다른 사람·동물·다른 공이 내 공을 움직임',
        node: { options: [{ id: 'o1', label: '원래 자리에 리플레이스', pen: 0, place: '원래 자리(모르면 추정 지점).', rule: '규칙 9.6' }] },
      },
      {
        id: 'deflect',
        title: '친 공이 사람·장비·카트에 맞음',
        summary: '나 자신, 캐디, 내 백·카트, 다른 사람 등에 우연히 맞은 경우.',
        node: {
          options: [
            { id: 'd1', label: '우연히 맞음 → 멈춘 곳에서 그대로', pen: 0, place: '공이 멈춘 곳.', rule: '규칙 11.1a' },
            { id: 'd2', label: '그린에서 친 공이 사람·동물에 맞음 → 다시 치기', pen: 0, void: 1, place: '원래 자리에서 다시 (그 스트로크는 무효).', rule: '규칙 11.1b 예외' },
            { id: 'd3', label: '움직이는 공을 고의로 막거나 방향을 바꿈', pen: 2, rule: '규칙 11.2', place: '규칙에 따라 처리 (위원회 확인).' },
          ],
        },
      },
      {
        id: 'double',
        title: '한 번 스윙에 공을 두 번 맞힘 (투터치)',
        node: { options: [{ id: 'dt', label: '1타로만 계산 (벌타 없음)', pen: 0, place: '공이 멈춘 곳.', rule: '규칙 10.1a', warn: '샷 자체는 [샷 +1]로 한 번만 기록하세요.' }] },
      },
      {
        id: 'whiff',
        title: '헛스윙 (치려고 했는데 공을 못 맞힘)',
        voice: ['헛스윙'],
        node: {
          options: [
            { id: 'w1', label: '치려는 의도로 휘둘렀음 → 1타로 기록', action: 'stroke', pen: 0, place: '공이 있는 그 자리.', rule: '규칙 1.2·스트로크 정의' },
            { id: 'w2', label: '다운스윙 중 스스로 멈췄음 → 타수 아님', action: 'note', pen: 0, place: '공이 있는 그 자리.', rule: '스트로크 정의' },
          ],
        },
      },
    ],
  },
  {
    id: 'green',
    icon: '🟢',
    title: '그린 위 상황',
    situations: [
      {
        id: 'ballball',
        title: '그린에서 친 공이 그린 위 다른 공을 맞힘',
        summary: '스트로크 플레이에서 두 공이 모두 그린 위에 있었다면 친 사람에게 2벌타.',
        node: {
          options: [
            { id: 'bb', label: '2벌타, 내 공은 멈춘 곳에서', pen: 2, place: '내 공은 멈춘 곳, 맞은 공은 원래 자리에 리플레이스.', rule: '규칙 11.1a' },
            { id: 'bb0', label: '그린 밖에서 쳤음 → 벌타 없음', pen: 0, place: '공이 멈춘 곳.', rule: '규칙 11.1a' },
          ],
        },
      },
      {
        id: 'flag',
        title: '공이 깃대에 맞음 / 홀 가장자리에 걸림',
        node: {
          question: '어떤 상황인가요?',
          answers: [
            { label: '깃대에 맞음 (꽂혀 있거나 잡고 있던 깃대)', node: { options: [{ id: 'f0', label: '벌타 없음, 멈춘 곳에서', pen: 0, place: '공이 멈춘 곳.', rule: '규칙 13.2' }] } },
            {
              label: '깃대에 기댄 채 멈춤',
              node: { options: [{ id: 'f1', label: '공 일부가 그린 표면 아래 → 홀인', pen: 0, holeout: true, rule: '규칙 13.2c', place: '홀아웃.' }] },
            },
            {
              label: '홀 가장자리에 걸려 있다가 떨어짐',
              node: {
                options: [
                  { id: 'h10', label: '홀에 다가간 뒤 10초 안에 떨어짐', desc: '직전 스트로크로 홀인.', pen: 0, holeout: true, rule: '규칙 13.3a', place: '홀아웃.' },
                  { id: 'h11', label: '10초가 지난 뒤 떨어짐', desc: '직전 스트로크로 홀인하되 1벌타.', pen: 1, holeout: true, rule: '규칙 13.3a', place: '홀아웃.' },
                ],
              },
            },
          ],
        },
      },
      {
        id: 'nomark',
        title: '마크하지 않고 공을 집어 올림',
        node: { options: [{ id: 'nm', label: '원래 자리에 리플레이스', pen: 1, place: '원래 자리.', rule: '규칙 14.1a' }] },
      },
      {
        id: 'testsurface',
        title: '그린 표면을 문지르거나 공을 굴려 테스트',
        node: { options: [{ id: 'ts', label: '일반 페널티', pen: 2, place: '공이 있는 곳.', rule: '규칙 13.1e' }] },
      },
      {
        id: 'repair',
        title: '볼 마크·스파이크 자국 수리, 퍼팅 라인 터치',
        summary: '현재 규칙에서는 대부분 허용됩니다.',
        node: { options: [{ id: 'rp', label: '허용 — 벌타 없음', action: 'note', pen: 0, place: '그대로 진행.', rule: '규칙 13.1c' }] },
      },
      {
        id: 'caddie',
        title: '캐디가 퍼팅(샷) 라인 후방에 서 있었음',
        node: { options: [{ id: 'cd', label: '스탠스를 취할 때 캐디가 뒤에 있었음', pen: 2, place: '공이 있는 곳.', rule: '규칙 10.2b(4)' }] },
      },
    ],
  },
  {
    id: 'breach',
    icon: '⚠️',
    title: '규칙 위반 (주로 2벌타)',
    situations: [
      {
        id: 'wrongball',
        title: '다른 사람 공(잘못된 공)을 침',
        voice: ['잘못된 공', '남의 공'],
        summary: '잘못된 공으로 친 타수는 모두 무효, 2벌타. 다음 홀 티샷 전까지 내 공으로 바로잡지 않으면 실격.',
        node: {
          options: [
            {
              id: 'wb',
              label: '2벌타 + 잘못된 공 타수 무효',
              pen: 2,
              count: { label: '잘못된 공으로 친 샷을 앱에 몇 타 입력했나요?', max: 10 },
              place: '내 공을 찾아 원래 있던 곳에서 플레이 (못 찾으면 분실구 처리).',
              rule: '규칙 6.3c',
              warn: '반드시 내 공으로 바로잡으세요. 그대로 다음 홀 티샷 시 실격.',
            },
            { id: 'wbpa', label: '페널티구역 안 물에 떠 있는 공 등을 착각', desc: '잘못된 공 규칙은 동일하게 적용됩니다.', pen: 2, count: { label: '그 공으로 친 샷을 몇 타 입력했나요?', max: 10 }, place: '내 공을 찾아 원래 있던 곳에서.', rule: '규칙 6.3c' },
          ],
        },
      },
      {
        id: 'wrongplace',
        title: '잘못된 장소에서 침 (드롭 위치 착오 등)',
        node: {
          options: [
            { id: 'wp', label: '잘못된 장소에서 플레이', desc: '일반 페널티. 크게 이득을 본 "중대한 위반"이면 바로잡지 않을 경우 실격.', pen: 2, place: '친 공이 멈춘 곳에서 계속(중대한 위반이면 바른 장소에서 다시).', rule: '규칙 14.7', warn: '중대한 위반 여부는 위원회 판정 대상입니다.' },
            { id: 'wd', label: '드롭 방법만 틀림 (구제구역은 맞음) 후 플레이', desc: '예: 어깨 높이에서 드롭.', pen: 1, place: '공이 멈춘 곳에서 계속.', rule: '규칙 14.3b(3)' },
            { id: 'wdfix', label: '치기 전에 잘못된 드롭을 알아차림', desc: '다시 드롭하면 벌타 없음.', pen: 0, place: '바른 방법으로 다시 드롭.', rule: '규칙 14.5' },
          ],
        },
      },
      {
        id: 'teeout',
        title: '티잉구역 밖(티마커 앞)에서 티샷',
        summary: '그 샷은 무효이고 2벌타, 티잉구역 안에서 다시 칩니다.',
        node: {
          options: [
            { id: 'to', label: '2벌타 + 그 샷 무효 → 다시 티샷', pen: 2, void: 1, place: '티잉구역 안에서 다시 티샷 (예: 다음 샷이 4타째가 아니라 3타째).', rule: '규칙 6.1b', warn: '먼저 [샷 +1]로 그 티샷을 기록한 뒤 이 처리를 선택하세요.' },
          ],
        },
      },
      {
        id: 'improve',
        title: '라이·스탠스·스윙 구역 개선',
        summary: '나뭇가지 꺾기, 뒤땅 누르기, 디봇 메우기 등.',
        node: { options: [{ id: 'im', label: '일반 페널티', pen: 2, place: '공이 있는 곳.', rule: '규칙 8.1a' }] },
      },
      {
        id: 'sand',
        title: '벙커에서 클럽이 모래에 닿음',
        node: {
          options: [
            { id: 's1', label: '어드레스·연습스윙·백스윙 때 모래 접촉', pen: 2, place: '공이 있는 곳.', rule: '규칙 12.2b(1)' },
            { id: 's2', label: '클럽을 기대어 놓음·발자국 정리(공 상태 개선 없음)', desc: '허용', action: 'note', pen: 0, place: '공이 있는 곳.', rule: '규칙 12.2b(2)' },
          ],
        },
      },
      {
        id: 'paground',
        title: '페널티구역에서 클럽을 땅·물에 댐, 낙엽 치움',
        summary: '2019년부터 허용됩니다.',
        node: { options: [{ id: 'pg', label: '허용 — 벌타 없음', action: 'note', pen: 0, place: '공이 있는 곳.', rule: '규칙 17.1b' }] },
      },
      {
        id: 'advice',
        title: '다른 플레이어에게 조언을 주거나 구함 (클럽 선택 등)',
        node: { options: [{ id: 'ad', label: '일반 페널티', pen: 2, place: '그대로 진행.', rule: '규칙 10.2a', warn: '같은 편 파트너·캐디에게는 허용됩니다.' }] },
      },
      {
        id: 'clubs',
        title: '클럽 14개 초과',
        node: { options: [{ id: 'cl', label: '위반이 있었던 홀마다 2벌타 (라운드 최대 4벌타)', pen: 2, place: '알게 된 즉시 초과 클럽을 사용 중지 선언.', rule: '규칙 4.1b', warn: '라운드 전체 최대 4벌타 — 첫 두 홀에만 적용하세요.' }] },
      },
      {
        id: 'practiceshot',
        title: '홀 플레이 중 연습 샷',
        node: { options: [{ id: 'ps', label: '일반 페널티', pen: 2, place: '그대로 진행.', rule: '규칙 5.5a', warn: '홀 사이 직전 그린 근처 퍼팅·치핑 연습은 허용.' }] },
      },
      {
        id: 'late',
        title: '출발 시각에 늦음 (5분 이내)',
        node: { options: [{ id: 'lt', label: '첫 홀에 일반 페널티', pen: 2, place: '그대로 진행.', rule: '규칙 5.3a', warn: '5분 넘게 늦으면 실격.' }] },
      },
      {
        id: 'dq',
        title: '실격 사유 (비공인 장비·스코어 오기 등)',
        node: {
          options: [
            { id: 'dq1', label: '비공인 클럽·공 사용, 플레이 중 성능 바꾼 클럽 사용', action: 'note', pen: 0, rule: '규칙 4.1a·4.2a', warn: '공식 경기라면 실격 사유입니다.', place: '위원회에 알리세요.' },
            { id: 'dq2', label: '스코어카드에 실제보다 낮은 타수 제출', action: 'note', pen: 0, rule: '규칙 3.3b', warn: '낮게 적으면 실격, 높게 적으면 그 타수가 확정됩니다.', place: '제출 전 반드시 확인.' },
          ],
        },
      },
      {
        id: 'twoballs',
        title: '규칙을 잘 모르겠음 → 두 개의 공으로 플레이',
        summary: '스트로크 플레이에서 처리 방법이 애매할 때, 두 공으로 끝까지 친 뒤 스코어 제출 전에 위원회에 판정을 받습니다.',
        node: {
          options: [
            { id: 'tb', label: '두 공 플레이를 기록', action: 'note', pen: 0, place: '어느 공을 점수로 쓸지 먼저 선언하고 두 공 모두 홀아웃.', rule: '규칙 20.1c(3)', warn: '판정 후 [최종 타수 직접 입력]으로 이 홀 점수를 확정하세요.' },
          ],
        },
      },
    ],
  },
  {
    id: 'casual',
    icon: '🤝',
    title: '친선 라운드 관행 (비공식)',
    casual: true,
    situations: [
      {
        id: 'ok',
        title: 'OK (컨시드)',
        voice: ['오케이', 'ok', '컨시드'],
        summary: '동반자가 남은 퍼트를 인정. 1타를 더하고 홀아웃합니다.',
        node: { options: [{ id: 'ok', label: '1타 추가하고 홀아웃', action: 'concede', mode: 'casual', requires: ['casual', 'noProvisional'], place: '다음 홀로.', rule: '친선 관행 (스트로크 플레이 공식 규칙 아님)' }] },
      },
      {
        id: 'mulligan',
        title: '멀리건',
        voice: ['멀리건'],
        summary: '직전 샷을 없던 것으로 하고 벌타 없이 다시 칩니다.',
        node: { options: [{ id: 'mg', label: '직전 1타 무효, 다시 치기', action: 'mulligan', mode: 'casual', requires: ['casual'], place: '같은 곳에서 다시.', rule: '친선 관행' }] },
      },
      {
        id: 'pickup',
        title: '기브업 / 양파 (더블파)',
        voice: ['기브업', '양파'],
        summary: '홀을 포기하고 더블파(파의 2배)로 기록합니다.',
        node: { options: [{ id: 'pu', label: '홀 포기 → 더블파 처리', action: 'pickup', mode: 'casual', requires: ['casual'], place: '다음 홀로.', rule: '친선 관행' }] },
      },
      {
        id: 'ilpa',
        title: '일파만파 (첫 홀 전원 파)',
        node: { options: [{ id: 'ip', label: '이 홀을 파로 기록', action: 'par', mode: 'casual', requires: ['casual'], place: '다음 홀로.', rule: '친선 관행' }] },
      },
      {
        id: 'placing',
        title: '터치플레이 / 볼 옮겨놓기 (윈터룰)',
        node: { options: [{ id: 'tp', label: '벌타 없이 좋은 라이로 옮김', mode: 'casual', pen: 0, requires: ['casual'], place: '동반자와 합의한 범위 안.', rule: '친선 관행 (공식 대회는 E-3 로컬룰만 인정)' }] },
      },
    ],
  },
];

// 상황 id → 상황
export const SITUATIONS = Object.fromEntries(CATEGORIES.flatMap((c) => c.situations.map((s) => [s.id, { ...s, category: c.id }])));

/** 트리 안의 모든 처리 선택을 평탄하게 나열 (테스트·검색용) */
export function allOptions(node, path = []) {
  if (node.options) return node.options.map((o) => ({ option: o, path }));
  return node.answers.flatMap((a) => allOptions(a.node, [...path, a.label]));
}

export function findOption(sitId, optId, answerPath = []) {
  let node = SITUATIONS[sitId].node;
  for (const label of answerPath) node = node.answers.find((a) => a.label.startsWith(label)).node;
  return node.options.find((o) => o.id === optId);
}

export function penaltyOf(opt, ctx) {
  return typeof opt.pen === 'function' ? opt.pen(ctx) : opt.pen || 0;
}

/**
 * 현재 상황(ctx)에서 이 처리를 쓸 수 있는지.
 * ctx = { local, casual, provisionalActive, par }
 */
export function availability(opt, ctx) {
  for (const r of opt.requires || []) {
    if (r === 'casual' && !ctx.casual) return { ok: false, reason: '친선 라운드 모드에서만 사용할 수 있습니다.' };
    if (r === 'noProvisional' && ctx.provisionalActive) return { ok: false, reason: '잠정구를 이미 쳤으면 사용할 수 없습니다. 먼저 잠정구를 정리하세요.' };
    if (r === 'provisional' && !ctx.provisionalActive) return { ok: false, reason: '진행 중인 잠정구가 없습니다.' };
    if (LOCAL_RULES[r] && !ctx.local[r]) return { ok: false, reason: `골프장이 '${LOCAL_RULES[r].name}'를 운영할 때만 가능합니다. (설정에서 켜기)` };
  }
  return { ok: true };
}

/** 처리 선택 → 스코어 엔진 사건 */
export function buildEvent(sitId, opt, ctx, params = {}) {
  const sit = SITUATIONS[sitId];
  const base = { sit: sitId, opt: opt.id, label: `${sit.title} → ${opt.label}`, mode: opt.mode || 'official', rule: opt.rule };
  if (opt.warn) base.warn = opt.warn;
  switch (opt.action || 'penalty') {
    case 'stroke':
      return { ...base, type: 'stroke' };
    case 'provisional':
      return { ...base, type: 'provisional' };
    case 'resolve':
      return { ...base, type: 'resolve', keep: opt.keep };
    case 'mulligan':
    case 'concede':
    case 'pickup':
    case 'note':
      return { ...base, type: opt.action };
    case 'par':
      return { ...base, type: 'set_total', value: ctx.par };
    case 'goto':
      return null;
    default: {
      const ev = { ...base, type: 'penalty', n: penaltyOf(opt, ctx) };
      const v = opt.count ? params.count || 0 : opt.void || 0;
      if (v) ev.void = v;
      if (opt.holeout) ev.holeout = true;
      return ev;
    }
  }
}
