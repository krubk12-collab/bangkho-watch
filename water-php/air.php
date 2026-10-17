<?php
// คุณภาพอากาศจริงรอบโรงเรียน — Air4Thai (กรมควบคุมมลพิษ) สถานีใกล้สุด 3 แห่ง แคช 10 นาที
// เบราว์เซอร์เรียก Air4Thai ตรงไม่ได้ (ไม่มี CORS) เลยผ่านไฟล์นี้ · ต้นทางล่ม = ส่งแคชเดิม
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=120');
const TTL = 600, LAT = 13.851028, LON = 100.403063;
$DIR = __DIR__ . '/data';
if (!is_dir($DIR)) @mkdir($DIR, 0755, true);
if (!file_exists("$DIR/.htaccess")) @file_put_contents("$DIR/.htaccess", "Require all denied\n");
$ALL = !empty($_GET['all']);                  // ?all=1 = ทุกสถานีในกรุงเทพฯ-ปริมณฑล (หน้า /water/goto)
$CF = $ALL ? "$DIR/air_all.json" : "$DIR/air.json";
if (is_file($CF) && time() - filemtime($CF) < TTL) { readfile($CF); exit; }

$h = curl_init('https://air4thai.pcd.go.th/services/getNewAQI_JSON.php');
curl_setopt_array($h, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30,
  CURLOPT_CAINFO => __DIR__ . '/air4thai-ca.pem',   // Air4Thai ส่ง chain ผิด (ใบ Let's Encrypt YR1 แต่แนบ Sectigo) → แนบ YR1 + Root YR เอง · ถ้าเขาเปลี่ยนผู้ออกใบ ต้องแก้ไฟล์นี้
  CURLOPT_USERAGENT => 'Mozilla/5.0 (bangkho.ac.th/water)']);
$j = json_decode((string)curl_exec($h), true); curl_close($h);

$st = [];
foreach ($j['stations'] ?? [] as $s) {
  $a = $s['AQILast'] ?? []; $pm = $a['PM25']['value'] ?? null;
  $dt = strtotime(($a['date'] ?? '') . ' ' . ($a['time'] ?? '') . ' +07:00');
  if (!is_numeric($pm) || $pm < 0 || !$dt || $dt < time() - 3 * 3600) continue;   // ค่าเก่าเกิน 3 ชม./เครื่องเสีย (-1) ไม่ใช้
  if ($ALL && ((float)$s['lat'] < 13.5 || (float)$s['lat'] > 14.2 || (float)$s['long'] < 100.2 || (float)$s['long'] > 100.9)) continue;
  $km = hypot(((float)$s['lat'] - LAT) * 111, ((float)$s['long'] - LON) * 108);
  $n = fn($k) => is_numeric($a[$k]['value'] ?? null) && $a[$k]['value'] >= 0 ? (float)$a[$k]['value'] : null;
  $st[] = ['n' => $s['nameTH'], 'area' => $s['areaTH'], 'km' => round($km, 1), 'lat' => (float)$s['lat'], 'lon' => (float)$s['long'], 'pm' => (float)$pm, 'pm10' => $n('PM10'), 'o3' => $n('O3'),
    'aqi' => is_numeric($a['AQI']['aqi'] ?? null) ? (int)$a['AQI']['aqi'] : null, 'dt' => date('Y-m-d H:i', $dt)];
}
usort($st, fn($x, $y) => $x['km'] <=> $y['km']);
if (!$st) { if (is_file($CF)) { readfile($CF); exit; } http_response_code(502); echo '{"error":"air4thai"}'; exit; }

$js = json_encode(['t' => date('c'), 'st' => $ALL ? $st : array_slice($st, 0, 3)], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
if ($js === false) { if (is_file($CF)) { readfile($CF); exit; } http_response_code(500); echo '{"error":"encode"}'; exit; }
$tmp = "$CF.tmp"; file_put_contents($tmp, $js); rename($tmp, $CF);
echo $js;
