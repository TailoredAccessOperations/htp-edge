/* htp.sh python3 shell. Runs in the page. No sockets, no HTTP. */
(function (root) {
  "use strict";

  const UNBOUND = { kind: "unbound" };
  class Incomplete extends Error {}
  class SyntaxErr extends Error {
    constructor(msg, line) {
      super(msg);
      this.line = line || 1;
    }
  }
  class BreakExc extends Error {}
  class ContinueExc extends Error {}
  class ReturnExc extends Error {
    constructor(v) {
      super();
      this.value = v;
    }
  }
  class PyRunError extends Error {
    constructor(cls, msg, inst) {
      super(msg || "");
      this.cls = cls;
      this.inst = inst || null;
      this.stack = [];
    }
  }

  /* `match` and `case` are SOFT keywords in Python: `re.match(p, s)` and
   * `obj.case` are both legal. They must stay out of KEYWORDS or every
   * attribute access named `match`/`case` dies with "expected name" — the
   * statement parser recognises them by context instead. */
  const KEYWORDS = new Set(
    "False True None and or not if elif else for while def return break continue pass import from as try except finally raise class lambda in is global nonlocal assert with yield del".split(" "),
  );
  const SOFT_KEYWORDS = new Set(["match", "case"]);

  /* Identifier classification. Python 3 accepts any XID_Start / XID_Continue code
   * point, so `π = 3` is a legal name rather than a SyntaxError. */
  const IDENT_START = /[\p{L}\p{Nl}_]/u;
  const IDENT_PART = /[\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}_]/u;
  function isIdentStart(ch) { return ch !== undefined && IDENT_START.test(ch); }
  function isIdentPart(ch) { return ch !== undefined && IDENT_PART.test(ch); }

  function createPython() {
    const rt = {
      output: "",
      steps: 0,
      depth: 0,
      stack: [],
      line: 1,
      fs: new Map(),
      dirs: new Set(["/"]),
      modules: new Map(),
      ids: new Map(),
      // The exception currently being handled, for a bare `raise`.
      active: [],
      // Set by the IDE layer so `input()` can round-trip through the page prompt
      // instead of silently returning "".
      inputHook: null,
      slept: 0,
      stop: false,
    };
    const STEP_MAX = 250000;
    const OUT_MAX = 180000;

    function step() {
      if (rt.stop) throw runError(rt.exc.RuntimeError, "interrupted");
      if (++rt.steps > STEP_MAX) throw runError(rt.exc.RuntimeError, "execution step limit");
    }
    function write(s) {
      rt.output += s;
      if (rt.output.length > OUT_MAX) {
        rt.output = rt.output.slice(0, OUT_MAX) + "\n[output truncated]\n";
        throw runError(rt.exc.RuntimeError, "output limit");
      }
    }
    function runError(cls, msg) {
      const inst = blankInst(cls, msg);
      const e = new PyRunError(cls, msg, inst);
      e.stack = rt.stack.map((f) => ({ name: f.name, line: f.line }));
      return e;
    }
    function fail(cls, msg) {
      throw runError(cls, msg);
    }
    function blankInst(cls, msg) {
      return { kind: "inst", cls, dict: new Map([["msg", msg == null ? "" : String(msg)], ["args", [msg]]]) };
    }

    class Env {
      constructor(parent) {
        this.parent = parent || null;
        this.map = new Map();
        this.locals = null;
        this.globals = null;
        this.module = null;
      }
      get(name) {
        if (this.globals && this.globals.has(name)) return this.module.get(name);
        if (this.map.has(name)) {
          const v = this.map.get(name);
          if (v === UNBOUND) fail(rt.exc.UnboundLocalError, "local variable '" + name + "' referenced before assignment");
          return v;
        }
        if (this.parent) return this.parent.get(name);
        fail(rt.exc.NameError, "name '" + name + "' is not defined");
      }
      set(name, value) {
        if (this.globals && this.globals.has(name)) {
          this.module.set(name, value);
          return;
        }
        if (this.locals) {
          if (this.locals.has(name) || !this.parent) {
            this.map.set(name, value);
            return;
          }
          this.parent.set(name, value);
          return;
        }
        this.map.set(name, value);
      }
    }

    function isNum(v) { return typeof v === "number" && Number.isFinite(v); }
    function asNum(v) {
      if (typeof v === "boolean") return v ? 1 : 0;
      if (isNum(v)) return v;
      fail(rt.exc.TypeError, "unsupported operand for number: " + typeName(v));
    }
    function truth(v) {
      if (v == null || v === false) return false;
      if (v === true) return true;
      if (typeof v === "number") return v !== 0;
      if (typeof v === "string") return v.length !== 0;
      if (Array.isArray(v)) return v.length !== 0;
      if (v.kind === "tuple" || v.kind === "set" || v.kind === "frozenset") return v.items.length !== 0;
      if (v.kind === "dict") return v.items.length !== 0;
      if (v.kind === "bytes") return v.data.length !== 0;
      return true;
    }
    function typeName(v) {
      if (v == null) return "NoneType";
      if (typeof v === "boolean") return "bool";
      if (typeof v === "number") return Number.isInteger(v) ? "int" : "float";
      if (typeof v === "string") return "str";
      if (Array.isArray(v)) return "list";
      if (v.kind === "type" || v.kind === "class") return v.name;
      return v.kind || "object";
    }
    function pyStr(v) {
      if (v == null) return "None";
      if (typeof v === "boolean") return v ? "True" : "False";
      if (typeof v === "number") return String(v);
      if (typeof v === "string") return v;
      if (Array.isArray(v)) return "[" + v.map(pyRepr).join(", ") + "]";
      if (v.kind === "tuple") {
        const inner = v.items.map(pyRepr).join(", ");
        return "(" + inner + (v.items.length === 1 ? "," : "") + ")";
      }
      if (v.kind === "dict") return "{" + v.items.map(([k, val]) => pyRepr(k) + ": " + pyRepr(val)).join(", ") + "}";
      if (v.kind === "set") return v.items.length ? "{" + v.items.map(pyRepr).join(", ") + "}" : "set()";
      if (v.kind === "frozenset") return v.items.length ? "frozenset({" + v.items.map(pyRepr).join(", ") + "})" : "frozenset()";
      if (v.kind === "bytes") return "b'" + bytesEscape(v.data) + "'";
      if (v.kind === "func" || v.kind === "builtin") return "<function " + (v.name || "fn") + ">";
      if (v.kind === "class" || v.kind === "type") return "<class '" + v.name + "'>";
      if (v.kind === "module") return "<module '" + v.name + "'>";
      if (v.kind === "inst") {
        // Honour __str__ (then __repr__) — `print(obj)` must call them. Falling
        // through to a bare `ClsName()` is what made every custom class print
        // identically, and what made exception tracebacks unreadable.
        const s = findClass(v.cls, "__str__");
        if (s) return pyStr(call(getAttr(v, "__str__"), [], new Map()));
        const r = findClass(v.cls, "__repr__");
        if (r) return pyStr(call(getAttr(v, "__repr__"), [], new Map()));
        return defaultInstStr(v);
      }
      if (v.kind === "bound") return pyStr(v.func);
      if (v.kind === "ns") return "Namespace(" + [...v.dict.entries()].map(([k, val]) => k + "=" + pyRepr(val)).join(", ") + ")";
      if (v.kind === "range") return "range(" + v.start + ", " + v.stop + (v.step !== 1 ? ", " + v.step : "") + ")";
      if (v.kind === "match") return "<re.Match>";
      if (v.kind === "re") return "re.compile(" + pyRepr(v.src) + ")";
      return "<" + (v.kind || "object") + ">";
    }
    function defaultInstStr(v) {
      return (v.cls ? v.cls.name : "object") + "(" + pyStr(v.dict.get("msg") || "") + ")";
    }
    function pyRepr(v) {
      if (typeof v === "string") return "'" + v.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t") + "'";
      // repr() must use __repr__ specifically — never __str__.
      if (v && v.kind === "inst") {
        const r = findClass(v.cls, "__repr__");
        if (!r) return defaultInstStr(v);
        const s = call(getAttr(v, "__repr__"), [], new Map());
        return typeof s === "string" ? "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n") + "'" : pyStr(s);
      }
      return pyStr(v);
    }
    function bytesEscape(data) {
      let s = "";
      for (const b of data) {
        if (b === 92) s += "\\\\";
        else if (b === 39) s += "\\'";
        else if (b === 10) s += "\\n";
        else if (b === 13) s += "\\r";
        else if (b === 9) s += "\\t";
        else if (b >= 32 && b < 127) s += String.fromCharCode(b);
        else s += "\\x" + b.toString(16).padStart(2, "0");
      }
      return s;
    }
    function pyEq(a, b) {
      if (a === b) return true;
      if (typeof a === "boolean") a = a ? 1 : 0;
      if (typeof b === "boolean") b = b ? 1 : 0;
      if (typeof a === "number" && typeof b === "number") return a === b;
      if (typeof a === "string" && typeof b === "string") return a === b;
      if (a == null || b == null) return a == null && b == null;
      if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (!pyEq(a[i], b[i])) return false;
        return true;
      }
      if (a && b && a.kind === "tuple" && b.kind === "tuple") return pyEq(a.items, b.items);
      if (a && b && a.kind === "bytes" && b.kind === "bytes") {
        if (a.data.length !== b.data.length) return false;
        for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
        return true;
      }
      if (a && b && a.kind === "dict" && b.kind === "dict") {
        if (a.items.length !== b.items.length) return false;
        for (const [k, v] of a.items) {
          const f = dictGet(b, k);
          if (!f.ok || !pyEq(f.v, v)) return false;
        }
        return true;
      }
      // A user-defined __eq__ wins over identity — otherwise every @dataclass
      // and every hand-rolled value type compares equal only to itself.
      // Exception instances are excluded: CPython compares them by identity.
      if (a && b && a.kind === "inst" && b.kind === "inst" && !isExceptionClass(a.cls)) {
        const own = findClass(a.cls, "__eq__");
        if (own) return truth(call({ kind: "bound", self: a, func: own }, [b], new Map()));
        if (a.cls === b.cls) return false;
        const other = findClass(b.cls, "__eq__");
        if (other) return truth(call({ kind: "bound", self: b, func: other }, [a], new Map()));
      }
      return false;
    }
    function isExceptionClass(cls) {
      let c = cls;
      while (c) {
        if (c === BaseException) return true;
        c = (c.bases && c.bases[0]) || null;
      }
      return false;
    }
    function dictGet(d, k) {
      for (const [kk, vv] of d.items) if (pyEq(kk, k)) return { ok: true, v: vv };
      return { ok: false };
    }
    function dictSet(d, k, v) {
      for (let i = 0; i < d.items.length; i++) if (pyEq(d.items[i][0], k)) { d.items[i][1] = v; return; }
      d.items.push([k, v]);
    }
    function emptyDict() { return { kind: "dict", items: [] }; }
    function tuple(items) { return { kind: "tuple", items }; }
    function makeBytes(arr) { return { kind: "bytes", data: arr instanceof Uint8Array ? arr : Uint8Array.from(arr) }; }
    function toUtf8(s) { return new TextEncoder().encode(String(s)); }
    function fromUtf8(data, fatal) {
      return new TextDecoder("utf-8", { fatal: !!fatal }).decode(data);
    }

    function lex(src) {
      const s = String(src).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const tokens = [];
      const indents = [0];
      let i = 0;
      let line = 1;
      let col = 0;
      let paren = 0;
      let bol = true;
      function push(type, value) { tokens.push({ type, value, line, col }); }
      function syntax(msg) { throw new SyntaxErr(msg, line); }
      while (i < s.length) {
        if (bol && paren === 0) {
          let ind = 0;
          while (s[i] === " " || s[i] === "\t") {
            if (s[i] === "\t") syntax("indent with spaces, not tabs");
            ind++;
            i++;
          }
          if (s[i] === "#" || s[i] === "\n" || i >= s.length) {
            if (s[i] === "#") while (i < s.length && s[i] !== "\n") i++;
            if (s[i] === "\n") { i++; line++; col = 0; continue; }
            break;
          }
          col = ind;
          const top = indents[indents.length - 1];
          if (ind > top) { indents.push(ind); push("INDENT", ind); }
          else if (ind < top) {
            while (indents[indents.length - 1] > ind) { indents.pop(); push("DEDENT", ind); }
            if (indents[indents.length - 1] !== ind) syntax("inconsistent indent");
          }
          bol = false;
        } else if (bol) {
          bol = false;
        }
        const c = s[i];
        if (c === " " || c === "\t") { i++; col++; continue; }
        if (c === "#") { while (i < s.length && s[i] !== "\n") i++; continue; }
        if (c === "\n") {
          if (paren === 0) push("NEWLINE", "\n");
          i++; line++; col = 0; bol = true; continue;
        }
        if (c === "\\") {
          if (s[i + 1] === "\n") { i += 2; line++; col = 0; continue; }
          syntax("unexpected backslash");
        }
        if (c === "." && s[i + 1] >= "0" && s[i + 1] <= "9") {
          let j = i + 1;
          while (s[j] >= "0" && s[j] <= "9") j++;
          push("NUM", parseFloat(s.slice(i, j)));
          col += j - i; i = j; continue;
        }
        if ((c >= "0" && c <= "9")) {
          let j = i;
          if (c === "0" && (s[i + 1] === "x" || s[i + 1] === "X")) {
            j = i + 2;
            while (/[0-9a-fA-F]/.test(s[j] || "")) j++;
            push("NUM", parseInt(s.slice(i + 2, j), 16));
          } else {
            while (s[j] >= "0" && s[j] <= "9") j++;
            if (s[j] === "." && s[j + 1] >= "0" && s[j + 1] <= "9") {
              j++;
              while (s[j] >= "0" && s[j] <= "9") j++;
              if (s[j] === "e" || s[j] === "E") {
                j++;
                if (s[j] === "+" || s[j] === "-") j++;
                while (s[j] >= "0" && s[j] <= "9") j++;
              }
              push("NUM", parseFloat(s.slice(i, j)));
            } else push("NUM", parseInt(s.slice(i, j), 10));
          }
          col += j - i; i = j; continue;
        }
        const two = s[i] + (s[i + 1] || "");
        const three = two + (s[i + 2] || "");
        if (c === "f" || c === "F" || c === "r" || c === "R" || c === "b" || c === "B" || c === "u" || c === "U") {
          let k = i;
          let flags = "";
          while ("fFrRbBuU".includes(s[k] || "")) { flags += s[k].toLowerCase(); k++; }
          if (s[k] === "'" || s[k] === '"') {
            const lit = readString(k, flags.includes("r"));
            const raw = lit.value;
            i = lit.end; col = lit.col; line = lit.line;
            if (flags.includes("b")) push("BYTES", raw);
            else if (flags.includes("f")) push("FSTR", raw);
            else push("STR", raw);
            continue;
          }
        }
        if (c === "'" || c === '"') {
          const lit = readString(i, false);
          i = lit.end; col = lit.col; line = lit.line;
          push("STR", lit.value);
          continue;
        }
        // Identifiers follow Python 3: XID_Start / XID_Continue, so `π = 3` and
        // `naïve_x1` are legal names rather than a SyntaxError.
        if (isIdentStart(c)) {
          let j = i + 1;
          while (isIdentPart(s[j] || "")) j++;
          const word = s.slice(i, j);
          push(KEYWORDS.has(word) ? "KW" : "NAME", word);
          col += j - i; i = j; continue;
        }
        // `**=` must be tested before `*=`, and `:=` before `:`. Order is longest-first.
        const ops = [":=", "**=", "//=", ">>=", "<<=", "==", "!=", "<=", ">=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "**", "//", "<<", ">>", "->"];
        let matched = null;
        for (const op of ops) if (s.startsWith(op, i)) { matched = op; break; }
        if (matched) { push("OP", matched); i += matched.length; col += matched.length; continue; }
        if ("+-*/%@&|^~=<>.,:;()[]{}".includes(c)) {
          if ("([{".includes(c)) paren++;
          if (")]}".includes(c)) paren--;
          push("OP", c);
          i++; col++; continue;
        }
        syntax("unexpected " + JSON.stringify(c));
      }
      while (indents.length > 1) { indents.pop(); push("DEDENT", 0); }
      push("EOF", "");
      if (paren > 0) throw new Incomplete("unclosed bracket");
      return tokens;

      function readString(start, raw) {
        const q = s[start];
        const triple = s[start + 1] === q && s[start + 2] === q;
        let j = start + (triple ? 3 : 1);
        let ln = line;
        let cl = col + (triple ? 3 : 1);
        let out = "";
        while (j < s.length) {
          if (!triple && s[j] === "\n") syntax("unterminated string");
          if (s[j] === q && (!triple || (s[j + 1] === q && s[j + 2] === q))) {
            j += triple ? 3 : 1;
            cl += triple ? 3 : 1;
            return { value: out, end: j, line: ln, col: cl };
          }
          if (s[j] === "\\" && s[j + 1] === q) {
            out += raw ? "\\" + q : q;
            j += 2; cl += 2; continue;
          }
          if (s[j] === "\\" && !raw) {
            const n = s[j + 1];
            const map = { n: "\n", r: "\r", t: "\t", "\\": "\\", "'": "'", '"': '"', a: "\u0007", b: "\b", f: "\f", v: "\v", "0": "\0" };
            if (map[n] !== undefined) { out += map[n]; j += 2; cl += 2; continue; }
            if (n === "x") {
              const h = s.slice(j + 2, j + 4);
              out += String.fromCharCode(parseInt(h, 16));
              j += 4; cl += 4; continue;
            }
            if (n === "u") {
              const h = s.slice(j + 2, j + 6);
              out += String.fromCharCode(parseInt(h, 16));
              j += 6; cl += 6; continue;
            }
            if (n === "\n") { j += 2; ln++; cl = 0; continue; }
            out += n || ""; j += 2; cl += 2; continue;
          }
          if (s[j] === "\n") { out += "\n"; j++; ln++; cl = 0; continue; }
          out += s[j]; j++; cl++;
        }
        throw new Incomplete("unterminated string");
      }
    }

    function Parser(tokens) {
      this.t = tokens;
      this.i = 0;
      this.forbidIn = 0;
    }
    Parser.prototype.peek = function () { return this.t[Math.min(this.i, this.t.length - 1)]; };
    Parser.prototype.next = function () { return this.t[Math.min(this.i++, this.t.length - 1)]; };
    Parser.prototype.isOp = function (v) { const p = this.peek(); return p.type === "OP" && p.value === v; };
    Parser.prototype.isKw = function (v) { const p = this.peek(); return p.type === "KW" && p.value === v; };
    Parser.prototype.eatOp = function (v) { if (this.isOp(v)) { this.next(); return true; } return false; };
    Parser.prototype.eatKw = function (v) { if (this.isKw(v)) { this.next(); return true; } return false; };
    Parser.prototype.expectOp = function (v) {
      if (!this.eatOp(v)) throw new SyntaxErr("expected " + v, this.peek().line);
    };
    Parser.prototype.expectKw = function (v) {
      if (!this.eatKw(v)) throw new SyntaxErr("expected " + v, this.peek().line);
    };
    Parser.prototype.skipNl = function () { while (this.peek().type === "NEWLINE") this.next(); };
    Parser.prototype.parseFile = function () {
      const body = this.parseBody(true);
      if (this.peek().type !== "EOF") throw new SyntaxErr("unexpected " + this.peek().type, this.peek().line);
      return { type: "module", body, line: 1 };
    };
    Parser.prototype.parseBody = function (top) {
      const body = [];
      this.skipNl();
      while (this.peek().type !== "EOF" && this.peek().type !== "DEDENT") {
        body.push(this.parseStmt());
        this.skipNl();
      }
      if (!top && this.peek().type === "EOF") throw new Incomplete("expected dedent");
      return body;
    };
    Parser.prototype.parseSuite = function () {
      if (this.peek().type === "NEWLINE") {
        this.next();
        this.skipNl();
        if (this.peek().type === "EOF") throw new Incomplete("expected block");
        if (this.peek().type !== "INDENT") throw new SyntaxErr("expected an indented block", this.peek().line);
        this.next();
        const body = [];
        while (this.peek().type !== "DEDENT" && this.peek().type !== "EOF") {
          this.skipNl();
          if (this.peek().type === "DEDENT" || this.peek().type === "EOF") break;
          body.push(this.parseStmt());
        }
        if (this.peek().type === "EOF") throw new Incomplete("expected dedent");
        this.next();
        if (!body.length) throw new Incomplete("expected block");
        return body;
      }
      if (this.peek().type === "EOF") throw new Incomplete("expected block");
      // A one-line suite (`while x: y`, `def f(): a=1; b=2`) still honours the
      // `;` separator — parseSimple() alone would leave the second statement
      // dangling and the next parse would blow up with "invalid syntax".
      const body = [this.parseSimple()];
      while (this.isOp(";")) {
        this.next();
        if (this.peek().type === "NEWLINE" || this.peek().type === "EOF") break;
        body.push(this.parseSimple());
      }
      if (this.peek().type === "NEWLINE") this.next();
      return body;
    };
    Parser.prototype.parseStmt = function () {
      const p0 = this.peek();
      const kw = p0.type === "KW" ? p0.value : "";
      if (this.isOp("@")) return this.finishLine(this.parseDecorated());
      if (kw === "if") return this.finishLine(this.parseIf());
      if (kw === "while") return this.finishLine(this.parseWhile());
      if (kw === "for") return this.finishLine(this.parseFor());
      if (kw === "def") return this.finishLine(this.parseDef());
      if (kw === "class") return this.finishLine(this.parseClass());
      if (kw === "try") return this.finishLine(this.parseTry());
      if (kw === "with") return this.finishLine(this.parseWith());
      // `match` is a soft keyword: a match statement unless it is being used as
      // an ordinary name (`match = x`, `re.match(...)`, `m.case`).
      if (p0.type === "NAME" && p0.value === "match") {
        const nxt = this.t[this.i + 1];
        const asName = nxt && ((nxt.type === "OP" && (nxt.value === "=" || nxt.value === "." || nxt.value === ",")) ||
          (nxt.type === "KW" && (nxt.value === "in" || nxt.value === "is")));
        if (!asName) return this.finishLine(this.parseMatch());
      }
      return this.finishLine(this.parseSimple());
    };
    /** Consume the trailing NEWLINE and any `;`-separated siblings on the same
     *  physical line, folding them into a `seq` node. `a=1; b=2` is valid
     *  Python and used to be a SyntaxError here. */
    Parser.prototype.finishLine = function (first) {
      if (this.peek().type === "NEWLINE") this.next();
      if (!this.isOp(";")) return first;
      const body = [first];
      while (this.eatOp(";")) {
        if (this.peek().type === "NEWLINE" || this.peek().type === "EOF") break;
        body.push(this.parseSimple());
        if (this.peek().type === "NEWLINE") { this.next(); break; }
      }
      return { type: "seq", body, line: first.line || 1 };
    };
    Parser.prototype.parseSimple = function () {
      const kw = this.peek().type === "KW" ? this.peek().value : "";
      const line = this.peek().line;
      /* Annotation statement: `x: T` or `x: T = v`. This belongs HERE and not in
       * parseAtom: `{"a": 1}` and `f(x: 1)` are the same `NAME :` token shape,
       * and only statement position makes it an annotation. */
      const p0 = this.peek();
      const p1 = this.t[this.i + 1];
      if (p0.type === "NAME" && p1 && p1.type === "OP" && p1.value === ":") {
        this.next();
        this.next();
        const target = { type: "name", id: p0.value, line: p0.line };
        const annotation = this.parseTest();
        if (this.eatOp("=")) return { type: "annassign", target, annotation, value: this.parseTest(), line: p0.line };
        return { type: "annassign", target, annotation, value: null, line: p0.line };
      }
      if (kw === "return") {
        this.next();
        if (this.peek().type === "NEWLINE" || this.peek().type === "EOF" || this.peek().type === "DEDENT") return { type: "return", value: null, line };
        return { type: "return", value: this.parseTestList(), line };
      }
      if (kw === "break") { this.next(); return { type: "break", line }; }
      if (kw === "continue") { this.next(); return { type: "continue", line }; }
      if (kw === "pass") { this.next(); return { type: "pass", line }; }
      if (kw === "raise") {
        this.next();
        if (this.peek().type === "NEWLINE" || this.peek().type === "EOF") return { type: "raise", exc: null, cause: null, line };
        const exc = this.parseTest();
        // `raise X from Y` — the cause is only used for __cause__ chaining, but
        // it must be consumed or it derails the rest of the statement.
        let cause = null;
        if (this.eatKw("from")) cause = this.parseTest();
        return { type: "raise", exc, cause, line };
      }
      if (kw === "assert") {
        this.next();
        const test = this.parseTest();
        let msg = null;
        if (this.eatOp(",")) msg = this.parseTest();
        return { type: "assert", test, msg, line };
      }
      if (kw === "import") return this.parseImport();
      if (kw === "from") return this.parseFrom();
      if (kw === "global" || kw === "nonlocal") {
        this.next();
        const names = [this.expectName()];
        while (this.eatOp(",")) names.push(this.expectName());
        return { type: kw === "global" ? "global" : "nonlocal", names, line };
      }
      if (kw === "del") {
        this.next();
        return { type: "del", target: this.parseTargetList(), line };
      }
      const e = this.parseTestList();
      if (this.isAug()) {
        const op = this.next().value;
        return { type: "aug", op, target: e, value: this.parseTestList(), line };
      }
      if (this.isOp("=")) {
        const targets = [e];
        let value;
        while (this.eatOp("=")) {
          const n = this.parseTestList();
          if (this.isOp("=")) targets.push(n);
          else value = n;
        }
        return { type: "assign", targets, value, line };
      }
      return { type: "expr", value: e, line };
    };
    Parser.prototype.isAug = function () {
      return this.peek().type === "OP" && /^(?:\+=|-=|\*=|\/=|\/\/=|%=|\*\*=|&=|\|=|\^=|<<=|>>=)$/.test(this.peek().value);
    };
    Parser.prototype.expectName = function () {
      const p = this.peek();
      if (p.type !== "NAME") throw new SyntaxErr("expected name", p.line);
      this.next();
      return p.value;
    };
    Parser.prototype.parseDotted = function () {
      let name = this.expectName();
      while (this.eatOp(".")) name += "." + this.expectName();
      return name;
    };
    Parser.prototype.parseImport = function () {
      const line = this.peek().line;
      this.expectKw("import");
      const names = [];
      do {
        const name = this.parseDotted();
        let as = null;
        if (this.eatKw("as")) as = this.expectName();
        names.push({ name, as });
      } while (this.eatOp(","));
      return { type: "import", names, line };
    };
    Parser.prototype.parseFrom = function () {
      const line = this.peek().line;
      this.expectKw("from");
      // Leading dots: `from . import x` / `from .mod import y`.
      let level = 0;
      while (this.isOp(".")) { this.next(); level++; }
      const module = this.peek().type === "NAME" ? this.parseDotted() : "";
      this.expectKw("import");
      const names = [];
      let star = false;
      const one = () => {
        if (this.eatOp("*")) { star = true; return; }
        const name = this.expectName();
        let as = null;
        if (this.eatKw("as")) as = this.expectName();
        names.push({ name, as });
      };
      if (this.eatOp("(")) {
        do {
          if (this.isOp(")")) break;
          one();
        } while (this.eatOp(","));
        this.expectOp(")");
      } else {
        do { one(); } while (star ? false : this.eatOp(","));
      }
      return { type: "from", module, level, names, star, line };
    };
    Parser.prototype.parseIf = function () {
      const line = this.peek().line;
      this.expectKw("if");
      const test = this.parseTest();
      this.expectOp(":");
      const body = this.parseSuite();
      const elifs = [];
      while (this.eatKw("elif")) {
        const t = this.parseTest();
        this.expectOp(":");
        elifs.push({ test: t, body: this.parseSuite() });
      }
      let orelse = [];
      if (this.eatKw("else")) { this.expectOp(":"); orelse = this.parseSuite(); }
      return { type: "if", test, body, elifs, orelse, line };
    };
    Parser.prototype.parseWhile = function () {
      const line = this.peek().line;
      this.expectKw("while");
      const test = this.parseTest();
      this.expectOp(":");
      const body = this.parseSuite();
      let orelse = [];
      if (this.eatKw("else")) { this.expectOp(":"); orelse = this.parseSuite(); }
      return { type: "while", test, body, orelse, line };
    };
    Parser.prototype.parseFor = function () {
      const line = this.peek().line;
      this.expectKw("for");
      this.forbidIn++;
      const target = this.parseTargetList();
      this.forbidIn--;
      this.expectKw("in");
      const iter = this.parseTest();
      this.expectOp(":");
      const body = this.parseSuite();
      let orelse = [];
      if (this.eatKw("else")) { this.expectOp(":"); orelse = this.parseSuite(); }
      return { type: "for", target, iter, body, orelse, line };
    };
    /* Parse a parameter list up to and including the closing `)`.
     *
     * `**` arrives from the lexer as a SINGLE token, so the old
     * `eatOp("*") / eatOp("*")` pair could never see the second half — which is
     * why `def f(*a, **k)` and `lambda *a:` both died with "expected name".
     * Branch on the token that is actually there, and mark keyword-only params
     * so `f(a, *, b=1)` refuses to bind `b` positionally. */
    Parser.prototype.parseParams = function () {
      const params = [];
      let vararg = null;
      let kwarg = null;
      let kwOnly = false;
      let posOnly = 0;
      if (this.eatOp(")")) return { params, vararg, kwarg, posOnly };
      while (!this.isOp(")")) {
        if (this.eatOp("**")) {
          kwarg = this.expectName();
        } else if (this.isOp("*")) {
          this.next();
          if (this.peek().type === "NAME") { vararg = this.expectName(); kwOnly = true; }
          else kwOnly = true; // bare `*` marker
        } else if (this.eatOp("/")) {
          posOnly = params.length;
        } else if (this.peek().type === "NAME") {
          const p = this.parseParam(true);
          p.kw = kwOnly;
          params.push(p);
        } else {
          throw new SyntaxErr("expected parameter name", this.peek().line);
        }
        if (!this.eatOp(",")) break;
      }
      this.expectOp(")");
      return { params, vararg, kwarg, posOnly };
    };
    /** `name`, `name=default`, `name: annotation`.
     *
     *  The annotation is parsed speculatively and rolled back when the `:` turns
     *  out to be the def's own suite colon (`def f(x):` — the common case). A
     *  real annotation is always followed by `,`, `)` or `=`; the suite colon is
     *  followed by NEWLINE, EOF or the body. */
    Parser.prototype.parseParam = function (allowAnnot) {
      const name = this.expectName();
      if (allowAnnot && this.isOp(":")) {
        const save = this.i;
        this.next();
        try { this.parseTest(); } catch (e) { this.i = save; }
        const after = this.peek();
        const ended = (after.type === "OP" && (after.value === "," || after.value === ")" || after.value === "=")) ||
          after.type === "NEWLINE" || after.type === "EOF" || after.type === "INDENT" || after.type === "DEDENT" ||
          (after.type === "OP" && after.value === ":");
        if (!ended) this.i = save;
      }
      let def = null;
      if (this.eatOp("=")) def = this.parseTest();
      return { name, def, kw: false };
    };
    /** `@deco` prefix lines, then the def/class they decorate. */
    Parser.prototype.parseDecorated = function () {
      const decorators = [];
      while (this.isOp("@")) {
        this.next();
        decorators.push(this.parseTest());
        if (this.peek().type === "NEWLINE") this.next();
        this.skipNl();
      }
      const node = this.isKw("class") ? this.parseClass() : this.parseDef();
      node.decorators = decorators;
      return node;
    };
    Parser.prototype.parseDef = function () {
      const line = this.peek().line;
      this.expectKw("def");
      const name = this.expectName();
      this.expectOp("(");
      const sig = this.parseParams();
      // `-> int` — the annotation is evaluated for side effects only.
      if (this.eatOp("->")) this.parseTest();
      this.expectOp(":");
      const body = this.parseSuite();
      return { type: "def", name, body, line, decorators: [], ...sig };
    };
    Parser.prototype.parseClass = function () {
      const line = this.peek().line;
      this.expectKw("class");
      const name = this.expectName();
      const bases = [];
      if (this.eatOp("(")) {
        if (!this.isOp(")")) {
          do { bases.push(this.parseTest()); } while (this.eatOp(","));
        }
        this.expectOp(")");
      }
      this.expectOp(":");
      const body = this.parseSuite();
      return { type: "class", name, bases, body, line, decorators: [] };
    };
    Parser.prototype.parseTry = function () {
      const line = this.peek().line;
      this.expectKw("try");
      this.expectOp(":");
      const body = this.parseSuite();
      const handlers = [];
      while (this.eatKw("except")) {
        let type = null;
        let name = null;
        if (!this.isOp(":")) {
          type = this.parseTest();
          if (this.eatKw("as")) name = this.expectName();
        }
        this.expectOp(":");
        handlers.push({ type, name, body: this.parseSuite() });
      }
      let orelse = [];
      let finalbody = [];
      if (this.eatKw("else")) { this.expectOp(":"); orelse = this.parseSuite(); }
      if (this.eatKw("finally")) { this.expectOp(":"); finalbody = this.parseSuite(); }
      return { type: "try", body, handlers, orelse, finalbody, line };
    };
    Parser.prototype.parseWith = function () {
      const line = this.peek().line;
      this.expectKw("with");
      const items = [];
      do {
        const expr = this.parseTest();
        let as = null;
        if (this.eatKw("as")) as = this.parseTarget();
        items.push({ expr, as });
      } while (this.eatOp(","));
      this.expectOp(":");
      return { type: "with", items, body: this.parseSuite(), line };
    };
    Parser.prototype.parseTargetList = function () {
      const first = this.parseTarget();
      if (!this.isOp(",")) return first;
      const elts = [first];
      while (this.eatOp(",")) {
        if (this.endsList()) break;
        elts.push(this.parseTarget());
      }
      return { type: "tuple", elts, ctx: "store", line: first.line };
    };
    Parser.prototype.endsList = function () {
      const p = this.peek();
      return p.type === "NEWLINE" || p.type === "EOF" || p.type === "DEDENT" || p.type === "OP" && ")]}:".includes(p.value) || p.type === "KW" && (p.value === "in" || p.value === "if" || p.value === "else" || p.value === "for");
    };
    Parser.prototype.parseTarget = function () {
      const e = this.parseOr();
      return e;
    };
    Parser.prototype.parseTestList = function () {
      const first = this.parseTest();
      if (!this.isOp(",")) return first;
      const elts = [first];
      while (this.eatOp(",")) {
        if (this.endsList()) break;
        elts.push(this.parseTest());
      }
      return { type: "tuple", elts, line: first.line || 1 };
    };
    Parser.prototype.parseTest = function () {
      if (this.eatKw("lambda")) {
        const params = [];
        let vararg = null;
        let kwarg = null;
        if (!this.isOp(":")) {
          do {
            if (this.isOp("*")) {
              this.next();
              if (this.eatOp("**")) kwarg = this.expectName();
              else if (this.peek().type === "NAME") vararg = this.expectName();
            } else if (this.peek().type === "NAME") {
              const p = this.parseParam(false);
              p.kw = vararg !== null || kwarg !== null;
              params.push(p);
            } else break;
          } while (this.eatOp(","));
        }
        this.expectOp(":");
        const line = this.peek().line;
        return { type: "lambda", params, vararg, kwarg, body: this.parseTest(), line };
      }
      const e = this.parseOr();
      if (this.eatKw("if")) {
        const test = this.parseOr();
        this.expectKw("else");
        return { type: "ifexp", body: e, test, orelse: this.parseTest(), line: e.line || 1 };
      }
      return e;
    };
    /* `match subject: case <pattern> if <guard>: ...`
     *
     * Patterns are parsed into the same node shapes the expression parser
     * produces, so a literal pattern is just an expression node and a capture
     * pattern is a bare name. Only the shapes that carry structure get their
     * own node type; everything else reuses `lit`, `capture`, `wild`, `or`,
     * `seq`, `map` and `cls`. */
    Parser.prototype.parseMatch = function () {
      const line = this.peek().line;
      this.next(); // `match` — a soft keyword, consumed without expectKw
      const subject = this.parseTestList();
      this.expectOp(":");
      if (this.peek().type === "NEWLINE") this.next();
      this.skipNl();
      if (this.peek().type === "EOF") throw new Incomplete("expected block");
      if (this.peek().type !== "INDENT") throw new SyntaxErr("expected an indented block", this.peek().line);
      this.next();
      const cases = [];
      while (this.peek().type !== "DEDENT" && this.peek().type !== "EOF") {
        this.skipNl();
        if (this.peek().type === "DEDENT" || this.peek().type === "EOF") break;
        if (this.peek().type === "NEWLINE") { this.next(); continue; }
        const c = this.peek();
        if (!(c.type === "NAME" && c.value === "case")) throw new SyntaxErr("expected case", c.line);
        this.next();
        const pattern = this.parsePattern();
        let guard = null;
        if (this.eatKw("if")) guard = this.parseTest();
        this.expectOp(":");
        cases.push({ pattern, guard, body: this.parseSuite() });
      }
      if (this.peek().type === "EOF") throw new Incomplete("expected dedent");
      this.next();
      if (!cases.length) throw new Incomplete("expected block");
      return { type: "match", subject, cases, line };
    };
    Parser.prototype.parsePattern = function () {
      let first = this.parsePatternAs();
      while (this.isOp("|")) {
        this.next();
        first = { type: "orpat", alts: [first, this.parsePatternAs()], line: first.line };
      }
      return first;
    };
    Parser.prototype.parsePatternAs = function () {
      const p = this.parsePatternPrimary();
      if (this.eatKw("as")) return { type: "capture", id: this.expectName(), sub: p, line: p.line };
      return p;
    };
    Parser.prototype.parsePatternPrimary = function () {
      if (this.isOp("*")) {
        const line = this.peek().line;
        this.next();
        // `*rest` absorbs; a bare `*` is just a wildcard.
        return { type: "wild", id: this.peek().type === "NAME" ? this.expectName() : null, line };
      }
      if (this.eatOp("[")) {
        const line = this.peek().line;
        const items = [];
        while (!this.isOp("]")) {
          items.push(this.parsePattern());
          if (!this.eatOp(",")) break;
        }
        this.expectOp("]");
        return { type: "seq", items, line };
      }
      if (this.eatOp("{")) {
        const line = this.peek().line;
        const keys = [];
        while (!this.isOp("}")) {
          const key = this.parsePattern();
          this.expectOp(":");
          const value = this.parsePattern();
          keys.push({ key, value });
          if (!this.eatOp(",")) break;
        }
        this.expectOp("}");
        return { type: "map", keys, line };
      }
      if (this.eatOp("(")) {
        const line = this.peek().line;
        const items = [];
        while (!this.isOp(")")) {
          items.push(this.parsePattern());
          if (!this.eatOp(",")) break;
        }
        this.expectOp(")");
        if (items.length === 1) return items[0];
        return { type: "seq", items, line };
      }
      const line = this.peek().line;
      const e = this.parseOr();
      // A bare NAME is a capture pattern, not a value comparison.
      if (e.type === "name") return { type: "capture", id: e.id, sub: null, line };
      // `Point(x, y)` — a class pattern keyed on a plain name.
      if (e.type === "call" && e.func.type === "name") {
        return { type: "cls", id: e.func.id, args: (e.args || []).filter((a) => !a.star && !a.starstar), line };
      }
      return { type: "lit", expr: e, line };
    };
    Parser.prototype.parseOr = function () {
      let e = this.parseAnd();
      while (this.eatKw("or")) e = { type: "bool", op: "or", left: e, right: this.parseAnd(), line: e.line };
      return e;
    };
    Parser.prototype.parseAnd = function () {
      let e = this.parseNot();
      while (this.eatKw("and")) e = { type: "bool", op: "and", left: e, right: this.parseNot(), line: e.line };
      return e;
    };
    Parser.prototype.parseNot = function () {
      if (this.eatKw("not")) {
        const line = this.peek().line;
        return { type: "unary", op: "not", arg: this.parseNot(), line };
      }
      return this.parseCmp();
    };
    Parser.prototype.parseCmp = function () {
      let left = this.parseBor();
      const ops = [];
      while (true) {
        if (this.forbidIn && (this.isKw("in") || (this.isKw("not") && this.t[this.i + 1] && this.t[this.i + 1].type === "KW" && this.t[this.i + 1].value === "in"))) break;
        let op = null;
        if (this.eatKw("not")) {
          this.expectKw("in");
          op = "notin";
        } else if (this.eatKw("is")) op = this.eatKw("not") ? "isnot" : "is";
        else if (this.eatKw("in")) op = "in";
        else if (this.peek().type === "OP" && ["==", "!=", "<", ">", "<=", ">="].includes(this.peek().value)) op = this.next().value;
        else break;
        ops.push(op, this.parseBor());
      }
      if (!ops.length) return left;
      return { type: "compare", left, ops, line: left.line };
    };
    Parser.prototype.parseBor = function () {
      let e = this.parseBxor();
      while (this.eatOp("|")) e = { type: "bin", op: "|", left: e, right: this.parseBxor(), line: e.line };
      return e;
    };
    Parser.prototype.parseBxor = function () {
      let e = this.parseBand();
      while (this.eatOp("^")) e = { type: "bin", op: "^", left: e, right: this.parseBand(), line: e.line };
      return e;
    };
    Parser.prototype.parseBand = function () {
      let e = this.parseShift();
      while (this.eatOp("&")) e = { type: "bin", op: "&", left: e, right: this.parseShift(), line: e.line };
      return e;
    };
    Parser.prototype.parseShift = function () {
      let e = this.parseAdd();
      while (this.peek().type === "OP" && (this.peek().value === "<<" || this.peek().value === ">>")) {
        const op = this.next().value;
        e = { type: "bin", op, left: e, right: this.parseAdd(), line: e.line };
      }
      return e;
    };
    Parser.prototype.parseAdd = function () {
      let e = this.parseMul();
      while (this.peek().type === "OP" && (this.peek().value === "+" || this.peek().value === "-")) {
        const op = this.next().value;
        e = { type: "bin", op, left: e, right: this.parseMul(), line: e.line };
      }
      return e;
    };
    Parser.prototype.parseMul = function () {
      let e = this.parseUnary();
      while (this.peek().type === "OP" && ["*", "/", "//", "%", "@"].includes(this.peek().value)) {
        const op = this.next().value;
        e = { type: "bin", op, left: e, right: this.parseUnary(), line: e.line };
      }
      return e;
    };
    Parser.prototype.parseUnary = function () {
      if (this.peek().type === "OP" && ["+", "-", "~"].includes(this.peek().value)) {
        const op = this.next().value;
        const line = this.peek().line;
        return { type: "unary", op, arg: this.parseUnary(), line };
      }
      return this.parsePow();
    };
    Parser.prototype.parsePow = function () {
      const e = this.parsePrimary();
      if (this.eatOp("**")) return { type: "bin", op: "**", left: e, right: this.parseUnary(), line: e.line };
      return e;
    };
    Parser.prototype.parsePrimary = function () {
      let e = this.parseAtom();
      while (true) {
        if (this.eatOp("(")) {
          const call = this.parseArgList();
          e = { type: "call", func: e, args: call.args, kw: call.kw, line: e.line };
        } else if (this.eatOp("[")) {
          const sl = this.parseSubscript();
          e = { type: "sub", value: e, index: sl, line: e.line };
        } else if (this.eatOp(".")) {
          e = { type: "attr", value: e, attr: this.expectName(), line: e.line };
        } else break;
      }
      return e;
    };
    Parser.prototype.parseAtom = function () {
      const p = this.peek();
      if (p.type === "NUM") { this.next(); return { type: "num", value: p.value, line: p.line }; }
      if (p.type === "STR" || p.type === "BYTES" || p.type === "FSTR") {
        const one = () => {
          const t = this.next();
          if (t.type === "STR") return { type: "str", value: t.value, line: t.line };
          if (t.type === "BYTES") return { type: "bytes", value: t.value, line: t.line };
          return { type: "fstr", raw: t.value, line: t.line };
        };
        let expr = one();
        while (this.peek().type === "STR" || this.peek().type === "BYTES" || this.peek().type === "FSTR") {
          expr = { type: "bin", op: "+", left: expr, right: one(), line: expr.line };
        }
        return expr;
      }
      if (p.type === "NAME") {
        this.next();
        // Walrus. It is only legal where an enclosing bracket makes the whole
        // thing an expression — which the enclosing paren has already done by
        // the time we get here, so the parser does not police that.
        if (this.isOp(":=")) {
          this.next();
          return { type: "named", id: p.value, value: this.parseTest(), line: p.line };
        }
        return { type: "name", id: p.value, line: p.line };
      }
      if (p.type === "KW" && (p.value === "True" || p.value === "False" || p.value === "None")) {
        this.next();
        return { type: "const", value: p.value === "True" ? true : p.value === "False" ? false : null, line: p.line };
      }
      if (this.eatOp("[")) return this.parseList(p.line);
      if (this.eatOp("{")) return this.parseBrace(p.line);
      if (this.eatOp("(")) return this.parseParen(p.line);
      throw new SyntaxErr("invalid syntax", p.line);
    };
    Parser.prototype.parseList = function (line) {
      if (this.eatOp("]")) return { type: "list", elts: [], line };
      const first = this.parseTest();
      if (this.isKw("for")) {
        const gens = this.parseGens();
        this.expectOp("]");
        return { type: "listcomp", elt: first, gens, line };
      }
      const elts = [first];
      while (this.eatOp(",")) {
        if (this.isOp("]")) break;
        elts.push(this.parseTest());
      }
      this.expectOp("]");
      return { type: "list", elts, line };
    };
    Parser.prototype.parseBrace = function (line) {
      if (this.eatOp("}")) return { type: "dict", keys: [], vals: [], line };
      const first = this.parseTest();
      if (this.eatOp(":")) {
        const val = this.parseTest();
        if (this.isKw("for")) {
          const gens = this.parseGens();
          this.expectOp("}");
          return { type: "dictcomp", key: first, value: val, gens, line };
        }
        const keys = [first];
        const vals = [val];
        while (this.eatOp(",")) {
          if (this.isOp("}")) break;
          keys.push(this.parseTest());
          this.expectOp(":");
          vals.push(this.parseTest());
        }
        this.expectOp("}");
        return { type: "dict", keys, vals, line };
      }
      if (this.isKw("for")) {
        const gens = this.parseGens();
        this.expectOp("}");
        return { type: "setcomp", elt: first, gens, line };
      }
      const elts = [first];
      while (this.eatOp(",")) {
        if (this.isOp("}")) break;
        elts.push(this.parseTest());
      }
      this.expectOp("}");
      return { type: "set", elts, line };
    };
    Parser.prototype.parseParen = function (line) {
      if (this.eatOp(")")) return { type: "tuple", elts: [], line };
      const first = this.parseTest();
      if (this.isKw("for")) {
        const gens = this.parseGens();
        this.expectOp(")");
        return { type: "genexp", elt: first, gens, line };
      }
      if (this.eatOp(",")) {
        const elts = [first];
        while (!this.isOp(")")) {
          if (this.eatOp(",")) { if (this.isOp(")")) break; }
          elts.push(this.parseTest());
          if (!this.eatOp(",")) break;
        }
        this.expectOp(")");
        return { type: "tuple", elts, line };
      }
      this.expectOp(")");
      return first;
    };
    Parser.prototype.parseGens = function () {
      const gens = [];
      while (this.eatKw("for")) {
        this.forbidIn++;
        const target = this.parseTargetList();
        this.forbidIn--;
        this.expectKw("in");
        const iter = this.parseOr();
        const ifs = [];
        while (this.eatKw("if")) ifs.push(this.parseOr());
        gens.push({ target, iter, ifs });
      }
      if (!gens.length) throw new SyntaxErr("expected for", this.peek().line);
      return gens;
    };
    Parser.prototype.parseArgList = function () {
      const args = [];
      const kw = [];
      if (this.eatOp(")")) return { args, kw };
      while (!this.isOp(")")) {
        // `**kw` arrives as one token; `*seq` as a single `*`. Testing only "*"
        // silently dropped every `**mapping` call.
        if (this.isOp("**")) {
          this.next();
          args.push({ starstar: this.parseTest() });
        } else if (this.isOp("*")) {
          this.next();
          args.push({ star: this.parseTest() });
        } else if (this.peek().type === "NAME" && this.t[this.i + 1] && this.t[this.i + 1].type === "OP" && this.t[this.i + 1].value === "=") {
          const name = this.next().value;
          this.next();
          kw.push([name, this.parseTest()]);
        } else {
          const first = this.parseTest();
          if (this.isKw("for")) args.push({ type: "genexp", elt: first, gens: this.parseGens(), line: first.line });
          else args.push(first);
        }
        if (!this.eatOp(",")) break;
      }
      this.expectOp(")");
      return { args, kw };
    };
    Parser.prototype.parseSubscript = function () {
      if (this.eatOp("]")) throw new SyntaxErr("empty subscript", this.peek().line);
      const parts = [];
      let slice = false;
      if (this.isOp(":")) { slice = true; parts.push(null); }
      else parts.push(this.parseTest());
      while (this.eatOp(":")) {
        slice = true;
        if (this.isOp(":") || this.isOp("]")) parts.push(null);
        else parts.push(this.parseTest());
      }
      this.expectOp("]");
      if (!slice) return parts[0];
      return { type: "slice", parts, line: parts[0] && parts[0].line || 1 };
    };

    /** Names bound by a `global` statement anywhere in the function body. Same
     *  reason as collectNonlocals: they must not be function-locals. */
    function collectGlobals(stmts, set) {
      for (const st of stmts || []) walk(st);
      function walk(st) {
        if (!st) return;
        if (st.type === "global") { st.names.forEach((n) => set.add(n)); return; }
        if (st.type === "def" || st.type === "class" || st.type === "lambda") return;
        if (st.type === "seq") walkBody(st.body);
        if (st.type === "for") { walkBody(st.body); walkBody(st.orelse); }
        if (st.type === "while" || st.type === "if") { walkBody(st.body); walkBody(st.orelse); }
        if (st.type === "try") {
          walkBody(st.body); walkBody(st.orelse); walkBody(st.finalbody);
          st.handlers.forEach((h) => walkBody(h.body));
          return;
        }
        if (st.type === "with") walkBody(st.body);
        if (st.type === "match") st.cases.forEach((c) => walkBody(c.body));
      }
      function walkBody(body) { if (Array.isArray(body)) body.forEach(walk); }
      return set;
    }
    /** Names bound by a `nonlocal` statement anywhere in the function body.
     *  They must NOT be in the frame's local set, or `Env.set` would create a
     *  function-local instead of writing through to the enclosing cell. */
    function collectNonlocals(stmts, set) {
      for (const st of stmts || []) walk(st);
      function walk(st) {
        if (!st) return;
        if (st.type === "nonlocal") { st.names.forEach((n) => set.add(n)); return; }
        if (st.type === "def" || st.type === "class" || st.type === "lambda") return;
        if (st.type === "seq") walkBody(st.body);
        if (st.type === "for") walkBody(st.body), walkBody(st.orelse);
        if (st.type === "while" || st.type === "if") walkBody(st.body), walkBody(st.orelse);
        if (st.type === "try") {
          walkBody(st.body); walkBody(st.orelse); walkBody(st.finalbody);
          st.handlers.forEach((h) => walkBody(h.body));
          return;
        }
        if (st.type === "with") walkBody(st.body);
        if (st.type === "match") st.cases.forEach((c) => walkBody(c.body));
      }
      function walkBody(body) { if (Array.isArray(body)) body.forEach(walk); }
      return set;
    }

    function collectLocals(stmts, set) {
      for (const st of stmts || []) walk(st);
      function walk(st) {
        if (!st) return;
        if (st.type === "seq") return walkBody(st.body);
        if (st.type === "match") return st.cases.forEach((c) => walkBody(c.body));
        if (st.type === "named") { set.add(st.id); return; }
        if (st.type === "assign") st.targets.forEach(collectTarget);
        else if (st.type === "aug" || st.type === "del") collectTarget(st.target);
        else if (st.type === "for") collectTarget(st.target);
        else if (st.type === "def" || st.type === "class") set.add(st.name);
        else if (st.type === "import") st.names.forEach((n) => set.add((n.as || n.name).split(".")[0]));
        else if (st.type === "from") st.names.forEach((n) => set.add(n.as || n.name));
        else if (st.type === "with") st.items.forEach((it) => { if (it.as) collectTarget(it.as); });
        else if (st.type === "try") {
          st.handlers.forEach((h) => { if (h.name) set.add(h.name); walkBody(h.body); });
          walkBody(st.body); walkBody(st.orelse); walkBody(st.finalbody);
          return;
        }
        if (st.type === "def" || st.type === "class" || st.type === "lambda") return;
        walkBody(st.body); walkBody(st.orelse);
        (st.elifs || []).forEach((b) => walkBody(b.body));
      }
      function walkBody(body) { if (Array.isArray(body)) body.forEach(walk); }
      function collectTarget(t) {
        if (!t) return;
        if (t.type === "name") set.add(t.id);
        else if (t.type === "tuple" || t.type === "list") (t.elts || []).forEach(collectTarget);
      }
    }

    const env = new Env(null);
    rt.env = env;
    rt.exc = {};
    function addExc(name, base) {
      const cls = { kind: "class", name, bases: base ? [base] : [], dict: new Map() };
      cls.dict.set("__init__", {
        kind: "builtin",
        name: "__init__",
        method: true,
        fn: (args) => {
          const self = args[0];
          const msg = args.length > 1 && args[1] != null ? pyStr(args[1]) : "";
          self.dict.set("msg", msg);
          self.dict.set("args", args.slice(1));
          return null;
        },
      });
      rt.exc[name] = cls;
      env.set(name, cls);
      return cls;
    }
    const BaseException = addExc("BaseException", null);
    const ExceptionCls = addExc("Exception", BaseException);
    addExc("SystemExit", BaseException);
    addExc("StopIteration", ExceptionCls);
    addExc("AssertionError", ExceptionCls);
    addExc("AttributeError", ExceptionCls);
    addExc("ImportError", ExceptionCls);
    addExc("LookupError", ExceptionCls);
    addExc("IndexError", rt.exc.LookupError);
    addExc("KeyError", rt.exc.LookupError);
    addExc("NameError", ExceptionCls);
    addExc("UnboundLocalError", rt.exc.NameError);
    addExc("OSError", ExceptionCls);
    addExc("FileNotFoundError", rt.exc.OSError);
    addExc("RuntimeError", ExceptionCls);
    addExc("RecursionError", rt.exc.RuntimeError);
    addExc("NotImplementedError", rt.exc.RuntimeError);
    addExc("SyntaxError", ExceptionCls);
    addExc("TypeError", ExceptionCls);
    addExc("ValueError", ExceptionCls);
    addExc("ZeroDivisionError", ExceptionCls);
    const JSONDecodeError = addExc("JSONDecodeError", rt.exc.ValueError);

    function isSub(cls, want) {
      let c = cls;
      while (c) {
        if (c === want) return true;
        c = (c.bases && c.bases[0]) || null;
      }
      return false;
    }
    function isinstance(v, t) {
      if (t && t.kind === "tuple") return t.items.some((x) => isinstance(v, x));
      if (Array.isArray(t)) return t.some((x) => isinstance(v, x));
      if (!t) return false;
      if (t.kind === "class") {
        if (v && v.kind === "inst") return isSub(v.cls, t);
        return false;
      }
      if (t === TYPE.bool) return typeof v === "boolean";
      if (t === TYPE.int) return typeof v === "boolean" || (typeof v === "number" && Number.isInteger(v));
      if (t === TYPE.float) return typeof v === "number";
      if (t === TYPE.str) return typeof v === "string";
      if (t === TYPE.list) return Array.isArray(v);
      if (t === TYPE.tuple) return !!(v && v.kind === "tuple");
      if (t === TYPE.dict) return !!(v && v.kind === "dict");
      if (t === TYPE.set) return !!(v && v.kind === "set");
      if (t === TYPE.frozenset) return !!(v && v.kind === "frozenset");
      if (t === TYPE.bytes) return !!(v && v.kind === "bytes");
      if (t === TYPE.type) return !!(v && (v.kind === "type" || v.kind === "class"));
      if (t === TYPE.NoneType) return v == null;
      return false;
    }

    const TYPE = {};
    /* classmethods reachable off the type object: `int.from_bytes`,
     * `int.to_bytes`, `str.maketrans`. Registered here so getAttr can find
     * them without teaching TYPE objects about a second attribute table. */
    const TYPE_CLASSMETHODS = {
      int: {
        from_bytes: builtin("from_bytes", (a) => {
          const data = a[0] && a[0].kind === "bytes" ? a[0].data : snapshot(a[0]).map((n) => asNum(n) & 255);
          const little = pyStr(a[2] || "big") === "little";
          const bytes = little ? Uint8Array.from(data).reverse() : Uint8Array.from(data);
          let v = 0n;
          for (const b of bytes) v = (v << 8n) | BigInt(b);
          const signed = truth(a[3]);
          const limit = 1n << BigInt(8 * bytes.length - 1);
          if (signed && v >= limit) v -= 1n << BigInt(8 * bytes.length);
          return Number(v);
        }),
      },
    };
    function makeType(name, ctor) {
      const t = { kind: "type", name, ctor };
      TYPE[name] = t;
      return t;
    }

    function builtin(name, fn) { return { kind: "builtin", name, fn }; }
    function method(name, fn) { return { kind: "builtin", name, fn, method: true }; }

    function getAttr(obj, name) {
      if (obj == null) fail(rt.exc.AttributeError, "None has no attribute " + name);
      // Introspection dunders on functions/builtins: `print.__name__` is the
      // first thing anyone runs, and `dir()`/`help()` both lean on it.
      if ((obj.kind === "func" || obj.kind === "builtin") && (name === "__name__" || name === "__qualname__")) {
        return obj.__name__ || obj.name || "";
      }
      if (obj.kind === "property" && name === "__name__") return obj.fget && obj.fget.__name__ ? obj.fget.__name__ : "property";
      if (name === "mro") return [obj].concat(linearize(obj));
      if (typeof obj === "number" && !Array.isArray(obj)) {
        const m = NUM_METHODS[name];
        if (m) return { kind: "bound", self: obj, func: method(name, m) };
      }
      if (typeof obj === "string") {
        const m = STR_METHODS[name];
        if (!m) fail(rt.exc.AttributeError, "str has no attribute " + name);
        return { kind: "bound", self: obj, func: method(name, m) };
      }
      if (Array.isArray(obj)) {
        const m = LIST_METHODS[name];
        if (!m) fail(rt.exc.AttributeError, "list has no attribute " + name);
        return { kind: "bound", self: obj, func: method(name, m) };
      }
      if (obj.kind === "dict") {
        const m = DICT_METHODS[name];
        if (!m) fail(rt.exc.AttributeError, "dict has no attribute " + name);
        return { kind: "bound", self: obj, func: method(name, m) };
      }
      if (obj.kind === "set" || obj.kind === "frozenset") {
        const m = SET_METHODS[name];
        if (!m) fail(rt.exc.AttributeError, "set has no attribute " + name);
        return { kind: "bound", self: obj, func: method(name, m) };
      }
      if (obj.kind === "bytes") {
        const m = BYTES_METHODS[name];
        if (!m) fail(rt.exc.AttributeError, "bytes has no attribute " + name);
        return { kind: "bound", self: obj, func: method(name, m) };
      }
      if (obj.kind === "tuple") {
        if (name === "count" || name === "index") {
          return { kind: "bound", self: obj, func: method(name, TUPLE_METHODS[name]) };
        }
        fail(rt.exc.AttributeError, "tuple has no attribute " + name);
      }
      if (obj.kind === "property") {
        // `@x.setter` / `@x.getter` inside a class body: return a decorator that
        // rebuilds the descriptor with the new accessor's name.
        if (name === "setter" || name === "getter" || name === "deleter") {
          return builtin(name, (a) => ({
            kind: "property",
            fget: name === "setter" ? obj.fget : a[0],
            fset: name === "setter" ? a[0] : obj.fset,
            deleter: name === "deleter" ? a[0] : obj.deleter,
          }));
        }
        fail(rt.exc.AttributeError, "property has no attribute " + name);
      }
      if (obj.kind === "enummember") {
        if (obj.dict.has(name)) return obj.dict.get(name);
        fail(rt.exc.AttributeError, obj.owner + "." + obj.name + " has no attribute " + name);
      }
      if (obj.kind === "super") {
        const found = findClassIn(obj.mro, name);
        if (found === undefined) fail(rt.exc.AttributeError, "'super' object has no attribute '" + name + "'");
        if (found && found.kind === "property") return found.fget ? call(found.fget, [obj.obj], new Map()) : null;
        if (found && (found.kind === "func" || (found.kind === "builtin" && found.method))) return { kind: "bound", self: obj.obj, func: found };
        return found;
      }
      if (obj.kind === "inst") {
        if (obj.dict.has(name)) return obj.dict.get(name);
        const found = findClass(obj.cls, name);
        if (found === undefined) fail(rt.exc.AttributeError, obj.cls.name + " has no attribute " + name);
        if (found && found.kind === "property") {
          // `@property` returns a descriptor; reading it calls the getter.
          if (found.fget) return call(found.fget, [obj], new Map());
          return null;
        }
        if (found && found.kind === "builtin" && found.static) return found;
        if (found && found.kind === "property" && name === "setter") return found;
        if (found && (found.kind === "func" || found.kind === "builtin")) return { kind: "bound", self: obj, func: found };
        return found;
      }
      if (obj.kind === "class" || obj.kind === "type") {
        if (name === "__name__") return obj.name;
        // `int.from_bytes(...)` / `str.maketrans(...)`: classmethods that live
        // on the type object rather than its instances.
        if (obj.kind === "type" && TYPE_CLASSMETHODS[obj.name] && TYPE_CLASSMETHODS[obj.name][name]) {
          return TYPE_CLASSMETHODS[obj.name][name];
        }
        if (obj.kind === "type" && name === "fromkeys" && obj.name === "dict") return builtin("fromkeys", dictFromKeys);
        if (obj.dict && obj.dict.has && obj.dict.has(name)) return obj.dict.get(name);
        if (obj.kind === "class") {
          const found = findClass(obj, name);
          if (found !== undefined) return found;
        }
        fail(rt.exc.AttributeError, obj.name + " has no attribute " + name);
      }
      if (obj.kind === "module" || obj.kind === "ns" || obj.kind === "enum") {
        if (!obj.dict.has(name)) fail(rt.exc.AttributeError, obj.name + " has no attribute " + name);
        return obj.dict.get(name);
      }
      if (obj.kind === "match") return { kind: "bound", self: obj, func: method(name, MATCH_METHODS[name] || (() => fail(rt.exc.AttributeError, "Match has no attribute " + name))) };
      if (obj.kind === "re") return { kind: "bound", self: obj, func: method(name, RE_METHODS[name] || (() => fail(rt.exc.AttributeError, "Pattern has no attribute " + name))) };
      if (obj.kind === "file") return { kind: "bound", self: obj, func: method(name, FILE_METHODS[name] || (() => fail(rt.exc.AttributeError, "file has no attribute " + name))) };
      if (obj.kind === "hash") {
        if (name === "hexdigest") return { kind: "bound", self: obj, func: builtin("hexdigest", () => obj.hex) };
        fail(rt.exc.AttributeError, "HASH has no attribute " + name);
      }
      if (obj.kind === "parsed") {
        if (name === "_replace") return { kind: "bound", self: obj, func: method("_replace", parsedReplace) };
        if (name in obj.fields) return obj.fields[name];
        fail(rt.exc.AttributeError, "ParseResult has no attribute " + name);
      }
      if (obj.kind === "future") {
        if (name === "result") return { kind: "bound", self: obj, func: method("result", (args) => { if (obj.error) throw obj.error; return obj.value; }) };
        if (name === "done") return { kind: "bound", self: obj, func: builtin("done", () => true) };
        fail(rt.exc.AttributeError, "Future has no attribute " + name);
      }
      fail(rt.exc.AttributeError, typeName(obj) + " has no attribute " + name);
    }
    function setAttr(obj, name, value) {
      if (obj && obj.kind === "inst") {
        // `@x.setter` — assigning through a property descriptor.
        const prop = findClass(obj.cls, name);
        if (prop && prop.kind === "property") {
          if (!prop.fset) fail(rt.exc.AttributeError, "property '" + name + "' of '" + obj.cls.name + "' object has no setter");
          call(prop.fset, [obj, value], new Map());
          return;
        }
        obj.dict.set(name, value);
        return;
      }
      if (obj && (obj.kind === "module" || obj.kind === "ns")) { obj.dict.set(name, value); return; }
      if (obj && obj.kind === "parsed") { obj.fields[name] = value; return; }
      fail(rt.exc.AttributeError, "cannot set " + name + " on " + typeName(obj));
    }
    /** C3 is overkill; depth-first left-to-right bases is right for the diamond
     *  shapes people actually write, and dedupes on the way back up. */
    function linearize(cls) {
      const out = [];
      const seen = new Set([cls]);
      const walk = (c) => {
        for (const b of (c.bases || [])) {
          if (seen.has(b)) continue;
          seen.add(b);
          out.push(b);
          walk(b);
        }
      };
      walk(cls);
      return out;
    }
    function findClassIn(list, name) {
      for (const c of list) {
        if (c && c.dict && c.dict.has(name)) return c.dict.get(name);
      }
      return undefined;
    }
    /* Zero-arg `super()` produces a {kind:"super"} marker rather than a bound
     * method, because attribute lookup on it has to start *after* the instance's
     * own class in the MRO — which is exactly what getAttr() special-cases. */
    function superBuiltin(args) {
      const self = args[0];
      if (!self || self.kind !== "inst") fail(rt.exc.TypeError, "super() argument 1 must be an instance");
      const rest = linearize(self.cls);
      if (!rest.length) fail(rt.exc.TypeError, "super(): " + self.cls.name + " has no parent class");
      return { kind: "super", name: "super", obj: self, mro: rest };
    }
    function findClass(cls, name) {
      const seen = new Set();
      const stack = [cls];
      while (stack.length) {
        const c = stack.shift();
        if (!c || seen.has(c)) continue;
        seen.add(c);
        if (c.dict && c.dict.has(name)) return c.dict.get(name);
        (c.bases || []).forEach((b) => stack.push(b));
      }
      return undefined;
    }

    function call(fn, args, kwargs) {
      kwargs = kwargs || new Map();
      step();
      // CPython's default is 1000. This engine spends ~30 JS frames per Python
      // frame (eval → exec → execBody → callUser → call), so the browser's own
      // stack runs out around 350. 300 is the highest value that reliably
      // produces a catchable Python RecursionError instead of an opaque
      // "Maximum call stack size exceeded" that tears down the whole page.
      if (rt.depth > 300) fail(rt.exc.RecursionError, "maximum recursion depth exceeded");
      if (fn && fn.kind === "class") return instantiate(fn, args, kwargs);
      if (fn && fn.kind === "type") return fn.ctor(args, kwargs);
      if (fn && fn.kind === "bound") {
        rt.depth++;
        try {
          if (fn.func.kind === "builtin") return fn.func.fn([fn.self, ...args], kwargs);
          return callUser(fn.func, [fn.self, ...args], kwargs);
        } finally { rt.depth--; }
      }
      if (fn && fn.kind === "builtin") return fn.fn(args, kwargs);
      if (fn && fn.kind === "enum") {
        // `Color(1)` is a value lookup across the enum's members.
        for (const [, member] of fn.members.items) {
          if (pyEq(member.value, args[0]) || pyEq(member.name, args[0])) return member;
        }
        fail(rt.exc.ValueError, pyRepr(args[0]) + " is not a valid " + fn.name);
      }
      if (fn && fn.kind === "func") {
        rt.depth++;
        try { return callUser(fn, args, kwargs); }
        finally { rt.depth--; }
      }
      fail(rt.exc.TypeError, typeName(fn) + " is not callable");
    }
    function callUser(fn, args, kwargs) {
      const frame = new Env(fn.env);
      frame.module = fn.module;
      frame.globals = fn.globals || null;
      frame.locals = new Set(fn.locals);
      for (const name of frame.locals) frame.map.set(name, UNBOUND);
      const params = fn.params;
      // Keyword-only params must not be filled positionally: `f(a, *, b=1)`
      // called as `f(1, 2)` is a TypeError, not a silent rebind.
      const positional = params.filter((p) => !p.kw && p.name !== (fn.kwarg || "\u0000"));
      const bound = new Map();
      let i = 0;
      for (; i < args.length && i < positional.length; i++) bound.set(positional[i].name, args[i]);
      const extra = args.slice(i);
      if (extra.length && !fn.vararg) fail(rt.exc.TypeError, fn.name + "() takes " + positional.length + " positional arguments but " + args.length + " were given");
      if (fn.vararg) bound.set(fn.vararg, tuple(extra));
      const kwLeft = new Map(kwargs);
      for (const [k, v] of kwLeft) {
        if (bound.has(k)) fail(rt.exc.TypeError, fn.name + "() got multiple values for '" + k + "'");
        if (params.some((p) => p.name === k)) { bound.set(k, v); kwLeft.delete(k); }
        else if (!fn.kwarg) fail(rt.exc.TypeError, fn.name + "() got an unexpected keyword argument '" + k + "'");
      }
      if (fn.kwarg) bound.set(fn.kwarg, mapToDict(kwLeft));
      for (const p of params) {
        if (!bound.has(p.name)) {
          if (p.def === undefined) fail(rt.exc.TypeError, fn.name + "() missing argument '" + p.name + "'");
          bound.set(p.name, p.def);
        }
      }
      for (const [k, v] of bound) frame.map.set(k, v);
      // Implicit closure cells. Python makes `super()` and `__class__` work
      // inside any method body without an explicit argument; reproduce that by
      // binding them in the frame when the first parameter is `self`/`cls`.
      // Without this, `super().method()` raised "argument 1 must be an instance".
      if (args.length && fn.params.length && (fn.params[0].name === "self" || fn.params[0].name === "cls") && fn.cls) {
        frame.map.set("__class__", fn.cls);
        if (!frame.locals.has("super")) {
          const owner = fn;
          frame.map.set("super", builtin("super", () => {
            const rest = linearize(owner.cls);
            if (!rest.length) fail(rt.exc.TypeError, "super(): " + owner.cls.name + " has no parent class");
            return { kind: "super", name: "super", obj: args[0], mro: rest };
          }));
        }
      }
      rt.stack.push({ name: fn.name, line: fn.line });
      try {
        execBody(fn.body, frame);
      } catch (e) {
        if (e instanceof ReturnExc) return e.value;
        throw e;
      } finally {
        rt.stack.pop();
      }
      return null;
    }
    function mapToDict(m) {
      const d = emptyDict();
      for (const [k, v] of m) dictSet(d, k, v);
      return d;
    }
    function instantiate(cls, args, kwargs) {
      const inst = { kind: "inst", cls, dict: new Map() };
      const init = findClass(cls, "__init__");
      if (init) {
        // `__init__` must not become the constructor's return value — the
        // constructor returns the instance, which is what `datetime.datetime(...)`
        // and every other class call depends on.
        call({ kind: "bound", self: inst, func: init }, args, kwargs);
      }
      return inst;
    }

    function snapshot(v) {
      if (Array.isArray(v)) return v.slice();
      if (typeof v === "string") return [...v];
      if (v && v.kind === "tuple") return v.items.slice();
      if (v && (v.kind === "set" || v.kind === "frozenset")) return v.items.slice();
      if (v && v.kind === "dict") return v.items.map(([k]) => k);
      if (v && v.kind === "bytes") return Array.from(v.data);
      if (v && v.kind === "range") {
        const out = [];
        let n = 0;
        for (let i = v.start; v.step > 0 ? i < v.stop : i > v.stop; i += v.step) {
          out.push(i);
          if (++n > 100000) fail(rt.exc.OverflowError || rt.exc.RuntimeError, "range too large");
        }
        return out;
      }
      if (v && v.kind === "iter") return v.items.slice(v.i);
      if (v && v.kind === "file") return fileLines(v);
      if (v && v.kind === "inst") {
        if (findClass(v.cls, "__iter__")) {
          const it = call(getAttr(v, "__iter__"), []);
          return snapshot(it);
        }
        if (findClass(v.cls, "__getitem__")) {
          // Legacy protocol: index from 0 until __getitem__ raises IndexError.
          const out = [];
          for (let i = 0; i < 1000000; i++) {
            try { out.push(call(getAttr(v, "__getitem__"), [i], new Map())); }
            catch (e) { if (isIndexStop(e)) return out; throw e; }
          }
          return out;
        }
        if (findClass(v.cls, "__len__")) {
          const n = dunderLen(v);
          const out = [];
          for (let i = 0; i < n; i++) out.push(call(getAttr(v, "__getitem__"), [i], new Map()));
          return out;
        }
      }
      fail(rt.exc.TypeError, typeName(v) + " is not iterable");
    }
    function forEach(v, fn) {
      if (v && v.kind === "iter") {
        while (v.i < v.items.length) { step(); fn(v.items[v.i++]); }
        return;
      }
      const items = snapshot(v);
      for (const item of items) { step(); fn(item); }
    }

    function indexOf(seqLen, idx) {
      let i = asNum(idx);
      if (!Number.isInteger(i)) fail(rt.exc.TypeError, "index must be an integer");
      if (i < 0) i += seqLen;
      if (i < 0 || i >= seqLen) fail(rt.exc.IndexError, "index out of range");
      return i;
    }
    function sliceIdx(len, v, dflt) {
      if (v == null) return dflt;
      let i = asNum(v);
      if (!Number.isInteger(i)) fail(rt.exc.TypeError, "slice index must be an integer");
      if (i < 0) i += len;
      if (i < 0) i = 0;
      if (i > len) i = len;
      return i;
    }
    function doSlice(len, parts, getter) {
      const step = parts.length > 2 && parts[2] != null ? asNum(parts[2]) : 1;
      if (step === 0) fail(rt.exc.ValueError, "slice step cannot be zero");
      let start = parts[0] == null ? (step > 0 ? 0 : len - 1) : asNum(parts[0]);
      let stop = parts[1] == null ? (step > 0 ? len : -1) : asNum(parts[1]);
      if (parts[0] != null && start < 0) start += len;
      if (parts[1] != null && stop < 0) stop += len;
      const out = [];
      if (step > 0) {
        if (start < 0) start = 0;
        for (let i = start; i < stop && i < len; i += step) out.push(getter(i));
      } else {
        if (start >= len) start = len - 1;
        for (let i = start; i > stop && i >= 0; i += step) out.push(getter(i));
      }
      return out;
    }

    function execBody(body, frame) {
      for (const st of body || []) exec(st, frame);
    }
    function exec(st, frame) {
      if (!st) return;
      rt.line = st.line || rt.line;
      if (rt.stack.length) rt.stack[rt.stack.length - 1].line = rt.line;
      step();
      switch (st.type) {
        case "pass": return;
        case "seq": execBody(st.body, frame); return;
        case "annassign": {
          // The annotation is evaluated (for side effects); with a value it is
          // a normal assignment, which is what `@dataclass` fields rely on.
          const anno = ev(st.annotation, frame);
          // In a class body every annotated name is a field declaration —
          // `x: int` (required) and `x: int = 1` (defaulted) alike.
          const inClass = frame.pendingAnnotations;
          if (inClass) dictSet(inClass, st.target.id, anno);
          if (st.value) assign(st.target, ev(st.value, frame), frame);
          else if (!inClass) frame.set(st.target.id, null);
          return;
        }
        case "break": throw new BreakExc();
        case "continue": throw new ContinueExc();
        case "return": throw new ReturnExc(st.value ? ev(st.value, frame) : null);
        case "expr": {
          const v = ev(st.value, frame);
          if (rt.repl && v != null) write(pyRepr(v) + "\n");
          return;
        }
        case "walrus": {
          const v = ev(st.value, frame);
          frame.set(st.id, v);
          return v;
        }
        case "assign": {
          const value = ev(st.value, frame);
          for (let i = 0; i < st.targets.length - 0; i++) assign(st.targets[i], value, frame);
          return;
        }
        case "aug": {
          const cur = ev(st.target, frame);
          assign(st.target, binOp(st.op.replace(/=$/, ""), cur, ev(st.value, frame)), frame);
          return;
        }
        case "if": {
          if (truth(ev(st.test, frame))) return execBody(st.body, frame);
          for (const b of st.elifs) if (truth(ev(b.test, frame))) return execBody(b.body, frame);
          return execBody(st.orelse, frame);
        }
        case "while": {
          let broke = false;
          try {
            while (truth(ev(st.test, frame))) {
              step();
              try { execBody(st.body, frame); }
              catch (e) { if (e instanceof ContinueExc) continue; throw e; }
            }
          } catch (e) { if (e instanceof BreakExc) broke = true; else throw e; }
          if (!broke) execBody(st.orelse, frame);
          return;
        }
        case "for": {
          const iter = ev(st.iter, frame);
          let broke = false;
          try {
            forEach(iter, (val) => {
              assign(st.target, val, frame);
              try { execBody(st.body, frame); }
              catch (e) { if (e instanceof ContinueExc) return; throw e; }
            });
          } catch (e) { if (e instanceof BreakExc) broke = true; else throw e; }
          if (!broke) execBody(st.orelse, frame);
          return;
        }
        case "def": {
          const locals = new Set();
          collectLocals(st.body, locals);
          st.params.forEach((p) => locals.add(p.name));
          if (st.vararg) locals.add(st.vararg);
          if (st.kwarg) locals.add(st.kwarg);
          collectGlobals(st.body, new Set()).forEach((g) => locals.delete(g));
          collectNonlocals(st.body, new Set()).forEach((g) => locals.delete(g));
          const fn = {
            kind: "func",
            name: st.name,
            params: st.params.map((p) => ({ name: p.name, def: p.def ? ev(p.def, frame) : undefined, kw: !!p.kw })),
            vararg: st.vararg,
            kwarg: st.kwarg,
            body: st.body,
            env: frame,
            module: frame.module || env,
            locals: [...locals],
            globals: new Set(st.globals || []),
            line: st.line,
          };
          // Decorators apply bottom-up: `@a @b def f` → f = a(b(f)).
          let value = fn;
          for (let i = (st.decorators || []).length - 1; i >= 0; i--) {
            value = call(ev(st.decorators[i], frame), [value], new Map());
          }
          frame.set(st.name, value);
          return;
        }
        case "class": {
          const bases = st.bases.map((b) => ev(b, frame));
          const bodyEnv = new Env(frame);
          bodyEnv.module = frame.module || env;
          const annotations = emptyDict();
          bodyEnv.pendingAnnotations = annotations;
          execBody(st.body, bodyEnv);
          const dict = new Map(bodyEnv.map);
          if (annotations.items.length) dict.set("__annotations__", annotations);
          const value = { kind: "class", name: st.name, bases, dict };
          // Stamp the owning class onto every method so `super()` / `__class__`
          // resolve to the right MRO at call time.
          for (const v of dict.values()) {
            if (v && (v.kind === "func" || (v.kind === "builtin" && v.method))) v.cls = value;
          }
          for (let i = (st.decorators || []).length - 1; i >= 0; i--) {
            frame.set(st.name, call(ev(st.decorators[i], frame), [value], new Map()));
            return;
          }
          frame.set(st.name, value);
          return;
        }
        case "match": {
          const subject = ev(st.subject, frame);
          for (const c of st.cases) {
            const bound = new Map();
            if (!matchPattern(c.pattern, subject, bound, frame)) continue;
            // Bind before the guard: `case n if n > 3` must see `n`. Undo the
            // binding if the guard fails, so a rejected case leaks nothing.
            const shadow = new Map();
            for (const [k, v] of bound) {
              shadow.set(k, frame.map.has(k) ? frame.map.get(k) : undefined);
              frame.set(k, v);
            }
            if (c.guard && !truth(ev(c.guard, frame))) {
              for (const [k, v] of shadow) {
                if (v === undefined) frame.map.delete(k);
                else frame.map.set(k, v);
              }
              continue;
            }
            return execBody(c.body, frame);
          }
          return;
        }
        case "try": {
          let failed = false;
          try {
            execBody(st.body, frame);
          } catch (e) {
            failed = true;
            if (!(e instanceof PyRunError)) throw e;
            let matched = false;
            for (const h of st.handlers) {
              if (!h.type || matchesExc(e, ev(h.type, frame))) {
                matched = true;
                if (h.name) frame.set(h.name, e.inst || blankInst(e.cls, e.message));
                // Track the active exception so a bare `raise` inside the
                // handler re-raises it, as in CPython.
                rt.active.push(e);
                try { execBody(h.body, frame); } finally { rt.active.pop(); }
                break;
              }
            }
            if (!matched) throw e;
          } finally {
            execBody(st.finalbody, frame);
          }
          if (!failed) execBody(st.orelse, frame);
          return;
        }
        case "with": {
          let ctx = frame;
          const entered = [];
          for (const item of st.items) {
            const mgr = ev(item.expr, ctx);
            const val = call(getAttr(mgr, "__enter__"), []);
            entered.push(mgr);
            if (item.as) assign(item.as, val, frame);
          }
          try { execBody(st.body, frame); }
          finally {
            for (let i = entered.length - 1; i >= 0; i--) {
              try { call(getAttr(entered[i], "__exit__"), [null, null, null]); }
              catch (e) { if (!(e instanceof PyRunError)) throw e; }
            }
          }
          return;
        }
        case "import":
          st.names.forEach((n) => {
            const mod = importMod(n.name);
            frame.set(n.as || n.name.split(".")[0], n.as ? mod : importMod(n.name.split(".")[0]));
          });
          return;
        case "from": {
          if (st.level) {
            // Relative import inside the in-page sandbox: there is no package
            // hierarchy to resolve against, so say so plainly.
            fail(rt.exc.ImportError, "attempted relative import with no known parent package");
          }
          const mod = importMod(st.module);
          if (st.star) {
            for (const [k, v] of mod.dict) if (k.charAt(0) !== "_") frame.set(k, v);
            return;
          }
          st.names.forEach((n) => frame.set(n.as || n.name, getAttr(mod, n.name)));
          return;
        }
        case "raise": {
          if (!st.exc) {
            // Bare `raise` re-raises whatever the enclosing `except` caught.
            const active = rt.active && rt.active.length ? rt.active[rt.active.length - 1] : null;
            if (!active) fail(rt.exc.RuntimeError, "No active exception to reraise");
            throw active;
          }
          const v = ev(st.exc, frame);
          const cause = st.cause ? safeEv(st.cause, frame) : null;
          if (v && v.kind === "inst") {
            const e = new PyRunError(v.cls, pyStr(v.dict.get("msg") || ""), v);
            e.stack = rt.stack.map((f) => ({ name: f.name, line: f.line }));
            if (cause instanceof PyRunError) { e.__cause__ = cause; e.message += " (during handling of the above exception another exception occurred)"; }
            throw e;
          }
          if (v && v.kind === "class" && isSub(v, BaseException)) {
            const inst = instantiate(v, [], new Map());
            const e = new PyRunError(v, pyStr(inst.dict.get("msg") || ""), inst);
            e.stack = rt.stack.map((f) => ({ name: f.name, line: f.line }));
            if (cause instanceof PyRunError) e.__cause__ = cause;
            throw e;
          }
          // Raising an instance whose class is not an exception is a TypeError
          // in Python; raising a bare class used to slip through.
          fail(rt.exc.TypeError, "exceptions must derive from BaseException");
        }
        case "assert":
          if (!truth(ev(st.test, frame))) fail(rt.exc.AssertionError, st.msg ? pyStr(ev(st.msg, frame)) : "");
          return;
        case "global":
        case "nonlocal":
          return;
        case "del":
          delTarget(st.target, frame);
          return;
        default:
          fail(rt.exc.SyntaxError, "cannot execute " + st.type);
      }
    }
    /* Structural pattern matching. Bindings are recorded into `out` and only
     * committed by the caller once a guard passes — CPython semantics, and it
     * stops a failed case from leaking its captures. */
    function matchPattern(pat, v, out, frame) {
      step();
      if (!pat) return false;
      switch (pat.type) {
        case "wild":
          if (pat.id) out.set(pat.id, v);
          return true;
        case "lit":
          return pyEq(safeEv(pat.expr, frame), v);
        case "capture": {
          if (pat.sub && !matchPattern(pat.sub, v, out, frame)) return false;
          out.set(pat.id, v);
          return true;
        }
        case "orpat": return pat.alts.some((a) => matchPattern(a, v, out, frame));
        case "seq": {
          const items = safeSnapshot(v);
          if (!items) return false;
          const starAt = pat.items.findIndex((p) => p.type === "wild" && p.id);
          if (starAt < 0) {
            if (items.length !== pat.items.length) return false;
            return pat.items.every((p, i) => matchPattern(p, items[i], out, frame));
          }
          const before = starAt;
          const after = pat.items.length - starAt - 1;
          if (items.length < before + after) return false;
          for (let i = 0; i < before; i++) if (!matchPattern(pat.items[i], items[i], out, frame)) return false;
          out.set(pat.items[starAt].id, items.slice(before, items.length - after));
          for (let i = 0; i < after; i++) {
            if (!matchPattern(pat.items[starAt + 1 + i], items[items.length - after + i], out, frame)) return false;
          }
          return true;
        }
        case "map": {
          if (!v || v.kind !== "dict") return false;
          for (const kp of pat.keys) {
            const key = safeEv(kp.key, frame);
            const f = dictGet(v, key);
            if (!f.ok) return false;
            if (!matchPattern(kp.value, f.v, out, frame)) return false;
          }
          return true;
        }
        case "cls": {
          let clsVal;
          try { clsVal = frame.get(pat.id); } catch (e) { return false; }
          if (!isinstance(v, clsVal)) return false;
          // `case Point(x, y)` needs positional access, which a plain `__init__`
          // class does not provide — fall back to the attributes the names match.
          const items = safeSnapshot(v);
          return (pat.args || []).every((p, i) => matchPattern(p, positionalFor(v, p, i, items), out, frame));
        }
        default: return false;
      }
    }
    /** Best-effort positional read for a class pattern: the i-th declared
     *  parameter's attribute, else the i-th iterable item. */
    function positionalFor(v, pat, i, items) {
      if (items && i < items.length) return items[i];
      const init = findClass(v.cls, "__init__");
      const paramName = init && init.params && init.params[i] && init.params[i].name;
      if (paramName && paramName !== "self" && paramName !== "cls" && v.dict.has(paramName)) return v.dict.get(paramName);
      return Symbol("nomatch");
    }
    /** Evaluate a pattern's literal sub-expression; an unknown name is a failed
     *  pattern, not an exception. */
    function safeEv(node, frame) {
      try { return ev(node, frame); } catch (e) { return Symbol("nomatch"); }
    }
    function safeSnapshot(v) {
      try { return snapshot(v); } catch (e) { return null; }
    }
    function pHasUndefined() { return false; }
    function matchesExc(err, type) {
      if (type && type.kind === "tuple") return type.items.some((t) => matchesExc(err, t));
      if (Array.isArray(type)) return type.some((t) => matchesExc(err, t));
      return isSub(err.cls, type);
    }
    function assign(target, value, frame) {
      if (!target) return;
      if (target.type === "name") { frame.set(target.id, value); return; }
      if (target.type === "tuple" || target.type === "list") {
        const items = snapshot(value);
        if (items.length !== target.elts.length) fail(rt.exc.ValueError, "expected " + target.elts.length + " values, got " + items.length);
        target.elts.forEach((el, i) => assign(el, items[i], frame));
        return;
      }
      if (target.type === "attr") { setAttr(ev(target.value, frame), target.attr, value); return; }
      if (target.type === "sub") {
        const obj = ev(target.value, frame);
        const idx = target.index;
        const key = idx && idx.type === "slice" ? null : ev(idx, frame);
        if (Array.isArray(obj)) {
          if (key !== null) { obj[indexOf(obj.length, key)] = value; return; }
          const parts = idx.parts.map((p) => (p ? ev(p, frame) : null));
          const step = parts.length > 2 && parts[2] != null ? asNum(parts[2]) : 1;
          if (step === 0) fail(rt.exc.ValueError, "slice step cannot be zero");
          // Walk the same bounds doSlice() uses so `l[1:3] = ...` replaces
          // exactly the elements a read of the same slice would return.
          const probe = doSlice(obj.length, parts, (i) => i);
          const at = probe.length ? probe[0] : (step > 0 ? obj.length : 0);
          const repl = snapshot(value);
          obj.splice(at, probe.length, ...repl);
          return;
        }
        if (obj && obj.kind === "dict") { dictSet(obj, key, value); return; }
        if (obj && obj.kind === "tuple") fail(rt.exc.TypeError, "tuple does not support item assignment");
        if (obj && obj.kind === "inst" && findClass(obj.cls, "__setitem__")) {
          call(getAttr(obj, "__setitem__"), [idx && idx.type === "slice" ? { kind: "slice", parts: idx.parts.map((p) => (p ? ev(p, frame) : null)) } : key, value], new Map());
          return;
        }
        fail(rt.exc.TypeError, typeName(obj) + " does not support item assignment");
      }
      fail(rt.exc.SyntaxError, "cannot assign to " + target.type);
    }
    function delTarget(target, frame) {
      if (target.type === "name") {
        if (frame.map.has(target.id)) frame.map.delete(target.id);
        else fail(rt.exc.NameError, "name '" + target.id + "' is not defined");
        return;
      }
      if (target.type === "sub") {
        const obj = ev(target.value, frame);
        const key = ev(target.index, frame);
        if (Array.isArray(obj)) obj.splice(indexOf(obj.length, key), 1);
        else if (obj && obj.kind === "dict") {
          const i = obj.items.findIndex(([k]) => pyEq(k, key));
          if (i < 0) fail(rt.exc.KeyError, pyRepr(key));
          obj.items.splice(i, 1);
        }
        return;
      }
      fail(rt.exc.SyntaxError, "cannot delete " + target.type);
    }

    function ev(node, frame) {
      if (!node) return null;
      rt.line = node.line || rt.line;
      if (rt.stack.length) rt.stack[rt.stack.length - 1].line = rt.line;
      switch (node.type) {
        case "num": return node.value;
        case "str": return node.value;
        // Walrus in expression position: bind in the current frame, yield the value.
        case "named": {
          const v = ev(node.value, frame);
          frame.set(node.id, v);
          return v;
        }
        case "bytes": {
          const chars = node.value;
          const arr = new Uint8Array(chars.length);
          for (let bi = 0; bi < chars.length; bi++) arr[bi] = chars.charCodeAt(bi) & 255;
          return makeBytes(arr);
        }
        case "const": return node.value;
        case "name": return frame.get(node.id);
        case "unary": return unary(node.op, ev(node.arg, frame));
        case "bin": return binOp(node.op, ev(node.left, frame), ev(node.right, frame));
        case "bool": {
          const l = ev(node.left, frame);
          if (node.op === "and") return truth(l) ? ev(node.right, frame) : l;
          return truth(l) ? l : ev(node.right, frame);
        }
        case "compare": {
          let left = ev(node.left, frame);
          for (let i = 0; i < node.ops.length; i += 2) {
            const right = ev(node.ops[i + 1], frame);
            if (!cmp(node.ops[i], left, right)) return false;
            left = right;
          }
          return true;
        }
        case "ifexp": return truth(ev(node.test, frame)) ? ev(node.body, frame) : ev(node.orelse, frame);
        case "list": return (node.elts || []).map((e) => ev(e, frame));
        case "tuple": return tuple((node.elts || []).map((e) => ev(e, frame)));
        case "set": {
          const s = { kind: "set", items: [] };
          (node.elts || []).forEach((e) => setAdd(s, ev(e, frame)));
          return s;
        }
        case "dict": {
          const d = emptyDict();
          for (let i = 0; i < node.keys.length; i++) dictSet(d, ev(node.keys[i], frame), ev(node.vals[i], frame));
          return d;
        }
        case "listcomp": return evalListComp(node, frame);
        case "setcomp": {
          const s = { kind: "set", items: [] };
          evalComp(node.gens, frame, (local) => setAdd(s, ev(node.elt, local)));
          return s;
        }
        case "dictcomp": {
          const d = emptyDict();
          evalComp(node.gens, frame, (local) => dictSet(d, ev(node.key, local), ev(node.value, local)));
          return d;
        }
        case "genexp": {
          const items = [];
          evalComp(node.gens, frame, (local) => items.push(ev(node.elt, local)));
          return { kind: "iter", items, i: 0 };
        }
        case "lambda": {
          const params = node.params.map((p) => ({ name: p.name, def: p.def ? ev(p.def, frame) : undefined, kw: !!p.kw }));
          return {
            kind: "func",
            name: "<lambda>",
            params,
            vararg: node.vararg || null,
            kwarg: node.kwarg || null,
            body: [{ type: "return", value: node.body, line: node.line }],
            env: frame,
            module: frame.module || env,
            locals: params.map((p) => p.name),
            globals: new Set(),
            line: node.line,
          };
        }
        case "fstr": return evalFStr(node.raw, frame);
        case "attr": return getAttr(ev(node.value, frame), node.attr);
        case "sub": return subscript(ev(node.value, frame), node.index, frame);
        case "slice": return node;
        case "call": return evalCall(node, frame);
        default: fail(rt.exc.SyntaxError, "cannot evaluate " + node.type);
      }
    }
    function evalCall(node, frame) {
      const fn = ev(node.func, frame);
      const args = [];
      let kwargs = new Map();
      for (const a of node.args) {
        if (a && a.star) snapshot(ev(a.star, frame)).forEach((v) => args.push(v));
        else if (a && a.starstar) {
          const d = ev(a.starstar, frame);
          if (!d || d.kind !== "dict") fail(rt.exc.TypeError, "keywords must be a dict");
          d.items.forEach(([k, v]) => kwargs.set(String(k), v));
        } else args.push(ev(a, frame));
      }
      for (const [k, v] of node.kw) kwargs.set(k, ev(v, frame));
      return call(fn, args, kwargs);
    }
    function evalComp(gens, frame, emit) {
      function rec(i, local) {
        if (i >= gens.length) { emit(local); return; }
        const g = gens[i];
        const iter = ev(g.iter, local);
        forEach(iter, (val) => {
          const child = new Env(local);
          assign(g.target, val, child);
          for (const cond of g.ifs) if (!truth(ev(cond, child))) return;
          rec(i + 1, child);
        });
      }
      rec(0, frame);
    }
    function evalListComp(node, frame) {
      const out = [];
      evalComp(node.gens, frame, (local) => out.push(ev(node.elt, local)));
      return out;
    }
    function evalFStr(raw, frame) {
      let i = 0;
      let out = "";
      while (i < raw.length) {
        if (raw[i] === "{" && raw[i + 1] === "{") { out += "{"; i += 2; continue; }
        if (raw[i] === "}" && raw[i + 1] === "}") { out += "}"; i += 2; continue; }
        if (raw[i] !== "{") { out += raw[i++]; continue; }
        i++;
        let expr = "";
        let spec = "";
        let conv = "";
        let brace = 1, bracket = 0, paren = 0, inSpec = false;
        while (i < raw.length) {
          const c = raw[i];
          if (c === "'" || c === '"') {
            const q = c;
            expr += c; i++;
            while (i < raw.length && raw[i] !== q) { expr += raw[i++]; }
            if (raw[i] === q) { expr += q; i++; }
            continue;
          }
          if (c === "{") brace++;
          if (c === "}") {
            brace--;
            if (brace === 0) { i++; break; }
          }
          if (c === "[") bracket++;
          if (c === "]") bracket--;
          if (c === "(") paren++;
          if (c === ")") paren--;
          // `!r` / `!s` / `!a` conversion, immediately before the spec or `}`.
          if (c === "!" && brace === 1 && bracket === 0 && paren === 0 && !inSpec && raw[i + 1] !== "=") {
            conv = raw[i + 1] || "s";
            i += 2;
            continue;
          }
          if (c === ":" && brace === 1 && bracket === 0 && paren === 0 && !inSpec) { inSpec = true; i++; continue; }
          if (inSpec) spec += c; else expr += c;
          i++;
        }
        let val = evalExprSrc(expr, frame);
        if (conv === "r" || conv === "a") val = pyRepr(val);
        else if (conv === "s") val = pyStr(val);
        out += formatSpec(val, spec);
      }
      return out;
    }
    function evalExprSrc(src, frame) {
      const tokens = lex(String(src).trim());
      const p = new Parser(tokens);
      const e = p.parseTest();
      return ev(e, frame);
    }
    /** One format spec: `[[fill]align][sign][#][0][width][,][.precision][type]`.
     *  Covers the specs real code reaches for — `>10`, `<-8`, `^`, `08.2f`,
     *  `+d`, `,`, `x`, `%`, `s` — instead of silently falling back to str(). */
    function formatSpec(val, spec) {
      spec = String(spec || "");
      if (!spec) return typeof val === "string" ? val : pyStr(val);
      const m = spec.match(/^(?:(.)?([<>^]))?([-+ ])?(#)?(0)?(\d+)?(,)?(?:\.(\d+))?([bcdeEfFgGnosxX%])?$/);
      if (!m) fail(rt.exc.ValueError, "Unknown format code '" + spec + "'");
      const fill = m[1] || (m[4] ? "0" : " ");
      const align = m[2] || (m[4] ? ">" : null);
      const sign = m[3] || "";
      const alt = m[4];
      const zero = m[5];
      const width = m[6] ? Number(m[6]) : 0;
      const comma = m[7];
      const prec = m[8] === undefined ? undefined : Number(m[8]);
      const type = m[9] || "";
      let out;
      switch (type) {
        case "f": case "F": out = asNum(val).toFixed(prec === undefined ? 6 : prec); break;
        case "e": out = asNum(val).toExponential(prec === undefined ? 6 : prec); break;
        case "E": out = asNum(val).toExponential(prec === undefined ? 6 : prec).toUpperCase(); break;
        case "g": out = String(Number(asNum(val).toPrecision(prec === undefined ? 6 : prec))); break;
        case "d": out = String(Math.trunc(asNum(val))); break;
        case "b": out = (Math.trunc(asNum(val)) >>> 0).toString(2); break;
        case "o": out = (Math.trunc(asNum(val)) >>> 0).toString(8); break;
        case "x": out = (Math.trunc(asNum(val)) >>> 0).toString(16); if (alt) out = "0x" + out; break;
        case "X": out = (Math.trunc(asNum(val)) >>> 0).toString(16).toUpperCase(); if (alt) out = "0X" + out; break;
        case "%": out = (asNum(val) * 100).toFixed(prec === undefined ? 6 : prec) + "%"; break;
        case "c": out = typeof val === "string" ? val : String.fromCodePoint(asNum(val)); break;
        default: out = typeof val === "string" ? val : pyStr(val);
      }
      if (comma && "dfeEgG".includes(type)) {
        const neg = out.startsWith("-");
        const digits = (neg ? out.slice(1) : out).split(".");
        digits[0] = digits[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        out = (neg ? "-" : "") + digits.join(".");
      }
      if (/[diouxXeEfFgG%]/.test(type) && (typeof val === "number" || typeof val === "boolean")) {
        const n = asNum(val);
        if (sign === "+" && n >= 0) out = "+" + out;
        else if (sign === " " && n >= 0) out = " " + out;
      }
      if (width > out.length) {
        const a = align || (zero && type ? ">" : ">");
        if (a === "<") out = out + fill.repeat(width - out.length);
        else if (a === "^") {
          const left = Math.floor((width - out.length) / 2);
          out = fill.repeat(left) + out + fill.repeat(width - out.length - left);
        } else if (fill === "0" && /^-?\d/.test(out)) {
          out = out[0] === "-" ? "-" + "0".repeat(width - out.length) + out.slice(1) : "0".repeat(width - out.length) + out;
        } else out = fill.repeat(width - out.length) + out;
      }
      return out;
    }
    /** `"{} {key} {0[1]} {x:.2f}".format(...)` — positional, keyword and
     *  attribute/item access. Unknown fields raise, as they do in CPython. */
    function strFormat(fmt, args, kwargs) {
      const positional = Array.isArray(args) ? args : args == null ? [] : args.kind === "tuple" ? args.items : [args];
      let auto = 0;
      return String(fmt).replace(/\{\{|\}\}|\{([^{}]*)\}/g, (all, field) => {
        if (all === "{{") return "{";
        if (all === "}}") return "}";
        let name = field, spec = "", conv = "";
        const ci = field.indexOf(":");
        if (ci >= 0) { name = field.slice(0, ci); spec = field.slice(ci + 1); }
        const cj = name.indexOf("!");
        if (cj >= 0) { conv = name.slice(cj + 1); name = name.slice(0, cj); }
        const path = name.split(".");
        let v;
        const head = path[0];
        if (/^\d+$/.test(head)) v = positional[Number(head)];
        else if (head === "") v = positional[auto++];
        else {
          const f = kwargs ? dictLookup(kwargs, head) : { ok: false };
          if (!f.ok) fail(rt.exc.KeyError, head);
          v = f.v;
        }
        for (const part of path.slice(1)) {
          v = /^\d+$/.test(part) ? subscript(v, { type: "num", value: Number(part) }) : getAttr(v, part);
        }
        if (conv === "r") v = pyRepr(v);
        else if (conv === "s") v = pyStr(v);
        return formatSpec(v, spec);
      });
    }
    function unary(op, v) {
      if (op === "not") return !truth(v);
      if (op === "+") return asNum(v);
      if (op === "-") return -asNum(v);
      if (op === "~") return ~asNum(v);
      fail(rt.exc.TypeError, "bad unary " + op);
    }
    function binOp(op, a, b) {
      if (op === "+") {
        if (typeof a === "string" || typeof b === "string") return pyStr(a) + (typeof b === "string" ? b : pyStr(b));
        if (Array.isArray(a) && Array.isArray(b)) return a.concat(b);
        if (a && b && a.kind === "bytes" && b.kind === "bytes") {
          const data = new Uint8Array(a.data.length + b.data.length);
          data.set(a.data, 0); data.set(b.data, a.data.length);
          return makeBytes(data);
        }
        if (a && b && a.kind === "tuple" && b.kind === "tuple") return tuple(a.items.concat(b.items));
        if (a && b && isSet(a) && isSet(b)) return setFrom(a.items.concat(b.items));
        return asNum(a) + asNum(b);
      }
      if (op === "-") {
        if (a && b && isSet(a) && isSet(b)) return setFrom(a.items.filter((x) => !b.items.some((y) => pyEq(x, y))));
        if (a && b && a.kind === "dict" && b.kind === "dict") return setFrom(a.items.filter(([k]) => !dictGet(b, k).ok).map(([k]) => k));
        return asNum(a) - asNum(b);
      }
      if (op === "*") {
        if (typeof a === "string" && typeof b === "number") return a.repeat(asNum(b));
        if (typeof b === "string" && typeof a === "number") return b.repeat(asNum(a));
        if (Array.isArray(a) && typeof b === "number") return repeatList(a, asNum(b));
        if (Array.isArray(b) && typeof a === "number") return repeatList(b, asNum(a));
        if (a && b && a.kind === "tuple" && typeof b === "number") return tuple(repeatList(a.items, asNum(b)));
        if (a && b && a.kind === "tuple" && b.kind === "tuple") return tuple(a.items.concat(b.items));
        return asNum(a) * asNum(b);
      }
      if (op === "/") {
        const n = asNum(b);
        if (n === 0) fail(rt.exc.ZeroDivisionError, "division by zero");
        return asNum(a) / n;
      }
      if (op === "//") {
        const n = asNum(b);
        if (n === 0) fail(rt.exc.ZeroDivisionError, "division by zero");
        return Math.floor(asNum(a) / n);
      }
      if (op === "%") {
        // `"%s=%d" % (k, v)` is old but still everywhere. Implement the common
        // conversion set instead of raising "printf formatting is not supported".
        if (typeof a === "string") return printfFormat(a, b);
        const n = asNum(b);
        if (n === 0) fail(rt.exc.ZeroDivisionError, "modulo by zero");
        let r = asNum(a) % n;
        if (r !== 0 && (r > 0) !== (n > 0)) r += n;
        return r;
      }
      if (op === "**") return asNum(a) ** asNum(b);
      if (op === "&") {
        if (a && b && isSet(a) && isSet(b)) return setFrom(a.items.filter((x) => b.items.some((y) => pyEq(x, y))));
        if (a && b && a.kind === "dict" && b.kind === "dict") return setFrom(a.items.filter(([k]) => dictGet(b, k).ok).map(([k]) => k));
        return asNum(a) & asNum(b);
      }
      if (op === "|") {
        if (a && b && isSet(a) && isSet(b)) return setFrom(a.items.concat(b.items));
        return asNum(a) | asNum(b);
      }
      if (op === "^") {
        if (a && b && isSet(a) && isSet(b)) {
          const inB = (x) => b.items.some((y) => pyEq(x, y));
          return setFrom(a.items.filter((x) => !inB(x)).concat(b.items.filter((x) => !a.items.some((y) => pyEq(x, y)))));
        }
        return asNum(a) ^ asNum(b);
      }
      if (op === "<<") return asNum(a) << asNum(b);
      if (op === ">>") return asNum(a) >> asNum(b);
      fail(rt.exc.TypeError, "unsupported operand " + op);
    }
    function setFrom(items) {
      const s = { kind: "set", items: [] };
      items.forEach((v) => setAdd(s, v));
      return s;
    }
    function isSet(v) { return !!v && (v.kind === "set" || v.kind === "frozenset"); }
    /** `"%s=%.2f" % (k, v)` — supports s d i f e g x o c r % and the `%(name)s`
     *  mapping form, which is the only one `logging`/`gettext` code uses. */
    function printfFormat(fmt, arg) {
      const mapping = arg && arg.kind === "dict";
      const args = mapping ? null : (arg && arg.kind === "tuple" ? arg.items : [arg]);
      let ai = 0;
      return String(fmt).replace(/%(?:\(([^)]*)\))?([-+ #0]*)(\d+|\*)?(?:\.(\d+|\*))?([diouxXeEfFgGcrsa%])/g, (all, key, flags, widthRaw, precRaw, conv) => {
        if (conv === "%") return "%";
        let v;
        if (mapping) {
          const f = dictGet(arg, key);
          if (!f.ok) fail(rt.exc.TypeError, "format requires a mapping");
          v = f.v;
        } else {
          if (ai >= (args || []).length) fail(rt.exc.TypeError, "not enough arguments for format string");
          v = args[ai++];
        }
        let out;
        switch (conv) {
          case "d": case "i": case "u": out = String(Math.trunc(asNum(v))); break;
          case "f": case "F": out = asNum(v).toFixed(precRaw === undefined ? 6 : Number(precRaw)); break;
          case "e": case "E": {
            out = asNum(v).toExponential(precRaw === undefined ? 6 : Number(precRaw));
            if (conv === "E") out = out.toUpperCase();
            break;
          }
          case "g": case "G": out = String(Number(asNum(v).toPrecision(precRaw === undefined ? 6 : Number(precRaw)))); break;
          case "x": out = (asNum(v) >>> 0).toString(16); break;
          case "X": out = (asNum(v) >>> 0).toString(16).toUpperCase(); break;
          case "o": out = (asNum(v) >>> 0).toString(8); break;
          case "c": out = typeof v === "string" ? v : String.fromCodePoint(asNum(v)); break;
          case "r": out = pyRepr(v); break;
          case "a": out = pyRepr(v); break;
          default: out = typeof v === "string" ? v : pyStr(v);
        }
        const width = widthRaw === undefined ? 0 : Number(widthRaw);
        if (width > out.length) {
          const pad = (flags || "").includes("0") && "diouxXeEfFgG".includes(conv) ? "0" : " ";
          if ((flags || "").includes("-")) out = out + " ".repeat(width - out.length);
          else if (conv === "s" && (flags || "").includes("0")) out = out + " ".repeat(width - out.length);
          else if (pad === "0" && /^-?\d/.test(out)) out = out.replace("-", "-") + "0".repeat(width - out.length);
          else out = " ".repeat(width - out.length) + out;
        }
        return out;
      });
    }
    function repeatList(arr, n) {
      const out = [];
      for (let i = 0; i < n; i++) out.push(...arr);
      return out;
    }
    function order(a, b) {
      if (typeof a === "number" && typeof b === "number") return a === b ? 0 : a < b ? -1 : 1;
      if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
      const as = pyStr(a), bs = pyStr(b);
      return as < bs ? -1 : as > bs ? 1 : 0;
    }
    function cmp(op, a, b) {
      if (op === "==") return pyEq(a, b);
      if (op === "!=") return !pyEq(a, b);
      if (op === "is") return a === b || (a == null && b == null);
      if (op === "isnot") return !(a === b || (a == null && b == null));
      if (op === "in") return contains(b, a);
      if (op === "notin") return !contains(b, a);
      if (typeof a === "string" && typeof b === "string") {
        if (op === "<") return a < b;
        if (op === ">") return a > b;
        if (op === "<=") return a <= b;
        if (op === ">=") return a >= b;
      }
      // Set and frozenset relations are proper subset/superset tests, not
      // numeric comparisons.
      if (isSet(a) && isSet(b)) {
        const inB = (x) => b.items.some((y) => pyEq(x, y));
        const subset = a.items.every(inB);
        const superset = b.items.every((x) => a.items.some((y) => pyEq(x, y)));
        if (op === "<") return subset && !superset;
        if (op === "<=") return subset;
        if (op === ">") return superset && !subset;
        if (op === ">=") return superset;
      }
      const x = asNum(a), y = asNum(b);
      if (op === "<") return x < y;
      if (op === ">") return x > y;
      if (op === "<=") return x <= y;
      if (op === ">=") return x >= y;
      return false;
    }
    function contains(hay, needle) {
      if (typeof hay === "string") return typeof needle === "string" && hay.includes(needle);
      if (Array.isArray(hay)) return hay.some((x) => pyEq(x, needle));
      if (hay && hay.kind === "tuple") return hay.items.some((x) => pyEq(x, needle));
      if (isSet(hay)) return hay.items.some((x) => pyEq(x, needle));
      if (hay && hay.kind === "dict") return dictGet(hay, needle).ok;
      if (hay && hay.kind === "inst") {
        const c = findClass(hay.cls, "__contains__");
        if (c) return truth(call(getAttr(hay, "__contains__"), [needle], new Map()));
        if (findClass(hay.cls, "__iter__")) return forEachBool(hay, (x) => pyEq(x, needle));
        if (findClass(hay.cls, "__getitem__")) {
          // Legacy iteration protocol: index until IndexError.
          for (let i = 0; i < 1000000; i++) {
            let item;
            try { item = call(getAttr(hay, "__getitem__"), [i], new Map()); }
            catch (e) { if (isIndexStop(e)) return false; throw e; }
            if (pyEq(item, needle)) return true;
          }
          return false;
        }
      }
      if (hay && hay.kind === "bytes" && hay && needle && needle.kind === "bytes") {
        const h = hay.data, n = needle.data;
        outer: for (let i = 0; i + n.length <= h.length; i++) {
          for (let j = 0; j < n.length; j++) if (h[i + j] !== n[j]) continue outer;
          return true;
        }
        return false;
      }
      if (hay && hay.kind === "range") return snapshot(hay).some((x) => pyEq(x, needle));
      fail(rt.exc.TypeError, "argument of type " + typeName(hay) + " is not iterable");
    }
    function isIndexStop(e) {
      return e instanceof PyRunError && isSub(e.cls, rt.exc.IndexError);
    }
    function forEachBool(v, fn) {
      let found = false;
      forEach(v, (item) => { if (!found && fn(item)) found = true; });
      return found;
    }
    function dunderLen(v) {
      if (v && v.kind === "inst") {
        const f = findClass(v.cls, "__len__");
        if (f) return asNum(call(getAttr(v, "__len__"), [], new Map()));
      }
      return null;
    }
    function subscript(obj, index, frame) {
      if (index && index.type === "slice") {
        const parts = index.parts.map((p) => (p ? ev(p, frame) : null));
        if (typeof obj === "string") return doSlice(obj.length, parts, (i) => obj[i]).join("");
        if (Array.isArray(obj)) return doSlice(obj.length, parts, (i) => obj[i]);
        if (obj && obj.kind === "tuple") return tuple(doSlice(obj.items.length, parts, (i) => obj.items[i]));
        if (obj && obj.kind === "bytes") return makeBytes(doSlice(obj.data.length, parts, (i) => obj.data[i]));
        fail(rt.exc.TypeError, typeName(obj) + " is not sliceable");
      }
      const key = ev(index, frame);
      return subscriptRaw(obj, key);
    }
    /** Item lookup on an already-evaluated key. Split out of `subscript` so
     *  operators (operator.itemgetter) and builtins can share it. */
    function subscriptRaw(obj, key) {
      if (obj && obj.kind === "inst" && findClass(obj.cls, "__getitem__")) {
        return call(getAttr(obj, "__getitem__"), [key], new Map());
      }
      if (typeof obj === "string") return obj[indexOf(obj.length, key)];
      if (Array.isArray(obj)) return obj[indexOf(obj.length, key)];
      if (obj && obj.kind === "tuple") return obj.items[indexOf(obj.items.length, key)];
      if (obj && obj.kind === "bytes") return obj.data[indexOf(obj.data.length, key)];
      if (obj && obj.kind === "dict") {
        const f = dictGet(obj, key);
        // defaultdict: a missing key is materialised from the factory instead of
        // raising KeyError.
        if (!f.ok) {
          if (!obj.factory) fail(rt.exc.KeyError, pyRepr(key));
          const made = call(obj.factory, [], new Map());
          dictSet(obj, key, made);
          return made;
        }
        return f.v;
      }
      fail(rt.exc.TypeError, typeName(obj) + " is not subscriptable");
    }

    function setAdd(s, v) {
      if (!s.items.some((x) => pyEq(x, v))) s.items.push(v);
    }

    const NUM_METHODS = {
      bit_length: (a) => {
        let n = Math.abs(Math.trunc(asNum(a[0])));
        let bits = 0;
        while (n > 0) { bits++; n = Math.floor(n / 2); }
        return bits;
      },
      bit_count: (a) => {
        let n = Math.abs(Math.trunc(asNum(a[0])));
        let bits = 0;
        while (n > 0) { bits += n & 1; n = Math.floor(n / 2); }
        return bits;
      },
      to_bytes: (a) => {
        const n = Math.trunc(asNum(a[0]));
        const len = a[1] == null ? Math.max(1, Math.ceil((NUM_METHODS.bit_length([n]) + 7) / 8)) : asNum(a[1]);
        const little = pyStr(a[3] || "big") === "little";
        const out = new Uint8Array(len);
        let v = BigInt(n);
        const big = BigInt(1) << BigInt(8 * len);
        let norm = ((v % big) + big) % big;
        for (let i = len - 1; i >= 0; i--) { out[i] = Number(norm & 255n); norm >>= 8n; }
        if (little) out.reverse();
        return makeBytes(out);
      },
      is_integer: (a) => Number.isInteger(a[0]),
      is_real: () => true,
      conjugate: (a) => asNum(a[0]),
      as_integer_ratio: (a) => tuple([Math.trunc(asNum(a[0])), 1]),
      hex: (a) => "0x" + Math.trunc(asNum(a[0])).toString(16),
      real: (a) => asNum(a[0]),
      imag: () => 0,
    };

    const STR_METHODS = {
      startswith: (args) => {
        const self = args[0];
        const p = args[1];
        const list = p && p.kind === "tuple" ? p.items : Array.isArray(p) ? p : [p];
        return list.some((x) => self.startsWith(String(x)));
      },
      endswith: (args) => {
        const self = args[0];
        const p = args[1];
        const list = p && p.kind === "tuple" ? p.items : Array.isArray(p) ? p : [p];
        return list.some((x) => self.endsWith(String(x)));
      },
      strip: (args) => args[0].trim(),
      lstrip: (args) => (args[1] != null ? trimChars(args[0], pyStr(args[1]), "l") : args[0].trimStart()),
      rstrip: (args) => (args[1] != null ? trimChars(args[0], pyStr(args[1]), "r") : args[0].trimEnd()),
      lower: (args) => args[0].toLowerCase(),
      upper: (args) => args[0].toUpperCase(),
      split: (args) => {
        const self = args[0];
        if (args[1] == null) return self.trim().length ? self.trim().split(/\s+/) : [];
        const sep = String(args[1]);
        const max = args[2] == null ? -1 : asNum(args[2]);
        if (max < 0) return self.split(sep);
        const out = [];
        let rest = self;
        for (let n = 0; n < max; n++) {
          const i = rest.indexOf(sep);
          if (i < 0) break;
          out.push(rest.slice(0, i));
          rest = rest.slice(i + sep.length);
        }
        out.push(rest);
        return out;
      },
      join: (args) => snapshot(args[1]).map((x) => (typeof x === "string" ? x : pyStr(x))).join(args[0]),
      replace: (args) => {
        const count = args[3] == null ? -1 : asNum(args[3]);
        const a = String(args[1]), b = String(args[2]);
        if (count < 0) return args[0].split(a).join(b);
        let out = "", rest = args[0], n = 0;
        while (n < count) {
          const i = rest.indexOf(a);
          if (i < 0) break;
          out += rest.slice(0, i) + b;
          rest = rest.slice(i + a.length);
          n++;
        }
        return out + rest;
      },
      find: (args) => args[0].indexOf(String(args[1])),
      rfind: (args) => args[0].lastIndexOf(String(args[1])),
      index: (args) => {
        const i = args[0].indexOf(String(args[1]));
        if (i < 0) fail(rt.exc.ValueError, "substring not found");
        return i;
      },
      count: (args) => args[0].split(String(args[1])).length - 1,
      encode: (args) => makeBytes(toUtf8(args[0])),
      isdigit: (args) => args[0].length > 0 && /^\d+$/.test(args[0]),
      isalpha: (args) => args[0].length > 0 && /^\p{L}+$/u.test(args[0]),
      isalnum: (args) => args[0].length > 0 && /^[\p{L}\d]+$/u.test(args[0]),
      isspace: (args) => args[0].length > 0 && /^\s+$/.test(args[0]),
      isupper: (args) => /\p{L}/u.test(args[0]) && args[0] === args[0].toUpperCase(),
      islower: (args) => /\p{L}/u.test(args[0]) && args[0] === args[0].toLowerCase(),
      zfill: (args) => {
        const w = asNum(args[1]);
        const s = args[0];
        return s.length >= w ? s : (s.startsWith("-") || s.startsWith("+") ? s[0] + "0".repeat(w - s.length) + s.slice(1) : "0".repeat(w - s.length) + s);
      },
      title: (args) => args[0].replace(/\p{L}[\p{L}']*/gu, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()),
      capitalize: (args) => (args[0] ? args[0][0].toUpperCase() + args[0].slice(1).toLowerCase() : args[0]),
      casefold: (args) => args[0].toLowerCase(),
      center: (args) => padTo(args[0], asNum(args[1]), args[2] == null ? " " : pyStr(args[2]), "center"),
      ljust: (args) => padTo(args[0], asNum(args[1]), args[2] == null ? " " : pyStr(args[2]), "left"),
      rjust: (args) => padTo(args[0], asNum(args[1]), args[2] == null ? " " : pyStr(args[2]), "right"),
      removeprefix: (args) => (args[0].startsWith(pyStr(args[1])) ? args[0].slice(pyStr(args[1]).length) : args[0]),
      removesuffix: (args) => (args[0].endsWith(pyStr(args[1])) ? args[0].slice(0, args[0].length - pyStr(args[1]).length) : args[0]),
      partition: (args) => {
        const s = args[0], sep = pyStr(args[1]);
        const i = s.indexOf(sep);
        return i < 0 ? [s, "", ""] : [s.slice(0, i), sep, s.slice(i + sep.length)];
      },
      rpartition: (args) => {
        const s = args[0], sep = pyStr(args[1]);
        const i = s.lastIndexOf(sep);
        return i < 0 ? ["", "", s] : [s.slice(0, i), sep, s.slice(i + sep.length)];
      },
      expandtabs: (args) => args[0].replace(/\t/g, " ".repeat(args[1] == null ? 8 : asNum(args[1]))),
      splitlines: (args) => {
        if (args[0] === "") return [];
        const lines = args[0].split(/\r\n|\r|\n/);
        if (lines[lines.length - 1] === "") lines.pop();
        return args[1] ? lines.map((l, i) => (i < lines.length - 1 ? l + "\n" : l)) : lines;
      },
      isascii: (args) => /^[\x00-\x7f]*$/.test(args[0]),
      maketrans: (args) => ({ kind: "trans", map: new Map() }),
      format: (args, kwargs) => strFormat(args[0], args.slice(1), kwargs && kwargs.size ? kwargs : null),
      format_map: (args) => {
        const m = args[1];
        if (!m || m.kind !== "dict") fail(rt.exc.TypeError, "format_map() requires a dict");
        return String(args[0]).replace(/\{([^{}]*)\}/g, (all, key) => {
          const f = dictGet(m, key);
          if (!f.ok) fail(rt.exc.KeyError, key);
          return pyStr(f.v);
        });
      },
      format_spec: (args) => formatSpec(args[0], args[1] == null ? "" : pyStr(args[1])),
    };
    function padTo(s, width, fill, side) {
      if (s.length >= width) return s;
      if (fill.length === 0) fail(rt.exc.ValueError, "fill character must be exactly one character long");
      const n = width - s.length;
      if (side === "left") return s + fill.repeat(n);
      if (side === "right") return fill.repeat(n) + s;
      const left = Math.floor(n / 2);
      return fill.repeat(left) + s + fill.repeat(n - left);
    }
    function trimChars(s, chars, side) {
      const set = new Set(chars);
      let a = 0, b = s.length;
      if (side !== "r") while (a < b && set.has(s[a])) a++;
      if (side !== "l") while (b > a && set.has(s[b - 1])) b--;
      return s.slice(a, b);
    }
    const LIST_METHODS = {
      append: (args) => { args[0].push(args[1]); return null; },
      extend: (args) => { snapshot(args[1]).forEach((v) => args[0].push(v)); return null; },
      pop: (args) => {
        const i = args[1] == null ? args[0].length - 1 : indexOf(args[0].length, args[1]);
        if (!args[0].length) fail(rt.exc.IndexError, "pop from empty list");
        return args[0].splice(i, 1)[0];
      },
      insert: (args) => { args[0].splice(asNum(args[1]), 0, args[2]); return null; },
      remove: (args) => {
        const i = args[0].findIndex((x) => pyEq(x, args[1]));
        if (i < 0) fail(rt.exc.ValueError, "list.remove(x): x not in list");
        args[0].splice(i, 1); return null;
      },
      index: (args) => {
        const i = args[0].findIndex((x) => pyEq(x, args[1]));
        if (i < 0) fail(rt.exc.ValueError, "not in list");
        return i;
      },
      count: (args) => args[0].filter((x) => pyEq(x, args[1])).length,
      sort: (args) => { args[0].sort((a, b) => pyStr(a) < pyStr(b) ? -1 : pyStr(a) > pyStr(b) ? 1 : 0); return null; },
      reverse: (args) => { args[0].reverse(); return null; },
      copy: (args) => args[0].slice(),
      clear: (args) => { args[0].length = 0; return null; },
    };
    const DICT_METHODS = {
      get: (args) => { const f = dictGet(args[0], args[1]); return f.ok ? f.v : (args.length > 2 ? args[2] : null); },
      setdefault: (args) => {
        const f = dictGet(args[0], args[1]);
        if (f.ok) return f.v;
        const v = args.length > 2 ? args[2] : null;
        dictSet(args[0], args[1], v);
        return v;
      },
      keys: (args) => args[0].items.map(([k]) => k),
      values: (args) => args[0].items.map(([, v]) => v),
      items: (args) => args[0].items.map(([k, v]) => tuple([k, v])),
      update: (args) => {
        const other = args[1];
        if (other && other.kind === "dict") other.items.forEach(([k, v]) => dictSet(args[0], k, v));
        return null;
      },
      pop: (args) => {
        const i = args[0].items.findIndex(([k]) => pyEq(k, args[1]));
        if (i < 0) { if (args.length > 2) return args[2]; fail(rt.exc.KeyError, pyRepr(args[1])); }
        return args[0].items.splice(i, 1)[0][1];
      },
      clear: (args) => { args[0].items.length = 0; return null; },
      copy: (args) => ({ kind: "dict", items: args[0].items.map(([k, v]) => [k, v]) }),
    };
    const SET_METHODS = {
      add: (args) => { setAdd(args[0], args[1]); return null; },
      clear: (args) => { args[0].items.length = 0; return null; },
      remove: (args) => {
        const i = args[0].items.findIndex((x) => pyEq(x, args[1]));
        if (i < 0) fail(rt.exc.KeyError, pyRepr(args[1]));
        args[0].items.splice(i, 1); return null;
      },
      discard: (args) => {
        const i = args[0].items.findIndex((x) => pyEq(x, args[1]));
        if (i >= 0) args[0].items.splice(i, 1);
        return null;
      },
    };
    const TUPLE_METHODS = {
      count: (args) => args[0].items.filter((x) => pyEq(x, args[1])).length,
      index: (args) => {
        const i = args[0].items.findIndex((x) => pyEq(x, args[1]));
        if (i < 0) fail(rt.exc.ValueError, "not in tuple");
        return i;
      },
    };
    const BYTES_METHODS = {
      decode: (args) => {
        const errors = args[2] == null ? "strict" : pyStr(args[2]);
        try { return fromUtf8(args[0].data, errors === "strict"); }
        catch (e) { fail(rt.exc.ValueError, "invalid bytes"); }
      },
      startswith: (args) => {
        const self = args[0].data;
        const prefs = args[1] && args[1].kind === "tuple" ? args[1].items : [args[1]];
        return prefs.some((p) => {
          const d = p.kind === "bytes" ? p.data : toUtf8(pyStr(p));
          if (d.length > self.length) return false;
          for (let i = 0; i < d.length; i++) if (self[i] !== d[i]) return false;
          return true;
        });
      },
      lower: (args) => makeBytes(Array.from(args[0].data, (b) => (b >= 65 && b <= 90 ? b + 32 : b))),
      lstrip: (args) => {
        const d = args[0].data;
        let i = 0;
        while (i < d.length && d[i] <= 32) i++;
        return makeBytes(d.slice(i));
      },
      rstrip: (args) => {
        const d = args[0].data;
        let i = d.length;
        while (i > 0 && d[i - 1] <= 32) i--;
        return makeBytes(d.slice(0, i));
      },
      strip: (args) => BYTES_METHODS.rstrip([BYTES_METHODS.lstrip(args)]),
      hex: (args) => Array.from(args[0].data, (b) => b.toString(16).padStart(2, "0")).join(""),
    };
    const MATCH_METHODS = {
      group: (args) => {
        const m = args[0];
        const n = args.length > 1 && args[1] != null ? asNum(args[1]) : 0;
        if (n < 0 || n >= m.groups.length || m.groups[n] == null) return n === 0 ? m.groups[0] : null;
        return m.groups[n];
      },
      groups: (args) => tuple(args[0].groups.slice(1).map((g) => (g == null ? null : g))),
    };
    const RE_METHODS = {
      findall: (args) => reFindall(args[0], pyStr(args[1])),
      finditer: (args) => reFinditer(args[0], pyStr(args[1])),
      search: (args) => reSearch(args[0], pyStr(args[1])),
      match: (args) => reMatch(args[0], pyStr(args[1])),
      sub: (args, kwargs) => reSub(args[0], args[1], pyStr(args[2])),
    };
    const FILE_METHODS = {
      read: (args) => fileRead(args[0]),
      write: (args) => { fileWrite(args[0], args[1]); return null; },
      close: (args) => { args[0].closed = true; return null; },
      __enter__: (args) => args[0],
      __exit__: (args) => { args[0].closed = true; return null; },
      __iter__: (args) => ({ kind: "iter", items: fileLines(args[0]), i: 0 }),
    };

    function normPath(p) {
      let s = String(p).replace(/\\/g, "/");
      if (!s.startsWith("/")) s = "/" + s.replace(/^\.\//, "");
      const parts = [];
      for (const part of s.split("/")) {
        if (!part || part === ".") continue;
        if (part === "..") parts.pop();
        else parts.push(part);
      }
      return "/" + parts.join("/");
    }
    function ensureParent(path) {
      const parts = path.split("/").filter(Boolean);
      let cur = "";
      for (let i = 0; i < parts.length - 1; i++) {
        cur += "/" + parts[i];
        rt.dirs.add(cur);
      }
    }
    function fileRead(f) {
      if (f.bin) return makeBytes(f.data instanceof Uint8Array ? f.data : toUtf8(String(f.data || "")));
      return typeof f.data === "string" ? f.data : fromUtf8(f.data);
    }
    function fileWrite(f, data) {
      if (f.bin) {
        const bytes = data && data.kind === "bytes" ? data.data : toUtf8(pyStr(data));
        if (f.mode.includes("a") && f.data) {
          const prev = f.data instanceof Uint8Array ? f.data : toUtf8(String(f.data));
          const next = new Uint8Array(prev.length + bytes.length);
          next.set(prev, 0); next.set(bytes, prev.length);
          f.data = next;
        } else f.data = bytes;
      } else {
        const text = typeof data === "string" ? data : pyStr(data);
        f.data = f.mode.includes("a") ? String(f.data || "") + text : text;
      }
      rt.fs.set(f.path, f.data);
    }
    function fileLines(f) {
      const text = typeof f.data === "string" ? f.data : fromUtf8(f.data instanceof Uint8Array ? f.data : new Uint8Array());
      if (!text) return [];
      const lines = text.split("\n");
      return lines.map((ln, i) => (i < lines.length - 1 ? ln + "\n" : ln)).filter((ln, i) => ln.length || i < lines.length - 1);
    }
    function openFile(args, kwargs) {
      const path = normPath(pyStr(args[0]));
      const mode = args[1] != null ? pyStr(args[1]) : "r";
      const bin = mode.includes("b");
      const exists = rt.fs.has(path);
      if ((mode.includes("r")) && !mode.includes("w") && !mode.includes("+") && !mode.includes("a") && !exists) {
        fail(rt.exc.FileNotFoundError, "no such file: " + path);
      }
      ensureParent(path);
      rt.dirs.add(path.split("/").slice(0, -1).join("/") || "/");
      let data = exists ? rt.fs.get(path) : (bin ? new Uint8Array() : "");
      if (mode.includes("w")) data = bin ? new Uint8Array() : "";
      rt.fs.set(path, data);
      return { kind: "file", path, mode, bin, data, closed: false };
    }

    function parsedReplace(args, kwargs) {
      const self = args[0];
      const fields = Object.assign({}, self.fields);
      for (const [k, v] of kwargs) fields[k] = v == null ? "" : pyStr(v);
      return makeParsed(fields);
    }
    function makeParsed(fields) {
      const host = String(fields.netloc || "");
      const hostname = host.includes("@") ? host.split("@").pop().split(":")[0] : host.split(":")[0];
      fields.hostname = hostname;
      return { kind: "parsed", fields };
    }
    function urlparse(url) {
      const s = String(url);
      const m = s.match(/^(([^:/?#]+):)?(\/\/([^/?#]*))?([^?#]*)(\?([^#]*))?(#(.*))?/);
      return makeParsed({
        scheme: m[2] || "",
        netloc: m[4] || "",
        path: m[5] || "",
        params: "",
        query: m[7] || "",
        fragment: m[9] || "",
      });
    }
    function urlunparse(p) {
      const f = p && p.kind === "parsed" ? p.fields : null;
      if (!f) fail(rt.exc.TypeError, "urlunparse expects a ParseResult");
      let out = "";
      if (f.scheme) out += f.scheme + ":";
      if (f.netloc || f.scheme) out += "//" + (f.netloc || "");
      out += f.path || "";
      if (f.query) out += "?" + f.query;
      if (f.fragment) out += "#" + f.fragment;
      return out;
    }

    function jsFlags(flags) {
      let f = "";
      const n = typeof flags === "number" ? flags : 0;
      if (n & 2) f += "i";
      if (n & 8) f += "m";
      if (n & 16) f += "s";
      return f;
    }
    function compilePat(pat, flags) {
      let src = String(pat);
      let fl = jsFlags(flags);
      const inline = src.match(/^\(\?([aiLmsux]+)\)/);
      if (inline) {
        if (inline[1].includes("i")) fl += "i";
        if (inline[1].includes("m")) fl += "m";
        if (inline[1].includes("s")) fl += "s";
        src = src.slice(inline[0].length);
      }
      src = src.replace(/\(\?P<[^>]+>/g, "(");
      try {
        new RegExp(src, fl);
      } catch (e) {
        fail(rt.exc.ValueError, "bad pattern");
      }
      return { kind: "re", src, flags: fl };
    }
    function reExecAll(reobj, text) {
      const re = new RegExp(reobj.src, reobj.flags.includes("g") ? reobj.flags : reobj.flags + "g");
      const out = [];
      let m;
      while ((m = re.exec(text))) {
        out.push(m);
        if (m[0] === "") re.lastIndex++;
        if (out.length > 100000) break;
      }
      return out;
    }
    function asMatch(m) {
      return { kind: "match", groups: m.slice(0, m.length) };
    }
    function groupCount(reobj) {
      try { return new RegExp(reobj.src + "|").exec("").length - 1; }
      catch { return 0; }
    }
    function reFindall(reobj, text) {
      const ms = reExecAll(reobj, text);
      const groups = groupCount(reobj);
      if (groups <= 0) return ms.map((m) => m[0]);
      if (groups === 1) return ms.map((m) => (m[1] == null ? "" : m[1]));
      return ms.map((m) => tuple(m.slice(1, groups + 1).map((g) => (g == null ? null : g))));
    }
    function reFinditer(reobj, text) {
      return reExecAll(reobj, text).map(asMatch);
    }
    function reSearch(reobj, text) {
      const m = new RegExp(reobj.src, reobj.flags).exec(text);
      return m ? asMatch(m) : null;
    }
    function reMatch(reobj, text) {
      const m = new RegExp("^(?:" + reobj.src + ")", reobj.flags).exec(text);
      return m ? asMatch(m) : null;
    }
    function reSub(reobj, repl, text) {
      const re = new RegExp(reobj.src, reobj.flags.includes("g") ? reobj.flags : reobj.flags + "g");
      if (typeof repl === "string") return text.replace(re, repl.replace(/\\(\d)/g, "$$$1"));
      return text.replace(re, (...m) => pyStr(call(repl, [asMatch(m)])));
    }

    function sha256Hex(bytes) {
      const K = new Uint32Array([
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
      ]);
      const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
      const bitLen = bytes.length * 8;
      const withOne = new Uint8Array(((bytes.length + 9 + 63) & ~63));
      withOne.set(bytes);
      withOne[bytes.length] = 0x80;
      const view = new DataView(withOne.buffer);
      view.setUint32(withOne.length - 4, bitLen >>> 0);
      view.setUint32(withOne.length - 8, Math.floor(bitLen / 0x100000000));
      const w = new Uint32Array(64);
      for (let i = 0; i < withOne.length; i += 64) {
        for (let t = 0; t < 16; t++) w[t] = view.getUint32(i + t * 4);
        for (let t = 16; t < 64; t++) {
          const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
          const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
          w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
        }
        let [a, b, c, d, e, f, g, hh] = h;
        for (let t = 0; t < 64; t++) {
          const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
          const ch = (e & f) ^ (~e & g);
          const t1 = (hh + S1 + ch + K[t] + w[t]) >>> 0;
          const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
          const maj = (a & b) ^ (a & c) ^ (b & c);
          const t2 = (S0 + maj) >>> 0;
          hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
        }
        h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
        h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
      }
      return Array.from(h, (n) => n.toString(16).padStart(8, "0")).join("");
    }
    function rotr(n, s) { return (n >>> s) | (n << (32 - s)); }

    function dictFromKeys(args) {
      const seq = snapshot(args[0]);
      const value = args.length > 1 ? args[1] : null;
      const d = emptyDict();
      seq.forEach((k) => { if (!dictGet(d, k).ok) dictSet(d, k, value); });
      return d;
    }

    function mod(name, attrs) {
      const dict = new Map(Object.entries(attrs || {}));
      const m = { kind: "module", name, dict };
      rt.modules.set(name, m);
      return m;
    }

    const math = mod("math", {
      pi: Math.PI, e: Math.E, tau: Math.PI * 2,
      sqrt: builtin("sqrt", (a) => Math.sqrt(asNum(a[0]))),
      floor: builtin("floor", (a) => Math.floor(asNum(a[0]))),
      ceil: builtin("ceil", (a) => Math.ceil(asNum(a[0]))),
      sin: builtin("sin", (a) => Math.sin(asNum(a[0]))),
      cos: builtin("cos", (a) => Math.cos(asNum(a[0]))),
      log: builtin("log", (a) => Math.log(asNum(a[0]))),
      fabs: builtin("fabs", (a) => Math.abs(asNum(a[0]))),
    });
    let rng = Math.random;
    const random = mod("random", {
      random: builtin("random", () => rng()),
      choice: builtin("choice", (a) => {
        const items = snapshot(a[0]);
        if (!items.length) fail(rt.exc.IndexError, "cannot choose from an empty sequence");
        return items[Math.floor(rng() * items.length)];
      }),
      randint: builtin("randint", (a) => {
        const lo = asNum(a[0]), hi = asNum(a[1]);
        return lo + Math.floor(rng() * (hi - lo + 1));
      }),
      seed: builtin("seed", (a) => {
        let x = typeof a[0] === "number" ? a[0] : 1;
        rng = () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
        return null;
      }),
    });
    const jsonMod = mod("json", {
      loads: builtin("loads", (a) => {
        try { return jsToPy(JSON.parse(String(a[0]))); }
        catch (e) { fail(JSONDecodeError, "invalid json"); }
      }),
      dumps: builtin("dumps", (a) => JSON.stringify(pyToJs(a[0]))),
      JSONDecodeError,
    });
    const reMod = mod("re", {
      I: 2, IGNORECASE: 2, M: 8, MULTILINE: 8, S: 16, DOTALL: 16,
      compile: builtin("compile", (a) => compilePat(pyStr(a[0]), a[1] == null ? 0 : asNum(a[1]))),
      search: builtin("search", (a) => reSearch(compilePat(pyStr(a[0]), a[2] == null ? 0 : asNum(a[2])), pyStr(a[1]))),
      match: builtin("match", (a) => reMatch(compilePat(pyStr(a[0]), 0), pyStr(a[1]))),
      findall: builtin("findall", (a) => reFindall(compilePat(pyStr(a[0]), a[2] == null ? 0 : asNum(a[2])), pyStr(a[1]))),
      finditer: builtin("finditer", (a) => reFinditer(compilePat(pyStr(a[0]), a[2] == null ? 0 : asNum(a[2])), pyStr(a[1]))),
      sub: builtin("sub", (a) => reSub(compilePat(pyStr(a[0]), a[3] == null ? 0 : asNum(a[3])), a[1], pyStr(a[2]))),
      escape: builtin("escape", (a) => pyStr(a[0]).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    });
    /* Only SHA-256 is offered. WebCrypto has no synchronous digest, and a
     * hand-rolled MD5 that disagreed with the RFC vectors is worse than no MD5
     * at all — a hash that lies is a security bug, not a missing feature. */
    function digestFrom(data, algo) {
      const bytes = data instanceof Uint8Array ? data : toUtf8(pyStr(data));
      if (algo === "sha256") return { kind: "hash", hex: sha256Hex(bytes) };
      fail(rt.exc.ValueError, algo + " is not available in this shell");
    }
    const hashlib = mod("hashlib", {
      sha256: builtin("sha256", (a) => digestFrom(a[0] && a[0].kind === "bytes" ? a[0].data : toUtf8(pyStr(a[0] == null ? "" : a[0])), "sha256")),
      algorithms: tuple(["sha256"]),
    });
    function htmlUnescape(s) {
      return String(s).replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (all, ent) => {
        if (ent[0] === "#") {
          const cp = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
          return Number.isFinite(cp) ? String.fromCodePoint(cp) : all;
        }
        const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
        return named[ent] !== undefined ? named[ent] : all;
      });
    }
    const htmlMod = mod("html", {
      escape: builtin("escape", (a) => String(a[0]).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")),
      unescape: builtin("unescape", (a) => htmlUnescape(a[0])),
    });
    const timeMod = mod("time", {
      time: builtin("time", () => Date.now() / 1000),
      sleep: builtin("sleep", (a) => {
        rt.slept += Math.max(0, asNum(a[0]));
        return null;
      }),
    });
    function kw(kwargs, name, dflt) { return kwargs && kwargs.has(name) ? kwargs.get(name) : dflt; }
    const osPath = mod("os.path", {
      join: builtin("join", (a) => {
        let out = pyStr(a[0]);
        for (let i = 1; i < a.length; i++) {
          const p = pyStr(a[i]);
          if (p.startsWith("/")) out = p;
          else out = out.replace(/\/$/, "") + "/" + p;
        }
        return out;
      }),
      basename: builtin("basename", (a) => pyStr(a[0]).replace(/\/$/, "").split("/").pop() || ""),
      dirname: builtin("dirname", (a) => {
        const s = pyStr(a[0]).replace(/\/$/, "");
        const i = s.lastIndexOf("/");
        return i <= 0 ? (s.startsWith("/") ? "/" : "") : s.slice(0, i);
      }),
      splitext: builtin("splitext", (a) => {
        const base = pyStr(a[0]).split("/").pop();
        const i = base.lastIndexOf(".");
        if (i <= 0) return tuple([pyStr(a[0]), ""]);
        const ext = base.slice(i);
        return tuple([pyStr(a[0]).slice(0, pyStr(a[0]).length - ext.length), ext]);
      }),
      exists: builtin("exists", (a) => rt.fs.has(normPath(a[0])) || rt.dirs.has(normPath(a[0]))),
      isfile: builtin("isfile", (a) => rt.fs.has(normPath(a[0]))),
      isdir: builtin("isdir", (a) => rt.dirs.has(normPath(a[0]))),
    });
    // A deliberately tiny, page-local environment. It is NOT the browser's
    // real environment — `os.environ` must never become a way to read the
    // visitor's real machine state out of a "sandbox".
    const envDict = emptyDict();
    dictSet(envDict, "HOME", "/");
    dictSet(envDict, "PWD", "/");
    dictSet(envDict, "LANG", "en_US.UTF-8");
    dictSet(envDict, "PYTHONHASHSEED", "0");
    const osMod = mod("os", {
      path: osPath,
      makedirs: builtin("makedirs", (a, kwargs) => {
        const path = normPath(a[0]);
        const parts = path.split("/").filter(Boolean);
        let cur = "";
        for (const part of parts) { cur += "/" + part; rt.dirs.add(cur); }
        return null;
      }),
      remove: builtin("remove", (a) => {
        const path = normPath(a[0]);
        if (!rt.fs.has(path)) fail(rt.exc.FileNotFoundError, path);
        rt.fs.delete(path);
        return null;
      }),
      environ: envDict,
      getenv: builtin("getenv", (a) => {
        const f = dictGet(envDict, pyStr(a[0]));
        return f.ok ? f.v : a.length > 1 ? a[1] : null;
      }),
      putenv: builtin("putenv", (a) => { dictSet(envDict, pyStr(a[0]), pyStr(a[1])); return null; }),
      listdir: builtin("listdir", (a) => {
        const path = normPath(a[0] == null ? "/" : a[0]);
        const prefix = path === "/" ? "/" : path + "/";
        const names = new Set();
        for (const key of rt.fs.keys()) if (key.startsWith(prefix)) names.add(key.slice(prefix.length).split("/")[0]);
        for (const key of rt.dirs) if (key.startsWith(prefix) && key !== path) names.add(key.slice(prefix.length).split("/")[0]);
        return [...names].filter(Boolean);
      }),
    });
    const sysMod = mod("sys", {
      argv: ["repl.py"],
      version: "3.12.7 (htp shell)",
      version_info: tuple([3, 12, 7, "final", 0]),
      // The interpreter is a hand-written JS engine, not CPython. Saying so is
      // more useful than inventing a CPython that isn't here.
      implementation: { kind: "ns", name: "implementation", dict: new Map([["name", "htp"], ["version", tuple([3, 12, 7, "final", 0])], ["hexversion", 0x030c0700], ["cache_tag", "htp-312"]]) },
      platform: "htp",
      system: "htp",
      machine: "wasm",
      maxsize: Number.MAX_SAFE_INTEGER,
      executable: "repl.py",
      prefix: "/",
      byteorder: "little",
      float_info: { kind: "ns", name: "float_info", dict: new Map([["max", Number.MAX_VALUE], ["min", 2.2250738585072014e-308], ["eps", Number.EPSILON], ["dig", 15]]) },
      modules: { kind: "ns", name: "modules", dict: new Map() },
      path: ["/"],
      exit: builtin("exit", (a) => {
        const code = a.length ? a[0] : 0;
        const inst = blankInst(rt.exc.SystemExit, code == null ? "" : pyStr(code));
        inst.dict.set("code", code);
        const e = new PyRunError(rt.exc.SystemExit, pyStr(code), inst);
        e.stack = rt.stack.map((f) => ({ name: f.name, line: f.line }));
        throw e;
      }),
      stdout: { kind: "ns", name: "stdout", dict: new Map([["write", builtin("write", (a) => { write(pyStr(a[0])); return null; })]]) },
      stderr: { kind: "ns", name: "stderr", dict: new Map([["write", builtin("write", (a) => { write(pyStr(a[0])); return null; })]]) },
    });
    const urllibParse = mod("urllib.parse", {
      urlparse: builtin("urlparse", (a) => urlparse(pyStr(a[0]))),
      urljoin: builtin("urljoin", (a) => {
        try { return new URL(pyStr(a[1]), pyStr(a[0])).href; }
        catch (e) { return pyStr(a[1]); }
      }),
      urlunparse: builtin("urlunparse", (a) => urlunparse(a[0])),
      unquote: builtin("unquote", (a) => { try { return decodeURIComponent(pyStr(a[0])); } catch (e) { return pyStr(a[0]); } }),
      quote: builtin("quote", (a) => encodeURIComponent(pyStr(a[0]))),
      parse_qsl: builtin("parse_qsl", (a, kwargs) => {
        const keep = truth(kw(kwargs, "keep_blank_values", false));
        const out = [];
        for (const part of pyStr(a[0]).split("&")) {
          if (!part) continue;
          const i = part.indexOf("=");
          const k = i < 0 ? part : part.slice(0, i);
          const v = i < 0 ? "" : part.slice(i + 1);
          if (!keep && i >= 0 && v === "") continue;
          try { out.push(tuple([decodeURIComponent(k.replace(/\+/g, " ")), decodeURIComponent(v.replace(/\+/g, " "))])); }
          catch (e) { out.push(tuple([k, v])); }
        }
        return out;
      }),
      urlencode: builtin("urlencode", (a) => {
        const pairs = a[0] && a[0].kind === "dict"
          ? a[0].items.map(([k, v]) => [pyStr(k), v == null ? "" : pyStr(v)])
          : snapshot(a[0]).map((item) => {
            const seq = snapshot(item);
            return [pyStr(seq[0]), seq[1] == null ? "" : pyStr(seq[1])];
          });
        return pairs.map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&");
      }),
    });
    const urllib = mod("urllib", { parse: urllibParse });
    const RequestException = {
      kind: "class",
      name: "RequestException",
      bases: [rt.exc.OSError],
      dict: new Map([["__init__", rt.exc.OSError.dict.get("__init__")]]),
    };
    function denyNet() {
      const inst = blankInst(RequestException, "network is disabled in this shell");
      const e = new PyRunError(RequestException, "network is disabled in this shell", inst);
      e.stack = rt.stack.map((f) => ({ name: f.name, line: f.line }));
      throw e;
    }
    const Session = {
      kind: "class",
      name: "Session",
      bases: [],
      dict: new Map([
        ["__init__", method("__init__", (args) => {
          const self = args[0];
          self.dict.set("headers", emptyDict());
          self.dict.set("cookies", []);
          self.dict.set("proxies", emptyDict());
          self.dict.set("trust_env", true);
          return null;
        })],
        ["get", method("get", () => denyNet())],
        ["post", method("post", () => denyNet())],
        ["__enter__", method("__enter__", (args) => args[0])],
        ["__exit__", method("__exit__", () => null)],
      ]),
    };
    const requests = mod("requests", {
      get: builtin("get", () => denyNet()),
      post: builtin("post", () => denyNet()),
      Session,
      RequestException,
    });
    const Lock = {
      kind: "class",
      name: "Lock",
      bases: [],
      dict: new Map([
        ["__init__", method("__init__", () => null)],
        ["__enter__", method("__enter__", (args) => args[0])],
        ["__exit__", method("__exit__", () => null)],
        ["acquire", method("acquire", () => true)],
        ["release", method("release", () => null)],
      ]),
    };
    const threading = mod("threading", { Lock });
    const Future = { kind: "class", name: "Future", bases: [], dict: new Map() };
    const ThreadPoolExecutor = {
      kind: "class",
      name: "ThreadPoolExecutor",
      bases: [],
      dict: new Map([
        ["__init__", method("__init__", (args, kwargs) => {
          args[0].dict.set("max_workers", kw(kwargs, "max_workers", args[1] == null ? 8 : args[1]));
          return null;
        })],
        ["submit", method("submit", (args, kwargs) => {
          const fn = args[1];
          const callArgs = args.slice(2);
          try {
            return { kind: "future", value: call(fn, callArgs, kwargs), error: null };
          } catch (e) {
            return { kind: "future", value: null, error: e };
          }
        })],
        // `ex.map(fn, xs)` — executed serially on the calling thread. There are
        // no real threads here; the sandbox is single-threaded by design.
        ["map", method("map", (args) => snapshot(args[2]).map((v) => call(args[1], [v], new Map())))],
        ["mapAsync", method("mapAsync", (args) => snapshot(args[2]).map((v) => ({ kind: "future", value: call(args[1], [v], new Map()), error: null })))],
        ["__enter__", method("__enter__", (args) => args[0])],
        ["__exit__", method("__exit__", () => null)],
        ["shutdown", method("shutdown", () => null)],
      ]),
    };
    const futures = mod("concurrent.futures", {
      ThreadPoolExecutor,
      Future,
      as_completed: builtin("as_completed", (a) => {
        const v = a[0];
        if (v && v.kind === "dict") return v.items.map(([k]) => k);
        return snapshot(v);
      }),
    });
    const concurrent = mod("concurrent", { futures });
    function argparseError(parser, msg) {
      write(parserUsage(parser) + "\n" + (parser.prog || "repl.py") + ": error: " + msg + "\n");
      const inst = blankInst(rt.exc.SystemExit, "2");
      inst.dict.set("code", 2);
      const e = new PyRunError(rt.exc.SystemExit, msg, inst);
      e.stack = rt.stack.map((f) => ({ name: f.name, line: f.line }));
      throw e;
    }
    function parserUsage(parser) {
      const opts = parser.opts.map((o) => o.names.join(", ")).join(" ");
      return "usage: " + (parser.prog || "repl.py") + " " + opts;
    }
    const ArgumentParser = {
      kind: "class",
      name: "ArgumentParser",
      bases: [],
      dict: new Map([
        ["__init__", method("__init__", (args, kwargs) => {
          const self = args[0];
          self.dict.set("_parser", {
            prog: kw(kwargs, "prog", null) || "repl.py",
            desc: kw(kwargs, "description", "") || "",
            opts: [],
          });
          return null;
        })],
        ["add_argument", method("add_argument", (args, kwargs) => {
          const parser = args[0].dict.get("_parser");
          const names = args.slice(1).map(pyStr);
          const action = pyStr(kw(kwargs, "action", "store"));
          const long = names.find((n) => n.startsWith("--"));
          const dest = kw(kwargs, "dest", null) || (long ? long.slice(2).replace(/-/g, "_") : names[0].replace(/^-+/, "").replace(/-/g, "_"));
          let dflt = kwargs.has("default") ? kwargs.get("default") : undefined;
          if (dflt === undefined) dflt = action === "store_true" ? false : action === "append" ? [] : null;
          if (Array.isArray(dflt)) dflt = dflt.slice();
          parser.opts.push({
            names,
            dest: pyStr(dest),
            action,
            type: kw(kwargs, "type", null),
            default: dflt,
            choices: kw(kwargs, "choices", null),
            required: truth(kw(kwargs, "required", false)),
            help: kw(kwargs, "help", "") || "",
          });
          return null;
        })],
        ["parse_args", method("parse_args", (args) => {
          const parser = args[0].dict.get("_parser");
          let argv;
          if (args[1] == null) argv = snapshot(sysMod.dict.get("argv")).slice(1).map(pyStr);
          else argv = snapshot(args[1]).map(pyStr);
          if (argv.includes("-h") || argv.includes("--help")) {
            write(parserUsage(parser) + "\n");
            parser.opts.forEach((o) => write("  " + o.names.join(", ") + (o.help ? "  " + pyStr(o.help) : "") + "\n"));
            const inst = blankInst(rt.exc.SystemExit, "0");
            inst.dict.set("code", 0);
            throw new PyRunError(rt.exc.SystemExit, "", inst);
          }
          const ns = { kind: "ns", name: "Namespace", dict: new Map() };
          parser.opts.forEach((o) => ns.dict.set(o.dest, Array.isArray(o.default) ? o.default.slice() : o.default));
          const positional = parser.opts.filter((o) => !o.names[0].startsWith("-"));
          let pi = 0;
          for (let i = 0; i < argv.length; i++) {
            const a = argv[i];
            if (a === "--") { positionalRest(argv.slice(i + 1)); break; }
            if (a.startsWith("-") && a !== "-") {
              let name = a, value = null, has = false;
              const eq = a.indexOf("=");
              if (eq > 0 && a.startsWith("--")) { name = a.slice(0, eq); value = a.slice(eq + 1); has = true; }
              const opt = parser.opts.find((o) => o.names.includes(name));
              if (!opt) argparseError(parser, "unrecognized arguments: " + a);
              if (opt.action === "store_true") { ns.dict.set(opt.dest, true); continue; }
              if (!has) {
                if (i + 1 >= argv.length || (argv[i + 1].startsWith("-") && argv[i + 1] !== "-")) argparseError(parser, "argument " + name + ": expected a value");
                value = argv[++i];
              }
              let coerced = value;
              if (opt.type) coerced = call(opt.type, [value], new Map());
              if (opt.choices) {
                const choices = snapshot(opt.choices);
                if (!choices.some((c) => pyEq(c, coerced))) argparseError(parser, "invalid choice: " + value);
              }
              if (opt.action === "append") {
                const cur = ns.dict.get(opt.dest);
                if (Array.isArray(cur)) cur.push(coerced);
                else ns.dict.set(opt.dest, [coerced]);
              } else ns.dict.set(opt.dest, coerced);
            } else {
              if (pi >= positional.length) argparseError(parser, "unrecognized arguments: " + a);
              ns.dict.set(positional[pi].dest, a);
              pi++;
            }
          }
          function positionalRest(rest) {
            for (const a of rest) {
              if (pi >= positional.length) argparseError(parser, "unrecognized arguments: " + a);
              ns.dict.set(positional[pi].dest, a);
              pi++;
            }
          }
          for (const o of parser.opts) if (o.required && (ns.dict.get(o.dest) == null)) argparseError(parser, "the following arguments are required: " + o.names.join("/"));
          for (const o of positional) if (pi <= positional.indexOf(o)) argparseError(parser, "the following arguments are required: " + o.dest);
          return ns;
        })],
      ]),
    };
    const argparse = mod("argparse", { ArgumentParser });

    /* ──────────────────────────────────────────────────────────────────────
     * Additions. Everything below is pure computation over values that already
     * exist inside the sandbox — no clock beyond the page's, no I/O beyond the
     * in-memory filesystem, no sockets. `datetime`/`uuid` are deterministic
     * shims over the page clock and a counter, never `crypto`.
     * ────────────────────────────────────────────────────────────────────── */

    const iterItems = (v) => (v == null ? [] : snapshot(v));
    const itertools = mod("itertools", {
      chain: builtin("chain", (a) => a.flatMap((x) => iterItems(x))),
      product: builtin("product", (a) => {
        let out = [[]];
        for (const list of a) {
          const items = iterItems(list);
          const next = [];
          for (const prefix of out) for (const x of items) next.push(prefix.concat([x]));
          out = next;
          if (out.length > 100000) fail(rt.exc.MemoryError || rt.exc.RuntimeError, "itertools.product too large");
        }
        return out.map((t) => tuple(t));
      }),
      permutations: builtin("permutations", (a) => {
        const items = iterItems(a[0]);
        if (a[1] != null) {
          const r = asNum(a[1]);
          const perms = [];
          const walk = (cur, rest) => {
            if (cur.length === r) { perms.push(cur.slice()); return; }
            for (let i = 0; i < rest.length; i++) walk(cur.concat([rest[i]]), rest.slice(0, i).concat(rest.slice(i + 1)));
          };
          walk([], items);
          return perms.map((t) => tuple(t));
        }
        if (items.length > 8) fail(rt.exc.ValueError, "permutations() more than 8 elements");
        const perms = [];
        const walk = (cur, rest) => {
          if (!rest.length) { perms.push(cur.slice()); return; }
          for (let i = 0; i < rest.length; i++) walk(cur.concat([rest[i]]), rest.slice(0, i).concat(rest.slice(i + 1)));
        };
        walk([], items);
        return perms.map((t) => tuple(t));
      }),
      combinations: builtin("combinations", (a) => {
        const items = iterItems(a[0]);
        const r = asNum(a[1]);
        const out = [];
        const walk = (start, cur) => {
          if (cur.length === r) { out.push(cur.slice()); return; }
          for (let i = start; i < items.length; i++) walk(i + 1, cur.concat([items[i]]));
        };
        walk(0, []);
        return out.map((t) => tuple(t));
      }),
      groupby: builtin("groupby", (a) => {
        const items = iterItems(a[0]).slice().sort((x, y) => order(x, y));
        const groups = [];
        for (const item of items) {
          const last = groups[groups.length - 1];
          if (last && pyEq(last[0], item)) last[1].push(item);
          else groups.push([item, [item]]);
        }
        return groups.map(([k, v]) => tuple([k, iteratorOf(v)]));
      }),
      islice: builtin("islice", (a) => {
        let start = 0, stop = null;
        if (a.length >= 3) { start = asNum(a[1]); stop = asNum(a[2]); }
        else if (a.length === 2) stop = asNum(a[1]);
        const items = iterItems(a[0]).slice(start, stop === null ? undefined : stop);
        return iteratorOf(items);
      }),
      cycle: builtin("cycle", (a) => {
        const items = iterItems(a[0]);
        if (!items.length) fail(rt.exc.ValueError, "itertools.cycle() of an empty sequence");
        return iteratorOf(items.slice());
      }),
      repeat: builtin("repeat", (a) => {
        const n = a[1] == null ? 5 : asNum(a[1]);
        return iteratorOf(Array.from({ length: n }, () => a[0]));
      }),
      count: builtin("count", (a) => iterItems(a[1]).filter((x) => pyEq(x, a[0])).length),
      accumulate: builtin("accumulate", (a) => {
        const items = iterItems(a[0]);
        const fn = a[1];
        const out = [];
        let acc = items.length ? items[0] : null;
        if (items.length) out.push(acc);
        for (let i = 1; i < items.length; i++) { acc = fn ? call(fn, [acc, items[i]]) : asNum(acc) + asNum(items[i]); out.push(acc); }
        return out;
      }),
      zip_longest: builtin("zip_longest", (a) => {
        const fill = a[a.length - 1] && a[a.length - 1].kind === "inst" ? a[a.length - 1] : null;
        const cols = a.slice(0, a.length - 1).map(iterItems);
        const n = cols.reduce((m, c) => Math.max(m, c.length), 0);
        const out = [];
        for (let i = 0; i < n; i++) out.push(tuple(cols.map((c) => (i < c.length ? c[i] : fill))));
        return out;
      }),
      compress: builtin("compress", (a) => {
        const data = iterItems(a[0]), sel = iterItems(a[1]);
        return data.filter((_, i) => truth(sel[i]));
      }),
      takewhile: builtin("takewhile", (a) => {
        const items = iterItems(a[0]);
        const out = [];
        for (const x of items) { if (!truth(call(a[1], [x]))) break; out.push(x); }
        return iteratorOf(out);
      }),
      dropwhile: builtin("dropwhile", (a) => {
        const items = iterItems(a[0]);
        let i = 0;
        while (i < items.length && truth(call(a[1], [items[i]]))) i++;
        return iteratorOf(items.slice(i));
      }),
    });
    function iteratorOf(items) { return { kind: "iter", items, i: 0 }; }

    const functools = mod("functools", {
      reduce: builtin("reduce", (a) => {
        const items = iterItems(a[1]);
        if (!items.length) fail(rt.exc.TypeError, "reduce() of empty sequence with no initial value");
        let acc = items[0];
        for (let i = 1; i < items.length; i++) acc = call(a[0], [acc, items[i]]);
        return acc;
      }),
      wraps: builtin("wraps", (a) => a[0]),
      lru_cache: builtin("lru_cache", (a) => (a.length && a[0] && a[0].kind === "builtin" ? a[0] : (f) => f)),
      cache: builtin("cache", (a) => (a.length ? a[0] : (f) => f)),
      partial: builtin("partial", (a) => {
        const fn = a[0];
        const pre = a.slice(1);
        return builtin("partial", (inner, kwargs) => {
          const merged = new Map();
          for (const [k, v] of kwargs || []) merged.set(k, v);
          for (const p of pre) if (p && p.star) merged.set(p.name, p.value);
          return call(fn, inner.slice(0, pre.filter((p) => p && !p.star).length).concat(inner.slice(pre.filter((p) => p && !p.star).length)), merged);
        });
      }),
    });

    /* collections: Counter/defaultdict/deque/namedtuple/OrderedDict. The
     * behaviour people depend on is counting, defaulting and field access. */
    function makeNamedTuple(name, fields) {
      const cls = { kind: "class", name, bases: [], dict: new Map() };
      const fill = (inst, a) => {
        if (a.length === 1 && a[0] && (a[0].kind === "iter" || Array.isArray(a[0]))) a = a[0].items || a[0];
        fields.forEach((f, i) => inst.dict.set(f, a[i]));
        inst.dict.set("_fields", fields);
        const asDict = emptyDict();
        fields.forEach((f, i) => dictSet(asDict, f, a[i]));
        inst.dict.set("_asdict", asDict);
        return inst;
      };
      cls.dict.set("__init__", builtin("__init__", (a) => fill(a[0], a.slice(1))));
      cls.dict.set("__repr__", builtin("__repr__", (a) => name + "(" + fields.map((f) => f + "=" + pyRepr(a[0].dict.get(f))).join(", ") + ")"));
      cls.dict.set("__getitem__", builtin("__getitem__", (a) => {
        const k = a[1];
        if (typeof k === "string") {
          if (k === "_fields") return fields;
          if (!fields.includes(k)) fail(rt.exc.KeyError, k);
          return a[0].dict.get(k);
        }
        const items = fields.map((f) => a[0].dict.get(f));
        let i = asNum(k);
        if (i < 0) i += items.length;
        if (i < 0 || i >= items.length) fail(rt.exc.IndexError, "tuple index out of range");
        return items[i];
      }));
      cls.dict.set("__len__", builtin("__len__", (a) => fields.length));
      cls.dict.set("__iter__", builtin("__iter__", (a) => iteratorOf(fields.map((f) => a[0].dict.get(f)))));
      cls.dict.set("_asdict", builtin("_asdict", (a) => a[0].dict.get("_asdict")));
      cls.dict.set("_replace", builtin("_replace", (a, kwargs) => {
        const next = a.slice(1);
        const inst = { kind: "inst", cls, dict: new Map() };
        fields.forEach((f) => inst.dict.set(f, a[0].dict.get(f)));
        if (kwargs) for (const [k, v] of kwargs) {
          const i = fields.indexOf(k);
          if (i < 0) fail(rt.exc.ValueError, "Got unexpected field name: '" + k + "'");
          next[i] = v;
        }
        return fill(inst, next);
      }));
      fields.forEach((f) => cls.dict.set(f, builtin(f, (a) => a[0].dict.get(f))));
      const factory = builtin(name, (a) => fill({ kind: "inst", cls, dict: new Map() }, a));
      factory.cls = cls;
      return factory;
    }
    const CounterCls = {
      kind: "class", name: "Counter", bases: [], dict: new Map([
        ["__init__", builtin("__init__", (a) => {
          const self = a[0];
          // `counts` is a sandbox dict, not a JS Map — the rest of the runtime
          // only speaks the former.
          const counts = emptyDict();
          self.dict.set("counts", counts);
          const src = a[1];
          if (src && src.kind === "dict") for (const [k, v] of src.items) dictSet(counts, k, asNum(v));
          else if (src != null) {
            const tally = new Map();
            for (const x of iterItems(src)) tally.set(x, (tally.get(x) || 0) + 1);
            for (const [k, v] of tally) dictSet(counts, k, v);
          }
          return null;
        })],
        ["most_common", method("most_common", (a) => {
          const counts = a[0].dict.get("counts");
          let entries = counts.items.map(([k, v]) => [k, v]);
          entries.sort((x, y) => y[1] - x[1] || order(x[0], y[0]));
          if (a[1] != null) entries = entries.slice(0, asNum(a[1]));
          return entries.map((e) => tuple(e));
        })],
        ["keys", method("keys", (a) => a[0].dict.get("counts").items.map((e) => e[0]))],
        ["values", method("values", (a) => a[0].dict.get("counts").items.map((e) => e[1]))],
        ["items", method("items", (a) => a[0].dict.get("counts").items.map((e) => tuple(e)))],
        ["__repr__", method("__repr__", (a) => "Counter(" + pyRepr(a[0].dict.get("counts")) + ")")],
        ["__len__", method("__len__", (a) => a[0].dict.get("counts").items.length)],
        ["__getitem__", method("__getitem__", (a) => {
          const f = dictGet(a[0].dict.get("counts"), a[1]);
          if (!f.ok) fail(rt.exc.KeyError, pyRepr(a[1]));
          return f.v;
        })],
        ["update", method("update", (a) => {
          const counts = a[0].dict.get("counts");
          const src = a[1];
          if (src && src.kind === "dict") for (const [k, v] of src.items) dictSet(counts, k, asNum(v));
          else for (const x of iterItems(src)) dictSet(counts, x, (dictGet(counts, x).ok ? dictGet(counts, x).v : 0) + 1);
          return null;
        })],
        ["subtract", method("subtract", (a) => {
          const counts = a[0].dict.get("counts");
          for (const x of iterItems(a[1])) {
            const cur = dictGet(counts, x).ok ? dictGet(counts, x).v : 0;
            const next = cur - 1;
            if (next) dictSet(counts, x, next);
            else {
              const i = counts.items.findIndex(([k]) => pyEq(k, x));
              if (i >= 0) counts.items.splice(i, 1);
            }
          }
          return null;
        })],
      ]),
    };
    const collections = mod("collections", {
      Counter: builtin("Counter", (a) => call(CounterCls, a, new Map())),
      defaultdict: builtin("defaultdict", (a) => {
        const factory = a[0];
        const src = a[1];
        const init = src && src.kind === "iter" ? src.items : src && src.kind === "dict" ? src.items.map(([k, v]) => tuple([k, v])) : [];
        const d = emptyDict();
        for (const pair of init) dictSet(d, pair[0], pair[1]);
        // Stay kind:"dict" — everything downstream (subscript, dictSet, pyStr)
        // keys off that. The factory rides along as an extra field.
        d.factory = factory;
        return d;
      }),
      deque: builtin("deque", (a) => {
        const items = iterItems(a[0]);
        const d = { kind: "deque", items };
        d.append = (v) => { if (d.items.length >= (asNum(a[1]) || 0)) d.items.shift(); d.items.push(v); };
        return d;
      }),
      namedtuple: builtin("namedtuple", (a) => makeNamedTuple(pyStr(a[0]), iterItems(a[1]))),
      OrderedDict: builtin("OrderedDict", (a) => (a[0] && a[0].kind === "dict" ? a[0] : emptyDict())),
      Iterable: { kind: "class", name: "Iterable", bases: [], dict: new Map() },
    });
    const stringMod = mod("string", {
      ascii_lowercase: "abcdefghijklmnopqrstuvwxyz",
      ascii_uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      ascii_letters: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
      digits: "0123456789",
      hexdigits: "0123456789abcdefABCDEF",
      octdigits: "01234567",
      punctuation: "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~",
      whitespace: " \t\n\r\u000b\f",
      printable: null, // filled below once all pieces exist
    });
    stringMod.dict.set("printable", Object.keys(stringMod.dict).map((k) => stringMod.dict.get(k)).join(""));

    const datetimeMod = mod("datetime", {});
    const EPOCH_MS = 0;
    function toEpochSeconds(v) {
      if (v == null) return Date.now() / 1000;
      if (typeof v === "number") return v;
      if (v.kind === "inst" && v.dict.has("epoch")) return v.dict.get("epoch");
      return Date.now() / 1000;
    }
    function dateParts(epochSec) {
      const d = new Date(epochSec * 1000);
      return {
        year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
        hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(),
        microsecond: d.getUTCMilliseconds() * 1000, weekday: d.getUTCDay(),
      };
    }
    const dateCls = {
      kind: "class", name: "date", bases: [], dict: new Map([
        ["__init__", builtin("__init__", (a) => {
          const self = a[0];
          self.dict.set("year", asNum(a[1]));
          self.dict.set("month", a[2] == null ? 1 : asNum(a[2]));
          self.dict.set("day", a[3] == null ? 1 : asNum(a[3]));
          return null;
        })],
        ["__repr__", method("__repr__", (a) => a[0].dict.get("year") + "-" + pad2(a[0].dict.get("month")) + "-" + pad2(a[0].dict.get("day")))],
        ["isoformat", method("isoformat", (a) => pyRepr(a[0]))],
        ["weekday", method("weekday", (a) => new Date(Date.UTC(a[0].dict.get("year"), a[0].dict.get("month") - 1, a[0].dict.get("day"))).getUTCDay())],
        ["timetuple", method("timetuple", (a) => tuple([a[0].dict.get("year"), a[0].dict.get("month"), a[0].dict.get("day")]))],
      ]),
    };
    function pad2(n) { return String(n).padStart(2, "0"); }
    const datetimeCls = {
      kind: "class", name: "datetime", bases: [dateCls], dict: new Map([
        ["__init__", builtin("__init__", (a) => {
          const self = a[0];
          const ms = Date.UTC(asNum(a[1]), (a[2] == null ? 1 : asNum(a[2])) - 1, a[3] == null ? 1 : asNum(a[3]),
            a[4] == null ? 0 : asNum(a[4]), a[5] == null ? 0 : asNum(a[5]), a[6] == null ? 0 : asNum(a[6]));
          self.dict.set("epoch", ms / 1000);
          const p = dateParts(ms / 1000);
          for (const k of Object.keys(p)) self.dict.set(k, p[k]);
          return null;
        })],
        ["__repr__", method("__repr__", (a) => {
          const d = a[0];
          return d.dict.get("year") + "-" + pad2(d.dict.get("month")) + "-" + pad2(d.dict.get("day")) + " " +
            pad2(d.dict.get("hour")) + ":" + pad2(d.dict.get("minute")) + ":" + pad2(d.dict.get("second"));
        })],
        ["now", builtin("now", () => ({ kind: "inst", cls: datetimeCls, dict: new Map([["epoch", Date.now() / 1000]]) }))],
        ["utcnow", builtin("utcnow", () => ({ kind: "inst", cls: datetimeCls, dict: new Map([["epoch", Date.now() / 1000]]) }))],
        ["today", builtin("today", () => ({ kind: "inst", cls: datetimeCls, dict: new Map([["epoch", Date.now() / 1000]]) }))],
        ["fromtimestamp", builtin("fromtimestamp", (a) => ({ kind: "inst", cls: datetimeCls, dict: new Map([["epoch", toEpochSeconds(a[0])]]) }))],
        ["timestamp", method("timestamp", (a) => a[0].dict.get("epoch"))],
        ["isoformat", method("isoformat", (a) => pyStr(a[0]))],
        ["strftime", method("strftime", (a) => strftime(pyStr(a[1]), a[0].dict.get("epoch")))],
        ["weekday", method("weekday", (a) => dateParts(a[0].dict.get("epoch")).weekday)],
        ["year", method("year", (a) => a[0].dict.get("year"))],
        ["month", method("month", (a) => a[0].dict.get("month"))],
        ["day", method("day", (a) => a[0].dict.get("day"))],
        ["hour", method("hour", (a) => a[0].dict.get("hour"))],
        ["minute", method("minute", (a) => a[0].dict.get("minute"))],
        ["second", method("second", (a) => a[0].dict.get("second"))],
      ]),
    };
    function strftime(fmt, epochSec) {
      const p = dateParts(epochSec);
      return String(fmt).replace(/%([a-zA-Z%])/g, (all, c) => {
        if (c === "%") return "%";
        if (c === "Y") return String(p.year);
        if (c === "y") return pad2(p.year % 100);
        if (c === "m") return pad2(p.month);
        if (c === "d") return pad2(p.day);
        if (c === "H") return pad2(p.hour);
        if (c === "M") return pad2(p.minute);
        if (c === "S") return pad2(p.second);
        if (c === "j") return String(Math.floor((Date.UTC(p.year, p.month - 1, p.day) - Date.UTC(p.year, 0, 0)) / 86400000) + 1).padStart(3, "0");
        if (c === "A") return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][p.weekday];
        if (c === "a") return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][p.weekday];
        if (c === "B") return ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][p.month - 1];
        if (c === "b") return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][p.month - 1];
        if (c === "Z") return "UTC";
        if (c === "s") return String(Math.floor(epochSec));
        return all;
      });
    }
    datetimeMod.dict.set("date", builtin("date", (a) => call(dateCls, a, new Map())));
    datetimeMod.dict.set("datetime", builtin("datetime", (a) => call(datetimeCls, a, new Map())));
    const timedeltaCls = {
      kind: "class", name: "timedelta", bases: [], dict: new Map([
        ["__init__", builtin("__init__", (a) => {
          const self = a[0];
          self.dict.set("seconds", asNum(a[1]));
          self.dict.set("days", a[2] == null ? 0 : asNum(a[2]));
          return null;
        })],
        ["total_seconds", method("total_seconds", (a) => asNum(a[0].dict.get("days")) * 86400 + a[0].dict.get("seconds"))],
        ["__repr__", method("__repr__", (a) => "datetime.timedelta(seconds=" + a[0].dict.get("seconds") + ", days=" + a[0].dict.get("days") + ")")],
      ]),
    };
    datetimeMod.dict.set("timedelta", builtin("timedelta", (a) => call(timedeltaCls, a, new Map())));
    mod("time", {
      time: builtin("time", (a) => (a.length ? a[0] : Date.now() / 1000)),
      monotonic: builtin("monotonic", () => (typeof performance !== "undefined" ? performance.now() / 1000 : Date.now() / 1000)),
      perf_counter: builtin("perf_counter", () => (typeof performance !== "undefined" ? performance.now() / 1000 : Date.now() / 1000)),
      sleep: builtin("sleep", (a) => { rt.slept += asNum(a[0]); step(); return null; }),
      localtime: builtin("localtime", (a) => tuple(Object.values(dateParts(toEpochSeconds(a[0]))).slice(0, 6))),
      gmtime: builtin("gmtime", (a) => tuple(Object.values(dateParts(toEpochSeconds(a[0]))).slice(0, 6))),
      strftime: builtin("strftime", (a) => strftime(pyStr(a[0]), Date.now() / 1000)),
      time_ns: builtin("time_ns", () => Date.now() * 1e6),
    });

    const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    function b64encode(data) {
      let out = "";
      for (let i = 0; i < data.length; i += 3) {
        const n = (data[i] << 16) | ((data[i + 1] || 0) << 8) | (data[i + 2] || 0);
        out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < data.length ? B64[(n >> 6) & 63] : "=") + (i + 2 < data.length ? B64[n & 63] : "=");
      }
      return out;
    }
    function b64decode(s) {
      const clean = String(s).replace(/[^A-Za-z0-9+/]/g, "");
      const out = [];
      for (let i = 0; i < clean.length; i += 4) {
        const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12) | ((clean[i + 2] === undefined ? 0 : B64.indexOf(clean[i + 2])) << 6) | (clean[i + 3] === undefined ? 0 : B64.indexOf(clean[i + 3]));
        out.push((n >> 16) & 255);
        if (clean[i + 2] !== undefined) out.push((n >> 8) & 255);
        if (clean[i + 3] !== undefined) out.push(n & 255);
      }
      return makeBytes(out);
    }
    /* Python's base64 encoders return bytes, not str — `b64encode(b"ab")`
     * followed by `.decode()` is the canonical idiom and must round-trip. */
    const asciiBytes = (s) => makeBytes(Uint8Array.from(s, (c) => c.charCodeAt(0) & 255));
    const base64Mod = mod("base64", {
      b64encode: builtin("b64encode", (a) => asciiBytes(b64encode(a[0] && a[0].kind === "bytes" ? a[0].data : toUtf8(pyStr(a[0]))))),
      b64decode: builtin("b64decode", (a) => b64decode(pyStr(a[0]))),
      b16encode: builtin("b16encode", (a) => asciiBytes(Array.from(a[0] && a[0].kind === "bytes" ? a[0].data : toUtf8(pyStr(a[0]))).map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(""))),
      b16decode: builtin("b16decode", (a) => makeBytes(pyStr(a[0]).match(/.{2}/g).map((h) => parseInt(h, 16)))),
      urlsafe_b64encode: builtin("urlsafe_b64encode", (a) => asciiBytes(b64encode(a[0] && a[0].kind === "bytes" ? a[0].data : toUtf8(pyStr(a[0]))).replace(/\+/g, "-").replace(/\//g, "_"))),
      urlsafe_b64decode: builtin("urlsafe_b64decode", (a) => b64decode(pyStr(a[0]).replace(/-/g, "+").replace(/_/g, "/"))),
      standard_b64decode: builtin("standard_b64decode", (a) => b64decode(pyStr(a[0]))),
    });
    base64Mod.dict.set("standard_b64encode", base64Mod.dict.get("b64encode"));

    /* uuid is a deterministic shim. crypto.randomUUID() is deliberately NOT
     * used: the sandbox's whole premise is that it cannot reach the network or
     * a CSPRNG, and a UUID that silently came from one would be a lie. */
    let uuidCounter = 0;
    function makeUuid(seed) {
      uuidCounter++;
      const h = sha256Hex(toUtf8("htp-uuid:" + seed + ":" + uuidCounter));
      return h.slice(0, 8) + "-" + h.slice(8, 12) + "-4" + h.slice(13, 16) + "-a" + h.slice(17, 20) + "-" + h.slice(20, 32);
    }
    mod("uuid", {
      uuid4: builtin("uuid4", () => makeUuid("4")),
      uuid1: builtin("uuid1", () => makeUuid("1")),
      uuid3: builtin("uuid3", (a) => makeUuid(pyStr(a[0]) + pyStr(a[1]))),
      uuid5: builtin("uuid5", (a) => makeUuid(pyStr(a[0]) + pyStr(a[1]))),
      UUID: builtin("UUID", (a) => makeUuid(pyStr(a[0]))),
      NAMESPACE_DNS: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      NAMESPACE_URL: "6ba7b811-9dad-11d1-80b4-00c04fd430c8",
    });

    let enumMod;
    function makeEnum(name, members) {
      const membersMap = emptyDict();
      for (const [k, v] of Object.entries(members)) dictSet(membersMap, k, v);
      // `kind:"enum"` so `C.RED` resolves as a namespace lookup while `C(1)`
      // still works as a value lookup. A plain class would route `C(1)` through
      // instantiate() and hand back an empty instance instead of the member.
      const factory = { kind: "enum", name, dict: new Map(), members: membersMap };
      // A member is an object with .name/.value, not the bare value — `Color.RED.value`
      // is the whole reason anyone reaches for an Enum.
      for (const [k, v] of Object.entries(members)) {
        const member = { kind: "enummember", name: k, value: v, owner: name, dict: new Map([["name", k], ["value", v]]) };
        dictSet(membersMap, k, member);
        factory.dict.set(k, member);
      }
      factory.dict.set("__members__", membersMap);
      factory.dict.set("__name__", name);
      return factory;
    }
    enumMod = mod("enum", {
      auto: null,
      Enum: builtin("Enum", (a, kwargs) => {
        const name = pyStr(a[0]);
        // Members arrive positionally (a dict) or as keywords — `enum.Enum("C", a=1)`.
        let n = 1;
        const out = {};
        const take = (k, v) => { out[pyStr(k)] = v == null ? n++ : v; };
        if (a[1] && a[1].kind === "dict") for (const [k, v] of a[1].items) take(k, v);
        if (kwargs) for (const [k, v] of kwargs) take(k, v);
        return makeEnum(name, out);
      }),
    });
    enumMod.dict.set("IntEnum", enumMod.dict.get("Enum"));
    enumMod.dict.set("Flag", enumMod.dict.get("Enum"));

    mod("statistics", {
      mean: builtin("mean", (a) => { const xs = iterItems(a[0]).map(asNum); if (!xs.length) fail(rt.exc.StatisticsError || rt.exc.ValueError, "mean requires at least one data point"); return xs.reduce((a2, b) => a2 + b, 0) / xs.length; }),
      median: builtin("median", (a) => {
        const xs = iterItems(a[0]).map(asNum).sort((x, y) => x - y);
        if (!xs.length) fail(rt.exc.ValueError, "no median for empty data");
        const mid = Math.floor(xs.length / 2);
        return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
      }),
      mode: builtin("mode", (a) => { const c = tally(iterItems(a[0])); return c[0][0]; }),
      stdev: builtin("stdev", (a) => { const xs = iterItems(a[0]).map(asNum); const m = xs.reduce((x, y) => x + y, 0) / xs.length; return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)); }),
      pstdev: builtin("pstdev", (a) => { const xs = iterItems(a[0]).map(asNum); const m = xs.reduce((x, y) => x + y, 0) / xs.length; return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length); }),
      variance: builtin("variance", (a) => { const xs = iterItems(a[0]).map(asNum); const m = xs.reduce((x, y) => x + y, 0) / xs.length; return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1); }),
    });
    function tally(items) {
      const counts = new Map();
      for (const x of items) counts.set(x, (counts.get(x) || 0) + 1);
      let best = [];
      for (const [k, v] of counts) {
        if (!best.length || v > best[0][1]) best = [[k, v]];
        else if (v === best[0][1]) best.push([k, v]);
      }
      return best.sort((x, y) => order(y[0], x[0]));
    }

    const heapq = mod("heapq", {
      heappush: builtin("heappush", (a) => {
        const h = a[0];
        h.push(a[1]);
        siftDown(h, 0);
        return null;
      }),
      heappop: builtin("heappop", (a) => {
        const h = a[0];
        if (!h.length) fail(rt.exc.IndexError, "index out of range");
        const top = h[0];
        h[0] = h[h.length - 1];
        h.pop();
        siftDown(h, 0);
        return top;
      }),
      heapify: builtin("heapify", (a) => { for (let i = Math.floor(a[0].length / 2) - 1; i >= 0; i--) siftDown(a[0], i); return null; }),
      heappushpop: builtin("heappushpop", (a) => { const r = a[0][0] === undefined || order(a[1], a[0][0]) < 0 ? (a[0].unshift(a[1]), siftDown(a[0], 0), a[0].shift()) : a[0][0]; return r; }),
      nsmallest: builtin("nsmallest", (a) => iterItems(a[1]).sort((x, y) => order(x, y)).slice(0, asNum(a[0]))),
      nlargest: builtin("nlargest", (a) => iterItems(a[1]).sort((x, y) => order(y, x)).slice(0, asNum(a[0]))),
    });
    function siftDown(h, i) {
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < h.length && order(h[l], h[m]) < 0) m = l;
        if (r < h.length && order(h[r], h[m]) < 0) m = r;
        if (m === i) return;
        const t = h[i]; h[i] = h[m]; h[m] = t;
        i = m;
      }
    }

    mod("textwrap", {
      wrap: builtin("wrap", (a) => {
        const width = a[1] == null ? 70 : asNum(a[1]);
        return String(pyStr(a[0])).split("\n").flatMap((para) => {
          const words = para.split(/\s+/).filter(Boolean);
          const lines = [];
          let cur = "";
          for (const w of words) {
            if (!cur.length) cur = w;
            else if (cur.length + 1 + w.length <= width) cur += " " + w;
            else { lines.push(cur); cur = w; }
          }
          if (cur.length) lines.push(cur);
          return lines;
        });
      }),
      fill: builtin("fill", (a) => mod("textwrap").dict.get("wrap")(a).join("\n")),
      dedent: builtin("dedent", (a) => {
        const lines = String(pyStr(a[0])).split("\n");
        const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^[ \t]*/)[0].length);
        const n = indents.length ? Math.min.apply(null, indents) : 0;
        return lines.map((l) => l.slice(n)).join("\n");
      }),
      indent: builtin("indent", (a) => String(pyStr(a[0])).split("\n").map((l) => (l.trim() ? pyStr(a[1]) + l : l)).join("\n")),
      shorten: builtin("shorten", (a) => pyStr(a[0])),
    });

    mod("copy", {
      copy: builtin("copy", (a) => (Array.isArray(a[0]) ? a[0].slice() : a[0] && a[0].kind === "dict" ? { kind: "dict", items: a[0].items.map((e) => e.slice()) } : a[0] && a[0].kind === "set" ? { kind: "set", items: a[0].items.slice() } : a[0])),
      deepcopy: builtin("deepcopy", (a) => {
        const seen = new Map();
        const walk = (v) => {
          if (Array.isArray(v)) { if (seen.has(v)) return seen.get(v); const out = []; seen.set(v, out); v.forEach((x) => out.push(walk(x))); return out; }
          if (v && v.kind === "dict") { if (seen.has(v)) return seen.get(v); const out = emptyDict(); seen.set(v, out); v.items.forEach(([k, x]) => dictSet(out, k, walk(x))); return out; }
          if (v && v.kind === "set") { if (seen.has(v)) return seen.get(v); const out = { kind: "set", items: [] }; seen.set(v, out); v.items.forEach((x) => setAdd(out, walk(x))); return out; }
          if (v && v.kind === "tuple") return tuple(v.items.map(walk));
          if (v && v.kind === "inst") { const out = { kind: "inst", cls: v.cls, dict: new Map() }; seen.set(v, out); for (const [k, x] of v.dict) out.dict.set(k, walk(x)); return out; }
          return v;
        };
        return walk(a[0]);
      }),
    });

    const operatorMod = mod("operator", {});
    for (const [name, fn] of Object.entries({
      add: (a) => binOp("+", a[0], a[1]), sub: (a) => binOp("-", a[0], a[1]), mul: (a) => binOp("*", a[0], a[1]),
      truediv: (a) => binOp("/", a[0], a[1]), floordiv: (a) => binOp("//", a[0], a[1]), mod: (a) => binOp("%", a[0], a[1]),
      pow: (a) => binOp("**", a[0], a[1]), and_: (a) => binOp("&", a[0], a[1]), or_: (a) => binOp("|", a[0], a[1]),
      xor: (a) => binOp("^", a[0], a[1]), lshift: (a) => binOp("<<", a[0], a[1]), rshift: (a) => binOp(">>", a[0], a[1]),
      neg: (a) => unary("-", a[0]), not_: (a) => !truth(a[0]), abs: (a) => Math.abs(asNum(a[0])),
      eq: (a) => pyEq(a[0], a[1]), ne: (a) => !pyEq(a[0], a[1]), lt: (a) => cmp("<", a[0], a[1]),
      le: (a) => cmp("<=", a[0], a[1]), gt: (a) => cmp(">", a[0], a[1]), ge: (a) => cmp(">=", a[0], a[1]),
      truth: (a) => truth(a[0]), is_: (a) => a[0] === a[1], is_not: (a) => a[0] !== a[1],
      contains: (a) => contains(a[0], a[1]), length_hint: (a) => asNum(a[0]).length,
    })) operatorMod.dict.set(name, builtin(name, fn));
    operatorMod.dict.set("__item", builtin("item", (a) => subscriptRaw(a[0], a[1])));
    operatorMod.dict.set("itemgetter", builtin("itemgetter", (a) => {
      const keys = a.length === 1 ? [a[0]] : a;
      // Operators get evaluated values, not AST nodes — so item lookup goes
      // through subscriptRaw rather than subscript.
      const lookup = operatorMod.dict.get("__item");
      return builtin("itemgetter", (inner) => (keys.length === 1 ? call(lookup, [inner[0], keys[0]], new Map()) : keys.map((k) => call(lookup, [inner[0], k], new Map()))));
    }));
    operatorMod.dict.set("attrgetter", builtin("attrgetter", (a) => {
      const path = a.length === 1 ? [a[0]] : a;
      return builtin("attrgetter", (inner) => path.reduce((v, p) => getAttr(v, pyStr(p)), inner[0]));
    }));

    mod("bisect", {
      bisect_left: builtin("bisect_left", (a) => bisectIn(iterItems(a[0]), a[1])),
      bisect_right: builtin("bisect_right", (a) => bisectIn(iterItems(a[0]), a[1]) + (pyEq(iterItems(a[0])[bisectIn(iterItems(a[0]), a[1])], a[1]) ? 1 : 0)),
      insort: builtin("insort", (a) => { const xs = a[0]; xs.splice(bisectIn(xs, a[1]), 0, a[1]); return null; }),
      insort_left: builtin("insort_left", (a) => { const xs = a[0]; xs.splice(bisectIn(xs, a[1]), 0, a[1]); return null; }),
      insort_right: builtin("insort_right", (a) => { const xs = a[0]; xs.splice(bisectIn(xs, a[1]) + (pyEq(xs[bisectIn(xs, a[1])], a[1]) ? 1 : 0), 0, a[1]); return null; }),
    });
    function bisectIn(xs, v) {
      let lo = 0, hi = xs.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (order(xs[mid], v) < 0) lo = mid + 1; else hi = mid; }
      return lo;
    }

    mod("platform", {
      system: builtin("system", () => (typeof navigator !== "undefined" ? navigator.platform || "browser" : "browser")),
      machine: builtin("machine", () => "wasm"),
      python_version: builtin("python_version", () => "3.12.7"),
      python_implementation: builtin("python_implementation", () => "CPython"),
      uname: builtin("uname", () => tuple(["Linux", "htp.sh", "6.6.6-htp", "#1", "wasm", "browser"])),
    });

    mod("unicodedata", {
      normalize: builtin("normalize", (a) => pyStr(a[1])),
      name: builtin("name", (a) => "U+" + [...pyStr(a[0])].map((c) => c.codePointAt(0).toString(16).toUpperCase()).join(" ")),
      lookup: builtin("lookup", (a) => pyStr(a[0])),
    });

    const shutilMod = mod("shutil", {});
    void shutilMod;

    /* ── dataclasses ────────────────────────────────────────────────────────
     * The decorator rewrites an annotated class into an explicit __init__,
     * __repr__ and __eq__. Field order is source order; `field(...)` values
     * keep their default. `x: T` with no value is a required field, as in
     * CPython — so `P()` raises TypeError until every field is supplied. */
    const FIELD_MARK = "__field_default__";
    function dataclassDecorator(cls, kwargs) {
      const fields = [];
      const wantOrder = kwargs && kwargs.has("order") ? truth(kwargs.get("order")) : false;
      const wantEq = kwargs && kwargs.has("eq") ? truth(kwargs.get("eq")) : true;
      const wantRepr = kwargs && kwargs.has("repr") ? truth(kwargs.get("repr")) : true;
      const decls = cls.dict.get("__annotations__");
      if (decls && decls.kind === "dict") {
        for (const [name, annotation] of decls.items) {
          const key = String(name);
          const slot = cls.dict.get(name);
          const sentinel = slot && slot.kind === "field";
          fields.push({
            name: key,
            annotation,
            hasDefault: sentinel || slot !== undefined,
            default: sentinel ? slot.dict.get("default") : slot,
            compare: sentinel ? truth(slot.dict.get("compare")) : true,
            repr: sentinel ? truth(slot.dict.get("repr")) : true,
          });
        }
      }
      if (wantOrder) {
        fields.sort((a, b) => (a.hasDefault === b.hasDefault ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : a.hasDefault ? 1 : -1));
      }
      // Required fields bind positionally; defaulted fields are keyword-first.
      const required = fields.filter((f) => !f.hasDefault);
      const optional = fields.filter((f) => f.hasDefault);
      const ordered = required.concat(optional);
      cls.dict.set("__init__", builtin("__init__", (args, kws) => {
        const self = args[0];
        // Positional binding runs across the whole ordered field list, exactly
        // as it would for a hand-written __init__ — defaulted fields are simply
        // later in the order, so P(2) must not silently fall back to P(x=1).
        let i = 1;
        for (const f of ordered) {
          if (i < args.length) { self.dict.set(f.name, args[i++]); continue; }
          if (kws && kws.has(f.name)) { self.dict.set(f.name, kws.get(f.name)); continue; }
          if (f.hasDefault) { self.dict.set(f.name, f.default); continue; }
          fail(rt.exc.TypeError, "__init__() missing required argument: '" + f.name + "'");
        }
        const post = self.dict.get("__post_init__");
        if (post) call(post, [], new Map());
        return null;
      }));
      if (wantRepr) {
        cls.dict.set("__repr__", builtin("__repr__", (args) => cls.name + "(" + ordered.filter((f) => f.repr).map((f) => f.name + "=" + pyRepr(args[0].dict.get(f.name))).join(", ") + ")"));
      }
      if (wantEq) {
        cls.dict.set("__eq__", builtin("__eq__", (args) => {
          if (!args[1] || args[1].kind !== "inst" || args[1].cls !== cls) return false;
          return fields.filter((f) => f.compare).every((f) => pyEq(args[0].dict.get(f.name), args[1].dict.get(f.name)));
        }));
      }
      cls.dict.set("__dataclass_fields__", tuple(fields.map((f) => {
        const t = { kind: "class", name: "Field", bases: [], dict: new Map() };
        return { kind: "inst", cls: t, dict: new Map([["name", f.name], ["type", f.annotation], ["default", f.hasDefault ? f.default : null]]) };
      })));
      return cls;
    }
    function fieldFactory(defaultValue, kwargs) {
      const d = emptyDict();
      dictSet(d, "default", defaultValue == null ? null : defaultValue);
      dictSet(d, "init", !(kwargs && kwargs.has("init")) || truth(kwargs.get("init")));
      dictSet(d, "repr", !(kwargs && kwargs.has("repr")) || truth(kwargs.get("repr")));
      dictSet(d, "compare", !(kwargs && kwargs.has("compare")) || truth(kwargs.get("compare")));
      return { kind: "field", name: "field", dict: d };
    }
    mod("dataclasses", {
      dataclass: builtin("dataclass", (a, kwargs) => {
        const target = a[0];
        if (target && target.kind === "class") return dataclassDecorator(target, kwargs);
        // Bare `@dataclasses.dataclass` (no parens) hands us the function.
        return builtin("dataclass", () => null);
      }),
      field: builtin("field", (a, kwargs) => fieldFactory(a.length ? a[0] : null, kwargs)),
      fields: builtin("fields", (a) => {
        const cls = a[0] && a[0].kind === "inst" ? a[0].cls : a[0];
        const list = cls && cls.dict.get("__dataclass_fields__");
        return list ? snapshot(list) : [];
      }),
      asdict: builtin("asdict", (a) => {
        const d = emptyDict();
        if (a[0] && a[0].kind === "inst") for (const [k, v] of a[0].dict) dictSet(d, k, v);
        return d;
      }),
      astuple: builtin("astuple", (a) => (a[0] && a[0].kind === "inst" ? tuple([...a[0].dict.values()]) : tuple([]))),
      is_dataclass: builtin("is_dataclass", (a) => {
        const c = a[0] && a[0].kind === "inst" ? a[0].cls : a[0];
        return !!(c && c.kind === "class" && c.dict.get("__dataclass_fields__"));
      }),
      replace: builtin("replace", (a, kwargs) => {
        const self = a[0];
        const inst = { kind: "inst", cls: self.cls, dict: new Map() };
        for (const [k, v] of self.dict) inst.dict.set(k, v);
        if (kwargs) for (const [k, v] of kwargs) inst.dict.set(k, v);
        return inst;
      }),
    });
    void FIELD_MARK;

    /* typing: names only. This engine evaluates annotations at def time for
     * their side effects, so the aliases only have to exist. */
    const anyType = { kind: "type", name: "Any", ctor: () => null };
    mod("typing", {
      Any: anyType, Union: anyType, Optional: anyType, Callable: anyType, Iterable: anyType,
      Iterator: anyType, List: TYPE.list, Dict: TYPE.dict, Tuple: TYPE.tuple, Set: TYPE.set,
      FrozenSet: TYPE.frozenset, Type: TYPE.type, NoReturn: anyType, Literal: anyType,
      Sequence: anyType, Mapping: anyType, Generic: { kind: "class", name: "Generic", bases: [], dict: new Map() },
      TYPE_CHECKING: false, Annotated: anyType, Final: anyType, ClassVar: anyType, Protocol: anyType,
    });
    mod("collections.abc", {
      Iterable: anyType, Iterator: anyType, Sequence: anyType, Mapping: anyType,
      Callable: anyType, Generator: anyType, Container: anyType, Sized: anyType,
      Hashable: anyType, MutableMapping: anyType, MutableSequence: anyType, Set: anyType,
    });
    mod("csv", {
      reader: builtin("reader", (a) => fileLines(a[0]).map((line) => line.replace(/\r?\n$/, "").split(","))),
      DictReader: builtin("DictReader", (a) => fileLines(a[0]).map((line) => line.replace(/\r?\n$/, "").split(","))),
      writer: builtin("writer", (a) => {
        const fh = a[0];
        const d = emptyDict();
        dictSet(d, "writerow", builtin("writerow", (inner) => { fileWrite(fh, snapshot(inner[1]).map((x) => (typeof x === "string" ? x : pyStr(x))).join(",") + "\n"); return null; }));
        dictSet(d, "writerows", builtin("writerows", (inner) => { for (const row of snapshot(inner[1])) fileWrite(fh, snapshot(row).map((x) => (typeof x === "string" ? x : pyStr(x))).join(",") + "\n"); return null; }));
        return d;
      }),
    });


    function jsToPy(v) {
      if (v == null) return null;
      if (typeof v === "boolean" || typeof v === "number" || typeof v === "string") return v;
      if (Array.isArray(v)) return v.map(jsToPy);
      if (typeof v === "object") {
        const d = emptyDict();
        for (const k of Object.keys(v)) dictSet(d, k, jsToPy(v[k]));
        return d;
      }
      return pyStr(v);
    }
    function pyToJs(v) {
      if (v == null || typeof v === "boolean" || typeof v === "number" || typeof v === "string") return v;
      if (Array.isArray(v)) return v.map(pyToJs);
      if (v.kind === "tuple") return v.items.map(pyToJs);
      if (v.kind === "dict") {
        const o = {};
        v.items.forEach(([k, val]) => { o[pyStr(k)] = pyToJs(val); });
        return o;
      }
      if (v.kind === "bytes") return fromUtf8(v.data);
      return pyStr(v);
    }

    function importMod(name) {
      if (rt.modules.has(name)) return rt.modules.get(name);
      const parent = name.split(".").slice(0, -1).join(".");
      if (parent && rt.modules.has(parent)) {
        const child = name.split(".").pop();
        try { return getAttr(rt.modules.get(parent), child); } catch (e) { /* fall through */ }
      }
      fail(rt.exc.ImportError, "no module named " + name);
    }

    makeType("int", (args) => {
      if (!args.length) return 0;
      if (typeof args[0] === "boolean") return args[0] ? 1 : 0;
      if (typeof args[0] === "number") return Math.trunc(args[0]);
      const s = String(args[0]).trim();
      const base = args[1] == null ? 10 : asNum(args[1]);
      const n = parseInt(s, base);
      if (!Number.isFinite(n)) fail(rt.exc.ValueError, "invalid literal for int(): " + pyRepr(args[0]));
      return n;
    });
    makeType("float", (args) => {
      if (!args.length) return 0;
      const n = typeof args[0] === "number" ? args[0] : parseFloat(String(args[0]));
      if (!Number.isFinite(n)) fail(rt.exc.ValueError, "could not convert to float");
      return n;
    });
    makeType("str", (args) => (args.length ? pyStr(args[0]) : ""));
    makeType("bool", (args) => (args.length ? truth(args[0]) : false));
    makeType("list", (args) => (args.length ? snapshot(args[0]) : []));
    makeType("tuple", (args) => tuple(args.length ? snapshot(args[0]) : []));
    makeType("dict", (args) => {
      if (!args.length) return emptyDict();
      if (args[0] && args[0].kind === "dict") return { kind: "dict", items: args[0].items.map(([k, v]) => [k, v]) };
      // dict(Counter(...)), dict(mapping), dict(zip(...)) — anything with keys().
      if (args[0] && args[0].kind === "inst" && findClass(args[0].cls, "keys")) {
        const d = emptyDict();
        const keys = call(getAttr(args[0], "keys"), [], new Map());
        for (const k of snapshot(keys)) dictSet(d, k, call(getAttr(args[0], "__getitem__"), [k], new Map()));
        return d;
      }
      const d = emptyDict();
      snapshot(args[0]).forEach((pair) => {
        const seq = snapshot(pair);
        dictSet(d, seq[0], seq[1]);
      });
      return d;
    });
    makeType("set", (args) => {
      const s = { kind: "set", items: [] };
      if (args.length) snapshot(args[0]).forEach((v) => setAdd(s, v));
      return s;
    });
    makeType("frozenset", (args) => {
      const s = { kind: "frozenset", items: [] };
      if (args.length) snapshot(args[0]).forEach((v) => setAdd(s, v));
      return s;
    });
    makeType("bytes", (args) => {
      if (!args.length) return makeBytes([]);
      if (typeof args[0] === "string") return makeBytes(toUtf8(args[0]));
      if (args[0] && args[0].kind === "bytes") return makeBytes(args[0].data);
      return makeBytes(snapshot(args[0]).map((n) => asNum(n) & 255));
    });
    makeType("type", (args) => {
      if (!args.length) return TYPE.type;
      return typeOf(args[0]);
    });
    TYPE.NoneType = { kind: "type", name: "NoneType", ctor: () => null };
    function typeOf(v) {
      if (v == null) return TYPE.NoneType;
      if (typeof v === "boolean") return TYPE.bool;
      if (typeof v === "number") return Number.isInteger(v) ? TYPE.int : TYPE.float;
      if (typeof v === "string") return TYPE.str;
      if (Array.isArray(v)) return TYPE.list;
      if (v.kind === "tuple") return TYPE.tuple;
      if (v.kind === "dict") return TYPE.dict;
      if (v.kind === "set") return TYPE.set;
      if (v.kind === "frozenset") return TYPE.frozenset;
      if (v.kind === "bytes") return TYPE.bytes;
      if (v.kind === "class" || v.kind === "type") return TYPE.type;
      if (v.kind === "inst") return v.cls;
      return { kind: "type", name: v.kind || "object", ctor: () => null };
    }

    const builtins = {
      print: builtin("print", (args, kwargs) => {
        const sep = kwargs.has("sep") ? pyStr(kwargs.get("sep")) : " ";
        const end = kwargs.has("end") ? pyStr(kwargs.get("end")) : "\n";
        write(args.map((a) => (typeof a === "string" ? a : pyStr(a))).join(sep) + end);
        return null;
      }),
      len: builtin("len", (a) => {
        const v = a[0];
        if (typeof v === "string" || Array.isArray(v)) return v.length;
        if (v && (v.kind === "tuple" || v.kind === "set" || v.kind === "frozenset")) return v.items.length;
        if (v && v.kind === "dict") return v.items.length;
        if (v && v.kind === "bytes") return v.data.length;
        if (v && v.kind === "range") return snapshot(v).length;
        const custom = dunderLen(v);
        if (custom !== null) return custom;
        fail(rt.exc.TypeError, "len() of " + typeName(v));
      }),
      range: builtin("range", (a) => {
        let start = 0, stop = 0, step = 1;
        if (a.length === 1) stop = asNum(a[0]);
        else if (a.length >= 2) { start = asNum(a[0]); stop = asNum(a[1]); if (a[2] != null) step = asNum(a[2]); }
        if (step === 0) fail(rt.exc.ValueError, "range() step argument must not be zero");
        return { kind: "range", start, stop, step };
      }),
      abs: builtin("abs", (a) => Math.abs(asNum(a[0]))),
      min: builtin("min", (a, kwargs) => extreme(a, kwargs, true)),
      max: builtin("max", (a, kwargs) => extreme(a, kwargs, false)),
      sum: builtin("sum", (a) => snapshot(a[0]).reduce((n, x) => n + asNum(x), a[1] == null ? 0 : asNum(a[1]))),
      sorted: builtin("sorted", (a, kwargs) => {
        const key = kw(kwargs, "key", null);
        const rev = truth(kw(kwargs, "reverse", false));
        const arr = snapshot(a[0]);
        arr.sort((x, y) => {
          const xx = key ? call(key, [x]) : x;
          const yy = key ? call(key, [y]) : y;
          const c = order(xx, yy);
          return rev ? -c : c;
        });
        return arr;
      }),
      reversed: builtin("reversed", (a) => snapshot(a[0]).reverse()),
      enumerate: builtin("enumerate", (a) => {
        const start = a[1] == null ? 0 : asNum(a[1]);
        return snapshot(a[0]).map((v, i) => tuple([start + i, v]));
      }),
      zip: builtin("zip", (a) => {
        const cols = a.map(snapshot);
        const n = cols.reduce((m, c) => Math.min(m, c.length), cols.length ? cols[0].length : 0);
        const out = [];
        for (let i = 0; i < n; i++) out.push(tuple(cols.map((c) => c[i])));
        return out;
      }),
      any: builtin("any", (a) => snapshot(a[0]).some((x) => truth(x))),
      all: builtin("all", (a) => snapshot(a[0]).every((x) => truth(x))),
      map: builtin("map", (a) => snapshot(a[1]).map((v) => call(a[0], [v]))),
      filter: builtin("filter", (a) => snapshot(a[1]).filter((v) => (a[0] == null ? truth(v) : truth(call(a[0], [v]))))),
      isinstance: builtin("isinstance", (a) => isinstance(a[0], a[1])),
      issubclass: builtin("issubclass", (a) => isSub(a[0], a[1])),
      type: TYPE.type,
      repr: builtin("repr", (a) => pyRepr(a[0])),
      ord: builtin("ord", (a) => String(a[0]).codePointAt(0)),
      chr: builtin("chr", (a) => String.fromCodePoint(asNum(a[0]))),
      hex: builtin("hex", (a) => "0x" + asNum(a[0]).toString(16)),
      round: builtin("round", (a) => {
        const n = asNum(a[0]);
        const d = a[1] == null ? 0 : asNum(a[1]);
        const p = 10 ** d;
        return Math.round(n * p) / p;
      }),
      pow: builtin("pow", (a) => asNum(a[0]) ** asNum(a[1])),
      divmod: builtin("divmod", (a) => tuple([Math.floor(asNum(a[0]) / asNum(a[1])), asNum(a[0]) % asNum(a[1])])),
      hasattr: builtin("hasattr", (a) => { try { getAttr(a[0], pyStr(a[1])); return true; } catch (e) { return false; } }),
      getattr: builtin("getattr", (a) => { try { return getAttr(a[0], pyStr(a[1])); } catch (e) { if (a.length > 2) return a[2]; throw e; } }),
      setattr: builtin("setattr", (a) => { setAttr(a[0], pyStr(a[1]), a[2]); return null; }),
      iter: builtin("iter", (a) => ({ kind: "iter", items: snapshot(a[0]), i: 0 })),
      next: builtin("next", (a) => {
        const it = a[0] && a[0].kind === "iter" ? a[0] : { kind: "iter", items: snapshot(a[0]), i: 0 };
        if (it.i >= it.items.length) {
          if (a.length > 1) return a[1];
          fail(rt.exc.StopIteration, "");
        }
        return it.items[it.i++];
      }),
      open: builtin("open", openFile),
      // `input()` reads from the page's own prompt when the IDE wired one up;
      // with no terminal (tests, SSR) it returns "" rather than blocking.
      input: builtin("input", (a) => {
        if (a.length) write(pyStr(a[0]));
        return rt.inputHook ? String(rt.inputHook(pyStr(a[0]))) : "";
      }),
      dir: builtin("dir", (a) => {
        if (!a.length) return [...env.map.keys()];
        try { return [...Object.keys(STR_METHODS)]; } catch (e) { return []; }
      }),
      format: builtin("format", (a) => formatSpec(a[0], a[1] == null ? "" : pyStr(a[1]))),
      help: builtin("help", () => {
        write("python3 on htp.sh\nRun the editor, or type at >>> .\nCommands: shell, clear. Network is off.\n");
        return null;
      }),
      exit: sysMod.dict.get("exit"),
      quit: sysMod.dict.get("exit"),
      int: TYPE.int,
      float: TYPE.float,
      str: TYPE.str,
      bool: TYPE.bool,
      list: TYPE.list,
      dict: TYPE.dict,
      tuple: TYPE.tuple,
      set: TYPE.set,
      bytes: TYPE.bytes,
      bytearray: TYPE.bytes,
      complex: builtin("complex", (a) => ({ kind: "inst", cls: { kind: "class", name: "complex", bases: [], dict: new Map() }, dict: new Map([["real", a.length ? asNum(a[0]) : 0], ["imag", a.length > 1 ? asNum(a[1]) : 0]]) })),
      object: { kind: "class", name: "object", bases: [], dict: new Map() },
      __name__: "__main__",

      /* --- introspection / eval. `eval` and `exec` run in the same interpreter
       * and the same sandbox as everything else: same step budget, same in-memory
       * filesystem, same import registry, same denyNet(). --- */
      eval: builtin("eval", (a) => {
        const src = pyStr(a[0]);
        // eval(expr, globals, locals) — the locals dict is the frame's own map,
        // so names assigned inside the expression land where the caller expects.
        const frame = a[2] && a[2].kind === "dict" ? frameFromLocals(a[2]) : a[1] && a[1].kind === "dict" ? new Env(env) : env;
        const tree = new Parser(lex(src)).parseFile();
        let last = null;
        for (const st of tree.body) {
          if (st.type === "expr") last = ev(st.value, frame);
          else { exec(st, frame); last = null; }
        }
        return last;
      }),
      exec: builtin("exec", (a) => {
        const src = pyStr(a[0]);
        const tree = new Parser(lex(src)).parseFile();
        // Without an explicit namespace, `exec("z=9")` must make `z` visible
        // afterwards — so it targets the module frame, not a throwaway child.
        const frame = a[2] && a[2].kind === "dict" ? frameFromGlobals(a[2]) : env;
        for (const st of tree.body) exec(st, frame);
        return null;
      }),
      compile: builtin("compile", (a) => {
        const src = pyStr(a[0]);
        const mode = pyStr(a[2] == null ? "exec" : a[2]);
        if (mode === "exec") return new Parser(lex(src)).parseFile();
        if (mode === "eval") return { type: "module", body: [{ type: "expr", value: new Parser(lex(src)).parseTest(), line: 1 }], line: 1 };
        fail(rt.exc.ValueError, "compile() mode must be 'exec' or 'eval'");
      }),
      globals: builtin("globals", () => globalsView()),
      locals: builtin("locals", () => globalsView()),
      vars: builtin("vars", (a) => {
        if (!a.length) return globalsView();
        if (a[0] && a[0].kind === "dict") return a[0];
        const d = emptyDict();
        for (const k of ["__dict__", "msg", "args"]) if (a[0] && a[0].dict && a[0].dict.has(k)) dictSet(d, k, a[0].dict.get(k));
        if (a[0] && a[0].kind === "inst") for (const [k, v] of a[0].dict) dictSet(d, k, v);
        return d;
      }),
      dir: builtin("dir", (a) => {
        if (!a.length) return [...env.map.keys()].sort();
        const v = a[0];
        if (v == null) fail(rt.exc.TypeError, "dir() argument must be a type or instance");
        if (v.kind === "inst") {
          const out = new Set(v.dict.keys());
          let c = v.cls;
          while (c) { if (c.dict) for (const k of c.dict.keys()) out.add(k); c = (c.bases || [])[0]; }
          return [...out].filter((k) => !k.startsWith("__")).sort();
        }
        if (v.kind === "class") {
          const out = new Set(v.dict ? v.dict.keys() : []);
          let c = v;
          while (c) { if (c.dict) for (const k of c.dict.keys()) out.add(k); c = (c.bases || [])[0]; }
          return [...out].sort();
        }
        if (typeof v === "string") return Object.keys(STR_METHODS).sort();
        if (Array.isArray(v)) return Object.keys(LIST_METHODS).sort();
        return Object.keys(v).sort();
      }),
      id: builtin("id", (a) => idOf(a[0])),
      hash: builtin("hash", (a) => pyHash(a[0])),
      frozenset: builtin("frozenset", (a) => {
        const s = { kind: "frozenset", items: [] };
        if (a.length) snapshot(a[0]).forEach((v) => setAdd(s, v));
        return s;
      }),
      // staticmethod/classmethod keep the function unbound, which is what makes
      // `@staticmethod def s()` callable as `A.s()` with no implicit self.
      staticmethod: builtin("staticmethod", (a) => Object.assign({}, a[0], { static: true })),
      classmethod: builtin("classmethod", (a) => Object.assign({}, a[0], { method: true })),
      property: builtin("property", (a) => ({ kind: "property", fget: a[0], fset: a[1], deleter: a[2] })),
      callable: builtin("callable", (a) => !!(a[0] && (a[0].kind === "func" || a[0].kind === "builtin" || a[0].kind === "class" || a[0].kind === "type" || a[0].kind === "bound"))),
      NotImplemented: Symbol("NotImplemented"),
      Ellipsis: Symbol("Ellipsis"),
      __debug__: true,
      super: builtin("super", superBuiltin),
    };
    function globalsView() {
      const d = emptyDict();
      for (const [k, v] of env.map) if (v !== UNBOUND) dictSet(d, k, v);
      return d;
    }
    /** Python-compatible-enough hash for the immutable types; everything else
     *  raises TypeError("unhashable"), which is what dict keys actually rely on. */
    function pyHash(v) {
      if (v === null) return 5740354900026072187;
      if (v === true) return 1;
      if (v === false) return 0;
      if (typeof v === "number") return v | 0;
      if (typeof v === "string") { let h = 0; for (let i = 0; i < v.length; i++) h = (h * 31 + v.charCodeAt(i)) | 0; return h; }
      if (v && v.kind === "bytes") { let h = 0; for (const b of v.data) h = (h * 33 + b) | 0; return h; }
      if (v && (v.kind === "tuple" || v.kind === "frozenset")) {
        let h = 7;
        for (const x of v.items) h = (h * 31 + pyHash(x)) | 0;
        return h;
      }
      if (v && v.kind === "class") return idOf(v);
      fail(rt.exc.TypeError, "unhashable type: " + typeName(v));
    }
    /** Stable per-object identity for `id()`, `super()` and `hash(class)`. */
    function idOf(v) {
      if (!rt.ids.has(v)) rt.ids.set(v, rt.ids.size + 1);
      return rt.ids.get(v);
    }
    function frameFromLocals(d) {
      const f = new Env(null);
      f.module = env.module;
      for (const [k, v] of d.items) f.map.set(String(k), v);
      return f;
    }
    function dictLookup(src, key) {
      if (src instanceof Map) return src.has(key) ? { ok: true, v: src.get(key) } : { ok: false };
      if (src && src.kind === "dict") return dictGet(src, key);
      return { ok: false };
    }
    function frameFromGlobals(d) {
      const f = new Env(null);
      f.map = env.map;
      f.locals = null;
      f.globals = new Set([...env.map.keys()]);
      f.module = env.module;
      return f;
    }
    function extreme(args, kwargs, isMin) {
      let items = args.length === 1 ? snapshot(args[0]) : args;
      if (!items.length) fail(rt.exc.ValueError, "empty sequence");
      const key = kw(kwargs, "key", null);
      let best = items[0];
      let bestK = key ? call(key, [best]) : best;
      for (let i = 1; i < items.length; i++) {
        const k = key ? call(key, [items[i]]) : items[i];
        const c = order(k, bestK);
        if (isMin ? c < 0 : c > 0) { best = items[i]; bestK = k; }
      }
      return best;
    }
    for (const [k, v] of Object.entries(builtins)) env.set(k, v);
    for (const [k, v] of Object.entries(rt.exc)) env.set(k, v);
    // `print.__name__`, `dir(str)`, `help(len)` — introspection needs these and
    // the terminal's own completion leans on them.
    for (const v of env.map.values()) {
      if (v && (v.kind === "builtin" || v.kind === "func")) {
        if (v.name && !v.__name__) v.__name__ = v.name;
        v.dict = v.dict || new Map([["__name__", v.__name__ || ""], ["__qualname__", v.__name__ || ""]]);
      }
      if (v && v.kind === "class") v.dict.set("__name__", v.name);
    }

    function formatTrace(e, filename) {
      const lines = ["Traceback (most recent call last):"];
      const stack = e.stack && e.stack.length ? e.stack : [{ name: "<module>", line: rt.line || 1 }];
      for (const fr of stack) lines.push('  File "' + filename + '", line ' + (fr.line || 1) + ", in " + fr.name);
      lines.push(e.cls.name + ": " + (e.message || ""));
      return lines.join("\n") + "\n";
    }

    function run(src, filename, opts) {
      filename = filename || "<stdin>";
      const repl = !!(opts && opts.repl);
      const prev = rt.repl;
      rt.repl = repl;
      rt.steps = 0;
      rt.stop = false;
      rt.stack = [{ name: "<module>", line: 1 }];
      const startLen = rt.output.length;
      try {
        const tree = new Parser(lex(src)).parseFile();
        execBody(tree.body, env);
        rt.stack.pop();
        return { output: rt.output.slice(startLen), error: null };
      } catch (e) {
        rt.stack.pop();
        if (e instanceof PyRunError && e.cls === rt.exc.SystemExit) {
          const code = e.inst && e.inst.dict.get("code");
          const chunk = rt.output.slice(startLen);
          if (code === 0 || code == null || code === "0") return { output: chunk, error: null, exit: 0 };
          return { output: chunk, error: e.message ? e.message + "\n" : null, exit: code };
        }
        if (e instanceof SyntaxErr) {
          const msg = '  File "' + filename + '", line ' + e.line + "\nSyntaxError: " + e.message + "\n";
          return { output: rt.output.slice(startLen), error: msg };
        }
        if (e instanceof Incomplete) {
          return { output: rt.output.slice(startLen), error: "SyntaxError: unexpected EOF\n" };
        }
        if (e instanceof PyRunError) {
          return { output: rt.output.slice(startLen), error: formatTrace(e, filename) };
        }
        return { output: rt.output.slice(startLen), error: "RuntimeError: " + (e && e.message ? e.message : e) + "\n" };
      } finally {
        rt.repl = prev;
      }
    }
    function isComplete(src) {
      if (!String(src).trim()) return true;
      try {
        new Parser(lex(src)).parseFile();
        return true;
      } catch (e) {
        return !(e instanceof Incomplete);
      }
    }
    function reset() {
      rt.output = "";
      rt.fs = new Map();
      rt.dirs = new Set(["/"]);
      rt.steps = 0;
      const keep = new Set([...Object.keys(builtins), ...Object.keys(rt.exc)]);
      for (const key of [...env.map.keys()]) if (!keep.has(key)) env.map.delete(key);
      sysMod.dict.set("argv", ["repl.py"]);
    }
    function names(prefix) {
      const out = [];
      let cur = env;
      const seen = new Set();
      while (cur) {
        for (const k of cur.map.keys()) if (!seen.has(k) && k.startsWith(prefix || "")) { seen.add(k); out.push(k); }
        cur = cur.parent;
      }
      return out.sort();
    }
    return { run, isComplete, reset, names, rt };
  }

  /* The engine is pure computation: it creates no listeners, touches no element,
   * and knows nothing about the page. Everything the visitor sees — buttons,
   * keys, prompt, scrollback — belongs to /js/htp-terminal.js, the single owner
   * of that DOM.
   *
   * That split used to be blurred: attach() also bound #py-run / #py-clear /
   * #mode-toggle plus its own keydown handler on #py-code. htp-terminal.js binds
   * the same controls, so every interaction fired twice — Run executed the file
   * twice and printed its output twice, once formatted by each shell; Tab
   * indented by eight spaces because two handlers each inserted four; and the
   * mode button drove two different state machines with one click.
   *
   * setMode stays, because it records the shell's own mode; the button and
   * prompt-label mutation that used to live here is gone with the rest.
   */
  function attach() {
    const py = createPython();
    const api = {
      mode: "python",
      buffer: "",
      engine: py,
      pending() { return this.buffer.length > 0; },
      resetBuffer() { this.buffer = ""; },
      setMode(mode) {
        this.mode = mode === "shell" ? "shell" : "python";
      },
      banner() {
        return "Python 3.12.7 (htp shell) on the page\nNetwork is off. This shell does not open sockets or fetch URLs.\nType shell for the carrier tty. Run executes the editor.\n";
      },
      pushLine(line) {
        const text = this.buffer ? this.buffer + "\n" + line : line;
        if (!String(line).trim() && this.buffer) {
          this.buffer = "";
          return Object.assign({ incomplete: false }, py.run(text, "<stdin>", { repl: true }));
        }
        if (!String(text).trim()) return { incomplete: false, output: "", error: null };
        if (!py.isComplete(text)) {
          this.buffer = text;
          return { incomplete: true, output: "", error: null };
        }
        this.buffer = "";
        return Object.assign({ incomplete: false }, py.run(text, "<stdin>", { repl: true }));
      },
      runFile(src) {
        this.buffer = "";
        return py.run(src, "repl.py", { repl: false });
      },
      /** Cooperative interrupt; the next run() clears rt.stop on entry. */
      stop() { py.rt.stop = true; },
      reset() { this.buffer = ""; py.reset(); },
      complete(prefix) { return py.names(prefix || ""); },
    };
    root.HTPPython = api;
    return api;
  }

  const exported = { createPython, attach };
  root.HTPPyShell = exported;
  if (typeof document !== "undefined") attach();
})(typeof globalThis !== "undefined" ? globalThis : this);
