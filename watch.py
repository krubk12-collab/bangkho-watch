"""ตัวเฝ้า bangkho.ac.th — รันบน GitHub Actions ทุก 10 นาที (สร้างหลังโฮสต์ระงับบัญชี 15 ก.ย.69)

อ่าน access log สดจาก DirectAdmin + ยอดแบนด์วิดท์รายเดือน + ลองเปิดหน้าเว็บจริง
→ เกินเกณฑ์ส่ง LINE (ผ่าน GAS notify ตัวเดียวกับ daily-digest) → เขียน status.json ให้หน้าสถานะ

env: DA_USER DA_PASS LINE_NOTIFY_URL LINE_NOTIFY_KEY · OUT_DIR (ค่าเริ่มต้น site) · DRY_RUN=1 = พิมพ์แทนส่ง LINE
repo นี้เป็นสาธารณะ: ห้าม print IP/ข้อความเตือนลง log ของ Actions · IP ใน status.json/state.json ต้องปิดบังเสมอ
"""
import base64, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

try:
    import truststore; truststore.inject_into_ssl()   # เครื่อง notey ต้องใช้ใบรับรองของ Windows
except ImportError:
    pass

BKK = timezone(timedelta(hours=7))
SITE = "https://bangkho.ac.th"
DA = "https://ns105.hostinglotus.net:2222"          # ใช้ IP:2222 จะโดน 301 มาชื่อนี้
PAGE_URL = "https://krubk12-collab.github.io/bangkho-watch/"
CHECK_PATHS = ["/", "/home/", "/behave/", "/keep/", "/photo/", "/check/", "/sos/"]
MB = 1_000_000

# ตรวจ "ท่อ" ของแต่ละระบบ (ชิ้นที่ 2, 18 ก.ย.69) — ยิงประตู health.php ที่วางไว้ในแต่ละระบบ
# min = ไฟล์ข้อมูลหลักต้องมีอย่างน้อยกี่ record (จับทะเบียนหาย/ถูกเขียนทับ) · fresh_h = ข้อมูลใหม่สุดต้องไม่เก่ากว่ากี่ชั่วโมง
PHP_SYS = {
    # ตัวเลขเกณฑ์ = ประมาณ 70-80% ของค่าจริงวันที่ติดตั้ง (18 ก.ย.69) เผื่อลบข้อมูลตามปกติ แต่จับ "หายฮวบ" ได้
    "behave": {"name": "พลังวินัยบางโค", "min": {"students.json": 500, "parents.json": 500, "rules.json": 10}},
    "photo":  {"name": "บางโค Photo", "min": {"albums.json": 1}},
    "keep":   {"name": "บางโค Keep", "min": {"items.json": 150, "cats.json": 5}},
    "log":    {"name": "สถิติเข้าชมเว็บ", "fresh_h": 24},
    "size":   {"name": "เช็คเสื้อกีฬาสี", "min": {"2569.json": 150}},
    "order":  {"name": "สั่งวัสดุห้องเรียน", "min": {"catalog.json": 1}},   # catalog เป็น object ซ้อนหมวด ไม่ใช่ list สินค้า
    "gpf":    {"name": "สัญญาณกองทุน กบข.", "min": {}},                      # ไม่มี data/ ดึงราคาสดจาก yahoo.php
    "home":   {"name": "หน้าแรกโรงเรียน", "min": {"config.json": 5}},
    "qr":     {"name": "DinoQR สร้าง QR", "min": {}},
    "test69": {"name": "แบบทดสอบ O-NET", "min": {}},
}
# ระบบที่เป็นเปลือกครอบ GAS — ดึง URL /exec จากหน้าเปลือกเอง (redeploy แล้ว URL เปลี่ยน ห้าม hardcode)
GAS_SYS = {"check": "ระบบเช็คชื่อ", "dd": "ของหายได้คืน", "cer": "เกียรติบัตร",
           "dayoff": "ระบบลา", "result": "ผลนิเทศ", "booking": "จองห้อง",
           "scan": "BK DocScan สแกนเอกสาร", "sup": "ตารางสอน & นิเทศ"}
# ระบบที่หน้าเว็บกับท่อข้อมูลอยู่คนละที่ (ไม่มีเปลือกบนโฮสต์ให้ดึง URL) — ระบุตรง ๆ
LINK_SYS = {
    "time": {"name": "ภาพรวมการสอนปัจจุบัน", "site": SITE + "/time/",
             "pipe": "https://docs.google.com/spreadsheets/d/14ZyWxubxyrpJN3GGN8YE8llP6ynZHHMOHyzrh3v6sng/gviz/tq?tqx=out:csv",
             "pipe_name": "ตารางสอนใน Google Sheets", "least": 1000},
    "cardscan": {"name": "สแกนการ์ดตอบ", "site": "https://krubk12-collab.github.io/bklive-cardscan/",
                 "pipe": "https://script.google.com/macros/s/AKfycbwTID5HorZf1_V3llzh7fpcd_oW96XTQVAvBYPZ1byHu0wyZFTGL8CFA8B5lk9STfku/exec",
                 "pipe_name": "หลังบ้าน GAS", "expect": "ready"},
}
EXEC_RE = re.compile(r"https://script\.google\.com/(?:a/macros/[\w.-]+|macros)/s/[\w-]{40,}/exec")
GAS_BAD = ["Script function not found", "Exception:", "TypeError:", "ReferenceError:",
           "Authorization is required", "Sorry, unable to open the file",
           "Service invoked too many times", "Exceeded maximum execution time"]

# เกณฑ์เตือน — ลูกพี่ตั้งเป้าทั้งเว็บไม่เกิน 1 GB/วัน (15 ก.ย.69)
LIMITS = {
    "burst10_mb": 100,       # ทั้งเว็บใน 10 นาที
    "day_mb": 1000,          # ทั้งเว็บวันนี้
    "file_hour_mb": 200,     # ไฟล์เดียวใน 60 นาที
    "file_hour_req": 50,     # ไฟล์ใหญ่ (≥1 MB ต่อครั้ง) ถูกขอซ้ำกี่ครั้งใน 60 นาที
    "ip_hour_mb": 300,       # IP เดียวใน 60 นาที
    "disk_day_mb": 500,      # พื้นที่โฮสต์โตขึ้นต่อวัน (อัปโหลดจำนวนมาก)
    "month_pct": [70, 90, 100],
}
# log ไม่มีขนาดไฟล์ขาเข้า → นับจำนวน POST ไปจุดที่อัปโหลดสื่อได้ (keep POST ถี่ปกติจากรีโมทเพลง จึงไม่นับ)
UPLOAD_POST_HOUR = {"/photo/api.php": 100, "/home/api.php": 20}

OUT = os.environ.get("OUT_DIR", "site")
DRY = os.environ.get("DRY_RUN") == "1"
LOG_RE = re.compile(r'^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (\S+)[^"]*" (\d{3}) (\d+|-)')
IP_RE = re.compile(r"\b(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}\b")
now = datetime.now(BKK)


def mask(text):
    return IP_RE.sub(r"\1.\2.x.x", text)


def mb(b):
    return f"{b / MB:,.1f} MB" if b < 1000 * MB else f"{b / (1000 * MB):,.2f} GB"


def http(url, auth=False, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": "bangkho-watch/1.0"})
    if auth:
        tok = base64.b64encode(f'{os.environ["DA_USER"]}:{os.environ["DA_PASS"]}'.encode()).decode()
        req.add_header("Authorization", "Basic " + tok)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read()


def check_site():
    out = []
    for p in CHECK_PATHS:
        t0, note = time.time(), ""
        try:
            code, body = http(SITE + p, timeout=25)
            if b"has been suspended" in body[:3000]:
                note = "ถูกระงับบัญชี"
        except urllib.error.HTTPError as e:
            code = e.code
        except Exception as e:
            code, note = 0, "เชื่อมต่อไม่ได้"
        out.append({"path": p, "code": code, "ms": round((time.time() - t0) * 1000),
                    "ok": 0 < code < 400 and not note, "note": note})
    return out


def fetch(url, timeout=30):
    """ยิง URL คืน (code, body) — แอปหลายตัวตอบ 404/403 พร้อมเนื้อหาจริง จึงไม่ถือว่าล้มเหลวทันที"""
    try:
        return http(url, timeout=timeout)
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:
        return 0, f"เชื่อมต่อไม่ได้ ({type(e).__name__})".encode()


def fetch_retry(url, timeout=40):
    """GAS พลาดชั่วคราวได้บ่อย (ตอบ 404/503 คนละอย่างกับตอนเรียกจากเครื่องที่บ้าน) — ลองซ้ำก่อนตัดสินว่าพัง"""
    code, body = fetch(url, timeout)
    if not body or not (0 < code < 400):
        time.sleep(3)
        code, body = fetch(url, timeout)
    return code, body


def site_up(url):
    """หน้าเว็บของระบบยังเปิดได้ไหม (ใช้แยก 🔴 เข้าไม่ได้เลย ออกจาก 🟡 เข้าได้แต่ท่อมีปัญหา)"""
    code, body = fetch(url, timeout=25)
    return 0 < code < 400 and b"has been suspended" not in body[:3000]


def probe_php(slug, cfg):
    """ยิง /{slug}/health.php แล้วตรวจว่าไฟล์ข้อมูลหลักยังครบและยังเขียนได้"""
    r = {"sys": slug, "name": cfg["name"], "kind": "php", "url": f"{SITE}/{slug}/",
         "pipe_name": "ข้อมูลในระบบ", "ok": False, "site": True, "detail": "", "cid": None}
    t0 = time.time()
    code, body = fetch(f"{SITE}/{slug}/health.php", timeout=25)
    try:
        h = json.loads(body)
    except ValueError:
        r["site"] = site_up(r["url"])                    # หน้าเว็บยังอยู่ไหม → ตัดสินว่าเหลืองหรือแดง
        r["detail"] = ("ยังไม่ได้ติดตั้ง health.php" if code == 404 else
                       body.decode("utf-8", "ignore")[:60] if code == 0 else f"ประตูตรวจตอบ HTTP {code}")
        return r

    r["ms"] = round((time.time() - t0) * 1000)
    r["cid"] = (h.get("login") or {}).get("client_id")
    d = h.get("data") or {}
    r["files"], r["newest"], r["age_h"] = d.get("files"), d.get("newest"), d.get("age_h")
    r["counts"] = {f["f"]: f["n"] for f in d.get("top", []) if f.get("n") is not None}

    problems = list(h.get("note") or []) if not h.get("ok") else []
    for fname, least in (cfg.get("min") or {}).items():
        n = r["counts"].get(fname)
        if n is None:
            problems.append(f"ไม่พบไฟล์ {fname}")
        elif n < least:
            problems.append(f"{fname} เหลือ {n} รายการ (ควรมีอย่างน้อย {least})")
    if cfg.get("fresh_h") and r["age_h"] is not None and r["age_h"] > cfg["fresh_h"]:
        problems.append(f"ไม่มีข้อมูลใหม่มา {r['age_h']:.0f} ชม. — ท่อบันทึกอาจตัน")
    r["ok"] = not problems
    r["detail"] = " · ".join(problems)
    return r


def probe_gas(slug, name):
    """เปลือกบนโฮสต์ → หา URL /exec ในหน้า → ยิง exec จริง ดูว่า GAS ยังตอบ ไม่ใช่หน้า error"""
    r = {"sys": slug, "name": name, "kind": "gas", "url": f"{SITE}/{slug}/",
         "pipe_name": "หลังบ้าน Google Apps Script", "ok": False, "site": True, "detail": ""}
    t0 = time.time()
    code, body = fetch(r["url"], timeout=25)
    if not (0 < code < 400):
        r["site"] = False
        r["detail"] = f"หน้าเว็บเปิดไม่ได้ ({code or body.decode('utf-8', 'ignore')[:40]})"
        return r
    m = EXEC_RE.search(body.decode("utf-8", "ignore"))
    if not m:
        r["detail"] = "ไม่พบลิงก์ /exec ในหน้าเปลือก"
        return r
    # GAS ตอบ 404 เองได้เมื่อแอปไม่รู้จักหน้าที่ขอ (เช่น /result/ ต้องมี ?page=) — ดูเนื้อหาต่อว่า script ยังทำงาน
    code, body = fetch_retry(m.group(0))
    if not body:
        r["detail"] = f"เรียก GAS ไม่ได้ (HTTP {code})" if code else "เรียก GAS ไม่ได้"
        return r
    text = body.decode("utf-8", "ignore")[:4000]
    hit = next((b for b in GAS_BAD if b in text), None)
    r["ms"] = round((time.time() - t0) * 1000)
    if hit:
        r["detail"] = f"GAS ตอบผิดปกติ: {hit}"
    elif "Sign in - Google Accounts" in text or "AccountChooser" in text:
        # ระบบที่บังคับล็อกอินโดเมน (เช่น /cer/) — ตัวเฝ้าล็อกอินแทนไม่ได้
        # เจอหน้านี้แปลว่า deployment ยังอยู่จริง (ถ้าถูกลบจะได้ "Sorry, unable to open the file")
        r["ok"], r["detail"] = True, "ต้องล็อกอินโดเมนก่อนใช้ — ตรวจได้แค่ว่า deployment ยังอยู่"
    elif text.lstrip()[:1] in "{[":
        r["ok"] = True                      # ตอบ JSON = backend ทำงาน (บาง API ตอบสั้นมากโดยตั้งใจ)
    elif len(body) < 200:
        r["detail"] = "GAS ตอบสั้นผิดปกติ"
    else:
        r["ok"] = True
    return r


def probe_link(slug, cfg):
    """ระบบที่หน้าเว็บกับท่อข้อมูลคนละที่ — เช็คหน้าเว็บกับท่อแยกกัน"""
    r = {"sys": slug, "name": cfg["name"], "kind": "link", "url": cfg["site"],
         "pipe_name": cfg["pipe_name"], "ok": False, "site": True, "detail": ""}
    t0 = time.time()
    if not site_up(cfg["site"]):
        r["site"] = False
        r["detail"] = "หน้าเว็บเปิดไม่ได้"
        return r
    code, body = fetch_retry(cfg["pipe"])
    r["ms"] = round((time.time() - t0) * 1000)
    text = body.decode("utf-8", "ignore")[:4000]
    name = cfg["pipe_name"]
    if next((b for b in GAS_BAD if b in text), None):
        r["detail"] = f"{name} ตอบผิดปกติ"
    elif cfg.get("expect"):
        # มีคำตอบที่ถูกต้องให้เทียบ → ใช้ตัวนี้ตัดสิน (บาง endpoint ตอบ 404 แต่ทำงานได้จริง)
        r["ok"] = cfg["expect"] in text
        if not r["ok"]:
            r["detail"] = f"{name} ตอบไม่ตรงที่ควรเป็น (HTTP {code})"
    elif not body or not (0 < code < 400):
        r["detail"] = f"{name} ไม่ตอบ (HTTP {code})" if code else f"{name} เรียกไม่ได้"
    elif len(body) < cfg.get("least", 1):
        r["detail"] = f"{name} ตอบข้อมูลน้อยผิดปกติ ({len(body)} ไบต์)"
    else:
        r["ok"] = True
    return r


def probe_all(state):
    systems = ([probe_php(s, c) for s, c in PHP_SYS.items()]
               + [probe_gas(s, n) for s, n in GAS_SYS.items()]
               + [probe_link(s, c) for s, c in LINK_SYS.items()])
    # client_id ล็อกอินต้องเป็นตัวเดียวกันทั้งพอร์ต — ตัวไหนหลุดไปจากพวกคือ config เพี้ยน
    cids = Counter(s["cid"] for s in systems if s.get("cid"))
    if cids:
        main_cid = cids.most_common(1)[0][0]
        for s in systems:
            if s.get("cid") and s["cid"] != main_cid:
                s["ok"] = False
                s["detail"] = (s["detail"] + " · " if s["detail"] else "") + f"client_id ล็อกอินไม่ตรงกับระบบอื่น ({s['cid']})"
    # ไฟ 3 สี: 🟢 เว็บเข้าได้และท่อใช้งานได้ · 🟡 เว็บเข้าได้แต่ท่อมีปัญหา · 🔴 เว็บเข้าไม่ได้เลย
    was = state.setdefault("sys_ok", {})
    for s in systems:
        s["level"] = "ok" if s["ok"] else "warn" if s.get("site") else "down"
        prev = was.get(s["sys"])
        if s["level"] == "down":
            alert(state, f'sys:{s["sys"]}', f'🔴 {s["name"]} — เข้าเว็บไม่ได้เลย ({s["detail"] or "ไม่ตอบ"})', 6)
        elif s["level"] == "warn":
            alert(state, f'sys:{s["sys"]}', f'🟡 {s["name"]} — เว็บเข้าได้ แต่ {s.get("pipe_name", "ท่อ")} มีปัญหา: {s["detail"] or "เช็คไม่ผ่าน"}', 6)
        elif prev is False:
            send_line(f'🟢 {s["name"]} กลับมาปกติแล้ว\n{PAGE_URL}')
            state.get("sent", {}).pop(f'sys:{s["sys"]}', None)
        was[s["sys"]] = s["ok"]
    return systems


def da_query(cmd):
    _, body = http(f"{DA}/{cmd}", auth=True)
    d = {k: v[0] for k, v in urllib.parse.parse_qs(body.decode()).items()}
    if d.get("error") == "1":
        raise RuntimeError(d.get("text", "DirectAdmin error"))
    return d


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None   # เช่น "unlimited"


def read_log():
    _, body = http(f"{DA}/CMD_SHOW_LOG?domain=bangkho.ac.th&type=log&lines=20000", auth=True, timeout=120)
    rows = []
    for line in body.decode("utf-8", "replace").splitlines():
        m = LOG_RE.match(line)
        if not m:
            continue
        ip, ts, method, url, status, size = m.groups()
        try:
            t = datetime.strptime(ts, "%d/%b/%Y:%H:%M:%S %z")
        except ValueError:
            continue
        rows.append((t, ip, method, url.split("?", 1)[0], int(status), 0 if size == "-" else int(size)))
    return rows


def send_line(text):
    if DRY:
        print("[DRY] " + text.replace("\n", " | "))
        return
    q = urllib.parse.urlencode({"action": "notify", "key": os.environ["LINE_NOTIFY_KEY"], "text": text})
    try:
        http(f'{os.environ["LINE_NOTIFY_URL"]}?{q}', timeout=60)
    except Exception as e:
        print("ส่ง LINE ไม่สำเร็จ:", type(e).__name__)


def alert(state, key, text, cooldown_h):
    sent = state.setdefault("sent", {})
    if time.time() - sent.get(key, 0) < cooldown_h * 3600:
        return
    sent[key] = time.time()
    state.setdefault("alerts", []).insert(0, {"t": now.isoformat(timespec="minutes"), "kind": key.split(":")[0], "text": mask(text)})
    del state["alerts"][30:]
    send_line(f"⚠️ bangkho.ac.th\n{text}\nดูสถานะ: {PAGE_URL}")


def main():
    os.makedirs(OUT, exist_ok=True)
    state_path = os.path.join(OUT, "state.json")
    try:
        state = json.load(open(state_path, encoding="utf-8"))
    except (OSError, ValueError):
        state = {}
    status = {"updated": now.isoformat(timespec="seconds"), "limits": LIMITS, "errors": []}

    # 1) หน้าเว็บจริงยังเปิดได้ไหม
    checks = check_site()
    status["checks"] = checks
    bad = [c for c in checks if not c["ok"]]
    suspended = any(c["note"] == "ถูกระงับบัญชี" for c in checks)
    if bad:
        what = "โฮสต์ระงับบัญชี (แบนด์วิดท์/ทรัพยากรเกิน)" if suspended else \
            "เปิดไม่ได้: " + ", ".join(f'{c["path"]} ({c["code"] or c["note"]})' for c in bad)
        alert(state, "down", f"🔴 เว็บมีปัญหา — {what}", 1)
        state["down_since"] = state.get("down_since") or now.isoformat(timespec="minutes")
    elif state.get("down_since"):
        send_line(f"✅ bangkho.ac.th กลับมาใช้ได้แล้ว (ล่มตั้งแต่ {state['down_since'][11:16]} น.)\n{PAGE_URL}")
        state.pop("down_since")
        state.get("sent", {}).pop("down", None)

    # 1.5) ท่อรายระบบ — ทะเบียนนักเรียน/ครู, ล็อกอิน, บันทึกสถิติ, GAS หลังเปลือก
    try:
        status["systems"] = probe_all(state)
    except Exception as e:
        status["errors"].append(f"ตรวจระบบย่อยไม่สำเร็จ: {type(e).__name__}")

    # 2) ยอดรายเดือน + พื้นที่ดิสก์ (DirectAdmin สรุปวันละครั้ง)
    try:
        usage, config = da_query("CMD_API_SHOW_USER_USAGE"), da_query("CMD_API_SHOW_USER_CONFIG")
        used, limit = num(usage.get("bandwidth")), num(config.get("bandwidth"))
        disk, disk_limit = num(usage.get("quota")), num(config.get("quota"))
        pct = round(used / limit * 100, 1) if used is not None and limit else None
        status["month"] = {"used_mb": used, "limit_mb": limit, "pct": pct, "disk_mb": disk, "disk_limit_mb": disk_limit}
        month = now.strftime("%Y-%m")
        reached = [p for p in LIMITS["month_pct"] if pct is not None and pct >= p]
        if reached:
            lv = reached[-1]
            alert(state, f"month:{month}:{lv}",
                  f"📊 แบนด์วิดท์เดือนนี้ใช้ไป {used / 1024:,.1f} GB = {pct}% ของเพดาน {limit / 1024:,.0f} GB"   # DirectAdmin นับ MiB (153600 = 150 GB)
                  + (" — ถึงเพดานแล้ว โฮสต์อาจระงับเว็บ" if lv >= 100 else ""), 24)
        days = state.setdefault("disk_by_day", {})
        today = now.strftime("%Y-%m-%d")
        if disk is not None:
            days.setdefault(today, disk)
            prev = [d for d in sorted(days) if d < today]
            if prev and disk - days[prev[-1]] > LIMITS["disk_day_mb"]:
                alert(state, f"disk:{today}", f"💾 พื้นที่โฮสต์โตขึ้น {disk - days[prev[-1]]:,.0f} MB ใน 1 วัน — มีการอัปโหลดไฟล์จำนวนมาก", 24)
            for d in sorted(days)[:-14]:
                days.pop(d)
    except Exception as e:
        status["errors"].append(f"อ่านยอดจาก DirectAdmin ไม่ได้: {type(e).__name__}")

    # 3) log สด — แบนด์วิดท์ระหว่างวัน / ไฟล์โหลดซ้ำ / IP ดึงหนัก / อัปโหลดถี่
    try:
        rows = read_log()
        start_today = now.replace(hour=0, minute=0, second=0, microsecond=0)
        r10 = [r for r in rows if r[0] >= now - timedelta(minutes=10)]
        r60 = [r for r in rows if r[0] >= now - timedelta(minutes=60)]
        rday = [r for r in rows if r[0] >= start_today]
        b10, b60, bday = (sum(r[5] for r in x) for x in (r10, r60, rday))

        files_b, files_n, files_big, ips_b, posts = Counter(), Counter(), Counter(), Counter(), Counter()
        for t, ip, method, path, code, size in r60:
            files_b[path] += size
            files_n[path] += 1
            if size >= MB:
                files_big[path] += 1
            ips_b[ip] += size
            if method == "POST":
                posts[path] += 1

        if b10 > LIMITS["burst10_mb"] * MB:
            alert(state, "burst", f"🚀 ทั้งเว็บใช้ {mb(b10)} ใน 10 นาทีล่าสุด (เกณฑ์ {LIMITS['burst10_mb']} MB)", 1)
        if bday > LIMITS["day_mb"] * MB:
            alert(state, f"day:{now:%Y-%m-%d}", f"📈 วันนี้ทั้งเว็บใช้ไปแล้ว {mb(bday)} เกินเป้า 1 GB/วัน", 24)
        for path, b in files_b.most_common(5):
            if b > LIMITS["file_hour_mb"] * MB or files_big[path] >= LIMITS["file_hour_req"]:
                alert(state, f"file:{path}", f"🔁 ไฟล์ {path} ถูกโหลด {files_n[path]} ครั้ง รวม {mb(b)} ใน 1 ชั่วโมง — อาจมีหน้าเว็บโหลดซ้ำวนรอบ", 3)
        for ip, b in ips_b.most_common(3):
            if b > LIMITS["ip_hour_mb"] * MB:
                alert(state, f"ip:{mask(ip)}", f"🖥️ เครื่อง IP {ip} ดึงข้อมูล {mb(b)} ใน 1 ชั่วโมง — อาจเป็นจอที่เปิดหน้าเว็บค้างไว้", 3)
        for path, limit in UPLOAD_POST_HOUR.items():
            if posts[path] > limit:
                alert(state, f"upload:{path}", f"📤 มีการส่งข้อมูล/อัปโหลดไป {path} {posts[path]} ครั้งใน 1 ชั่วโมง (เกณฑ์ {limit})", 3)

        hours = state.setdefault("hours", {})
        per_hour = defaultdict(int)
        for r in rows:
            per_hour[r[0].astimezone(BKK).strftime("%Y-%m-%dT%H")] += r[5]
        for h, b in per_hour.items():
            hours[h] = max(hours.get(h, 0), b)      # log หมุนทิ้งแล้วชั่วโมงเก่าจะหาย — เก็บค่าสูงสุดที่เคยเห็น
        for h in sorted(hours)[:-72]:
            hours.pop(h)

        status["log"] = {"from": rows[0][0].isoformat(timespec="minutes") if rows else None, "lines": len(rows)}
        status["today"] = {"bytes": bday, "req": len(rday)}
        status["last10"] = {"bytes": b10, "req": len(r10)}
        status["last60"] = {
            "bytes": b60, "req": len(r60),
            "files": [{"path": p, "bytes": b, "req": files_n[p]} for p, b in files_b.most_common(8)],
            "ips": [{"ip": mask(ip), "bytes": b} for ip, b in ips_b.most_common(5)],
        }
        status["hours"] = [{"h": h, "bytes": hours[h]} for h in sorted(hours)[-48:]]
    except Exception as e:
        status["errors"].append(f"อ่าน log สดไม่ได้: {type(e).__name__}")

    if status["errors"] and not bad:   # เว็บล่มแจ้งไปแล้วด้านบน ไม่ต้องแจ้งซ้ำ
        alert(state, "watch_error", "🛠️ ตัวเฝ้าทำงานไม่ครบ: " + "; ".join(status["errors"]), 6)

    cutoff = time.time() - 7 * 86400
    state["sent"] = {k: v for k, v in state.get("sent", {}).items() if v > cutoff}
    status["alerts"] = state.get("alerts", [])
    status["down_since"] = state.get("down_since")
    json.dump(state, open(state_path, "w", encoding="utf-8"), ensure_ascii=False)
    json.dump(status, open(os.path.join(OUT, "status.json"), "w", encoding="utf-8"), ensure_ascii=False)
    print(f"ok checks={len(checks) - len(bad)}/{len(checks)} errors={len(status['errors'])}")


if __name__ == "__main__":
    main()
