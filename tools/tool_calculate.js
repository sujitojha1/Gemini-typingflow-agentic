// Safe math evaluator (no eval — MV3 CSP compliant)
function safeEval(expr) {
    const src = String(expr).replace(/\s+/g, '');
    let pos = 0;

    const FUNCS = {
        sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor,
        ceil: Math.ceil, sin: Math.sin, cos: Math.cos, tan: Math.tan,
        log: Math.log, log2: Math.log2, log10: Math.log10, exp: Math.exp,
        pow: Math.pow, min: (...a) => Math.min(...a), max: (...a) => Math.max(...a),
        sum: (...a) => a.reduce((x, y) => x + y, 0),
        sign: Math.sign, trunc: Math.trunc,
    };
    const CONSTS = { PI: Math.PI, pi: Math.PI, E: Math.E, e: Math.E };

    function peek()         { return pos < src.length ? src[pos] : null; }
    function consume(n = 1) { const s = src.slice(pos, pos + n); pos += n; return s; }

    function parseNumber() {
        const m = src.slice(pos).match(/^\d+(\.\d+)?([eE][+-]?\d+)?/);
        if (!m) throw new Error('Expected number at: ' + src.slice(pos, pos + 10));
        pos += m[0].length;
        return parseFloat(m[0]);
    }
    function parseIdent() {
        const m = src.slice(pos).match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
        if (!m) throw new Error('Expected identifier at: ' + src.slice(pos, pos + 10));
        pos += m[0].length;
        return m[0];
    }

    function parseExpr() { return parseAddSub(); }
    function parseAddSub() {
        let v = parseMulDiv();
        while (pos < src.length && (src[pos] === '+' || src[pos] === '-')) {
            const op = consume();
            v = op === '+' ? v + parseMulDiv() : v - parseMulDiv();
        }
        return v;
    }
    function parseMulDiv() {
        let v = parsePow();
        while (pos < src.length &&
               ((src[pos] === '*' && src[pos + 1] !== '*') || src[pos] === '/' || src[pos] === '%')) {
            const op = consume();
            v = op === '*' ? v * parsePow() : op === '/' ? v / parsePow() : v % parsePow();
        }
        return v;
    }
    function parsePow() {
        let base = parseUnary();
        if (pos < src.length && src.slice(pos, pos + 2) === '**') {
            consume(2);
            base = Math.pow(base, parseUnary());
        }
        return base;
    }
    function parseUnary() {
        if (peek() === '-') { consume(); return -parsePrimary(); }
        if (peek() === '+') { consume(); return parsePrimary(); }
        return parsePrimary();
    }
    function parsePrimary() {
        if (peek() === '(') {
            consume();
            const v = parseExpr();
            if (peek() !== ')') throw new Error('Expected )');
            consume();
            return v;
        }
        if (/\d/.test(peek())) return parseNumber();
        if (/[a-zA-Z_]/.test(peek())) {
            const name = parseIdent();
            if (name in CONSTS) return CONSTS[name];
            if (peek() === '(') {
                consume();
                const args = [];
                if (peek() !== ')') {
                    args.push(parseExpr());
                    while (peek() === ',') { consume(); args.push(parseExpr()); }
                }
                if (peek() !== ')') throw new Error('Expected ) after args for ' + name);
                consume();
                if (!(name in FUNCS)) throw new Error('Unknown function: ' + name);
                return FUNCS[name](...args);
            }
            throw new Error('Unknown identifier: ' + name);
        }
        throw new Error('Unexpected character: ' + peek());
    }

    const result = parseExpr();
    if (pos < src.length) throw new Error('Trailing characters: ' + src.slice(pos));
    return result;
}

function toolCalculate({ expression }) {
    try {
        const result = safeEval(String(expression));
        return JSON.stringify({ result: String(result) });
    } catch (e) {
        return JSON.stringify({ error: 'Calculation failed: ' + e.message });
    }
}
