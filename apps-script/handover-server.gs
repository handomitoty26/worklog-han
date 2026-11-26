// 관리일지 인계 공유(인계함) 서버 — 사감실 전용 계정 시트에 붙여 쓰는 Apps Script 웹 앱
/** @OnlyCurrentDoc */

// 규칙(설계서 review-purpose.md): 인증은 허용 목록(모양 맞는 12자 코드 + 상태 정확히 "사용"),
// 이름·권한은 서버만 정함, 같은 요청을 두 번 받아도 결과가 같음, 모든 칸은 텍스트 서식(@) + 앞글자 막기.

var HO = {
  CODE_CHARS: "ABCDEFGHJKLMNPQRSTUVWXYZ23456789",
  BODY_MAX: 2000,
  PLACE_MAX: 30,
  MEMO_MAX: 200,
  NAME_MAX: 40,
  LIST_DAYS: 14,
  LIST_MAX: 300,
  KEEP_DAYS: 365,
  REQ_MAX: 20000,
  SHEETS: {
    "사감": ["사감 ID", "이름", "코드", "상태", "만든 시각"],
    "인계": ["id", "받은 시각", "날짜", "시각", "근무지", "작성자 ID", "작성자 이름", "내용", "상태", "취소 시각"],
    "확인": ["인계 id", "사감 ID", "이름", "종류", "시각", "메모"]
  }
};
var CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/;
var HID_RE = /^[A-Za-z0-9]{4,40}$/;
var SID_RE = /^S\d{2,4}$/;
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
var TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
var STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/;
var DAY_MS = 864e5;

// ── 웹 앱 입구 ──────────────────────────────────────────────

function doPost(e) {
  try {
    var raw = e && e.postData && typeof e.postData.contents === "string" ? e.postData.contents : null;
    var req = parseReq_(raw);
    if (!req) return out_(bad_("요청 형식이 맞지 않습니다"));
    var code = normCode_(req.code);
    if (!CODE_RE.test(code)) return out_({ ok: false, error: "auth" });
    var me = findStaff_(code);
    if (!me) return out_({ ok: false, error: "auth" });
    var op = req.op, r;
    if (op === "list") r = list_();
    else if (op === "post") r = post_(me, req.data);
    else if (op === "ack") r = ack_(me, req.data);
    else if (op === "withdraw") r = withdraw_(me, req.data);
    else r = bad_("알 수 없는 요청입니다");
    if (r.ok) r.me = me;
    return out_(r);
  } catch (err) {
    console.error("doPost 실패: " + (err && err.message ? err.message : String(err)));
    return out_({ ok: false, error: "server" });
  }
}

function doGet() {
  return ContentService.createTextOutput("관리일지 인계 공유 서버입니다. 관리일지 앱에서만 씁니다.");
}

// ── 요청 처리 ───────────────────────────────────────────────

function list_() {
  var from = nowMs_() - HO.LIST_DAYS * DAY_MS;
  var ho = rows_(sheet_("인계"), 10), seen = Object.create(null), items = [];
  for (var i = 0; i < ho.length; i++) {
    var r = ho[i], id = String(r[0]).trim();
    if (!HID_RE.test(id) || seen[id]) continue;
    seen[id] = true;
    if (String(r[8]).trim() !== "정상") continue;
    var at = stampMs_(r[1]);
    if (!(at >= from)) continue;
    items.push({
      id: id, at: String(r[1]).trim(), date: String(r[2]).trim(), time: String(r[3]).trim(),
      place: unguard_(r[4]), sid: String(r[5]).trim(), name: unguard_(r[6]), body: unguard_(r[7]), acks: []
    });
  }
  items.sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; });
  items = items.slice(0, HO.LIST_MAX);
  var byId = Object.create(null);
  items.forEach(function (it) { byId[it.id] = it; });
  var ak = rows_(sheet_("확인"), 6), dup = Object.create(null);
  for (var j = 0; j < ak.length; j++) {
    var a = ak[j], hid = String(a[0]).trim(), it2 = byId[hid];
    if (!it2) continue;
    var kind = kindOf_(String(a[3]).trim()), sid = String(a[1]).trim();
    if (!kind || !SID_RE.test(sid)) continue;
    var key = hid + "|" + sid + "|" + kind;
    if (dup[key]) continue;
    dup[key] = true;
    it2.acks.push({ sid: sid, name: unguard_(a[2]), kind: kind, at: String(a[4]).trim(), memo: unguard_(a[5]) });
  }
  return { ok: true, items: items };
}

function post_(me, d) {
  if (!isObj_(d)) return bad_("인계 형식이 맞지 않습니다");
  var id = d.id, date = d.date, time = d.time, place = d.place, body = d.body;
  if (typeof id !== "string" || !HID_RE.test(id)) return bad_("인계 번호 형식이 맞지 않습니다");
  if (!realDate_(date)) return bad_("날짜는 14일 전부터 내일까지만 됩니다");
  if (typeof time !== "string" || !TIME_RE.test(time)) return bad_("시각 형식이 맞지 않습니다");
  if (typeof place !== "string" || place.length > HO.PLACE_MAX) return bad_("근무지는 30자까지입니다");
  if (typeof body !== "string" || !body.trim() || body.length > HO.BODY_MAX) return bad_("내용은 1~2000자입니다");
  return locked_(function () {
    var sh = sheet_("인계"), f = findHo_(sh, id);
    if (f) return String(f.r[5]).trim() === me.id ? { ok: true } : bad_("인계 번호가 겹칩니다");
    // 날짜 범위는 새 글에만 — 이미 받은 글을 응답만 잃고 다음 날 다시 보내도 ok
    if (!dateOk_(date)) return bad_("날짜는 14일 전부터 내일까지만 됩니다");
    append_(sh, [[id, stamp_(nowMs_()), date, time, place.trim(), me.id, me.name, body, "정상", ""]]);
    return { ok: true };
  });
}

function ack_(me, d) {
  if (!isObj_(d)) return bad_("확인 형식이 맞지 않습니다");
  var hid = d.id, kind = d.kind, memo = d.memo === undefined ? "" : d.memo;
  if (typeof hid !== "string" || !HID_RE.test(hid)) return bad_("인계 번호 형식이 맞지 않습니다");
  var label = labelOf_(kind);
  if (!label) return bad_("확인 종류가 맞지 않습니다");
  if (typeof memo !== "string" || memo.length > HO.MEMO_MAX) return bad_("메모는 200자까지입니다");
  if (kind === "ack" && memo.trim()) return bad_("확인에는 메모를 쓰지 않습니다");
  return locked_(function () {
    var f = findHo_(sheet_("인계"), hid);
    if (!f) return bad_("없는 인계입니다");
    if (String(f.r[8]).trim() !== "정상") return { ok: true };
    var sh = sheet_("확인"), rs = rows_(sh, 6);
    for (var i = 0; i < rs.length; i++) {
      if (String(rs[i][0]).trim() === hid && String(rs[i][1]).trim() === me.id && String(rs[i][3]).trim() === label) return { ok: true };
    }
    append_(sh, [[hid, me.id, me.name, label, stamp_(nowMs_()), memo.trim()]]);
    return { ok: true };
  });
}

function withdraw_(me, d) {
  if (!isObj_(d)) return bad_("취소 형식이 맞지 않습니다");
  var hid = d.id;
  if (typeof hid !== "string" || !HID_RE.test(hid)) return bad_("인계 번호 형식이 맞지 않습니다");
  return locked_(function () {
    var sh = sheet_("인계"), f = findHo_(sh, hid);
    if (!f) return bad_("없는 인계입니다");
    if (String(f.r[5]).trim() !== me.id) return { ok: false, error: "forbidden", message: "작성자만 취소할 수 있습니다" };
    if (String(f.r[8]).trim() === "취소") return { ok: true };
    var rg = sh.getRange(f.row, 9, 1, 2);
    rg.setNumberFormat("@");
    rg.setValues([["취소", stamp_(nowMs_())]]);
    return { ok: true };
  });
}

// ── 운영자가 편집기에서 실행하는 함수 ───────────────────────

function setupSheets() {
  var ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone("Asia/Seoul");
  Object.keys(HO.SHEETS).forEach(function (name) {
    var head = HO.SHEETS[name], sh = ss.getSheetByName(name) || ss.insertSheet(name);
    ensureRows_(sh, 2);
    sh.getRange(1, 1, sh.getMaxRows(), head.length).setNumberFormat("@");
    var hr = sh.getRange(1, 1, 1, head.length), cur = hr.getDisplayValues()[0];
    if (cur.join("") === "") hr.setValues([head]);
    else if (cur.join("\u0001") !== head.join("\u0001")) throw new Error("'" + name + "' 시트 첫 줄이 정해진 머리줄과 다릅니다 — 새 시트에서 다시 하세요");
    sh.setFrozenRows(1);
  });
  statusRule_();
  Logger.log("시트 준비를 마쳤습니다");
}

function issueCodes() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error("다른 작업 중입니다 — 잠시 뒤 다시 실행하세요");
  try {
    var sh = sheet_("사감"), last = sh.getLastRow();
    if (last < 2) { Logger.log("사감 표가 비어 있습니다 — 2번째 줄부터 이름을 적으세요"); return; }
    var rg = sh.getRange(2, 1, last - 1, 5), vals = rg.getDisplayValues();
    var names = Object.create(null), ids = Object.create(null), codes = Object.create(null), rows = [];
    for (var i = 0; i < vals.length; i++) {
      var r = vals[i].map(function (v) { return unguard_(v).trim(); });
      rows.push(r);
      if (r.join("") === "") continue;
      var line = (i + 2) + "번째 줄: ";
      if (!r[1]) throw new Error(line + "이름이 비었습니다");
      if (r[1].length > HO.NAME_MAX) throw new Error(line + "이름은 40자까지입니다");
      if (names[r[1]]) throw new Error(line + "이름이 다른 줄과 겹칩니다 — 구분되게 적으세요");
      names[r[1]] = true;
      if (r[0]) {
        if (!SID_RE.test(r[0]) || ids[r[0]]) throw new Error(line + "사감 ID가 이상하거나 겹칩니다");
        ids[r[0]] = true;
      }
      if (r[2]) {
        var c = normCode_(r[2]);
        if (!CODE_RE.test(c) || codes[c]) throw new Error(line + "코드가 이상하거나 겹칩니다 — 그 줄 코드 칸을 비우고 다시 실행하세요");
        codes[c] = true;
      }
      if (r[3] && r[3] !== "사용" && r[3] !== "중지") throw new Error(line + "상태는 '사용' 또는 '중지'만 됩니다");
    }
    var next = maxStaffNo_(ids), now = stamp_(nowMs_()), made = 0;
    for (var k = 0; k < rows.length; k++) {
      var w = rows[k];
      if (w.join("") === "") continue;
      if (!w[0]) { next++; w[0] = "S" + (next < 10 ? "0" + next : String(next)); }
      if (!w[2]) {
        var nc = newCode_(codes);
        codes[nc] = true;
        w[2] = fmtCode_(nc);
        made++;
      }
      if (!w[3]) w[3] = "사용";
      if (!w[4]) w[4] = now;
    }
    rg.setNumberFormat("@");
    rg.setValues(rows.map(function (row) { return row.map(guard_); }));
    statusRule_();
    PropertiesService.getScriptProperties().setProperty("maxStaffNo", String(next));
    SpreadsheetApp.flush();
    Logger.log("새 코드 " + made + "개를 만들었습니다 — 코드는 시트에서 보고 각 사감에게 직접 전하세요");
  } finally {
    lock.releaseLock();
  }
}

function cleanupOld() { cleanup_(false); }

function cleanupOldConfirm() { cleanup_(true); }

function installCleanupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "cleanupOld") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("cleanupOld").timeBased().everyDays(1).atHour(3).create();
  Logger.log("매일 새벽 3시 정리를 설치했습니다");
}

// ── 보관 정리(1년) ──────────────────────────────────────────

function cleanup_(force) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error("다른 작업 중입니다 — 다음 정리 때 다시 합니다");
  try {
    var cut = nowMs_() - HO.KEEP_DAYS * DAY_MS;
    var hs = sheet_("인계"), hr = rows_(hs, 10), gone = Object.create(null), delH = [];
    for (var i = 0; i < hr.length; i++) {
      var at = stampMs_(hr[i][1]);
      if (!isNaN(at) && at < cut) { delH.push(i + 2); gone[String(hr[i][0]).trim()] = true; }
    }
    // 확인 기록은 지우기로 정한 인계의 것만(부모가 남거나 없는 확인은 둠)
    var as = sheet_("확인"), ar = rows_(as, 6), delA = [];
    for (var j = 0; j < ar.length; j++) {
      if (gone[String(ar[j][0]).trim()]) delA.push(j + 2);
    }
    capCheck_("인계", delH.length, hr.length, force);
    capCheck_("확인", delA.length, ar.length, force);
    deleteRuns_(hs, delH);
    deleteRuns_(as, delA);
    SpreadsheetApp.flush();
    Logger.log("정리: 인계 " + delH.length + "줄, 확인 " + delA.length + "줄을 지웠습니다");
  } finally {
    lock.releaseLock();
  }
}

function capCheck_(name, del, total, force) {
  if (!force && del > total * 0.1) {
    throw new Error("'" + name + "' 시트에서 지울 줄이 너무 많습니다(" + del + "/" + total + "줄) — 시트를 확인한 뒤 cleanupOldConfirm을 실행하세요");
  }
}

function deleteRuns_(sh, rows) {
  if (!rows.length) return;
  if (sh.getMaxRows() <= sh.getLastRow()) sh.insertRowsAfter(sh.getMaxRows(), 1);
  rows.sort(function (a, b) { return b - a; });
  var i = 0;
  while (i < rows.length) {
    var end = rows[i], start = end;
    while (i + 1 < rows.length && rows[i + 1] === start - 1) { i++; start = rows[i]; }
    sh.deleteRows(start, end - start + 1);
    i++;
  }
}

// ── 도우미 ──────────────────────────────────────────────────

function nowMs_() { return Date.now(); }

function stamp_(ms) { return Utilities.formatDate(new Date(ms), "Asia/Seoul", "yyyy-MM-dd'T'HH:mm:ss'+09:00'"); }

function day_(ms) { return Utilities.formatDate(new Date(ms), "Asia/Seoul", "yyyy-MM-dd"); }

function stampMs_(s) {
  s = String(s == null ? "" : s).trim();
  if (!STAMP_RE.test(s)) return NaN;
  // 2월 30일·25시처럼 없는 날짜는 Date.parse가 다음 날로 넘기므로, 되돌린 글자가 원문과 같을 때만
  var ms = Date.parse(s);
  return !isNaN(ms) && new Date(ms + 9 * 3600000).toISOString().slice(0, 19) + "+09:00" === s ? ms : NaN;
}

function guard_(v) {
  var s = v == null ? "" : String(v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function unguard_(v) {
  var s = v == null ? "" : String(v);
  return /^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s;
}

function normCode_(s) { return typeof s === "string" ? s.replace(/[\s-]/g, "").toUpperCase() : ""; }

function isObj_(o) { return o !== null && typeof o === "object" && !Array.isArray(o); }

function realDate_(s) {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  var ms = Date.parse(s + "T00:00:00Z");
  return !isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === s;
}

function dateOk_(s) {
  if (!realDate_(s)) return false;
  var today = Date.parse(day_(nowMs_()) + "T00:00:00Z"), diff = Math.round((Date.parse(s + "T00:00:00Z") - today) / DAY_MS);
  return diff >= -14 && diff <= 1;
}

function kindOf_(label) { return label === "확인" ? "ack" : label === "조치 완료" ? "done" : ""; }

function labelOf_(kind) { return kind === "ack" ? "확인" : kind === "done" ? "조치 완료" : ""; }

function parseReq_(raw) {
  if (typeof raw !== "string" || raw.length > HO.REQ_MAX) return null;
  try {
    var o = JSON.parse(raw);
    return isObj_(o) ? o : null;
  } catch (e) {
    return null;
  }
}

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function bad_(msg) { return { ok: false, error: "bad", message: msg }; }

function sheet_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error("시트가 없습니다: " + name);
  return sh;
}

function rows_(sh, ncol) {
  var last = sh.getLastRow();
  return last < 2 ? [] : sh.getRange(2, 1, last - 1, ncol).getDisplayValues();
}

function findStaff_(code) {
  var rs = rows_(sheet_("사감"), 5), hit = null, n = 0;
  for (var i = 0; i < rs.length; i++) {
    var c = normCode_(unguard_(rs[i][2]));
    if (!CODE_RE.test(c)) continue;
    if (c === code) { n++; hit = rs[i]; }
  }
  if (n !== 1) return null;
  var id = String(hit[0]).trim(), name = unguard_(hit[1]).trim(), st = String(hit[3]).trim();
  if (!SID_RE.test(id) || !name || name.length > HO.NAME_MAX || st !== "사용") return null;
  return { id: id, name: name };
}

function findHo_(sh, hid) {
  var rs = rows_(sh, 10);
  for (var i = 0; i < rs.length; i++) if (String(rs[i][0]).trim() === hid) return { row: i + 2, r: rs[i] };
  return null;
}

function ensureRows_(sh, last) {
  var max = sh.getMaxRows();
  if (last > max) sh.insertRowsAfter(max, Math.max(50, last - max));
}

function append_(sh, rows) {
  var start = sh.getLastRow() + 1;
  ensureRows_(sh, start + rows.length - 1);
  var rg = sh.getRange(start, 1, rows.length, rows[0].length);
  rg.setNumberFormat("@");
  rg.setValues(rows.map(function (r) { return r.map(guard_); }));
}

function locked_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: "busy", message: "서버가 바쁩니다 — 잠시 뒤 다시 보냅니다" };
  try {
    var r = fn();
    SpreadsheetApp.flush();
    return r;
  } finally {
    lock.releaseLock();
  }
}

function statusRule_() {
  var sh = sheet_("사감");
  ensureRows_(sh, 2);
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(["사용", "중지"], true).setAllowInvalid(false).build();
  sh.getRange(2, 4, sh.getMaxRows() - 1, 1).setDataValidation(rule);
}

function maxStaffNo_(ids) {
  var m = Number(PropertiesService.getScriptProperties().getProperty("maxStaffNo")) || 0;
  function see(s) {
    s = String(s).trim();
    if (SID_RE.test(s)) m = Math.max(m, Number(s.slice(1)));
  }
  Object.keys(ids).forEach(see);
  rows_(sheet_("인계"), 10).forEach(function (r) { see(r[5]); });
  rows_(sheet_("확인"), 6).forEach(function (r) { see(r[1]); });
  return m;
}

function newCode_(taken) {
  for (var t = 0; t < 20; t++) {
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + ":" + t + ":" + nowMs_());
    var s = "";
    for (var i = 0; i < 12; i++) s += HO.CODE_CHARS.charAt(bytes[i] & 31);
    if (!taken[s]) return s;
  }
  throw new Error("코드를 만들지 못했습니다 — 다시 실행하세요");
}

function fmtCode_(s) { return s.slice(0, 4) + "-" + s.slice(4, 8) + "-" + s.slice(8, 12); }
