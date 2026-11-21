import re, sys
from rapidocr_onnxruntime import RapidOCR

IMG = sys.argv[1] if len(sys.argv) > 1 else r"testbill\bill1.jpeg"
COLS = {"hsn": (540, 600), "qty": (610, 670), "incl": (680, 760),
        "excl": (765, 830), "amt": (895, 960)}

def num(s):
    d = re.sub(r"\D", "", s)
    return int(d) / 100 if d else None

result, _ = RapidOCR()(IMG)
toks = [(int(b[0][0]), int(b[0][1]), t.strip(), float(c)) for b, t, c in result]

def col(name, pattern, y0=None, y1=None):
    lo, hi = COLS[name]
    out = [t for t in toks if lo <= t[0] <= hi and re.fullmatch(pattern, t[2])
           and (y0 is None or t[1] >= y0) and (y1 is None or t[1] <= y1)]
    return sorted(out, key=lambda t: t[1])

hsn = col("hsn", r"\d{8}")
qty = col("qty", r"\d+(?:\.\d+)?\s*PCS")
if not hsn or not qty:
    print("HSN ya Qty nahi mili"); sys.exit()
top = hsn[0][1] - 25
bottom = qty[-1][1] + 14
incl = col("incl", r"[\d.,]+", top, bottom)
excl = col("excl", r"[\d.,]+", top, bottom)
amt = col("amt", r"[\d.,]+", top, bottom)
below = col("amt", r"[\d.,]+", bottom + 1)

counts = [len(hsn), len(qty), len(incl), len(excl), len(amt)]
print("Counts HSN/Qty/Incl/Excl/Amt:", counts)
if len(set(counts)) != 1:
    print("WARNING: counts match nahi karte, rukna padega"); sys.exit()

tq, ta = 0, 0.0
for i in range(len(hsn)):
    q = float(re.match(r"\d+(?:\.\d+)?", qty[i][2]).group())
    ri, rx, a = num(incl[i][2]), num(excl[i][2]), num(amt[i][2])
    flags = []
    if rx and abs(q * rx - a) > 0.01 * q + 0.02 and a and ri:
        fixed = round(a / q, 2)
        if abs(ri / fixed - 1.18) <= 0.005:
            flags.append(f"AUTO-FIXED excl {rx:,.2f} -> {fixed:,.2f}")
            rx = fixed
    if not rx or abs(q * rx - a) > 0.01 * q + 0.02:
        flags.append("qty x excl != amount")
    if not rx or abs(ri / rx - 1.18) > 0.005:
        flags.append("incl/excl != 1.18")
    tq += q
    ta += a
    status = "OK" if not flags else "CHECK: " + ", ".join(flags)
    print(f"{i+1:>2} {hsn[i][2]} qty={q:g} incl={ri:,.2f} excl={rx:,.2f} amt={a:,.2f} {status}")

print("Total qty:", tq, "(bill: 37)")
print("Sum of amounts:", round(ta, 2))
if below:
    print("Printed total:", num(below[0][2]))


print()
print("--- DESCRIPTIONS ---")
hy = [h[1] for h in hsn]
buckets = [[] for _ in hy]
for x, y, text, c in toks:
    if not (190 <= x <= 450) or c < 0.85:
        continue
    if text.isdigit() and len(text) <= 2:
        continue
    best, bd = None, 999
    for i, h in enumerate(hy):
        d = (y + 20) - h
        if abs(d) < bd:
            best, bd = i, abs(d)
    if bd <= 14:
        buckets[best].append((y, text))
rows = []
for b in buckets:
    b.sort()
    rows.append([t for _, t in b])
for i in range(1, len(rows)):
    first = rows[i][0] if rows[i] else ""
    if re.fullmatch(r"GODREJ(2026)?", first):
        rows[i - 1].append(first)
        rows[i] = rows[i][1:]
for i, r in enumerate(rows, 1):
    s = " ".join(r)
    s = re.sub(rf"^{i}(?=[A-Z0-9])", "", s)
    s = re.sub(r"(?<=[A-Z])L$", "", s) if s.endswith("SAMSUNGL") else s
    print(i, s)