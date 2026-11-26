// Apps Script 서버 시험용 가짜 시트·서비스(구글 없이 node에서 handover-server.gs를 돌림)
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";

export const NOW = Date.parse("2026-11-25T12:00:00+09:00");
export const DAY = 864e5;
const SRC = readFileSync(new URL("../apps-script/handover-server.gs", import.meta.url), "utf8");
const GUARD_RE = /^[=+\-@\t\r]/;

// 한국 시각 도장(서버 stamp_와 같은 모양)
export function stamp(ms) {
  return new Date(ms + 9 * 3600e3).toISOString().slice(0, 19) + "+09:00";
}

export class FakeSheet {
  constructor(name, opt = {}) {
    this.name = name;
    this.maxCols = opt.maxCols ?? 26;
    const rows = opt.maxRows ?? 1000;
    this.cells = Array.from({ length: rows }, () => []);
    this.fmt = Array.from({ length: rows }, () => []);
    this.frozen = 0;
    this.validations = [];
    this.quotePrefix = !!opt.quotePrefix;
    this.writes = 0;
  }
  get maxRows() { return this.cells.length; }
  getName() { return this.name; }
  getMaxRows() { return this.maxRows; }
  getLastRow() {
    for (let r = this.maxRows; r >= 1; r--) {
      if (this.cells[r - 1].some(v => v !== undefined && v !== "")) return r;
    }
    return 0;
  }
  getRange(row, col, nr = 1, nc = 1) {
    const ok = [row, col, nr, nc].every(Number.isInteger) && row >= 1 && col >= 1 && nr >= 1 && nc >= 1
      && row + nr - 1 <= this.maxRows && col + nc - 1 <= this.maxCols;
    if (!ok) throw new Error(`범위 밖: ${this.name} ${row},${col},${nr},${nc} (줄 ${this.maxRows})`);
    return new FakeRange(this, row, col, nr, nc);
  }
  insertRowsAfter(after, n) {
    if (!Number.isInteger(after) || after < 1 || after > this.maxRows || !Number.isInteger(n) || n < 1) throw new Error("insertRowsAfter 인자");
    this.cells.splice(after, 0, ...Array.from({ length: n }, () => []));
    this.fmt.splice(after, 0, ...Array.from({ length: n }, () => []));
    return this;
  }
  deleteRows(start, n) {
    if (!Number.isInteger(start) || start < 1 || !Number.isInteger(n) || n < 1 || start + n - 1 > this.maxRows) throw new Error("deleteRows 범위 밖");
    if (this.maxRows - n <= this.frozen) throw new Error("고정되지 않은 줄을 모두 지울 수는 없습니다");
    this.cells.splice(start - 1, n);
    this.fmt.splice(start - 1, n);
    return this;
  }
  setFrozenRows(n) { this.frozen = n; return this; }
  getFrozenRows() { return this.frozen; }
  // 시험용 — 운영자가 손으로 적은 것처럼 검사 없이 넣기
  put(row, values) {
    if (row < 1 || row > this.maxRows) throw new Error("put 범위 밖");
    values.forEach((v, i) => { this.cells[row - 1][i] = v == null ? "" : String(v); });
  }
  // 시험용 — 머리줄 아래 자료 줄을 ncol칸 문자열로
  rowsOf(ncol) {
    const out = [];
    for (let r = 2; r <= this.getLastRow(); r++) out.push(Array.from({ length: ncol }, (_, c) => this.cells[r - 1][c] ?? ""));
    return out;
  }
}

class FakeRange {
  constructor(sh, row, col, nr, nc) { Object.assign(this, { sh, row, col, nr, nc }); }
  each(fn) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) fn(this.row + i - 1, this.col + j - 1, i, j); }
  setNumberFormat(f) { this.each((r, c) => { this.sh.fmt[r][c] = f; }); return this; }
  getDisplayValues() {
    const out = Array.from({ length: this.nr }, () => new Array(this.nc).fill(""));
    this.each((r, c, i, j) => { out[i][j] = this.sh.cells[r][c] ?? ""; });
    return out;
  }
  setValues(vals) {
    if (!Array.isArray(vals) || vals.length !== this.nr || vals.some(x => !Array.isArray(x) || x.length !== this.nc)) throw new Error("setValues 크기가 맞지 않습니다");
    this.each((r, c, i, j) => {
      const v = vals[i][j];
      if (typeof v !== "string") throw new Error("문자열만 씁니다: " + typeof v);
      if (this.sh.fmt[r][c] !== "@") throw new Error(`텍스트 서식이 아닌 칸에 씀: ${this.sh.name} ${r + 1},${c + 1}`);
      if (GUARD_RE.test(v)) throw new Error("막지 않은 값: " + JSON.stringify(v));
    });
    this.each((r, c, i, j) => {
      const v = vals[i][j];
      this.sh.cells[r][c] = this.sh.quotePrefix && v.startsWith("'") ? v.slice(1) : v;
    });
    this.sh.writes++;
    return this;
  }
  setDataValidation(rule) { this.sh.validations.push({ row: this.row, col: this.col, nr: this.nr, nc: this.nc, rule }); return this; }
}

class FakeSpreadsheet {
  constructor(opt) { this.sheets = new Map(); this.tz = null; this.opt = opt; this.id = "test-sheet-id-not-real"; }
  getId() { return this.id; }
  getSheetByName(n) { return this.sheets.get(n) ?? null; }
  insertSheet(n) {
    if (this.sheets.has(n)) throw new Error("이미 있는 시트");
    const sh = new FakeSheet(n, this.opt);
    this.sheets.set(n, sh);
    return sh;
  }
  setSpreadsheetTimeZone(tz) { this.tz = tz; }
}

export function makeServer(opt = {}) {
  const clock = { now: opt.now ?? NOW };
  const ss = new FakeSpreadsheet({ quotePrefix: opt.quotePrefix, maxRows: opt.maxRows });
  const lock = { ok: true, held: 0, released: 0, waits: [] };
  const props = new Map();
  const triggers = [];
  const logs = [], errors = [];
  let flushes = 0;
  // 실행 흉내 — 편집기(editor)가 아니면 getActive를 위반으로 적고 오류를 던짐(doPost가 삼켜도 run이 시험을 실패시킴)
  let mode = "editor", opens = 0;
  const violations = [];
  const ids = { script: "test-script-id-not-real" };
  const active = name => () => {
    if (mode !== "editor") {
      violations.push(mode + ": " + name);
      throw new Error("웹 앱·트리거에서는 " + name + "를 쓸 수 없습니다(가짜)");
    }
    return ss;
  };
  const sandbox = {
    SpreadsheetApp: {
      getActive: active("getActive"),
      getActiveSpreadsheet: active("getActiveSpreadsheet"),
      openById(id) {
        opens++;
        if (id === ss.id) return ss;
        throw new Error("없는 시트입니다(가짜)");
      },
      flush: () => { flushes++; },
      newDataValidation: () => {
        const rule = {};
        const b = {
          requireValueInList(list, show) { rule.list = [...list]; rule.show = show; return b; },
          setAllowInvalid(x) { rule.allowInvalid = x; return b; },
          build: () => rule
        };
        return b;
      }
    },
    LockService: {
      getScriptLock: () => ({
        tryLock(ms) { lock.waits.push(ms); if (!lock.ok) return false; lock.held++; return true; },
        releaseLock() { lock.released++; }
      })
    },
    ContentService: {
      MimeType: { JSON: "JSON", TEXT: "TEXT" },
      createTextOutput(s) {
        const o = { content: String(s), mime: null };
        o.setMimeType = m => { o.mime = m; return o; };
        o.getContent = () => o.content;
        o.getMimeType = () => o.mime;
        return o;
      }
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: "SHA_256" },
      formatDate(d, tz, fmt) {
        if (tz !== "Asia/Seoul") throw new Error("시간대: " + tz);
        const iso = new Date(d.getTime() + 9 * 3600e3).toISOString();
        if (fmt === "yyyy-MM-dd'T'HH:mm:ss'+09:00'") return iso.slice(0, 19) + "+09:00";
        if (fmt === "yyyy-MM-dd") return iso.slice(0, 10);
        throw new Error("형식: " + fmt);
      },
      getUuid: opt.uuid ?? (() => randomUUID()),
      computeDigest(alg, s) {
        if (alg !== "SHA_256") throw new Error("알고리즘: " + alg);
        return [...createHash("sha256").update(String(s), "utf8").digest()].map(b => (b > 127 ? b - 256 : b));
      }
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (props.has(k) ? props.get(k) : null),
        setProperty(k, v) { props.set(k, String(v)); },
        // 실제처럼 두 번째 인자가 참일 때만 다른 속성을 모두 지움(기본은 합치기)
        setProperties(obj, deleteAll) {
          if (deleteAll) props.clear();
          Object.keys(obj).forEach(k => props.set(k, String(obj[k])));
        }
      })
    },
    ScriptApp: {
      getScriptId: () => ids.script,
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger(t) { const i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); },
      newTrigger(fn) {
        const t = { fn, getHandlerFunction: () => fn };
        const b = {
          timeBased: () => b,
          everyDays(n) { t.days = n; return b; },
          atHour(h) { t.hour = h; return b; },
          create() { triggers.push(t); return t; }
        };
        return b;
      }
    },
    Logger: { log: m => { logs.push(String(m)); } },
    console: { error: m => errors.push(String(m)), warn: m => errors.push(String(m)), log: m => logs.push(String(m)) }
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(SRC, ctx, { filename: "handover-server.gs" });
  ctx.nowMs_ = () => clock.now;
  // 모드는 finally로 반드시 풀고, 위반이 생겼으면 원래 결과와 상관없이 실패
  const run = (m, fn) => {
    const before = violations.length;
    mode = m;
    let out, err, threw = false;
    try { out = fn(); } catch (e) { threw = true; err = e; } finally { mode = "editor"; }
    if (violations.length > before) throw new Error("웹 앱·트리거 흉내에서 getActive를 불렀습니다: " + violations.slice(before).join(", "));
    if (threw) throw err;
    return out;
  };
  const s = {
    ctx, ss, clock, lock, props, triggers, logs, errors, ids, violations,
    get flushes() { return flushes; },
    get opens() { return opens; },
    sheet: n => ss.getSheetByName(n),
    // 웹 앱에 POST를 보낸 것처럼 doPost를 부르고 JSON 응답을 돌려줌
    call(body) {
      const contents = typeof body === "string" ? body : JSON.stringify(body);
      const out = run("web", () => ctx.doPost({ postData: { contents, type: "text/plain" } }));
      if (out.getMimeType() !== "JSON") throw new Error("응답 형식이 JSON이 아닙니다");
      return JSON.parse(out.getContent());
    },
    // 웹 앱 실행 흉내(doGet·날 것의 doPost)
    web: fn => run("web", fn),
    // 시간 트리거 실행 흉내
    trigger: name => run("trigger", () => ctx[name]())
  };
  return s;
}

// 시트 준비 + 사감 이름 넣고 코드 발급까지 — 사감 목록을 돌려줌
export function boot(names = ["김사감", "이사감"], opt = {}) {
  const s = makeServer(opt);
  s.ctx.setupSheets();
  names.forEach((n, i) => s.sheet("사감").put(i + 2, ["", n]));
  s.ctx.issueCodes();
  s.staff = s.sheet("사감").rowsOf(5).map(r => ({ id: r[0], name: r[1], code: r[2], st: r[3], made: r[4] }));
  return s;
}
