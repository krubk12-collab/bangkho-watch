<?php
// พื้นที่น้ำท่วมจากดาวเทียม GISTDA (disaster.gistda.or.th) — รายตำบล ย่อเหลือสรุปรายจังหวัด + ตำบลในนนทบุรี/ใกล้เคียง
// ต้นทางไม่มี CORS เลยต้องผ่านที่นี่ · แคช 1 ชม. · ต้นทางล่ม = ส่งแคชเก่าพร้อม stale
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=600');

const SRC = 'https://disaster.gistda.or.th/app-api/services/flood/';
const META = 'https://disaster.gistda.or.th/app-api/services/stac/flood/collections/';
const TTL = 3600;
$DIR = __DIR__ . '/data';
if (!is_dir($DIR)) @mkdir($DIR, 0755, true);
if (!file_exists("$DIR/.htaccess")) @file_put_contents("$DIR/.htaccess", "Require all denied\n");
$CF = "$DIR/gistda.json";
$CC = "$DIR/gistda_cells.json";   // รูปแปลงน้ำท่วมรอบโรงเรียน (หนัก ~100KB+) แยกไฟล์ ไม่ให้การ์ดหน้าแรกโหลด
if (isset($_GET['cells'])) { if (is_file($CC)) readfile($CC); else echo '{"cells":[]}'; exit; }
if (is_file($CF) && time() - filemtime($CF) < (isset($_GET['force']) ? 300 : TTL)) { readfile($CF); exit; }   // force = ดึงใหม่ได้ถ้าแคชเกิน 5 นาที

// อำเภอติดนนทบุรี/ต้นน้ำใกล้ ๆ (ภายใน ~30 กม. จากโรงเรียน) — น้ำท่วมตรงนี้ = เฝ้าระวัง
const NEAR = [
  'จ.พระนครศรีอยุธยา' => ['อ.บางซ้าย', 'อ.บางไทร', 'อ.บางปะอิน', 'อ.ลาดบัวหลวง'],
  'จ.ปทุมธานี' => ['อ.ลาดหลุมแก้ว', 'อ.สามโคก', 'อ.เมืองปทุมธานี'],
  'จ.นครปฐม' => ['อ.บางเลน', 'อ.พุทธมณฑล'],
  'กรุงเทพมหานคร' => ['เขตตลิ่งชัน', 'เขตทวีวัฒนา', 'เขตบางพลัด', 'เขตบางซื่อ', 'เขตดุสิต'],
];

$PER = ['1day', '3days', '7days'];
// คืน JSON ที่ถอดได้ของแต่ละคีย์ · คีย์ 'm:<ช่วง>' = เมตา STAC (ช่วงวันที่ของภาพ + เวลาที่ GISTDA ประมวลผล)
function fetchAll($ps) {
  $mh = curl_multi_init(); $hs = []; $res = [];
  foreach ($ps as $p) {
    $h = curl_init(substr($p, 0, 2) === 'm:' ? META . substr($p, 2) . '_r2' : SRC . $p);
    curl_setopt_array($h, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30, CURLOPT_USERAGENT => 'Mozilla/5.0 (bangkho.ac.th/water)']);
    curl_multi_add_handle($mh, $h); $hs[$p] = $h;
  }
  do { $st = curl_multi_exec($mh, $run); if ($run) curl_multi_select($mh, 1); } while ($run && $st == CURLM_OK);
  foreach ($hs as $p => $h) {
    $j = json_decode((string)curl_multi_getcontent($h), true);
    curl_multi_remove_handle($mh, $h); curl_close($h);
    if (is_array($j['items'] ?? null)) $res[$p] = $j['items'];
    elseif (isset($j['extent'])) $res[$p] = $j;
  }
  curl_multi_close($mh);
  return $res;
}
$got = fetchAll(array_merge($PER, array_map(fn($p) => "m:flood$p", $PER)));
if ($miss = array_diff($PER, array_keys($got))) { sleep(2); $got += fetchAll($miss); }   // GISTDA 503 เป็นพัก ๆ ลองอีกรอบ

// ช่วงไหนดึงไม่ได้ ใช้ของเดิมช่วงนั้น (เดิมทิ้งทั้งชุด → 1day ล่มตัวเดียวทำให้ค้างทั้งหน้า)
$old = is_file($CF) ? json_decode(file_get_contents($CF), true) : null;
$now = date('Y-m-d H:i:s');
$out = ['updated' => $now, 'src' => 'GISTDA', 'stale' => []];
foreach ($PER as $p) {
  if (!isset($got[$p])) {
    if (!isset($old[$p])) { $out[$p] = null; $out['stale'][] = $p; continue; }   // ไม่เคยมีค่า = ว่างเฉพาะช่วงนี้
    $out[$p] = $old[$p]; $out[$p]['at'] = $old[$p]['at'] ?? $old['updated']; $out['stale'][] = $p;
    continue;
  }
  $prov = []; $nont = []; $near = []; $tot = 0;
  foreach ($got[$p] as $x) {
    $rai = ($x['flood'] ?? 0) / 1600; $tot += $rai;
    $pv = $x['province'] ?? '?';
    $prov[$pv] = $prov[$pv] ?? [$pv, 0, 0]; $prov[$pv][1] += $rai; $prov[$pv][2]++;
    $row = [$pv, $x['amphoe'] ?? '', $x['tambon'] ?? '', round($rai), round($x['population'] ?? 0), (int)($x['school'] ?? 0)];
    if (($x['provinceCode'] ?? 0) == 12) $nont[] = $row;
    elseif (in_array($x['amphoe'] ?? '', NEAR[$pv] ?? [], true)) $near[] = $row;
  }
  $byRai = fn($a, $b) => $b[3] <=> $a[3];
  usort($nont, $byRai); usort($near, $byRai);
  $prov = array_values($prov); usort($prov, fn($a, $b) => $b[1] <=> $a[1]);
  $m = $got["m:flood$p"] ?? null; $iv = $m['extent']['temporal']['interval'][0] ?? null;
  $th = fn($t) => $t ? date('Y-m-d H:i', strtotime($t)) : null;   // UTC → เวลาไทย (โฮสต์ตั้ง Asia/Bangkok)
  $out[$p] = [
    'from' => $iv ? substr($iv[0], 0, 10) : null, 'to' => $iv ? substr($iv[1], 0, 10) : null,   // ช่วงวันที่ของภาพดาวเทียม
    'proc' => $th($m['updated_at'] ?? null),   // GISTDA ประมวลผลล่าสุด
    'at' => $now, 'rai' => round($tot), 'tambon' => count($got[$p]),
    'prov' => array_map(fn($r) => [$r[0], round($r[1]), $r[2]], array_slice($prov, 0, 12)),
    'nont' => $nont, 'near' => $near,   // [จังหวัด, อำเภอ, ตำบล, ไร่, ประชากร, โรงเรียน]
  ];
}

if (count($out['stale']) === count($PER)) {
  if ($old) { @touch($CF, time() - TTL + 600); $old['stale'] = $PER; echo json_encode($old, JSON_UNESCAPED_UNICODE); }   // ล่มหมด: ลองใหม่อีก 10 นาที
  else { http_response_code(502); echo '{"error":"gistda unreachable"}'; }
  exit;
}
// ช่องน้ำท่วมรายช่อง (H3) ทั้งนนทบุรี + รอบโรงเรียนรัศมี 10 กม. จาก OGC Features ของ GISTDA (3 วัน) — ใช้บอก "น้ำใกล้โรงเรียนสุดกี่ กม."
const SCH = [13.851028, 100.403063];
function km($la, $lo) {
  $r = M_PI / 180; $dp = ($la - SCH[0]) * $r; $dl = ($lo - SCH[1]) * $r;
  $h = sin($dp / 2) ** 2 + cos(SCH[0] * $r) * cos($la * $r) * sin($dl / 2) ** 2;
  return 12742 * asin(sqrt($h));
}
function getJson($u) {
  $h = curl_init($u);
  curl_setopt_array($h, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60, CURLOPT_USERAGENT => 'Mozilla/5.0 (bangkho.ac.th/water)']);
  $j = json_decode((string)curl_exec($h), true); curl_close($h); return $j;
}
$sch = null;
// ดึงทีละจังหวัด (กรองด้วย pv_idn ที่ต้นทาง) — ทั้งกรอบ กทม.+ปริมณฑลก้อนเดียว ~20MB เสี่ยงเมมโมรีเต็ม
const BMR = [10, 11, 12, 13, 73, 74];   // กทม. สมุทรปราการ นนทบุรี ปทุมธานี นครปฐม สมุทรสาคร
@ini_set('memory_limit', '512M'); @set_time_limit(300);
function cellsOf($col) {
  $it = getJson(META . $col . '/items?limit=1');
  $href = $it['features'][0]['assets']['data']['href'] ?? null;
  if (!$href) return null;
  $cells = []; $scenes = [];
  foreach (BMR as $pv) {
    $fc = getJson('https://disaster.gistda.or.th' . $href . '?limit=8000&pv_idn=' . $pv);
    if (!is_array($fc['features'] ?? null)) return null;   // จังหวัดใดล่ม = ทั้งชุดใช้ไม่ได้ (กันแผนที่ขาดเป็นจังหวัด)
    foreach ($fc['features'] as $f) {
      $p = $f['properties']; $n = 0; $x = 0; $y = 0;
      array_walk_recursive($f['geometry']['coordinates'], function ($v, $k) use (&$n, &$x, &$y) { if ($k === 0) { $x += $v; $n++; } else $y += $v; });
      if (!$n) continue;
      $d = km($y / $n, $x / $n);
      if ($d <= 10) $scenes[$p['file_name'] ?? ''] = 1;
      $geo = $f['geometry'];   // Polygon หรือ MultiPolygon
      array_walk_recursive($geo['coordinates'], function (&$v) { $v = round($v, 4); });   // ~11 ม. พอสำหรับแผนที่ ลดขนาดไฟล์
      $cells[] = [round(($p['f_area'] ?? 0) / 1600, 1), round($d, 2), $p['tb_tn'] ?? '', $p['ap_tn'] ?? '', round($y / $n, 5), round($x / $n, 5), $geo, $p['pv_tn'] ?? '', $p['h3_address'] ?? ''];
    }
  }
  usort($cells, fn($a, $b) => $a[1] <=> $b[1]);
  return [$cells, $scenes];
}
$r3 = cellsOf('flood3days_r2');
if ($r3) {
  [$cells, $scenes] = $r3;
  $in = fn($r) => array_filter($cells, fn($c) => $c[1] <= $r);
  $sum = fn($a) => round(array_sum(array_column($a, 0)));
  $sch = [
    'at' => $now, 'min' => $cells && $cells[0][1] <= 10 ? $cells[0][1] : null,   // กม. ช่องน้ำท่วมที่ใกล้โรงเรียนสุด (null = ไม่พบใน 10 กม.)
    'n1' => count($in(1)), 'rai1' => $sum($in(1)), 'n3' => count($in(3)), 'rai3' => $sum($in(3)), 'n10' => count($in(10)), 'rai10' => $sum($in(10)),
    'top' => array_map(fn($c) => array_slice($c, 0, 6), array_slice(array_values($in(10)), 0, 5)),   // [ไร่, กม., ตำบล, อำเภอ, lat, lon]
    'scenes' => implode(', ', array_filter(array_keys($scenes))),
  ];
  // แผนที่: ชั้น 7 วัน (สีอ่อน) + ชั้น 3 วัน (สีเข้ม) ในไฟล์เดียว · ช่องสุดท้าย [8] = 1 ถ้าพบใน 3 วัน · 7 วันล่ม = ใช้ 3 วันอย่างเดียว
  $h3 = array_flip(array_filter(array_column($cells, 8)));
  $map = [];
  if ($r7 = cellsOf('flood7days_r2')) foreach ($r7[0] as $c) { if (!isset($h3[$c[8]])) { $c[8] = 0; $map[] = $c; } }
  foreach ($cells as $c) { $c[8] = 1; $map[] = $c; }   // 3 วันใส่ท้ายสุด = วาดทับด้านบน
  $cj = json_encode(['at' => $now, 'per' => $r7 ? '3+7days' : '3days', 'cells' => $map], JSON_UNESCAPED_UNICODE);
  if ($cj) { file_put_contents("$CC.tmp", $cj); rename("$CC.tmp", $CC); }
} elseif (isset($old['school'])) { $sch = $old['school']; $out['stale'][] = 'school'; }
$out['school'] = $sch;

$js = json_encode($out, JSON_UNESCAPED_UNICODE);
if ($js) { file_put_contents("$CF.tmp", $js); rename("$CF.tmp", $CF); }
echo $js;
