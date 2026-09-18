<?php
// health.php — ประตูตรวจสุขภาพระบบ (อ่านอย่างเดียว ไม่ต้องล็อกอิน ไม่เปิดข้อมูลส่วนตัว)
// วางไฟล์นี้ในโฟลเดอร์ระบบ (เช่น public_html/behave/health.php) ไฟล์เดียวจบ ไม่ต้องแก้โค้ดเดิม
// ตอบ JSON: ไฟล์ข้อมูลกี่ไฟล์/กี่ record, อัปเดตล่าสุดเมื่อไหร่, เขียน data/ ได้ไหม, client_id ล็อกอินตรงไหม
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

const BIG = 2 * 1024 * 1024;   // ใหญ่กว่านี้ไม่ parse (แค่ดูหัว-ท้ายว่าไฟล์ยังครบ)
const TOP = 25;                // รายงานรายไฟล์อย่างมากเท่านี้ (เรียงตามขนาด) ที่เหลือสรุปรวม

$dir  = __DIR__;
$data = $dir . '/data';
// หน้านี้เปิดสาธารณะ (ตัวเฝ้าอยู่นอกโฮสต์ จึงล็อกด้วยรหัสไม่ได้ง่าย ๆ)
// → บอกแค่ "ข้อมูลครบไหม/ใหม่ไหม" ไม่บอกเวอร์ชัน PHP, พื้นที่ดิสก์, หรือเนื้อข้อมูลใด ๆ
$out  = [
    'sys'  => basename($dir),
    'ok'   => true,
    'ts'   => date('c'),
    'note' => [],
];

/** นับ record: array → จำนวนสมาชิก, object → จำนวนคีย์, jsonl → จำนวนบรรทัด */
function count_records($path, $size)
{
    if (substr($path, -6) === '.jsonl') {
        $n = 0;
        $fh = fopen($path, 'rb');
        if (!$fh) return [null, 'เปิดไม่ได้'];
        while (($line = fgets($fh)) !== false) if (trim($line) !== '') $n++;
        fclose($fh);
        return [$n, null];
    }
    if ($size > BIG) {
        // ไฟล์ใหญ่: ไม่ parse ทั้งก้อน แค่ดูว่าวงเล็บปิดครบ (จับไฟล์ที่เขียนค้างกลางคัน)
        $fh = fopen($path, 'rb');
        $head = fread($fh, 1);
        fseek($fh, -1, SEEK_END);
        $tail = fread($fh, 1);
        fclose($fh);
        $pair = ['[' => ']', '{' => '}'];
        return [null, isset($pair[$head]) && $tail === $pair[$head] ? null : 'ไฟล์ใหญ่และท้ายไฟล์ไม่ครบ'];
    }
    $raw = file_get_contents($path);
    if ($raw === false || $raw === '') return [null, 'อ่านไม่ได้/ว่าง'];
    $j = json_decode($raw, true);
    if ($j === null && strtolower(trim($raw)) !== 'null') return [null, 'JSON พัง'];
    return [is_array($j) ? count($j) : 0, null];
}

// ---- ไฟล์ข้อมูล ----
if (!is_dir($data)) {
    $out['note'][] = 'ระบบนี้ไม่มีโฟลเดอร์ data/ (เก็บข้อมูลที่อื่น)';   // ไม่ถือว่าผิดปกติ
} else {
    $files = [];
    $newest = 0;
    $total  = 0;
    foreach (glob($data . '/*.{json,jsonl}', GLOB_BRACE) ?: [] as $p) {
        $name = basename($p);
        if (substr($name, -4) === '.bak' || $name[0] === '.') continue;
        $size = filesize($p);
        $mt   = filemtime($p);
        [$n, $err] = count_records($p, $size);
        if ($err) {
            $out['ok'] = false;
            $out['note'][] = "$name: $err";
        }
        $files[] = ['f' => $name, 'n' => $n, 'kb' => round($size / 1024, 1), 'mt' => date('Y-m-d H:i', $mt)];
        $newest  = max($newest, $mt);
        $total  += $size;
    }
    // โฟลเดอร์ย่อยชั้นเดียว (behave/data/state, behave/data/tx) — นับรวม ไม่ลงรายไฟล์
    foreach (glob($data . '/*', GLOB_ONLYDIR) ?: [] as $sub) {
        if (basename($sub) === '_history') continue;
        foreach (glob($sub . '/*.{json,jsonl}', GLOB_BRACE) ?: [] as $p) {
            $size = filesize($p);
            [$n, $err] = count_records($p, $size);
            if ($err) {
                $out['ok'] = false;
                $out['note'][] = basename($sub) . '/' . basename($p) . ": $err";
            }
            $files[] = ['f' => basename($sub) . '/' . basename($p), 'n' => $n, 'kb' => round($size / 1024, 1), 'mt' => date('Y-m-d H:i', filemtime($p))];
            $newest  = max($newest, filemtime($p));
            $total  += $size;
        }
    }
    usort($files, fn($a, $b) => $b['kb'] <=> $a['kb']);
    $out['data'] = [
        'files'  => count($files),
        'mb'     => round($total / 1048576, 2),
        'newest' => $newest ? date('Y-m-d H:i', $newest) : null,
        'age_h'  => $newest ? round((time() - $newest) / 3600, 1) : null,
        'top'    => array_slice($files, 0, TOP),
    ];
    if (!$files) {
        $out['ok'] = false;
        $out['note'][] = 'data/ ว่าง ไม่มีไฟล์ข้อมูล';
    }
    $out['writable'] = is_writable($data);
    if (!$out['writable']) {
        $out['ok'] = false;
        $out['note'][] = 'เขียน data/ ไม่ได้ — ระบบจะบันทึกข้อมูลไม่ได้';
    }
}

// ---- ท่อล็อกอิน Google: มี client_id อยู่ในหน้าเว็บไหม (โชว์แค่ส่วนหน้า พอให้เทียบว่าตรงกันทุกระบบ) ----
$cid = null;
foreach (array_merge(glob($dir . '/*.html') ?: [], glob($dir . '/*.php') ?: [], glob($dir . '/*.js') ?: []) as $p) {
    if (basename($p) === 'health.php' || filesize($p) > 800 * 1024) continue;
    if (preg_match('/([0-9]{6,}-[a-z0-9]{10,})\.apps\.googleusercontent\.com/', file_get_contents($p), $m)) {
        $cid = $m[1];
        break;
    }
}
$out['login'] = ['client_id' => $cid ? substr($cid, 0, strpos($cid, '-') + 6) . '…' : null, 'found' => (bool)$cid];

echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
