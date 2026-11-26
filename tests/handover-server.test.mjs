// 인계 공유 서버(handover-server.gs) 시험 — 가짜 시트에서 인증·쓰기·목록·코드 발급·정리를 확인
import test from "node:test";
import assert from "node:assert/strict";
import { makeServer, boot, stamp, NOW, DAY } from "./gas-fake.mjs";

const J = x => JSON.parse(JSON.stringify(x));
const P = (over = {}) => ({ id: "abc123def", date: "2026-11-25", time: "09:30", place: "태하관", body: "인계 내용", ...over });
const CODE_FMT = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;
// 인계 시트 한 줄(손으로 넣기용)
const HO = (o = {}) => [o.id ?? "post0001", o.at ?? stamp(NOW), o.date ?? "2026-11-25", o.time ?? "09:00", o.place ?? "", o.sid ?? "S01", o.name ?? "김사감", o.body ?? "내용", o.st ?? "정상", o.wat ?? ""];

function req(s, who, op, data) { return s.call({ op, code: s.staff[who].code, data }); }

// ── 시트 준비 ───────────────────────────────────────────────

test("setupSheets: 시간대·머리줄·고정·텍스트 서식·상태 규칙, 두 번 해도 됨", () => {
  const s = makeServer();
  s.ctx.setupSheets();
  s.ctx.setupSheets();
  assert.equal(s.ss.tz, "Asia/Seoul");
  assert.deepEqual(s.sheet("사감").rowsOf(5), []);
  assert.deepEqual(s.sheet("인계").cells[0].slice(0, 10), ["id", "받은 시각", "날짜", "시각", "근무지", "작성자 ID", "작성자 이름", "내용", "상태", "취소 시각"]);
  assert.deepEqual(s.sheet("확인").cells[0].slice(0, 6), ["인계 id", "사감 ID", "이름", "종류", "시각", "메모"]);
  for (const n of ["사감", "인계", "확인"]) {
    const sh = s.sheet(n);
    assert.equal(sh.frozen, 1);
    assert.equal(sh.fmt[999][0], "@", n + " 끝 줄까지 텍스트 서식");
  }
  const v = s.sheet("사감").validations.at(-1);
  assert.deepEqual(J(v.rule), { list: ["사용", "중지"], show: true, allowInvalid: false });
  assert.equal(v.col, 4);
  assert.equal(v.row, 2);
});

test("setupSheets: 머리줄이 다르면 멈춤", () => {
  const s = makeServer();
  s.ctx.setupSheets();
  s.sheet("인계").put(1, ["다른 머리"]);
  assert.throws(() => s.ctx.setupSheets(), /머리줄/);
});

// ── 코드 발급 ───────────────────────────────────────────────

test("issueCodes: ID·코드·상태·만든 시각, 코드는 서로 다르고 기록에 안 남음", () => {
  const s = boot(["김사감", "이사감", "박사감"]);
  assert.deepEqual(s.staff.map(x => x.id), ["S01", "S02", "S03"]);
  for (const x of s.staff) {
    assert.match(x.code, CODE_FMT);
    assert.equal(x.st, "사용");
    assert.equal(x.made, stamp(NOW));
  }
  assert.equal(new Set(s.staff.map(x => x.code)).size, 3);
  const all = s.logs.join("\n") + s.errors.join("\n");
  for (const x of s.staff) {
    assert.ok(!all.includes(x.code) && !all.includes(x.code.replace(/-/g, "")), "코드가 기록에 남으면 안 됨");
  }
  assert.match(s.logs.at(-1), /3개/);
  assert.equal(s.lock.held, s.lock.released);
});

test("issueCodes: 다시 돌리면 있는 것은 그대로, 새 줄만 채움, 중지 유지", () => {
  const s = boot(["김사감", "이사감"]);
  const sh = s.sheet("사감");
  sh.put(3, [s.staff[1].id, "이사감", s.staff[1].code, "중지", s.staff[1].made]);
  sh.put(4, ["", "박사감"]);
  s.ctx.issueCodes();
  const rows = sh.rowsOf(5);
  assert.deepEqual(rows[0].slice(0, 3), [s.staff[0].id, "김사감", s.staff[0].code]);
  assert.equal(rows[1][3], "중지");
  assert.equal(rows[1][2], s.staff[1].code);
  assert.equal(rows[2][0], "S03");
  assert.match(rows[2][2], CODE_FMT);
  assert.match(s.logs.at(-1), /1개/);
});

test("issueCodes: 잘못된 표는 아무것도 쓰지 않고 멈춤", () => {
  const cases = [
    ["이름 겹침", r => { r.put(4, ["", "김사감"]); }, /이름이 다른 줄과 겹칩니다/],
    ["이름 비움", r => { r.put(4, ["", "", "", "사용"]); }, /이름이 비었습니다/],
    ["이름 41자", r => { r.put(4, ["", "가".repeat(41)]); }, /40자/],
    ["코드 모양", r => { r.put(4, ["", "박사감", "ABC"]); }, /코드가 이상하거나/],
    ["코드 겹침", (r, s) => { r.put(4, ["", "박사감", s.staff[0].code.toLowerCase()]); }, /코드가 이상하거나/],
    ["ID 모양", r => { r.put(4, ["X1", "박사감"]); }, /사감 ID/],
    ["ID 겹침", r => { r.put(4, ["S01", "박사감"]); }, /사감 ID/],
    ["상태", r => { r.put(4, ["", "박사감", "", "정지"]); }, /상태는/]
  ];
  for (const [label, mut, re] of cases) {
    const s = boot(["김사감", "이사감"]);
    const sh = s.sheet("사감");
    mut(sh, s);
    const before = JSON.stringify(sh.cells.slice(0, 5));
    const writes = sh.writes;
    assert.throws(() => s.ctx.issueCodes(), re, label);
    assert.equal(sh.writes, writes, label + " — 쓰지 않음");
    assert.equal(JSON.stringify(sh.cells.slice(0, 5)), before, label);
    assert.equal(s.lock.held, s.lock.released, label + " — 잠금 풂");
  }
});

test("issueCodes: 사감 ID는 다시 쓰지 않음(줄을 지워도, 기록에만 남아도)", () => {
  const s = boot(["김사감", "이사감"]);
  const sh = s.sheet("사감");
  sh.put(3, ["", "", "", "", ""]);
  sh.put(4, ["", "박사감"]);
  s.ctx.issueCodes();
  assert.equal(sh.rowsOf(5)[2][0], "S03", "지운 S02를 다시 쓰지 않음");

  const t = makeServer();
  t.ctx.setupSheets();
  t.sheet("인계").put(2, HO({ sid: "S05" }));
  t.sheet("확인").put(2, ["post0001", "S07", "누구", "확인", stamp(NOW), ""]);
  t.sheet("사감").put(2, ["", "새사감"]);
  t.ctx.issueCodes();
  assert.equal(t.sheet("사감").rowsOf(5)[0][0], "S08");
  assert.equal(t.props.get("maxStaffNo"), "8");
});

test("issueCodes: 잠금을 못 잡으면 멈춤", () => {
  const s = makeServer();
  s.ctx.setupSheets();
  s.sheet("사감").put(2, ["", "김사감"]);
  s.lock.ok = false;
  assert.throws(() => s.ctx.issueCodes(), /다른 작업 중/);
  assert.deepEqual(s.sheet("사감").rowsOf(2), [["", "김사감"]]);
});

test("issueCodes: 코드가 이미 있으면 다시 뽑음", () => {
  let n = 0;
  const s = makeServer({ uuid: () => (n++ < 2 ? "same" : "other" + n) });
  s.clock.now = NOW;
  s.ctx.setupSheets();
  s.sheet("사감").put(2, ["", "김사감"]);
  s.sheet("사감").put(3, ["", "이사감"]);
  s.ctx.issueCodes();
  const rows = s.sheet("사감").rowsOf(5);
  assert.notEqual(rows[0][2], rows[1][2]);
});

// ── 인증(허용 목록) ─────────────────────────────────────────

test("인증: 맞는 코드면 서버가 정한 me를 돌려줌, 띄어쓰기·하이픈·소문자는 정리", () => {
  const s = boot();
  const code = s.staff[0].code;
  for (const c of [code, code.replace(/-/g, ""), code.toLowerCase(), " " + code.replace(/-/g, " ") + " "]) {
    const r = s.call({ op: "list", code: c });
    assert.equal(r.ok, true, c);
    assert.deepEqual(r.me, { id: "S01", name: "김사감" });
  }
});

test("인증: 코드가 없거나 틀리거나 모양이 다르면 auth", () => {
  const s = boot();
  const code = s.staff[0].code.replace(/-/g, "");
  for (const c of [undefined, null, "", 123, ["x"], code.slice(0, 11), code + "A", "ABCDEFGHJKLM", code.slice(0, 11) + "1", code.slice(0, 11) + "O"]) {
    const r = s.call({ op: "list", code: c });
    assert.deepEqual(r, { ok: false, error: "auth" }, String(c));
  }
});

test("인증: 상태가 정확히 '사용'일 때만(앞뒤 공백은 정리)", () => {
  for (const [st, ok] of [["사용", true], ["사용 ", true], [" 사용", true], ["중지", false], ["중지 ", false], ["정지", false], ["", false], ["사용중", false]]) {
    const s = boot(["김사감"]);
    const x = s.staff[0];
    s.sheet("사감").put(2, [x.id, x.name, x.code, st, x.made]);
    const r = s.call({ op: "list", code: x.code });
    assert.equal(r.ok, ok, JSON.stringify(st));
    if (!ok) assert.equal(r.error, "auth");
  }
});

test("인증: 같은 코드가 두 줄이면 둘 다 거부, ID·이름이 이상해도 거부", () => {
  const s = boot(["김사감", "이사감"]);
  const [a, b] = s.staff;
  s.sheet("사감").put(3, [b.id, b.name, a.code, "사용", b.made]);
  assert.equal(s.call({ op: "list", code: a.code }).error, "auth");

  const t = boot(["김사감"]);
  const x = t.staff[0];
  for (const row of [["X01", x.name], ["", x.name], [x.id, ""], [x.id, "가".repeat(41)]]) {
    t.sheet("사감").put(2, [row[0], row[1], x.code, "사용", x.made]);
    assert.equal(t.call({ op: "list", code: x.code }).error, "auth", JSON.stringify(row));
  }
});

test("인증: 모양이 틀린 코드 줄은 건너뜀(그 줄 코드로는 못 들어옴)", () => {
  const s = boot(["김사감"]);
  s.sheet("사감").put(3, ["S09", "가짜", "AAAA-AAAA-AAA1", "사용", ""]);
  assert.equal(s.call({ op: "list", code: "AAAAAAAAAAA1" }).error, "auth");
});

// ── 요청 모양 ───────────────────────────────────────────────

test("요청 모양: JSON 아님·배열·너무 큼·비어 있음·모르는 요청은 bad, me 없음", () => {
  const s = boot();
  const code = s.staff[0].code;
  for (const raw of ["{", "[]", "null", "\"x\"", JSON.stringify({ op: "list", code, pad: "x".repeat(20001) })]) {
    const r = s.call(raw);
    assert.equal(r.error, "bad", raw.slice(0, 20));
    assert.equal(r.me, undefined);
  }
  const noPost = JSON.parse(s.ctx.doPost({}).getContent());
  assert.equal(noPost.error, "bad");
  for (const op of [undefined, "delete", "LIST", "constructor"]) {
    const r = s.call({ op, code });
    assert.equal(r.error, "bad", String(op));
    assert.equal(r.me, undefined);
  }
});

test("서버 오류: 시트가 없으면 server만 돌려주고 기록에 남김", () => {
  const s = boot();
  s.ss.sheets.delete("인계");
  const r = req(s, 0, "list");
  assert.deepEqual(r, { ok: false, error: "server" });
  assert.match(s.errors.at(-1), /doPost 실패/);
});

test("doGet: 안내 글만", () => {
  const s = makeServer();
  assert.match(s.ctx.doGet().getContent(), /인계 공유 서버/);
});

// ── 인계 보내기 ─────────────────────────────────────────────

test("post: 작성자는 서버가 정함, 목록에 나옴, 같은 사람이 다시 보내면 그대로", () => {
  const s = boot();
  const r = req(s, 0, "post", P({ sid: "S99", name: "가짜", by: "가짜" }));
  assert.deepEqual(r, { ok: true, me: { id: "S01", name: "김사감" } });
  const row = s.sheet("인계").rowsOf(10)[0];
  assert.deepEqual(row.slice(0, 1).concat(row.slice(2)), ["abc123def", "2026-11-25", "09:30", "태하관", "S01", "김사감", "인계 내용", "정상", ""]);
  assert.equal(row[1], stamp(NOW));
  assert.equal(req(s, 0, "post", P({ body: "다른 내용" })).ok, true);
  assert.equal(s.sheet("인계").rowsOf(10).length, 1);
  const l = req(s, 1, "list");
  assert.equal(l.items.length, 1);
  assert.deepEqual(l.items[0], { id: "abc123def", at: stamp(NOW), date: "2026-11-25", time: "09:30", place: "태하관", sid: "S01", name: "김사감", body: "인계 내용", acks: [] });
  assert.deepEqual(l.me, { id: "S02", name: "이사감" });
  assert.ok(s.flushes > 0);
  assert.equal(s.lock.held, s.lock.released);
});

test("post: 다른 사람이 같은 id를 쓰면 bad", () => {
  const s = boot();
  req(s, 0, "post", P());
  const r = req(s, 1, "post", P());
  assert.equal(r.error, "bad");
  assert.match(r.message, /겹칩니다/);
  assert.equal(s.sheet("인계").rowsOf(10).length, 1);
});

test("post: 이미 받은 글은 날짜가 지난 뒤 다시 보내도 ok, 새 글은 날짜 범위 검사", () => {
  const s = boot();
  assert.equal(req(s, 0, "post", P({ id: "late14d", date: "2026-11-11" })).ok, true);
  s.clock.now += DAY;
  assert.deepEqual(req(s, 0, "post", P({ id: "late14d", date: "2026-11-11" })), { ok: true, me: { id: "S01", name: "김사감" } });
  assert.equal(req(s, 1, "post", P({ id: "late14d", date: "2026-11-11" })).error, "bad", "다른 사람은 여전히 겹침");
  const r = req(s, 0, "post", P({ id: "late15d", date: "2026-11-11" }));
  assert.equal(r.error, "bad");
  assert.match(r.message, /14일/);
  assert.equal(s.sheet("인계").rowsOf(10).length, 1);
});

test("post: 입력 검사", () => {
  const s = boot();
  const bads = [
    ["id 짧음", P({ id: "ab1" })], ["id 기호", P({ id: "abc-1234" })], ["id 41자", P({ id: "a".repeat(41) })], ["id 숫자형", P({ id: 12345678 })],
    ["15일 전", P({ date: "2026-11-10" })], ["모레", P({ date: "2026-11-27" })], ["없는 날", P({ date: "2026-02-30" })], ["날짜 모양", P({ date: "2026/11/25" })],
    ["시각 9:30", P({ time: "9:30" })], ["24:00", P({ time: "24:00" })], ["초 포함", P({ time: "09:30:00" })], ["시각 없음", P({ time: undefined })],
    ["근무지 31자", P({ place: "가".repeat(31) })], ["근무지 숫자", P({ place: 3 })],
    ["내용 빔", P({ body: "" })], ["내용 공백", P({ body: "  \n " })], ["내용 2001자", P({ body: "가".repeat(2001) })], ["내용 숫자", P({ body: 5 })]
  ];
  for (const [label, d] of bads) {
    const r = req(s, 0, "post", d);
    assert.equal(r.error, "bad", label);
    assert.equal(typeof r.message, "string");
  }
  for (const d of [null, [], "x"]) assert.equal(req(s, 0, "post", d).error, "bad");
  assert.equal(s.sheet("인계").rowsOf(10).length, 0);
  const goods = [P({ id: "a14d", date: "2026-11-11" }), P({ id: "a1tm", date: "2026-11-26" }), P({ id: "a2359", time: "23:59" }), P({ id: "a2000", body: "가".repeat(2000), place: "가".repeat(30) }), P({ id: "noplace", place: "" })];
  for (const d of goods) assert.equal(req(s, 0, "post", d).ok, true, d.id);
});

for (const quotePrefix of [false, true]) {
  test(`post·ack: 수식처럼 시작하는 글은 막아서 저장, 목록에는 원래 글(따옴표 ${quotePrefix ? "숨김" : "보임"})`, () => {
    const s = boot(["=김사감", "이사감"], { quotePrefix });
    const texts = ["=1+1", "+1", "-1", "@a", "\tx", "\rx", "'x", "보통 글"];
    texts.forEach((t, i) => assert.equal(req(s, 0, "post", P({ id: "guard" + i, body: t, place: t.slice(0, 2) })).ok, true, JSON.stringify(t)));
    assert.equal(req(s, 1, "ack", { id: "guard0", kind: "done", memo: "=HYPERLINK(1)" }).ok, true);
    const l = req(s, 1, "list");
    const byId = Object.fromEntries(l.items.map(x => [x.id, x]));
    texts.forEach((t, i) => {
      assert.equal(byId["guard" + i].body, quotePrefix && t === "'x" ? "x" : t, JSON.stringify(t));
      assert.equal(byId["guard" + i].name, "=김사감");
    });
    assert.equal(byId.guard0.acks[0].memo, "=HYPERLINK(1)");
    assert.deepEqual(req(s, 0, "list").me, { id: "S01", name: "=김사감" });
  });
}

test("post: 잠금을 못 잡으면 busy, 아무것도 안 씀", () => {
  const s = boot();
  s.lock.ok = false;
  const r = req(s, 0, "post", P());
  assert.equal(r.error, "busy");
  assert.equal(r.me, undefined);
  s.lock.ok = true;
  assert.equal(s.sheet("인계").rowsOf(10).length, 0);
});

test("post: 시트 줄이 모자라면 늘려서 씀", () => {
  const s = boot(["김사감"], { maxRows: 3 });
  for (let i = 0; i < 5; i++) assert.equal(req(s, 0, "post", P({ id: "grow" + i })).ok, true);
  const sh = s.sheet("인계");
  assert.equal(sh.rowsOf(10).length, 5);
  assert.ok(sh.maxRows >= 6);
});

// ── 확인·조치 완료 ──────────────────────────────────────────

test("ack: 확인·조치 완료, 같은 것 두 번은 한 줄, 목록에 붙음", () => {
  const s = boot(["김사감", "이사감", "박사감"]);
  req(s, 0, "post", P());
  assert.equal(req(s, 1, "ack", { id: "abc123def", kind: "ack" }).ok, true);
  assert.equal(req(s, 1, "ack", { id: "abc123def", kind: "ack", memo: "" }).ok, true);
  assert.equal(req(s, 2, "ack", { id: "abc123def", kind: "done", memo: "  처리함  " }).ok, true);
  assert.equal(req(s, 2, "ack", { id: "abc123def", kind: "done", memo: "또" }).ok, true);
  const rows = s.sheet("확인").rowsOf(6);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1].slice(0, 4).concat(rows[1][5]), ["abc123def", "S03", "박사감", "조치 완료", "처리함"]);
  const it = req(s, 0, "list").items[0];
  assert.deepEqual(it.acks, [
    { sid: "S02", name: "이사감", kind: "ack", at: stamp(NOW), memo: "" },
    { sid: "S03", name: "박사감", kind: "done", at: stamp(NOW), memo: "처리함" }
  ]);
});

test("ack: 입력 검사·없는 인계·취소된 인계", () => {
  const s = boot();
  req(s, 0, "post", P());
  for (const d of [{ id: "abc123def", kind: "constructor" }, { id: "abc123def", kind: "확인" }, { id: "abc123def" }, { id: "abc123def", kind: "ack", memo: "메모" },
    { id: "abc123def", kind: "done", memo: "가".repeat(201) }, { id: "abc123def", kind: "done", memo: 3 }, { id: "x", kind: "ack" }, null]) {
    assert.equal(req(s, 1, "ack", d).error, "bad", JSON.stringify(d));
  }
  assert.match(req(s, 1, "ack", { id: "nothere1", kind: "ack" }).message, /없는 인계/);
  assert.equal(req(s, 1, "ack", { id: "abc123def", kind: "done", memo: "가".repeat(200) }).ok, true);
  req(s, 0, "withdraw", { id: "abc123def" });
  assert.equal(req(s, 1, "ack", { id: "abc123def", kind: "ack" }).ok, true);
  assert.equal(s.sheet("확인").rowsOf(6).length, 1, "취소된 인계에는 쓰지 않음");
});

// ── 공유 취소 ───────────────────────────────────────────────

test("withdraw: 작성자만, 두 번 해도 같음, 목록에서 빠짐", () => {
  const s = boot();
  req(s, 0, "post", P());
  const f = req(s, 1, "withdraw", { id: "abc123def" });
  assert.equal(f.error, "forbidden");
  assert.match(f.message, /작성자만/);
  assert.match(req(s, 0, "withdraw", { id: "nothere1" }).message, /없는 인계/);
  assert.equal(req(s, 0, "withdraw", { id: "bad-id" }).error, "bad");
  assert.equal(req(s, 0, "withdraw", { id: "abc123def" }).ok, true);
  const row1 = s.sheet("인계").rowsOf(10)[0];
  assert.deepEqual(row1.slice(8), ["취소", stamp(NOW)]);
  s.clock.now = NOW + 60000;
  assert.equal(req(s, 0, "withdraw", { id: "abc123def" }).ok, true);
  assert.deepEqual(s.sheet("인계").rowsOf(10)[0].slice(8), ["취소", stamp(NOW)], "두 번째는 시각을 바꾸지 않음");
  assert.equal(req(s, 1, "list").items.length, 0);
  assert.equal(req(s, 0, "post", P()).ok, true, "같은 id 다시 보내기는 그대로(되살리지 않음)");
  assert.equal(req(s, 1, "list").items.length, 0);
});

// ── 목록 ────────────────────────────────────────────────────

test("list: 14일 안·최신순·첫 줄 우선·이상한 줄 건너뜀", () => {
  const s = boot();
  const sh = s.sheet("인계");
  const rows = [
    HO({ id: "old15day", at: stamp(NOW - 15 * DAY) }),
    HO({ id: "in13days", at: stamp(NOW - 13 * DAY) }),
    HO({ id: "newest01", at: stamp(NOW - 1000) }),
    HO({ id: "dupfirst", at: stamp(NOW - 2 * DAY), body: "처음" }),
    HO({ id: "dupfirst", at: stamp(NOW - DAY), body: "나중" }),
    HO({ id: "wdfirst1", st: "취소" }),
    HO({ id: "wdfirst1", body: "되살림 시도" }),
    HO({ id: "badat001", at: "2026-11-25 12:00" }),
    HO({ id: "bad-id01" }),
    HO({ id: "stweird1", st: "보류" }),
    HO({ id: "constructor", at: stamp(NOW - 3 * DAY) }),
    HO({ id: "toString", at: stamp(NOW - 4 * DAY) })
  ];
  rows.forEach((r, i) => sh.put(i + 2, r));
  const l = req(s, 0, "list");
  assert.deepEqual(l.items.map(x => x.id), ["newest01", "dupfirst", "constructor", "toString", "in13days"]);
  assert.equal(l.items[1].body, "처음");
});

test("list: 확인 줄 — 목록에 있는 인계만, 종류·ID 이상한 줄과 겹친 줄은 뺌", () => {
  const s = boot();
  s.sheet("인계").put(2, HO({ id: "constructor" }));
  const ak = s.sheet("확인");
  [["constructor", "S02", "이사감", "확인", stamp(NOW), ""],
    ["constructor", "S02", "이사감", "확인", stamp(NOW), ""],
    ["constructor", "S02", "이사감", "조치 완료", stamp(NOW), "끝"],
    ["constructor", "S02", "이사감", "constructor", stamp(NOW), ""],
    ["constructor", "X2", "이사감", "확인", stamp(NOW), ""],
    ["toString", "S02", "이사감", "확인", stamp(NOW), ""],
    ["__proto__", "S02", "이사감", "확인", stamp(NOW), ""]].forEach((r, i) => ak.put(i + 2, r));
  const it = req(s, 0, "list").items[0];
  assert.deepEqual(it.acks.map(a => a.kind), ["ack", "done"]);
});

test("list: 300개까지, 최신 것", () => {
  const s = boot();
  const sh = s.sheet("인계");
  for (let i = 0; i < 305; i++) sh.put(i + 2, HO({ id: "bulk" + String(i).padStart(4, "0"), at: stamp(NOW - i * 60000) }));
  const items = req(s, 0, "list").items;
  assert.equal(items.length, 300);
  assert.equal(items[0].id, "bulk0000");
  assert.equal(items[299].id, "bulk0299");
});

// ── 보관 정리 ───────────────────────────────────────────────

function fillCleanup(s, oldN, newN, interleave = false) {
  const sh = s.sheet("인계"), ak = s.sheet("확인");
  const ids = [];
  for (let i = 0; i < oldN + newN; i++) {
    const old = interleave ? i % 2 === 0 && i / 2 < oldN : i < oldN;
    const id = (old ? "old" : "new") + String(i).padStart(4, "0");
    ids.push(id);
    sh.put(i + 2, HO({ id, at: stamp(old ? NOW - 400 * DAY : NOW - DAY) }));
    ak.put(i + 2, [id, "S02", "이사감", "확인", stamp(old ? NOW - 400 * DAY : NOW - DAY), ""]);
  }
  return ids;
}

test("cleanupOld: 1년 지난 인계와 그 확인만 지움, 날짜 이상한 줄·남는 인계의 확인·부모 없는 확인은 둠", () => {
  const s = boot();
  fillCleanup(s, 3, 30, true);
  s.sheet("인계").put(35, HO({ id: "weirdat1", at: "모름" }));
  s.sheet("인계").put(36, HO({ id: "feb30at1", at: "2025-02-30T09:00:00+09:00" }));
  s.sheet("인계").put(37, HO({ id: "hour25at", at: "2025-01-10T25:00:00+09:00" }));
  s.sheet("확인").put(35, ["new0010", "S02", "이사감", "확인", stamp(NOW - 400 * DAY), ""]);
  s.sheet("확인").put(36, ["weirdat1", "S02", "이사감", "확인", stamp(NOW - 400 * DAY), ""]);
  s.sheet("확인").put(37, ["feb30at1", "S02", "이사감", "조치 완료", stamp(NOW - 400 * DAY), "메모"]);
  s.sheet("확인").put(38, ["nopar001", "S02", "이사감", "확인", stamp(NOW - 400 * DAY), ""]);
  s.sheet("확인").put(39, ["nopar002", "S02", "이사감", "확인", "모름", ""]);
  s.ctx.cleanupOld();
  const hs = s.sheet("인계").rowsOf(10).map(r => r[0]);
  assert.equal(hs.filter(x => x.startsWith("old")).length, 0);
  assert.equal(hs.length, 33);
  for (const id of ["weirdat1", "feb30at1", "hour25at"]) assert.ok(hs.includes(id), id + " — 받은 시각이 올바른 날짜가 아니면 둠");
  const as = s.sheet("확인").rowsOf(6);
  assert.equal(as.filter(r => r[0].startsWith("old")).length, 0);
  assert.equal(as.length, 35, "새 인계 30 + 남는 인계의 오래된 확인 3 + 부모 없는 확인 2");
  for (const id of ["new0010", "weirdat1", "feb30at1", "nopar001", "nopar002"]) assert.ok(as.some(r => r[0] === id && (id !== "new0010" || r[4] === stamp(NOW - 400 * DAY))), id);
  assert.match(s.logs.at(-1), /인계 3줄, 확인 3줄/);
  assert.equal(s.lock.held, s.lock.released);
});

test("cleanupOld: 한꺼번에 많이 지우면 멈추고, cleanupOldConfirm은 지움", () => {
  const s = boot();
  fillCleanup(s, 25, 5);
  assert.throws(() => s.ctx.cleanupOld(), /cleanupOldConfirm/);
  assert.equal(s.sheet("인계").rowsOf(10).length, 30, "멈추면 하나도 안 지움");
  assert.equal(s.sheet("확인").rowsOf(6).length, 30);
  assert.equal(s.lock.held, s.lock.released);
  s.ctx.cleanupOldConfirm();
  assert.equal(s.sheet("인계").rowsOf(10).length, 5);
  assert.equal(s.sheet("확인").rowsOf(6).length, 5);
});

test("cleanupOld: 줄 수와 상관없이 10%를 넘으면 멈춤, 딱 10%는 지움", () => {
  const few = boot();
  fillCleanup(few, 20, 1);
  assert.throws(() => few.ctx.cleanupOld(), /cleanupOldConfirm/);
  assert.equal(few.sheet("인계").rowsOf(10).length, 21);
  const over = boot();
  fillCleanup(over, 2, 17);
  assert.throws(() => over.ctx.cleanupOld(), /너무 많습니다\(2\/19줄\)/);
  const edge = boot();
  fillCleanup(edge, 1, 9);
  edge.ctx.cleanupOld();
  assert.equal(edge.sheet("인계").rowsOf(10).length, 9);
  assert.equal(edge.sheet("확인").rowsOf(6).length, 9);
});

test("cleanupOldConfirm: 시트가 꽉 차 있고 전부 지울 때도 줄 처리가 맞음", () => {
  const s = boot(["김사감"], { maxRows: 6 });
  const sh = s.sheet("인계");
  for (let i = 0; i < 5; i++) sh.put(i + 2, HO({ id: "full000" + i, at: stamp(NOW - 400 * DAY) }));
  assert.equal(sh.maxRows, sh.getLastRow());
  assert.throws(() => s.ctx.cleanupOld(), /cleanupOldConfirm/);
  s.ctx.cleanupOldConfirm();
  assert.equal(sh.rowsOf(10).length, 0);
  assert.deepEqual(sh.cells[0].slice(0, 1), ["id"]);
});

test("cleanupOld: 잠금을 못 잡으면 멈춤", () => {
  const s = boot();
  fillCleanup(s, 2, 2);
  s.lock.ok = false;
  assert.throws(() => s.ctx.cleanupOld(), /다른 작업 중/);
  assert.equal(s.sheet("인계").rowsOf(10).length, 4);
});

test("installCleanupTrigger: 여러 번 해도 정리 트리거는 하나, 다른 트리거는 그대로", () => {
  const s = makeServer();
  s.triggers.push({ fn: "other", getHandlerFunction: () => "other" });
  s.ctx.installCleanupTrigger();
  s.ctx.installCleanupTrigger();
  const mine = s.triggers.filter(t => t.fn === "cleanupOld");
  assert.equal(mine.length, 1);
  assert.equal(mine[0].days, 1);
  assert.equal(mine[0].hour, 3);
  assert.equal(s.triggers.filter(t => t.fn === "other").length, 1);
});
