<?php
// ระดับน้ำสดจากสถานีโทรมาตรกรมทรัพยากรน้ำ (สถานีเดียวกับกล้องใน cams.php) · แคช 10 นาที data/dwr.json
// ต้นทาง: telemetry.dwr.go.th/api/public/station/getByCode/<code> → stationCurrentData.wl (ม.รทก.) + wlChart/frChart.past รายชั่วโมง ~5 วัน
// red = เกณฑ์แดง (redHigh) ของกรมฯ ≈ ตลิ่งต่ำสุด · s = ระดับ 72 ชม. · q = น้ำไหล 24 ชม. · สสน. ไม่มีสถานีพวกนี้
// ใช้ 2 ทาง: เปิดตรง (หน้าเว็บ #rvCams) หรือ api.php require แล้วเรียก dwr_data() → D.dwr (assess.js ปัจจัยน้ำเหนือ สะพานปทุมธานี 1)
function dwr_data() {
  $ST = ['pom' => 'TA100218', 'pridi' => 'TA100222', 'pt1' => 'TA100219', 'pyf' => 'TA100220'];   // key ตรงกับ id ใน cams.php
  $CF = __DIR__ . '/data/dwr.json';
  $old = is_file($CF) ? json_decode(file_get_contents($CF), true) : null;
  if ($old && time() - filemtime($CF) < 600) return $old;
  $mh = curl_multi_init(); $hs = [];
  foreach ($ST as $k => $code) {
    $h = curl_init("https://telemetry.dwr.go.th/api/public/station/getByCode/$code");
    curl_setopt_array($h, [CURLOPT_RETURNTRANSFER => 1, CURLOPT_TIMEOUT => 25, CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_USERAGENT => 'bangkho-water/1.0']);
    curl_multi_add_handle($mh, $h); $hs[$k] = $h;
  }
  do { curl_multi_exec($mh, $run); curl_multi_select($mh); } while ($run);
  $hour = fn($d) => substr(str_replace('T', ' ', $d), 0, 13);
  $out = [];
  foreach ($hs as $k => $h) {
    $v = json_decode(curl_multi_getcontent($h), true)['value'] ?? null;
    curl_multi_remove_handle($mh, $h);
    $c = $v['stationCurrentData'] ?? null;
    if (!$c || !isset($c['wl'])) { if (isset($old[$k])) $out[$k] = ['stale' => true] + $old[$k]; continue; }   // ต้นทางล่ม → ค่าเดิม
    $p = $v['wlChart']['past'] ?? [];
    $s = [];
    foreach ($p as $i => $q) {
      if (!isset($q['value'])) continue;
      $a = $p[$i - 1]['value'] ?? null; $b = $p[$i + 1]['value'] ?? null;
      if ($a !== null && $b !== null && abs($q['value'] - $a) > .5 && abs($q['value'] - $b) > .5) continue;   // ตัดค่ากระโดดจุดเดียว (เซนเซอร์สะดุด)
      $s[] = [$hour($q['date']), $q['value']];
    }
    $fq = [];
    foreach ($v['frChart']['past'] ?? [] as $q) if (isset($q['value'])) $fq[] = [$hour($q['date']), round($q['value'])];
    $e = $v['fullCon']['entity'];
    $out[$k] = ['name' => $e['stnNameTh'], 'code' => $e['stationCode'], 'wl' => $c['wl'], 'dt' => substr(str_replace('T', ' ', $c['wlTimeStamp'] ?? ''), 0, 16),
      'fr' => $v['currentFlowRate'] ?? null, 'red' => end($p)['redHigh'] ?? null, 'lb' => $e['lbMsl'] ?? null, 'rb' => $e['rbMsl'] ?? null,
      's' => array_slice($s, -72), 'q' => array_slice($fq, -24)];
  }
  $j = json_encode($out, JSON_UNESCAPED_UNICODE);
  if ($out && $j) { @file_put_contents("$CF.tmp", $j) && @rename("$CF.tmp", $CF); }   // json_encode พัง/ว่าง ห้ามเขียนทับแคช
  return $out ?: ($old ?: []);
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: public, max-age=300');
  echo json_encode(dwr_data(), JSON_UNESCAPED_UNICODE) ?: '{}';
}
