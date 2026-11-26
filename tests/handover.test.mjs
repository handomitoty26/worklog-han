// 인계함 모듈(handover.js) 시험 — 순수 함수·보낼 목록·동기화·두 사감 끝까지(가짜 서버)
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { boot, NOW, DAY, stamp } from "./gas-fake.mjs";

const require = createRequire(import.meta.url);
const H = require("../handover.js");
const { pure: P, LIM, K } = H;

const URL1 = "https://script.google.com/macros/s/AKfycbTEST1234567890/exec";
const URL2 = "https://script.google.com/macros/s/AKfycbOTHER123456789/exec";
const OTHER_CF = "0000abcd";
const READ_FAIL = "못 보낸 인계를 읽지 못했습니다 — 최근 인계는 말로 전달하세요";
const REJECTED = "서버가 받지 않은 인계가 있습니다 — 인계함에서 확인하세요";
const SHARE_FAIL = "공유 예약 실패 — 다시 시도하거나 말로 전달하세요";
const WD_FAIL = "공유 취소 예약 실패 — 다시 시도하거나 말로 전달하세요";
const J = x => JSON.parse(JSON.stringify(x));
const raw = code => code.replace(/-/g, "");
const hoRows = s => s.sheet("인계").rowsOf(10);
const ackRows = s => s.sheet("확인").rowsOf(6);

let recSeq = 0;
function rec(body, over = {}) {
  recSeq++;
  return { id: "rec" + String(recSeq).padStart(5, "0"), kind: "인계사항", date: "2026-11-25", time: "13:30", body, ...over };
}

// 보낼 목록 항목을 손으로 만듦
function ox(op, id, o = {}) {
  const kind = o.kind || "ack";
  const x = { op, id, cf: o.cf || OTHER_CF, me: o.me === undefined ? null : o.me, at: o.at ?? NOW, tries: o.tries ?? 0 };
  if (op === "post") Object.assign(x, { oid: "p:" + id, data: { id, date: o.date || "2026-11-25", time: "13:30", place: "", body: o.body || "본문 " + id } });
  else if (op === "ack") Object.assign(x, { oid: `a:${id}:${kind}`, data: { id, kind, memo: "" } });
  else Object.assign(x, { oid: "w:" + id, data: { id } });
  return x;
}

function memStore(init = {}) {
  const m = new Map(Object.entries(init));
  const st = {
    m, failGet: false, failSet: null,
    blocked: k => st.failSet === true || (st.failSet instanceof Set && st.failSet.has(k)),
    get(k) { if (st.failGet) throw new Error("읽기 실패"); return m.has(k) ? m.get(k) : null; },
    set(k, v) { if (st.blocked(k)) throw new Error("저장 공간 부족"); m.set(k, String(v)); },
    remove(k) { if (st.blocked(k)) throw new Error("지우기 실패"); m.delete(k); },
    json: k => (m.has(k) ? JSON.parse(m.get(k)) : null)
  };
  return st;
}

function fakeTimers(clock) {
  let seq = 0;
  const q = new Map();
  return {
    setTimeout: (f, ms) => { const id = ++seq; q.set(id, { f, at: clock.now + ms, every: 0 }); return id; },
    clearTimeout: id => { q.delete(id); },
    setInterval: (f, ms) => { const id = ++seq; q.set(id, { f, at: clock.now + ms, every: ms }); return id; },
    clearInterval: id => { q.delete(id); },
    // 시계를 옮기며 때가 된 타이머를 순서대로 부름
    advance(ms) {
      const end = clock.now + ms;
      for (;;) {
        let id = null, t = null;
        for (const [k, v] of q) if (v.at <= end && (!t || v.at < t.at)) { id = k; t = v; }
        if (!t) break;
        clock.now = t.at;
        if (t.every) t.at += t.every; else q.delete(id);
        t.f();
      }
      clock.now = end;
    },
    // 기기가 잠든 것처럼 시계만 옮김(타이머도 같이 밀림)
    jump(ms) { clock.now += ms; for (const v of q.values()) v.at += ms; },
    get size() { return q.size; }
  };
}

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function flush(n = 5) { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); }

// 가짜 서버(gas-fake)에 붙은 앱 하나(탭 하나)
function makeClient(s, opt = {}) {
  const clock = s.clock;
  const store = opt.store || memStore();
  const timers = fakeTimers(clock);
  const net = { down: false, hang: false, gate: null, drop: 0, raw: null, onFetch: null, calls: [] };
  const servers = opt.servers || { [URL1]: s };
  const log = { notify: [], alert: [], confirm: [] };
  const answers = [];
  // 다른 창이 저장소를 바꿨을 때 오는 알림(storage 이벤트) 흉내
  const listeners = new Set();
  const env = {
    test: true, store, now: () => clock.now,
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, setInterval: timers.setInterval, clearInterval: timers.clearInterval,
    AbortController, doc: opt.doc || null, locks: opt.locks || null,
    listen: f => { listeners.add(f); return () => { listeners.delete(f); }; },
    confirm: m => { log.confirm.push(m); return answers.length ? answers.shift() : true; },
    alert: m => { log.alert.push(m); },
    prompt: () => null,
    notify: m => { log.notify.push(m); },
    showOv() {}, closeOv() {},
    fetch(url, o) {
      const req = JSON.parse(o.body);
      const call = { url, op: req.op, req, o };
      net.calls.push(call);
      if (net.onFetch) net.onFetch(call);
      const srv = servers[url];
      if (net.down || !srv) return Promise.reject(new TypeError("Failed to fetch"));
      const hold = net.hang ? new Promise(() => {}) : net.gate ? net.gate.promise : Promise.resolve();
      const drop = net.drop > 0 ? (net.drop--, true) : false;
      const fixed = net.raw ? net.raw(req) : null;
      return new Promise((resolve, reject) => {
        const sig = o.signal;
        if (sig) sig.addEventListener("abort", () => reject(new Error("AbortError")), { once: true });
        // 앱이 포기해도 서버는 늦게라도 요청을 처리함
        hold.then(() => {
          let status = 200, text;
          if (fixed) ({ status, text } = fixed);
          else { srv.clock.now = clock.now; text = JSON.stringify(srv.call(o.body)); }
          if (drop) return reject(new TypeError("Failed to fetch"));
          resolve({ status, text: () => Promise.resolve(text) });
        });
      });
    }
  };
  const ho = H.create(env);
  return {
    ho, t: ho._t, S: ho._t.S, store, net, log, answers, timers, env, flush, listeners,
    fire(key) { [...listeners].forEach(f => f({ key })); },
    async tick(ms) { timers.advance(ms); await flush(); },
    async jump(ms) { timers.jump(ms); await flush(); },
    async connect(code, o = {}) {
      assert.equal(ho._t.saveCfg({ url: o.url || URL1, code, place: o.place || "" }), "저장했습니다");
      assert.equal(ho._t.setEnabled(true), "켰습니다");
      ho.start();
      await flush();
    },
    ops: () => net.calls.map(x => x.op)
  };
}

// 코드가 알림·저장소(설정 밖)·주소에 새지 않음
function noLeak(c, code) {
  const r = raw(code);
  for (const m of [...c.log.notify, ...c.log.alert, ...c.log.confirm]) assert.ok(!m.includes(r), "알림에 코드: " + m);
  for (const [k, v] of c.store.m) if (k !== K.cfg) assert.ok(!v.includes(r), "저장소에 코드: " + k);
  for (const x of c.net.calls) assert.ok(!x.url.includes(r), "주소에 코드");
}

test("순수 함수 — 자르기·코드·주소·설정·날짜·모양 검사", () => {
  assert.equal(P.cut("가나다", 2), "가나");
  assert.equal(P.cut("a\u{1F600}", 2), "a");
  assert.equal(P.cut(5, 3), "");
  assert.equal(P.cut("abc", 5), "abc");
  assert.equal(P.normCode(" abcd-efgh 2345 "), "ABCDEFGH2345");
  assert.equal(P.normCode(null), "");
  assert.ok(P.validUrl(URL1));
  for (const u of ["http://script.google.com/macros/s/AKfycbTEST1234567890/exec", URL1 + "?x=1", URL1.replace("/exec", "/dev"),
    "https://evil.example/macros/s/AKfycbTEST1234567890/exec", "https://script.google.com/macros/s/short/exec", 5]) assert.equal(P.validUrl(u), false, String(u));
  assert.ok(P.validCode("ABCDEFGH2345"));
  for (const c of ["ABCDEFGHI345", "ABCDEFGHO345", "ABCDEFGH0345", "ABCDEFGH1345", "abcdefgh2345", "ABCDEFGH234"]) assert.equal(P.validCode(c), false, c);
  assert.equal(P.fnv(""), "811c9dc5");
  assert.match(P.cfOf(URL1, "ABCDEFGH2345"), /^[0-9a-f]{8}$/);
  assert.notEqual(P.cfOf(URL1, "ABCDEFGH2345"), P.cfOf(URL2, "ABCDEFGH2345"));
  assert.notEqual(P.cfOf(URL1, "ABCDEFGH2345"), P.cfOf(URL1, "ABCDEFGH2346"));

  const def = { enabled: false, url: "", code: "", place: "" };
  for (const r of [null, undefined, "{", "[1]", "5"]) assert.deepEqual(P.parseCfg(r), def);
  assert.deepEqual(P.parseCfg(JSON.stringify({ enabled: true, url: URL1, code: "" })), { enabled: false, url: URL1, code: "", place: "" });
  assert.equal(P.parseCfg(JSON.stringify({ enabled: "true", url: URL1, code: "ABCDEFGH2345" })).enabled, false);
  assert.equal(P.parseCfg(JSON.stringify({ enabled: true, url: "http://x", code: "ABCDEFGH2345" })).enabled, false);
  const full = P.parseCfg(JSON.stringify({ enabled: true, url: URL1, code: "ABCDEFGH2345", place: "가".repeat(40) }));
  assert.equal(full.enabled, true);
  assert.equal(full.place.length, 30);

  assert.ok(P.validDate("2026-11-25"));
  assert.ok(P.validDate("2028-02-29"));
  for (const d of ["2026-02-29", "2026-13-01", "2026-1-01", "", null]) assert.equal(P.validDate(d), false, String(d));
  assert.equal(P.kstStamp(NOW), "2026-11-25T12:00:00+09:00");
  assert.equal(P.kstStamp(NOW), stamp(NOW));
  assert.equal(P.kstDay(Date.parse("2026-11-25T23:59:59+09:00")), "2026-11-25");
  assert.equal(P.kstDay(Date.parse("2026-11-26T00:00:00+09:00")), "2026-11-26");
  assert.equal(P.dayAdd("2026-12-31", 1), "2027-01-01");
  assert.equal(P.stampMs(stamp(NOW)), NOW);
  assert.ok(Number.isNaN(P.stampMs("2026-11-25T12:00:00Z")));
  assert.ok(P.meOk({ id: "S01", name: "김" }));
  for (const m of [null, { id: "S1", name: "김" }, { id: "S01", name: "" }, { id: "S01", name: "가".repeat(41) }, { id: "S01" }]) assert.equal(P.meOk(m), false);

  const good = ox("post", "abcd1");
  assert.ok(P.validOx(good));
  const cases = [
    [{ oid: "p:zzzzz" }, false], [{ data: { ...good.data, id: "zzzzz" } }, false], [{ tries: -1 }, false], [{ tries: 1.5 }, false],
    [{ me: "S01" }, true], [{ me: "X01" }, false], [{ me: undefined }, false], [{ firstFail: NOW }, true], [{ firstFail: NaN }, false],
    [{ msg: 5 }, false], [{ msg: "바쁨" }, true], [{ cf: "XYZ" }, false], [{ op: "delete" }, false], [{ at: -1 }, false],
    [{ data: { ...good.data, body: 5 } }, false], [{ id: "a-b" }, false],
    [{ att: true }, true], [{ att: 1 }, false], [{ att: false }, false]
  ];
  for (const [ch, want] of cases) assert.equal(P.validOx({ ...good, ...ch }), want, JSON.stringify(ch));
  const ack = ox("ack", "abcd1", { kind: "done" });
  assert.ok(P.validOx(ack));
  assert.equal(P.validOx({ ...ack, oid: "a:abcd1:ack" }), false);
  assert.equal(P.validOx({ ...ack, data: { ...ack.data, kind: "seen" }, oid: "a:abcd1:seen" }), false);
  assert.equal(P.validOx({ ...ack, data: { ...ack.data, memo: 5 } }), false);
  assert.ok(P.validOx({ ...ack, data: { id: "abcd1", kind: "done" } }));
  const wd = ox("withdraw", "abcd1");
  assert.ok(P.validOx(wd));
  assert.equal(P.validOx({ ...wd, oid: "p:abcd1" }), false);
  assert.equal(P.validOx(null), false);
});

test("공유 전 검사 — 서버 검사와 날짜 경계가 같음", () => {
  const s = boot();
  assert.equal(typeof s.ctx.dateOk_, "function");
  const base = { id: "abcd1234", body: "본문", date: "2026-11-25", time: "13:30" };
  const M_BAD = "공유할 수 없는 기록입니다 — 공유 체크를 끄세요";
  const M_LONG = "공유는 2000자까지입니다 — 줄이거나 공유 체크를 끄세요";
  const M_DATE = "공유는 14일 전부터 내일 날짜까지입니다 — 날짜를 고치거나 공유 체크를 끄세요";
  const M_TIME = "공유하려면 시각을 00:00 모양으로 적어 주세요 — 시각을 고치거나 공유 체크를 끄세요";
  assert.equal(P.preShareCheck(base, NOW), "");
  for (const r of [null, "x", { ...base, id: "ab" }, { ...base, id: "ab-cd" }, { ...base, id: 5 }, { ...base, body: "  \n " }, { ...base, body: 5 }])
    assert.equal(P.preShareCheck(r, NOW), M_BAD, JSON.stringify(r));
  assert.equal(P.preShareCheck({ ...base, body: "가".repeat(2000) }, NOW), "");
  assert.equal(P.preShareCheck({ ...base, body: "가".repeat(2001) }, NOW), M_LONG);
  for (const t of ["", "9:30", "24:00", "12:60", "12:30:00", undefined]) assert.equal(P.preShareCheck({ ...base, time: t }, NOW), M_TIME, String(t));
  for (const d of ["2026-02-30", "2026/11/25", "", undefined]) {
    assert.equal(P.preShareCheck({ ...base, date: d }, NOW), M_DATE, String(d));
    assert.equal(s.ctx.dateOk_(d), false, String(d));
  }
  const times = [NOW, Date.parse("2026-11-25T23:59:30+09:00"), Date.parse("2026-11-26T00:00:30+09:00"),
    Date.parse("2026-12-31T23:59:59+09:00"), Date.parse("2027-01-01T00:00:01+09:00"), Date.parse("2028-02-29T10:00:00+09:00")];
  for (const t of times) {
    s.clock.now = t;
    const today = P.kstDay(t);
    for (let n = -17; n <= 3; n++) {
      const d = P.dayAdd(today, n);
      const client = P.preShareCheck({ ...base, date: d }, t) === "";
      assert.equal(client, n >= -14 && n <= 1, `${today} ${n}`);
      assert.equal(s.ctx.dateOk_(d), client, `서버와 다름 ${today} ${n}`);
    }
  }
});

test("서버 응답 판정", () => {
  const me = { id: "S01", name: "김사감" };
  const resp = (body, status = 200) => ({ kind: "resp", status, body });
  const ODD = { k: "retry", msg: "서버 응답이 이상합니다" };
  assert.deepEqual(P.judge(null), { k: "net" });
  assert.deepEqual(P.judge({ kind: "net" }), { k: "net" });
  assert.deepEqual(P.judge(resp({ ok: true, me }, 500)), ODD);
  assert.deepEqual(P.judge(resp(undefined)), ODD);
  assert.deepEqual(P.judge(resp([1])), ODD);
  assert.deepEqual(P.judge(resp({ ok: true })), ODD);
  assert.deepEqual(P.judge(resp({ ok: true, me: { id: "S01", name: "" } })), ODD);
  assert.deepEqual(P.judge(resp({ ok: true, me }), b => Array.isArray(b.items)), ODD);
  assert.deepEqual(P.judge(resp({ ok: true, me, items: [] }), () => { throw new Error("x"); }), ODD);
  const ok = P.judge(resp({ ok: true, me: { ...me, code: "비밀" }, items: [] }), b => Array.isArray(b.items));
  assert.equal(ok.k, "ok");
  assert.deepEqual(ok.me, me);
  assert.deepEqual(P.judge(resp({ ok: false, error: "auth" })), { k: "auth" });
  assert.deepEqual(P.judge(resp({ ok: false, error: "bad", message: "  없는 인계입니다 " })), { k: "reject", err: "bad", msg: "없는 인계입니다" });
  assert.deepEqual(P.judge(resp({ ok: false, error: "forbidden", message: "작성자만 취소할 수 있습니다" })), { k: "reject", err: "forbidden", msg: "작성자만 취소할 수 있습니다" });
  assert.deepEqual(P.judge(resp({ ok: false, error: "bad" })), { k: "reject", err: "bad", msg: "서버가 받지 않았습니다" });
  assert.deepEqual(P.judge(resp({ ok: false, error: "bad", message: 5 })), { k: "reject", err: "bad", msg: "서버가 받지 않았습니다" });
  assert.equal(P.judge(resp({ ok: false, error: "bad", message: "가".repeat(100) })).msg.length, 80);
  assert.deepEqual(P.judge(resp({ ok: false, error: "busy" })), { k: "retry", msg: "서버가 바쁩니다" });
  assert.deepEqual(P.judge(resp({ ok: false, error: "server" })), { k: "retry", msg: "서버 오류" });
  assert.deepEqual(P.judge(resp({ ok: "true", me })), { k: "retry", msg: "서버 오류" });
});

test("받은 항목 정리 — 모양 검사·확인 겹침·길이·정렬·200건", () => {
  const at = stamp(NOW);
  const good = { id: "abcd1", at, date: "2026-11-25", time: "13:30", place: "태하관", sid: "S01", name: "김사감", body: "본문", acks: [] };
  assert.deepEqual(P.cleanItem(good), good);
  assert.equal(P.cleanItem(null), null);
  for (const ch of [{ id: "a" }, { at: "2026-11-25 12:00" }, { sid: "X01" }, { body: 5 }, { id: undefined }]) assert.equal(P.cleanItem({ ...good, ...ch }), null, JSON.stringify(ch));
  // 어긋난 항목은 잘라 보여 주지 않고 버림(감사실장 P3-16)
  for (const ch of [{ date: "2026-02-30" }, { date: "" }, { time: "25:00" }, { time: "9:30" }, { place: "가".repeat(31) }, { place: 5 },
    { name: "나".repeat(41) }, { name: 5 }, { body: "다".repeat(2001) }])
    assert.equal(P.cleanItem({ ...good, ...ch }), null, JSON.stringify(ch).slice(0, 40));
  const c = P.cleanItem({ ...good, place: "가".repeat(30), name: "나".repeat(40), body: "다".repeat(2000), extra: "<script>" });
  assert.deepEqual([c.place.length, c.name.length, c.body.length, "extra" in c], [30, 40, 2000, false]);
  const acks = [
    { sid: "S02", name: "이사감", kind: "ack", at, memo: "확인에는 메모 없음" },
    { sid: "S02", name: "이사감", kind: "ack", at, memo: "" },
    { sid: "S02", name: "이사감", kind: "done", at, memo: "라".repeat(201) },
    { sid: "S03", name: "박", kind: "seen", at },
    { sid: "bad", kind: "ack", at },
    { sid: "S03", kind: "ack", at: "어제" },
    { sid: "S04", name: "최".repeat(41), kind: "ack", at, memo: "" },
    { sid: "S05", name: "정", kind: "ack", at },
    { sid: "S02", name: "이사감", kind: "done", at, memo: "라".repeat(200) },
    "문자"
  ];
  const ca = P.cleanItem({ ...good, acks }).acks;
  assert.equal(ca.length, 2);
  assert.deepEqual(ca[0], { sid: "S02", name: "이사감", kind: "ack", at, memo: "" });
  assert.deepEqual([ca[1].kind, ca[1].memo.length], ["done", 200]);
  assert.deepEqual(P.cleanItem({ ...good, acks: "x" }).acks, []);

  assert.deepEqual(P.cleanList(null), []);
  const mk = (i, ms) => ({ ...good, id: "item" + i, at: stamp(ms) });
  const list = P.cleanList([mk(1, NOW - 3e3), { junk: 1 }, mk(2, NOW), { ...mk(1, NOW - 1e3), body: "두 번째" }, mk(3, NOW - 2e3)]);
  assert.deepEqual(list.map(x => x.id), ["item2", "item3", "item1"]);
  assert.equal(list[2].body, "본문");
  const capped = P.cleanList(Array.from({ length: 250 }, (_, i) => mk(i, NOW - i * 1000)));
  assert.deepEqual([capped.length, capped[0].id, capped[199].id], [200, "item0", "item199"]);
});

test("화면 목록 합치기·확인 안 한 것 판정", () => {
  const me = { id: "S01", name: "김사감" };
  const cf = "aaaa1111";
  const it = (id, sid, ms, acks = []) => ({ id, at: stamp(ms), date: "2026-11-25", time: "10:00", place: "", sid, name: sid === "S01" ? "김사감" : "이사감", body: id, acks });
  const cache = { items: [it("itemA", "S02", NOW - DAY), it("itemB", "S01", NOW - 2 * DAY), it("itemOld", "S02", NOW - 15 * DAY)] };
  const snapshot = J(cache);
  const post = (id, o = {}) => ({ ...ox("post", id, { cf, me: "S01" }), data: { id, date: "2026-11-25", time: "11:00", place: " 태하관 ", body: "새 글" }, ...o });
  const box = [
    post("itemP"),
    post("itemA"),
    ox("withdraw", "itemB", { cf, me: "S01" }),
    ox("ack", "itemA", { cf, me: "S01" }),
    post("itemF", { cf: "bbbb2222", me: "S03" }),
    post("itemG", { cf: "bbbb2222", me: "S01" })
  ];
  const v = P.mergeView(cache, box, cf, me, NOW);
  assert.deepEqual(v.map(x => x.id), ["itemP", "itemG", "itemA"]);
  const p = v[0];
  assert.deepEqual([p.pending, p.name, p.sid, p.place, p.at], [true, "김사감", "S01", "태하관", stamp(NOW)]);
  assert.deepEqual(v[2].acks.map(x => [x.sid, x.kind, x.pending]), [["S01", "ack", true]]);
  assert.deepEqual(cache, snapshot);
  const v2 = P.mergeView(null, [post("itemP")], cf, null, NOW);
  assert.deepEqual([v2[0].name, v2[0].sid], ["나", ""]);
  const already = { items: [it("itemA", "S02", NOW, [{ sid: "S01", name: "김사감", kind: "ack", at: stamp(NOW), memo: "" }])] };
  assert.equal(P.mergeView(already, [ox("ack", "itemA", { cf, me: "S01" })], cf, me, NOW)[0].acks.length, 1);

  const fresh = it("itemU", "S02", NOW - 3600e3);
  const ackBy = (sid, kind) => ({ sid, name: "x", kind, at: stamp(NOW), memo: "" });
  assert.equal(P.isUnread(fresh, me, NOW), true);
  assert.equal(P.isUnread(fresh, null, NOW), false);
  assert.equal(P.isUnread({ ...fresh, pending: true }, me, NOW), false);
  assert.equal(P.isUnread(it("itemM", "S01", NOW), me, NOW), false);
  assert.equal(P.isUnread(it("itemO", "S02", NOW - 7 * DAY - 1000), me, NOW), false);
  assert.equal(P.isUnread(it("itemO", "S02", NOW - 7 * DAY + 1000), me, NOW), true);
  assert.equal(P.isUnread({ ...fresh, at: "어제" }, me, NOW), false);
  assert.equal(P.isUnread({ ...fresh, acks: [ackBy("S03", "ack")] }, me, NOW), true);
  assert.equal(P.isUnread({ ...fresh, acks: [ackBy("S03", "done")] }, me, NOW), false);
  assert.equal(P.isUnread({ ...fresh, acks: [ackBy("S01", "ack")] }, me, NOW), false);
});

test("꺼져 있으면 아무것도 하지 않음 — 타이머·호출·저장 없음", async () => {
  const s = boot();
  const c = makeClient(s);
  c.ho.start();
  c.ho.start();
  await c.flush();
  assert.equal(c.timers.size, 0);
  const r = rec("본문");
  assert.equal(c.ho.beforeAdd(r), null);
  assert.equal(c.ho.share(r), "");
  assert.equal(c.ho.withdraw(r.id), "");
  assert.equal(c.ho.isShared(r.id), false);
  c.ho.decorate();
  c.ho.open();
  c.ho.renderSettings();
  await c.ho.sync();
  assert.equal(c.t.ack(r.id, "ack"), "");
  await c.tick(LIM.interval * 3);
  assert.equal(c.net.calls.length, 0);
  assert.equal(c.store.m.size, 0);
  assert.deepEqual([...c.log.alert, ...c.log.notify, ...c.log.confirm], []);
  // 주소·코드를 저장했지만 켜지 않음
  assert.equal(c.t.saveCfg({ url: URL1, code: s.staff[0].code }), "저장했습니다");
  await c.tick(LIM.interval);
  assert.equal(c.net.calls.length, 0);
  assert.deepEqual([...c.store.m.keys()], [K.cfg]);
  // 켰다가 끄면 타이머가 모두 멈춤
  assert.equal(c.t.setEnabled(true), "켰습니다");
  await c.flush();
  assert.equal(c.net.calls.length, 1);
  assert.equal(c.t.setEnabled(false), "껐습니다");
  assert.equal(c.timers.size, 0);
  await c.tick(LIM.interval * 3);
  assert.equal(c.net.calls.length, 1);
  assert.equal(c.S.on, false);
  assert.equal(c.ho.share(rec("또")), "");
  assert.equal(c.store.m.has(K.outbox), false);
});

test("두 사감 끝까지 — 공유·받기·확인·조치 완료·공유 취소", async () => {
  const s = boot();
  const A = makeClient(s), B = makeClient(s);
  await A.connect(s.staff[0].code, { place: "태하관 1층" });
  await B.connect(s.staff[1].code);
  assert.deepEqual(A.S.me, { id: s.staff[0].id, name: "김사감" });
  assert.deepEqual(B.S.me, { id: s.staff[1].id, name: "이사감" });
  const c0 = A.net.calls[0];
  assert.deepEqual([c0.url, c0.op, c0.req.code], [URL1, "list", raw(s.staff[0].code)]);
  assert.deepEqual([c0.o.method, c0.o.credentials, c0.o.cache, c0.o.redirect], ["POST", "omit", "no-store", "follow"]);
  assert.deepEqual(c0.o.headers, { "Content-Type": "text/plain;charset=utf-8" });

  const r = rec("내일 아침 302호 점검 부탁드립니다");
  assert.equal(A.ho.share(r), "");
  await A.flush();
  assert.deepEqual(A.ops(), ["list", "post", "list"]);
  assert.deepEqual(Object.keys(A.net.calls[1].req.data).sort(), ["body", "date", "id", "place", "time"]);
  const rows = hoRows(s);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], [r.id, stamp(s.clock.now), r.date, r.time, "태하관 1층", s.staff[0].id, "김사감", r.body, "정상", ""]);
  assert.equal(A.store.m.has(K.outbox), false);
  assert.equal(A.ho.isShared(r.id), true);
  assert.ok(A.t.readShared()[r.id]);
  assert.deepEqual(A.t.tagOf(r.id, A.t.tagCtx()), ["📨 공유됨", "ho-ok"]);
  assert.equal(A.t.unreadCount(), 0);

  await B.ho.sync();
  const bv = B.t.view();
  assert.equal(bv.length, 1);
  assert.deepEqual([bv[0].name, bv[0].place, bv[0].body], ["김사감", "태하관 1층", r.body]);
  assert.equal(B.t.unreadCount(), 1);
  assert.equal(B.ho.isShared(r.id), false);
  assert.equal(B.t.tagOf(r.id, B.t.tagCtx()), null);

  assert.equal(B.t.ack(r.id, "ack"), "");
  assert.equal(B.t.unreadCount(), 0);
  await B.flush();
  const a1 = ackRows(s);
  assert.equal(a1.length, 1);
  assert.deepEqual(a1[0].slice(0, 4), [r.id, s.staff[1].id, "이사감", s.ctx.labelOf_("ack")]);
  assert.equal(B.t.ack(r.id, "done", "  302호 확인함  "), "");
  await B.flush();
  const a2 = ackRows(s);
  assert.equal(a2.length, 2);
  assert.deepEqual([a2[1][3], a2[1][5]], [s.ctx.labelOf_("done"), "302호 확인함"]);

  await A.ho.sync();
  assert.deepEqual(A.t.view()[0].acks.map(a => [a.name, a.kind, a.memo]), [["이사감", "ack", ""], ["이사감", "done", "302호 확인함"]]);

  assert.equal(A.ho.withdraw(r.id), "");
  assert.deepEqual(A.t.tagOf(r.id, A.t.tagCtx()), ["공유 취소 중", "ho-wait"]);
  assert.equal(A.t.view().length, 0);
  await A.flush();
  const after = hoRows(s)[0];
  assert.equal(after[8], "취소");
  assert.match(after[9], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/);
  assert.equal(A.ho.isShared(r.id), false);
  assert.equal(A.store.m.has(K.shared), false);
  assert.equal(A.t.tagOf(r.id, A.t.tagCtx()), null);
  await B.ho.sync();
  assert.equal(B.t.view().length, 0);
  noLeak(A, s.staff[0].code);
  noLeak(B, s.staff[1].code);
});

test("응답만 잃어버린 경우 — 다시 보내도 서버에는 한 번만(멱등)", async () => {
  const s = boot();
  const A = makeClient(s), B = makeClient(s);
  await A.connect(s.staff[0].code);
  await B.connect(s.staff[1].code);
  const r = rec("멱등 시험");
  A.net.drop = 1;
  A.ho.share(r);
  await A.flush();
  assert.equal(hoRows(s).length, 1);
  assert.equal(A.t.peekOutbox().length, 1);
  assert.equal(A.t.peekOutbox()[0].tries, 0);
  assert.equal(A.S.lastErr, "연결 안 됨");
  await A.tick(LIM.interval);
  assert.equal(A.t.peekOutbox().length, 0);
  assert.equal(hoRows(s).length, 1);
  assert.equal(A.ops().filter(o => o === "post").length, 2);

  await B.ho.sync();
  B.net.drop = 1;
  B.t.ack(r.id, "ack");
  await B.flush();
  assert.equal(ackRows(s).length, 1);
  await B.tick(LIM.interval);
  assert.equal(B.t.peekOutbox().length, 0);
  assert.equal(ackRows(s).length, 1);

  A.net.drop = 1;
  A.ho.withdraw(r.id);
  await A.flush();
  const cancelAt = hoRows(s)[0][9];
  assert.equal(hoRows(s)[0][8], "취소");
  await A.tick(LIM.interval);
  assert.equal(A.t.peekOutbox().length, 0);
  assert.equal(hoRows(s)[0][9], cancelAt);
  assert.deepEqual(A.t.readFailed(), []);
});

test("보낼 목록 저장 실패 — 일지는 막지 않고 못 보냄 표시·알림", async () => {
  const s = boot();
  const A = makeClient(s);
  await A.connect(s.staff[0].code);
  const r = rec("저장 실패 시험");
  A.store.failSet = new Set([K.outbox]);
  const n0 = A.net.calls.length;
  assert.equal(A.ho.share(r), SHARE_FAIL);
  assert.deepEqual(A.log.alert, [SHARE_FAIL]);
  assert.ok(A.S.localFail.has(r.id));
  assert.deepEqual(A.t.tagOf(r.id, A.t.tagCtx()), ["못 보냄", "ho-bad"]);
  await A.flush();
  assert.equal(A.net.calls.length, n0);
  // 알림 창이 깨져도 던지지 않음
  const keep = A.env.alert;
  A.env.alert = () => { throw new Error("창 없음"); };
  assert.equal(A.ho.share(r), SHARE_FAIL);
  A.env.alert = keep;
  A.store.failSet = null;
  assert.equal(A.ho.share(r), "");
  assert.equal(A.S.localFail.has(r.id), false);
  await A.flush();
  assert.equal(hoRows(s).length, 1);
  assert.deepEqual(A.t.tagOf(r.id, A.t.tagCtx()), ["📨 공유됨", "ho-ok"]);
});

test("한도 — 보낼 인계 50건·공유 취소 포함 100건·같은 것 겹쳐 넣지 않음", async () => {
  const s = boot();
  const A = makeClient(s);
  await A.connect(s.staff[0].code);
  A.net.down = true;
  const r0 = rec("겹침 시험");
  assert.equal(A.ho.share(r0), "");
  assert.equal(A.ho.share(r0), "");
  assert.equal(A.t.peekOutbox().length, 1);
  for (let i = 1; i < 50; i++) assert.equal(A.ho.share(rec("한도 " + i)), "");
  await A.flush();
  assert.equal(A.t.peekOutbox().length, 50);
  const FULL = "못 보낸 인계가 50건이라 더 예약할 수 없습니다 — 인터넷 연결을 확인하고, 이 인계는 말로 전달하세요";
  const r51 = rec("51번째");
  assert.equal(A.ho.share(r51), FULL);
  assert.ok(A.log.alert.includes(FULL));
  assert.deepEqual(A.t.tagOf(r51.id, A.t.tagCtx()), ["못 보냄", "ho-bad"]);
  assert.equal(A.t.ack("abcd9999", "ack"), "확인 예약 실패 — 다시 시도하거나 말로 전달하세요");
  for (let i = 0; i < 50; i++) assert.equal(A.ho.withdraw("wd" + String(i).padStart(4, "0")), "");
  assert.equal(A.ho.withdraw("wd9999"), WD_FAIL);
  assert.ok(A.log.alert.includes(WD_FAIL));
  assert.equal(A.t.peekOutbox().length, 100);
  await A.flush();
});

test("서버가 받지 않은 인계(겹친 번호) — 못 보낸 목록에 50건까지, 가득 차거나 못 적으면 보낼 목록에 남김", async () => {
  const s = boot(["김사감", "이사감", "박사감"]);
  const fill = Array.from({ length: 50 }, (_, i) => ({ op: "post", id: "old" + String(i).padStart(4, "0"), kind: "", snip: "s", msg: "m", at: 1 }));
  const A = makeClient(s);
  const B = makeClient(s, { store: memStore({ [K.failed]: JSON.stringify(fill.slice(0, 49)) }) });
  await A.connect(s.staff[0].code);
  await B.connect(s.staff[1].code);
  const r = rec("김사감 인계");
  A.ho.share(r);
  await A.flush();
  assert.equal(B.ho.share({ ...r, body: "B가   쓴\n\n인계" }), "");
  await B.flush();
  const f = B.t.readFailed();
  assert.equal(f.length, 50);
  assert.equal(f[0].id, "old0000");
  const last = f[49];
  assert.deepEqual([last.op, last.id, last.kind, last.snip, last.msg], ["post", r.id, "", "B가 쓴 인계", "인계 번호가 겹칩니다"]);
  assert.equal(B.t.peekOutbox().length, 0);
  assert.ok(B.log.notify.includes(REJECTED));
  assert.deepEqual(B.t.tagOf(r.id, B.t.tagCtx()), ["못 보냄(형식)", "ho-bad"]);
  assert.equal(hoRows(s).length, 1);

  // 50건이 차 있으면 옛 기록을 밀어내지 않고 원래 항목을 보낼 목록에 남김(감사실장 P2-11)
  const C = makeClient(s, { store: memStore({ [K.failed]: JSON.stringify(fill) }) });
  await C.connect(s.staff[2].code);
  C.log.notify.length = 0;
  assert.equal(C.ho.share({ ...r, body: "C가 쓴 인계" }), "");
  await C.flush();
  const fc = C.t.readFailed();
  assert.deepEqual([fc.length, fc[0].id, fc[49].id], [50, "old0000", "old0049"]);
  const cx = C.t.peekOutbox();
  assert.deepEqual([cx.length, cx[0].id, cx[0].tries, cx[0].msg], [1, r.id, 1, "인계 번호가 겹칩니다"]);
  assert.ok(C.log.notify.includes(REJECTED));
  assert.notDeepEqual(C.t.tagOf(r.id, C.t.tagCtx()), ["못 보냄(형식)", "ho-bad"]);
  // 사용자가 못 보낸 목록을 비우면 다음 보내기 때 옮겨 적음
  C.store.m.delete(K.failed);
  await C.tick(LIM.interval);
  assert.deepEqual(C.t.readFailed().map(x => x.id), [r.id]);
  assert.equal(C.t.peekOutbox().length, 0);

  const r2 = rec("두 번째 김사감 인계");
  A.ho.share(r2);
  await A.flush();
  B.store.failSet = new Set([K.failed]);
  B.ho.share({ ...r2, body: "겹침" });
  await B.flush();
  const x = B.t.peekOutbox();
  assert.equal(x.length, 1);
  assert.deepEqual([x[0].id, x[0].tries, x[0].msg], [r2.id, 1, "인계 번호가 겹칩니다"]);
});

test("깨진 보낼 목록 — 따로 보관하고 나머지는 살림", () => {
  const s = boot();
  const good = ox("post", "good0001");
  const st = memStore({ [K.outbox]: JSON.stringify([good, { junk: 1 }, good, 7]) });
  const c = makeClient(s, { store: st });
  assert.deepEqual(c.t.readOutbox(), [good]);
  assert.deepEqual(st.json(K.outbox), [good]);
  const bad = st.json(K.bad);
  assert.deepEqual(bad.map(b => b.raw), [JSON.stringify({ junk: 1 }), JSON.stringify(good), "7"]);
  assert.ok(bad.every(b => b.at === NOW));
  assert.deepEqual(c.log.notify, ["못 보낸 인계 일부가 깨져 따로 보관했습니다 — 최근 인계는 말로 전달하세요"]);
  assert.deepEqual(c.t.readOutbox(), [good]);
  assert.equal(c.log.notify.length, 1);

  const st2 = memStore({ [K.outbox]: "{{{", [K.bad]: "옛것" });
  const c2 = makeClient(s, { store: st2 });
  assert.deepEqual(c2.t.readOutbox(), []);
  assert.equal(st2.m.has(K.outbox), false);
  assert.deepEqual(st2.json(K.bad), [{ at: 0, raw: "옛것" }, { at: NOW, raw: "{{{" }]);

  const prev = Array.from({ length: 4 }, (_, i) => ({ at: 1, raw: "p" + i }));
  const st3 = memStore({ [K.outbox]: JSON.stringify([1, 2, 3]), [K.bad]: JSON.stringify(prev) });
  makeClient(s, { store: st3 }).t.readOutbox();
  // 옛 보관을 밀어내지 않고 모두 남김(감사실장 P2-10)
  assert.deepEqual(st3.json(K.bad).map(b => b.raw), ["p0", "p1", "p2", "p3", "1", "2", "3"]);
  const many = Array.from({ length: 8 }, (_, i) => ({ junk: i }));
  const st5 = memStore({ [K.outbox]: JSON.stringify([good, ...many]) });
  assert.deepEqual(makeClient(s, { store: st5 }).t.readOutbox(), [good]);
  assert.equal(st5.json(K.bad).length, 8);

  // 보관할 자리가 없으면 받아 둔 목록(가장 덜 중요)을 비우고 다시 씀
  const st6 = memStore({ [K.outbox]: JSON.stringify([good, { junk: 9 }]), [K.cache]: "받아 둔 목록" });
  let room = false;
  const set6 = st6.set;
  st6.set = (k, v) => { if (k === K.bad && st6.m.has(K.cache)) throw new Error("저장 공간 부족"); room = true; set6(k, v); };
  assert.deepEqual(makeClient(s, { store: st6 }).t.readOutbox(), [good]);
  assert.deepEqual([room, st6.m.has(K.cache), st6.json(K.bad).length], [true, false, 1]);

  // 보관을 못 쓰면 원래 목록을 건드리지 않음(잃지 않음), 알림은 한 번
  const orig = JSON.stringify([good, { junk: 2 }]);
  const st4 = memStore({ [K.outbox]: orig });
  st4.failSet = new Set([K.bad]);
  const c4 = makeClient(s, { store: st4 });
  assert.equal(c4.t.readOutbox(), null);
  assert.equal(st4.m.get(K.outbox), orig);
  assert.equal(c4.t.readOutbox(), null);
  assert.deepEqual(c4.log.alert, [READ_FAIL]);
});

test("인터넷 끊김 → 다시 연결되면 보냄", async () => {
  const s = boot();
  const A = makeClient(s);
  A.net.down = true;
  await A.connect(s.staff[0].code);
  assert.equal(A.S.lastErr, "연결 안 됨");
  assert.equal(A.t.statusText(), "마지막 받음 없음 — 연결 안 됨");
  assert.equal(A.S.me, null);
  const r = rec("끊김 시험");
  assert.equal(A.ho.share(r), "");
  await A.flush();
  const x = A.t.peekOutbox()[0];
  assert.deepEqual([x.tries, x.me], [0, null]);
  assert.deepEqual(A.t.tagOf(r.id, A.t.tagCtx()), ["보내는 중", "ho-wait"]);
  assert.equal(A.timers.size, 1);
  A.net.down = false;
  await A.tick(LIM.interval);
  assert.equal(A.t.peekOutbox().length, 0);
  assert.equal(hoRows(s).length, 1);
  assert.equal(A.S.lastErr, "");
  assert.equal(A.t.statusText(), "받음 " + P.kstStamp(s.clock.now).slice(11, 16));
});

test("응답이 없으면 15초 뒤 끊고 다음에 다시 — 늦게 닿은 요청도 한 번만 기록", async () => {
  const s = boot();
  const A = makeClient(s);
  await A.connect(s.staff[0].code);
  A.net.hang = true;
  A.ho.share(rec("멈춤 시험"));
  await A.flush();
  assert.equal(A.S.inflight.size, 1);
  await A.tick(LIM.timeout);
  assert.equal(A.S.inflight.size, 0);
  assert.equal(A.net.calls.at(-1).o.signal.aborted, true);
  assert.equal(A.S.lastErr, "연결 안 됨");
  assert.equal(A.t.peekOutbox().length, 1);
  A.net.hang = false;

  A.net.gate = deferred();
  await A.tick(LIM.interval);
  assert.equal(A.S.inflight.size, 1);
  await A.tick(LIM.timeout);
  assert.equal(A.t.peekOutbox().length, 1);
  assert.equal(hoRows(s).length, 0);
  A.net.gate.resolve();
  A.net.gate = null;
  await A.flush();
  assert.equal(hoRows(s).length, 1);
  assert.equal(A.t.peekOutbox().length, 1);
  await A.tick(LIM.interval);
  assert.equal(A.t.peekOutbox().length, 0);
  assert.equal(hoRows(s).length, 1);
  assert.equal(A.S.lastErr, "");
});

test("서버가 바쁨(잠금 실패) — 횟수만 늘리고 다음에 다시", async () => {
  const s = boot();
  const A = makeClient(s);
  await A.connect(s.staff[0].code);
  s.lock.ok = false;
  A.ho.share(rec("바쁨 시험"));
  await A.flush();
  const t0 = s.clock.now;
  let x = A.t.peekOutbox()[0];
  assert.deepEqual([x.tries, x.msg, x.firstFail], [1, "서버가 바쁩니다", t0]);
  assert.equal(A.S.lastErr, "");
  assert.deepEqual(A.ops().slice(-2), ["post", "list"]);
  await A.tick(LIM.interval);
  x = A.t.peekOutbox()[0];
  assert.deepEqual([x.tries, x.firstFail], [2, t0]);
  s.lock.ok = true;
  await A.tick(LIM.interval);
  assert.equal(A.t.peekOutbox().length, 0);
  assert.equal(hoRows(s).length, 1);
  assert.equal(s.lock.held, s.lock.released);
});

test("늦게 보내져 날짜가 지난 인계 — 서버가 받지 않음, 못 보낸 목록에 남김", async () => {
  const s = boot();
  const A = makeClient(s);
  await A.connect(s.staff[0].code);
  A.net.down = true;
  const r = rec("오래된 인계", { date: P.dayAdd("2026-11-25", -14) });
  assert.equal(A.ho.share(r), "");
  await A.flush();
  await A.jump(2 * DAY);
  A.net.down = false;
  await A.ho.sync();
  assert.equal(A.t.peekOutbox().length, 0);
  assert.equal(hoRows(s).length, 0);
  const f = A.t.readFailed();
  assert.equal(f.length, 1);
  assert.deepEqual([f[0].op, f[0].id, f[0].msg, f[0].snip], ["post", r.id, "날짜는 14일 전부터 내일까지만 됩니다", "오래된 인계"]);
  assert.ok(A.log.notify.includes(REJECTED));
  assert.deepEqual(A.t.tagOf(r.id, A.t.tagCtx()), ["못 보냄(형식)", "ho-bad"]);
});

test("공유 취소 — 없는 인계는 조용히 지움, 남의 인계는 못 보낸 목록, 보내기 전 취소, 저장 실패", async () => {
  const s = boot();
  const A = makeClient(s), B = makeClient(s);
  await A.connect(s.staff[0].code);
  await B.connect(s.staff[1].code);
  assert.equal(A.ho.withdraw("nope1234"), "");
  await A.flush();
  assert.equal(A.t.peekOutbox().length, 0);
  assert.deepEqual(A.t.readFailed(), []);
  assert.equal(A.log.notify.includes(REJECTED), false);

  const r = rec("김사감이 쓴 인계 ".repeat(5));
  A.ho.share(r);
  await A.flush();
  await B.ho.sync();
  assert.equal(B.ho.withdraw(r.id), "");
  assert.equal(B.ho.withdraw(r.id), "");
  await B.flush();
  const bf = B.t.readFailed();
  assert.equal(bf.length, 1);
  assert.deepEqual([bf[0].op, bf[0].msg, bf[0].snip], ["withdraw", "작성자만 취소할 수 있습니다", P.cut(r.body.replace(/\s+/g, " ").trim(), 40)]);
  assert.ok(B.log.notify.includes(REJECTED));
  assert.equal(B.ops().filter(o => o === "withdraw").length, 1);
  assert.equal(hoRows(s)[0][8], "정상");

  // 서버에 간 적 없는 공유는 목록에서 지우기만 함 — 본문이 서버에 올라가지 않음(감사실장 P1-2)
  A.net.down = true;
  const r2 = rec("바로 거둘 인계");
  A.ho.share(r2);
  assert.equal(A.t.peekOutbox()[0].att, undefined);
  assert.equal(A.ho.withdraw(r2.id), "");
  assert.deepEqual(A.t.peekOutbox(), []);
  assert.equal(A.t.tagOf(r2.id, A.t.tagCtx()), null);
  assert.equal(A.t.view().some(x => x.id === r2.id), false);
  await A.flush();
  A.net.down = false;
  const n2 = A.net.calls.length;
  await A.ho.sync();
  assert.equal(hoRows(s).some(x => x[0] === r2.id), false);
  assert.equal(A.net.calls.slice(n2).some(c => c.req.data && c.req.data.id === r2.id), false);
  assert.equal(A.t.peekOutbox().length, 0);
  assert.equal(A.ho.isShared(r2.id), false);

  // 보내기를 한 번이라도 시작한 공유(응답을 못 받음)는 서버에 닿았을 수 있으므로 취소를 덧붙임
  A.net.down = true;
  const r3 = rec("보내다 끊긴 인계");
  A.ho.share(r3);
  await A.flush();
  const p3 = A.t.peekOutbox();
  assert.deepEqual([p3.length, p3[0].att, p3[0].tries], [1, true, 0]);
  assert.equal(A.ho.withdraw(r3.id), "");
  assert.deepEqual(A.t.peekOutbox().map(x => x.oid), ["p:" + r3.id, "w:" + r3.id]);
  assert.deepEqual(A.t.tagOf(r3.id, A.t.tagCtx()), ["공유 취소 중", "ho-wait"]);
  A.net.down = false;
  await A.ho.sync();
  assert.equal(hoRows(s).find(x => x[0] === r3.id)[8], "취소");
  assert.equal(A.t.peekOutbox().length, 0);
  assert.equal(A.ho.isShared(r3.id), false);

  // 서버가 바빠 횟수가 오른 공유도 서버에 닿은 것으로 봄
  s.lock.ok = false;
  const r4 = rec("바쁠 때 쓴 인계");
  A.ho.share(r4);
  await A.flush();
  assert.equal(A.t.peekOutbox()[0].tries, 1);
  assert.equal(A.ho.withdraw(r4.id), "");
  assert.equal(A.t.peekOutbox().length, 2);
  s.lock.ok = true;
  await A.ho.sync();
  assert.equal(A.t.peekOutbox().length, 0);

  A.store.failSet = new Set([K.outbox]);
  assert.equal(A.ho.withdraw(r.id), WD_FAIL);
  assert.ok(A.log.alert.includes(WD_FAIL));
});

test("코드 틀림·중지된 사감 — 받은 목록을 지우고, 보낼 목록은 남김", async () => {
  const s = boot();
  const A = makeClient(s);
  await A.connect("ABCD-EFGH-JKLM");
  assert.equal(A.S.authBlocked, A.S.runCf);
  assert.equal(A.S.lastErr, "개인 코드를 확인하세요");
  assert.equal(A.t.statusText(), "개인 코드를 확인하세요 — 설정에서 코드를 다시 적어 주세요");
  assert.equal(A.store.m.has(K.cache), false);
  const r = rec("틀린 코드로 쓴 인계");
  assert.equal(A.ho.share(r), "");
  await A.flush();
  // 코드가 막힌 동안에는 보내지 않고 목록 받기로 풀렸는지만 봄(감사실장 P3-12)
  assert.deepEqual(A.ops(), ["list", "list"]);
  assert.equal(A.t.peekOutbox().length, 1);
  assert.equal(A.t.peekOutbox()[0].tries, 0);
  assert.equal(await A.t.testConnection(), "개인 코드를 확인하세요 — 코드가 틀렸거나 중지된 사감입니다");
  await A.tick(LIM.interval);
  assert.equal(A.ops().at(-1), "list");
  assert.equal(A.ops().includes("post"), false);

  // 코드를 고치면 연결이 바뀜 — 누가 쓴 건지 모르는 항목은 묻고 보냄
  assert.equal(A.t.saveCfg({ url: URL1, code: s.staff[0].code }), "저장했습니다");
  assert.match(A.log.confirm.at(-1), /아직 보내지 못한 인계가 있을 수 있습니다/);
  await A.flush();
  assert.equal(A.S.authBlocked, "");
  assert.deepEqual(A.S.me, { id: s.staff[0].id, name: "김사감" });
  assert.equal(A.t.foreignItems().length, 1);
  assert.deepEqual(A.t.tagOf(r.id, A.t.tagCtx()), ["보내기 멈춤 — 인계함 확인", "ho-warn"]);
  assert.equal(hoRows(s).length, 0);
  assert.equal(A.t.adoptForeign(), "");
  await A.flush();
  assert.equal(hoRows(s).length, 1);
  assert.equal(A.t.peekOutbox().length, 0);

  const B = makeClient(s);
  await B.connect(s.staff[1].code);
  assert.equal(B.t.view().length, 1);
  const st = s.staff[1];
  s.sheet("사감").put(3, [st.id, st.name, st.code, "중지", st.made]);
  await B.tick(LIM.interval);
  assert.equal(B.S.authBlocked, B.S.runCf);
  assert.deepEqual([B.S.me, B.S.cache, B.store.m.has(K.cache)], [null, null, false]);
  assert.deepEqual(B.t.view(), []);
  const rb = rec("중지된 동안 쓴 인계");
  assert.equal(B.ho.share(rb), "");
  await B.flush();
  await B.tick(LIM.interval);
  assert.equal(B.ops().includes("post"), false);
  assert.equal(B.t.peekOutbox().length, 1);
  s.sheet("사감").put(3, [st.id, st.name, st.code, "사용", st.made]);
  await B.tick(LIM.interval);
  await B.flush();
  assert.equal(B.S.authBlocked, "");
  assert.equal(B.S.me.name, "이사감");
  // 풀리면 바로 모아 둔 인계를 보냄
  assert.equal(B.ops().includes("post"), true);
  assert.equal(B.t.peekOutbox().length, 0);
  assert.equal(hoRows(s).find(x => x[0] === rb.id)[5], st.id);
  assert.equal(B.t.view().length, 2);
});

test("이전 연결에서 만든 보낼 항목 — 같은 사감은 자동, 모르면 묻고 보내기·버리기", async () => {
  const s = boot();
  const servers = { [URL1]: s, [URL2]: s };
  const code = s.staff[0].code, me = s.staff[0].id, cf = P.cfOf(URL1, raw(code));

  const A = makeClient(s, { servers });
  await A.connect(code);
  A.net.down = true;
  A.ho.share(rec("주소 바꾸기 전 인계"));
  await A.flush();
  A.net.down = false;
  assert.equal(A.t.saveCfg({ url: URL2, code }), "저장했습니다");
  assert.match(A.log.confirm.at(-1), /아직 보내지 못한 인계가 있을 수 있습니다/);
  await A.flush();
  assert.equal(A.t.peekOutbox().length, 0);
  assert.equal(A.net.calls.filter(x => x.op === "post").at(-1).url, URL2);
  assert.equal(hoRows(s).length, 1);

  // 누가 쓴 건지 모르는 항목 — 같은 번호의 뒤 항목도 함께 멈춤
  const B = makeClient(s, { servers, store: memStore({ [K.outbox]: JSON.stringify([ox("post", "fb000001", { cf: OTHER_CF, me: null }), ox("ack", "fb000001", { cf, me, kind: "done" })]) }) });
  await B.connect(code);
  assert.deepEqual(B.ops(), ["list"]);
  assert.equal(B.t.foreignItems().length, 1);
  assert.deepEqual(B.t.tagOf("fb000001", B.t.tagCtx()), ["보내기 멈춤 — 인계함 확인", "ho-warn"]);
  B.answers.push(false);
  assert.equal(B.t.adoptForeign(), "");
  assert.equal(B.t.foreignItems().length, 1);
  assert.equal(B.t.adoptForeign(), "");
  assert.equal(B.log.confirm.at(-1), "이전 연결에서 못 보낸 인계 1건을 지금 연결(김사감 님)로 보낼까요?");
  await B.flush();
  assert.deepEqual(B.ops().slice(1), ["post", "ack", "list"]);
  assert.equal(B.t.peekOutbox().length, 0);

  // 다른 사감이 쓴 항목 — 버리기
  const C = makeClient(s, { servers, store: memStore({ [K.outbox]: JSON.stringify([ox("post", "fc000001", { cf: OTHER_CF, me: "S99" })]) }) });
  assert.equal(C.t.adoptForeign(), "연결을 확인한 뒤 다시 누르세요");
  await C.connect(code);
  C.answers.push(false);
  assert.equal(C.t.dropForeign(), "");
  assert.equal(C.t.peekOutbox().length, 1);
  assert.equal(C.t.dropForeign(), "");
  assert.equal(C.log.confirm.at(-1), "이전 연결에서 만든 인계 1건을 버릴까요? 서버로 보내지 않고 지웁니다.");
  assert.equal(C.t.peekOutbox().length, 0);
  assert.equal(C.ops().includes("post"), false);
  assert.equal(hoRows(s).some(x => x[0] === "fc000001"), false);
});

test("보내는 중에 끄면 멈추고 저장하지 않음 — 다시 켜면 이어서 보냄", async () => {
  const s = boot();
  const A = makeClient(s);
  await A.connect(s.staff[0].code);
  A.net.gate = deferred();
  const r = rec("끄기 시험");
  A.ho.share(r);
  await A.flush();
  assert.equal(A.S.inflight.size, 1);
  const pc = A.net.calls.at(-1);
  assert.equal(pc.op, "post");
  assert.equal(A.t.setEnabled(false), "껐습니다");
  assert.equal(pc.o.signal.aborted, true);
  assert.equal(A.S.inflight.size, 0);
  // 끄는 순간 진행 중 요청을 바로 끝내 요청별 15초 타이머도 함께 지움
  assert.equal(A.timers.size, 0);
  const n = A.net.calls.length;
  A.net.gate.resolve();
  await A.flush();
  assert.equal(hoRows(s).length, 1);
  assert.equal(A.store.m.has(K.shared), false);
  assert.equal(A.t.peekOutbox().length, 1);
  await A.tick(LIM.interval * 2);
  assert.equal(A.net.calls.length, n);
  A.net.gate = null;
  assert.equal(A.t.setEnabled(true), "켰습니다");
  await A.flush();
  assert.equal(A.t.peekOutbox().length, 0);
  assert.equal(hoRows(s).length, 1);
  assert.equal(A.ho.isShared(r.id), true);
});

test("응답이 막 닿은 순간에 끄면 — 그 응답도 반영하지 않음", async () => {
  const s = boot();
  const A = makeClient(s);
  await A.connect(s.staff[0].code);
  A.net.gate = deferred();
  const r = rec("응답 직후 끄기");
  A.ho.share(r);
  await A.flush();
  assert.equal(A.S.inflight.size, 1);
  // 응답을 받아 요청 타이머를 지우는 순간 끄기를 예약 — 응답 처리보다 먼저 돎
  const clear = A.env.clearTimeout;
  let armed = true;
  A.env.clearTimeout = id => { if (armed) { armed = false; queueMicrotask(() => A.t.setEnabled(false)); } clear(id); };
  A.net.gate.resolve();
  await A.flush();
  assert.equal(armed, false);
  assert.equal(A.S.on, false);
  assert.equal(hoRows(s).length, 1);
  assert.equal(A.store.m.has(K.shared), false);
  assert.equal(A.t.peekOutbox().length, 1);
});

test("이상한 응답은 받지 않음·다시 켜면 받아 둔 목록으로 시작", async () => {
  const s = boot();
  const A = makeClient(s);
  const me = { id: s.staff[0].id, name: "김사감" };
  const cases = [
    { status: 200, text: "<html>로그인</html>" },
    { status: 500, text: JSON.stringify({ ok: true, me, items: [] }) },
    { status: 200, text: JSON.stringify({ ok: true, items: [] }) },
    { status: 200, text: JSON.stringify({ ok: true, me }) },
    { status: 200, text: JSON.stringify({ ok: true, me: { id: me.id, name: "가".repeat(41) }, items: [] }) }
  ];
  A.net.raw = () => cases[0];
  await A.connect(s.staff[0].code);
  for (const cs of cases) {
    A.net.raw = () => cs;
    await A.ho.sync();
    assert.equal(A.S.lastErr, "서버 응답이 이상합니다", cs.text);
    assert.equal(A.S.me, null);
    assert.equal(A.store.m.has(K.cache), false);
  }
  A.net.raw = () => ({ status: 200, text: JSON.stringify({ ok: false, error: "server" }) });
  await A.ho.sync();
  assert.equal(A.S.lastErr, "서버 오류");
  const xss = '<img src=x onerror="alert(1)"> \'따옴표\'';
  A.net.raw = () => ({ status: 200, text: JSON.stringify({ ok: true, me, items: [{ junk: 1 }, { id: "xss00001", at: stamp(NOW), date: "2026-11-25", time: "10:00", place: "", sid: "S99", name: "<b>이</b>", body: xss, acks: [] }] }) });
  await A.ho.sync();
  assert.equal(A.S.lastErr, "");
  assert.deepEqual(A.S.cache.items.map(x => [x.id, x.body, x.name]), [["xss00001", xss, "<b>이</b>"]]);

  A.net.raw = null;
  const r = rec("다시 켜기 시험");
  A.ho.share(r);
  await A.flush();
  const at = A.S.lastOk;
  const A2 = makeClient(s, { store: A.store });
  A2.net.down = true;
  A2.ho.start();
  await A2.flush();
  assert.deepEqual(A2.S.me, me);
  assert.deepEqual(A2.t.view().map(x => x.id), [r.id]);
  assert.equal(A2.t.statusText(), `마지막 받음 ${P.kstStamp(at).slice(11, 16)} — 연결 안 됨`);
  assert.equal(A2.ho.isShared(r.id), true);

  const other = JSON.parse(A.store.m.get(K.cache));
  other.cf = OTHER_CF;
  const A3 = makeClient(s, { store: memStore({ [K.cfg]: A.store.m.get(K.cfg), [K.cache]: JSON.stringify(other) }) });
  A3.net.down = true;
  A3.ho.start();
  await A3.flush();
  assert.equal(A3.S.me, null);
  assert.deepEqual(A3.t.view(), []);

  const A4 = makeClient(s, { store: memStore({ [K.cfg]: A.store.m.get(K.cfg), [K.cache]: "{" }) });
  A4.net.down = true;
  A4.ho.start();
  await A4.flush();
  assert.deepEqual([A4.S.on, A4.S.cache], [true, null]);
});

// 탭 사이 잠금(navigator.locks) 흉내 — mode로 고장 난 잠금도 만듦
function mutex(mode = "") {
  const m = {
    names: [], active: 0, max: 0, tail: Promise.resolve(),
    request(name, fn) {
      m.names.push(name);
      if (mode === "throw") throw new Error("잠금 고장");
      if (mode === "reject") return Promise.reject(new Error("잠금 거부"));
      if (mode === "after") return Promise.resolve(fn()).then(() => { throw new Error("늦은 오류"); });
      const run = m.tail.then(async () => {
        m.active++;
        m.max = Math.max(m.max, m.active);
        try { return await fn(); } finally { m.active--; }
      });
      m.tail = run.catch(() => {});
      return run;
    }
  };
  return m;
}

test("여러 탭 — 잠금으로 한 번에 하나씩, 잠금이 고장 나도 동기화", async () => {
  const s = boot();
  const L = mutex();
  const T1 = makeClient(s, { locks: L });
  const T2 = makeClient(s, { locks: L, store: T1.store });
  await T1.connect(s.staff[0].code);
  T1.net.gate = deferred();
  T1.ho.share(rec("탭 시험"));
  await T1.flush();
  T2.ho.start();
  await T2.flush();
  assert.equal(T2.net.calls.length, 0);
  T1.net.gate.resolve();
  T1.net.gate = null;
  await T1.flush();
  await T2.flush();
  assert.deepEqual(T2.ops(), ["list"]);
  assert.equal(hoRows(s).length, 1);
  assert.equal(L.max, 1);
  assert.ok(L.names.length >= 3 && L.names.every(n => n === "handover-sync"));
  for (const mode of ["throw", "reject", "after"]) {
    const c = makeClient(s, { locks: mutex(mode) });
    await c.connect(s.staff[1].code);
    assert.deepEqual(c.ops(), ["list"], mode);
  }
});

test("저장소 읽기 실패 — 처음부터면 꺼진 것으로, 켜진 중이면 알리고 목록 받기는 계속", async () => {
  const s = boot();
  const st = memStore();
  const A = makeClient(s, { store: st });
  await A.connect(s.staff[0].code);
  const c1 = makeClient(s, { store: st });
  st.failGet = true;
  c1.ho.start();
  await c1.flush();
  assert.deepEqual([c1.S.on, c1.net.calls.length], [false, 0]);

  const r = rec("읽기 실패 시험");
  assert.equal(A.ho.share(r), SHARE_FAIL);
  assert.deepEqual(A.log.alert, [READ_FAIL, SHARE_FAIL]);
  assert.equal(A.ho.share(rec("두 번째")), SHARE_FAIL);
  assert.deepEqual(A.log.alert, [READ_FAIL, SHARE_FAIL, SHARE_FAIL]);
  assert.equal(A.ho.isShared(r.id), false);
  assert.deepEqual(A.t.tagOf(r.id, A.t.tagCtx()), ["못 보냄", "ho-bad"]);
  const lists = () => A.ops().filter(o => o === "list").length;
  const n = lists();
  await A.ho.sync();
  assert.equal(lists(), n + 1);
  st.failGet = false;
  assert.equal(A.ho.share(r), "");
  await A.flush();
  assert.equal(hoRows(s).length, 1);
});

test("다른 창에서 끄거나 바꾸면 이 창도 멈춤 — 알림으로, 알림을 놓쳐도 요청 직전에(감사실장 P2-6)", async () => {
  const s = boot();
  const st = memStore();
  const A = makeClient(s, { store: st });
  const code = s.staff[0].code, code2 = s.staff[1].code;
  await A.connect(code);
  assert.equal(A.listeners.size, 1);
  // 같은 태블릿의 다른 창에서 끔 → 알림을 받고 멈춤
  const W = makeClient(s, { store: st });
  assert.equal(W.t.setEnabled(false), "껐습니다");
  assert.equal(A.S.on, true);
  A.fire(K.cfg);
  assert.deepEqual([A.S.on, A.listeners.size, A.timers.size], [false, 0, 0]);
  assert.equal(W.net.calls.length, 0);
  // 다시 켜면 다른 열쇠·전체 지우기 알림에는 그대로
  assert.equal(A.t.setEnabled(true), "켰습니다");
  await A.flush();
  A.fire("dormJournalData_v1");
  A.fire(null);
  assert.deepEqual([A.S.on, A.listeners.size], [true, 1]);

  // 알림 없이 설정이 꺼져 있으면 보내기 직전에 멈추고, 보낼 항목은 남김
  const cfgOn = st.get(K.cfg);
  st.set(K.cfg, JSON.stringify({ ...JSON.parse(cfgOn), enabled: false }));
  const n = A.net.calls.length;
  const r = rec("다른 창에서 끈 뒤 공유");
  assert.equal(A.ho.share(r), "");
  await A.flush();
  assert.equal(A.net.calls.length, n);
  assert.deepEqual([A.S.on, A.listeners.size, A.timers.size], [false, 0, 0]);
  assert.deepEqual(A.t.peekOutbox().map(x => x.id), [r.id]);

  // 알림 없이 코드가 바뀌어 있으면 옛 코드로 보내지 않고 새 연결로 다시 켬
  st.set(K.cfg, cfgOn);
  assert.equal(A.t.setEnabled(true), "켰습니다");
  await A.flush();
  assert.equal(hoRows(s).length, 1);
  st.set(K.cfg, JSON.stringify({ ...JSON.parse(cfgOn), code: raw(code2) }));
  const m = A.net.calls.length;
  await A.ho.sync();
  await A.flush();
  const after = A.net.calls.slice(m);
  assert.ok(after.length > 0);
  assert.equal(after.every(c => c.req.code === raw(code2)), true);
  assert.equal(A.S.me.name, "이사감");
  assert.equal(A.listeners.size, 1);
});

test("보낸 뒤 공유 표시를 남기지 못하면 보낼 목록에 두고 다음에 다시 확인(감사실장 P3-14)", async () => {
  const s = boot();
  const A = makeClient(s);
  await A.connect(s.staff[0].code);
  A.store.failSet = new Set([K.shared]);
  const r = rec("표시 실패");
  assert.equal(A.ho.share(r), "");
  await A.flush();
  const posts = () => A.ops().filter(o => o === "post").length;
  assert.deepEqual([hoRows(s).length, posts(), A.t.peekOutbox().length], [1, 1, 1]);
  assert.equal(A.log.notify.at(-1), "저장 공간 부족 — 공유 표시를 남기지 못해 나중에 다시 확인합니다");
  // 보낼 목록에 남아 있어 화면은 계속 "공유"로 보이되, 공유 표시는 아직 없음
  assert.equal(A.ho.isShared(r.id), true);
  assert.equal(!!(A.t.readShared() || {})[r.id], false);
  A.store.failSet = null;
  await A.tick(LIM.interval);
  // 같은 번호라 서버에는 한 줄만(규칙 d)
  assert.deepEqual([hoRows(s).length, posts(), A.t.peekOutbox().length], [1, 2, 0]);
  assert.ok(A.t.readShared()[r.id]);
  assert.equal(A.ho.isShared(r.id), true);
});

test("저장 공간이 모자라면 받아 둔 목록을 비워 보낼 목록을 저장", async () => {
  const s = boot();
  const A = makeClient(s);
  await A.connect(s.staff[0].code);
  assert.ok(A.store.m.has(K.cache));
  const set0 = A.store.set;
  A.store.set = (k, v) => { if (k === K.outbox && A.store.m.has(K.cache)) throw new Error("저장 공간 부족"); set0(k, v); };
  A.net.down = true;
  const r = rec("공간 부족 때 공유");
  assert.equal(A.ho.share(r), "");
  assert.equal(A.store.m.has(K.cache), false);
  assert.deepEqual(A.t.peekOutbox().map(x => x.id), [r.id]);
  await A.flush();
  A.store.set = set0;
  A.net.down = false;
  await A.ho.sync();
  assert.equal(hoRows(s).length, 1);
  assert.equal(A.t.peekOutbox().length, 0);
  assert.equal(A.store.m.has(K.cache), true);
});

test("받는 중에 다시 요청이 오면 이어서 돌되 최대 4번", async () => {
  const s = boot();
  const A = makeClient(s);
  await A.connect(s.staff[0].code);
  const before = A.ops().length;
  A.net.onFetch = x => { if (x.op === "list") A.ho.sync(); };
  await A.ho.sync();
  await A.flush();
  assert.deepEqual(A.ops().slice(before), ["list", "list", "list", "list"]);
  assert.equal(A.S.syncing, null);
  A.net.onFetch = null;
  await A.ho.sync();
  assert.equal(A.ops().length, before + 5);
});

test("일지 꼬리표 — 우선순위와 경계(시도 20회)", async () => {
  const s = boot();
  const A = makeClient(s);
  await A.connect(s.staff[0].code);
  A.net.down = true;
  const me = A.S.me.id, cf = A.S.runCf;
  A.store.m.set(K.outbox, JSON.stringify([
    ox("withdraw", "tag0001", { cf, me }),
    ox("withdraw", "tag0003", { cf, me }),
    ox("post", "tag0004", { cf: OTHER_CF, me: "S99" }),
    ox("post", "tag0005", { cf, me, tries: 21 }),
    ox("post", "tag0006", { cf, me, tries: 20 })
  ]));
  A.store.m.set(K.failed, JSON.stringify([
    { op: "post", id: "tag0001", kind: "", snip: "x", msg: "m", at: NOW },
    { op: "ack", id: "tag0010", kind: "ack", snip: "x", msg: "m", at: NOW }
  ]));
  A.store.m.set(K.shared, JSON.stringify({ tag0007: NOW, "bad-key": NOW, tag0011: "어제" }));
  A.S.localFail.add("tag0002");
  A.S.cache.items.push({ id: "tag0008", at: stamp(NOW), date: "", time: "", place: "", sid: me, name: "김사감", body: "x", acks: [] });
  const ctx = A.t.tagCtx();
  const tag = id => A.t.tagOf(id, ctx);
  assert.deepEqual(tag("tag0001"), ["못 보냄(형식)", "ho-bad"]);
  assert.deepEqual(tag("tag0002"), ["못 보냄", "ho-bad"]);
  assert.deepEqual(tag("tag0003"), ["공유 취소 중", "ho-wait"]);
  assert.deepEqual(tag("tag0004"), ["보내기 멈춤 — 인계함 확인", "ho-warn"]);
  assert.deepEqual(tag("tag0005"), ["보내는 중 — 문제 있음", "ho-warn"]);
  assert.deepEqual(tag("tag0006"), ["보내는 중", "ho-wait"]);
  assert.deepEqual(tag("tag0007"), ["📨 공유됨", "ho-ok"]);
  assert.deepEqual(tag("tag0008"), ["📨 공유됨", "ho-ok"]);
  for (const id of ["tag0009", "tag0010", "tag0011"]) assert.equal(tag(id), null, id);
  for (const id of ["tag0006", "tag0007", "tag0008"]) assert.equal(A.ho.isShared(id), true, id);
  assert.equal(A.ho.isShared("tag0009"), false);
});

test("설정 — 저장 검사·켜고 끄기·연결 바꾸기·지우기·연결 시험", async () => {
  const s = boot();
  const A = makeClient(s);
  const t = A.t;
  const code = s.staff[0].code;
  assert.equal(t.setEnabled(true), "주소와 개인 코드를 먼저 저장하세요");
  assert.equal(t.setEnabled(false), "껐습니다");
  assert.equal(A.store.m.size, 0);
  assert.equal(await t.testConnection(), "주소와 개인 코드를 먼저 저장하세요");
  const URL_MSG = "웹 앱 주소가 맞지 않습니다 — https://script.google.com/macros/s/…/exec 모양이어야 합니다";
  assert.equal(t.saveCfg({ url: "http://x", code }), URL_MSG);
  assert.equal(t.saveCfg(null), URL_MSG);
  assert.equal(t.saveCfg({ url: URL1, code: "" }), "개인 코드를 적어 주세요");
  assert.equal(t.saveCfg({ url: URL1, code: "ABC-DEF" }), "개인 코드는 12자입니다(줄표는 빼도 됩니다)");
  assert.equal(t.saveCfg({ url: URL1, code: "ABCD-EFGH-IJKL" }), "개인 코드에 쓰지 않는 글자가 있습니다(영문 I·O, 숫자 0·1은 없습니다)");
  assert.equal(t.saveCfg({ url: URL1, code, place: "가".repeat(31) }), "근무지는 30자까지입니다");
  assert.equal(A.store.m.size, 0);
  assert.equal(t.saveCfg({ url: ` ${URL1} `, code: code.toLowerCase(), place: " 태하관 " }), "저장했습니다");
  assert.deepEqual(A.store.json(K.cfg), { enabled: false, url: URL1, code: raw(code), place: "태하관" });
  // 꺼진 채로 연결 시험 — 켜지 않고 이름만 확인
  assert.equal(await t.testConnection(), "김사감 님으로 연결됨");
  assert.deepEqual([A.S.on, A.timers.size], [false, 0]);
  assert.equal(t.saveCfg({ url: URL1, code: "", place: "서현관" }), "저장했습니다");
  assert.equal(A.store.json(K.cfg).code, raw(code));
  assert.equal(t.setEnabled(true), "켰습니다");
  await A.flush();
  assert.equal(A.S.on, true);

  A.net.down = true;
  assert.equal(await t.testConnection(), "연결 안 됨 — 인터넷과 웹 앱 주소(배포 권한 ‘모든 사용자’)를 확인하세요");
  A.net.down = false;
  A.net.raw = () => ({ status: 200, text: JSON.stringify({ ok: false, error: "busy" }) });
  assert.equal(await t.testConnection(), "서버가 바쁩니다 — 잠시 뒤 다시 시험하세요");
  A.net.raw = () => ({ status: 200, text: "<html>" });
  assert.equal(await t.testConnection(), "서버 응답이 이상합니다 — 운영자에게 알려 주세요");
  // 켜진 연결의 코드가 막혔다고 나오면 받은 목록·이름을 바로 지움(감사실장 P3-13)
  assert.ok(A.S.me && A.S.cache && A.store.m.has(K.cache));
  A.net.raw = () => ({ status: 200, text: JSON.stringify({ ok: false, error: "auth" }) });
  assert.equal(await t.testConnection(), "개인 코드를 확인하세요 — 코드가 틀렸거나 중지된 사감입니다");
  assert.deepEqual([A.S.me, A.S.cache, A.store.m.has(K.cache), A.S.authBlocked === A.S.runCf], [null, null, false, true]);
  A.net.raw = null;
  await A.ho.sync();
  assert.deepEqual([A.S.authBlocked, A.S.me.name, A.store.m.has(K.cache)], ["", "김사감", true]);

  // 저장 공간이 없을 때 — 저장·켜기는 실패, 끄기는 먼저 멈추고 공간을 만들어 봄(감사실장 P2-7)
  A.store.failSet = new Set([K.cfg]);
  assert.equal(t.saveCfg({ url: URL1, code }), "설정을 저장하지 못했습니다(저장 공간)");
  assert.equal(t.setEnabled(false), "끄지 못했습니다(저장 공간) — 지금은 멈췄지만 앱을 다시 열면 켜집니다");
  assert.deepEqual([A.S.on, A.timers.size, A.listeners.size, A.S.inflight.size], [false, 0, 0, 0]);
  assert.equal(A.store.json(K.cfg).enabled, true);
  A.store.failSet = null;
  assert.equal(t.setEnabled(true), "켰습니다");
  await A.flush();
  assert.deepEqual([A.S.on, A.listeners.size], [true, 1]);
  assert.ok(A.store.m.has(K.cache));
  // 받은 목록을 비우면 저장되는 경우 — 끄기가 끝까지 됨
  const set0 = A.store.set;
  A.store.set = (k, v) => { if (k === K.cfg && A.store.m.has(K.cache)) throw new Error("저장 공간 부족"); set0(k, v); };
  assert.equal(t.setEnabled(false), "껐습니다");
  assert.deepEqual([A.S.on, A.store.m.has(K.cache), A.store.json(K.cfg).enabled], [false, false, false]);
  A.store.set = set0;
  assert.equal(t.setEnabled(true), "켰습니다");
  await A.flush();
  // 그래도 안 되면 설정을 지워서라도 끔
  A.store.set = (k, v) => { if (k === K.cfg) throw new Error("저장 공간 부족"); set0(k, v); };
  assert.equal(t.setEnabled(false), "껐습니다 — 저장 공간이 부족해 설정을 지웠습니다(다시 켜려면 주소·코드를 다시 적으세요)");
  assert.deepEqual([A.S.on, A.store.m.has(K.cfg), A.timers.size], [false, false, 0]);
  A.store.set = set0;
  assert.equal(t.saveCfg({ url: URL1, code }), "저장했습니다");
  assert.equal(t.setEnabled(true), "켰습니다");
  await A.flush();
  assert.equal(A.S.on, true);

  // 못 보낸 인계가 있을 때 연결 바꾸기 — 묻고, 거절하면 그대로
  A.net.down = true;
  A.ho.share(rec("바꾸기 전 인계"));
  await A.flush();
  const code2 = s.staff[1].code;
  A.answers.push(false);
  assert.equal(t.saveCfg({ url: URL1, code: code2 }), "바꾸지 않았습니다");
  assert.equal(A.store.json(K.cfg).code, raw(code));
  assert.match(A.log.confirm.at(-1), /아직 보내지 못한 인계가 있을 수 있습니다/);
  assert.ok(A.store.m.has(K.cache));
  A.answers.push(true);
  assert.equal(t.saveCfg({ url: URL1, code: code2 }), "저장했습니다");
  assert.equal(A.store.m.has(K.cache), false);

  // 지우기 — 못 보낸 건수를 알리고, 보낼 목록은 남김
  A.answers.push(false);
  assert.equal(t.clearSettings(), "");
  assert.ok(A.store.m.has(K.cfg));
  assert.match(A.log.confirm.at(-1), /아직 보내지 못한 인계 1건/);
  A.answers.push(true);
  assert.equal(t.clearSettings(), "지웠습니다");
  assert.equal(A.store.m.has(K.cfg), false);
  assert.equal(t.peekOutbox().length, 1);
  assert.deepEqual([A.S.on, A.timers.size], [false, 0]);

  // 꺼진 채 연결 시험 중에 연결을 바꾸거나 지우면 시험 요청을 끊음(감사실장 P2-8)
  A.net.down = false;
  assert.equal(t.saveCfg({ url: URL1, code }), "저장했습니다");
  A.net.hang = true;
  const pt1 = t.testConnection();
  assert.equal(A.S.inflight.size, 1);
  assert.equal(t.saveCfg({ url: URL1, code: code2 }), "저장했습니다");
  assert.equal(A.S.inflight.size, 0);
  assert.match(await pt1, /^연결 안 됨/);
  const pt2 = t.testConnection();
  assert.equal(A.S.inflight.size, 1);
  assert.equal(t.clearSettings(), "지웠습니다");
  assert.equal(A.S.inflight.size, 0);
  assert.match(await pt2, /^연결 안 됨/);
  A.net.hang = false;

  assert.equal(t.saveCfg({ url: URL1, code: "ABCD-EFGH-JKLM" }), "저장했습니다");
  assert.equal(await t.testConnection(), "개인 코드를 확인하세요 — 코드가 틀렸거나 중지된 사감입니다");
  noLeak(A, code);
});

// 일지 화면 흉내 — 공유 체크 칸만 있음(나머지 화면 만들기는 실패해도 됨)
function miniDoc() {
  const els = { "ho-share-chk": { checked: true } };
  return {
    els, visibilityState: "visible", head: null, body: null,
    getElementById: id => els[id] || null,
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    createElement() { throw new Error("화면 없음"); }
  };
}

test("일지 추가 전 검사(beforeAdd) — 공유 체크·종류·막기", async () => {
  const s = boot();
  const doc = miniDoc();
  const A = makeClient(s, { doc });
  const r = rec("추가 전 검사");
  assert.equal(A.ho.beforeAdd(r), null);
  await A.connect(s.staff[0].code);
  assert.deepEqual(A.ho.beforeAdd(r), { share: true });
  assert.equal(A.ho.beforeAdd({ ...r, kind: "일반" }), null);
  assert.deepEqual(A.ho.beforeAdd({ ...r, time: "" }), { block: true, msg: "공유하려면 시각을 00:00 모양으로 적어 주세요 — 시각을 고치거나 공유 체크를 끄세요" });
  doc.els["ho-share-chk"].checked = false;
  assert.equal(A.ho.beforeAdd({ ...r, time: "" }), null);
  assert.equal(doc.els["ho-share-chk"].checked, true);
  delete doc.els["ho-share-chk"];
  assert.equal(A.ho.beforeAdd(r), null);
  assert.equal(A.ho.beforeAdd(null), null);
});

test("연결 시험 단추 — 기다리는 사이 다른 설정 문구가 나오면 늦게 온 결과는 버림", async () => {
  const s = boot();
  const doc = miniDoc();
  doc.els["ho-set-msg"] = { textContent: "" };
  const A = makeClient(s, { doc });
  const t = A.t;
  const msg = () => doc.els["ho-set-msg"].textContent;
  assert.equal(t.saveCfg({ url: URL1, code: s.staff[0].code }), "저장했습니다");
  await t.runTest();
  assert.equal(msg(), "김사감 님으로 연결됨");
  // 응답을 기다리는 사이 "지웠습니다"가 나오면 늦게 온 "연결됨"이 덮지 않음
  A.net.gate = deferred();
  const p = t.runTest();
  assert.equal(msg(), "연결 시험 중…");
  t.setMsg("지웠습니다");
  A.net.gate.resolve();
  await p;
  assert.equal(msg(), "지웠습니다");
  // 연결 끊김 결과도 같음
  const g2 = deferred();
  A.net.gate = g2;
  const p2 = t.runTest();
  t.setMsg("");
  A.net.down = true;
  g2.resolve();
  await p2;
  assert.equal(msg(), "");
  A.net.gate = null;
  A.net.down = false;
  // 두 번 눌러도 마지막 시험 결과만
  const g3 = deferred();
  A.net.gate = g3;
  const p3 = t.runTest();
  A.net.gate = null;
  await t.runTest();
  assert.equal(msg(), "김사감 님으로 연결됨");
  t.setMsg("저장했습니다");
  g3.resolve();
  await p3;
  assert.equal(msg(), "저장했습니다");
});

test("브라우저 환경 연결·시험 손잡이는 시험 때만·공개 함수는 던지지 않음", async () => {
  const calls = [];
  const ls = new Map();
  const win = {
    localStorage: { getItem: k => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, v), removeItem: k => ls.delete(k) },
    fetch: () => Promise.reject(new Error("x")), setTimeout, clearTimeout, setInterval, clearInterval, AbortController,
    document: null, navigator: {}, alert: m => calls.push(["alert", m]), confirm: () => true, prompt: () => null
  };
  const env = H.browserEnv(win);
  assert.equal(env.locks, null);
  env.notify("알림");
  win.toast = m => calls.push(["toast", m]);
  env.notify("토스트");
  assert.deepEqual(calls, [["alert", "알림"], ["toast", "토스트"]]);
  env.store.set("k", "v");
  assert.equal(env.store.get("k"), "v");
  env.store.remove("k");
  assert.equal(env.store.get("k"), null);
  const locks = { request() {} };
  assert.equal(H.browserEnv({ ...win, navigator: { locks } }).locks, locks);
  // 다른 창의 설정 변경 알림은 storage 이벤트로 받고, 끌 때 떼어 냄
  const evs = [];
  const f0 = () => {};
  const off = H.browserEnv({ ...win, addEventListener: (ty, f) => evs.push(["add", ty, f]), removeEventListener: (ty, f) => evs.push(["rm", ty, f]) }).listen(f0);
  off();
  assert.deepEqual(evs.map(e => [e[0], e[1], e[2] === f0]), [["add", "storage", true], ["rm", "storage", true]]);

  const ho = H.create(env);
  assert.equal(ho._t, undefined);
  assert.equal(ho.version, 1);
  assert.deepEqual(Object.keys(ho).sort(), ["beforeAdd", "decorate", "freeSpace", "isShared", "open", "renderSettings", "share", "start", "sync", "version", "withdraw"]);
  ho.start();
  for (const a of [undefined, null, 5, "x", {}, { id: 5 }]) {
    assert.doesNotThrow(() => { ho.share(a); ho.withdraw(a); ho.isShared(a); ho.beforeAdd(a); ho.decorate(a); });
  }
  await ho.sync();
  const boom = () => { throw new Error("x"); };
  const broken = H.create({ ...env, store: { get: boom, set: boom, remove: boom } });
  assert.doesNotThrow(() => { broken.start(); broken.share(rec("x")); broken.isShared("abcd"); broken.renderSettings(); broken.open(); });
  assert.equal(broken.freeSpace(), false);
  ls.set(K.cache, "{}");
  assert.equal(ho.freeSpace(), true);
  assert.equal(ls.has(K.cache), false);
  assert.equal(ls.size, 0);
});

test("화면에 HTML을 넣는 길이 없음 — 서버 글은 글자로만(규칙 f)", () => {
  const src = readFileSync(new URL("../handover.js", import.meta.url), "utf8");
  for (const sink of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "DOMParser", "createContextualFragment", "srcdoc"]) {
    assert.equal(src.includes(sink), false, "HTML로 넣는 곳: " + sink);
  }
});
