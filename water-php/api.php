<?php
// ศูนย์เฝ้าระวังน้ำ /water — ดึงข้อมูลสดจาก api-v3.thaiwater.net (สสน.) ย่อให้เล็ก แล้วแคชไว้ 10 นาที
// ?force=1 = ดึงใหม่ทันที
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=120');

const TW  = 'https://api-v3.thaiwater.net/api/v1/thaiwater30/';
const IMG = 'https://api-v3.thaiwater.net/api/v1/thaiwater30//shared/image?_csrf=&image=';
const TTL = 600;
@ini_set('memory_limit', '512M');               // ต้นทางรวม ~16MB JSON แตกเป็นอาร์เรย์กินหลายร้อย MB
$DIR = __DIR__ . '/data';
if (!is_dir($DIR)) @mkdir($DIR, 0755, true);
if (!file_exists("$DIR/.htaccess")) @file_put_contents("$DIR/.htaccess", "Require all denied\n");
$CF = "$DIR/cache.json";

if (empty($_GET['force']) && is_file($CF) && time() - filemtime($CF) < TTL) { readfile($CF); exit; }

// ทางสำรอง: PHP พังกลางทาง (เมมโมรีเต็ม/ต้นทางเปลี่ยนรูป) → ส่งแคชล่าสุดพร้อม stale แทน 500 ว่าง
// ใช้ fpassthru ไม่ decode — ตอนเมมโมรีเต็มยังทำได้ · หน้าเว็บขึ้น "แหล่งข้อมูลขัดข้อง ใช้ค่าล่าสุดที่มี"
register_shutdown_function(function () use ($CF) {
  $e = error_get_last();
  if (!$e || !in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR]) || !is_file($CF)) return;
  if (!headers_sent()) http_response_code(200);
  $f = fopen($CF, 'rb'); fseek($f, 1);           // แคชขึ้นต้น {"updated"… → แทรก stale ไว้หน้า
  echo '{"stale":true,"crash":true,'; fpassthru($f); fclose($f);
});

// สถานีหลัก เรียงจากต้นน้ำลงมา  [id => [ชื่อสั้น, กลุ่ม]]
$KEY = [
  2795 => ['C.2 นครสวรรค์ (น้ำเหนือ)', 'river'],
  2744 => ['C.13 ท้ายเขื่อนเจ้าพระยา ชัยนาท', 'river'],
  2626 => ['C.7A อ่างทอง', 'river'],
  2609 => ['C.35 บ้านป้อม อยุธยา', 'river'],
  2607 => ['S.5 แม่น้ำป่าสัก อยุธยา', 'river'],
  49   => ['บางปะอิน อยุธยา', 'river'],
  26   => ['สะพานนวลฉวี ปากเกร็ด นนทบุรี', 'river'],
  2599 => ['C.12 สามเสน กรุงเทพฯ', 'river'],
  4    => ['สะพานกรุงเทพ (ใกล้ปากน้ำ)', 'river'],
  23   => ['คลองอ้อมนนท์ บางใหญ่', 'west'],     // ใกล้ รร. สุด ~4 กม. · ตายตั้งแต่ ก.ค.66 กลับมาส่งค่า 2ต.ค.69
  24   => ['คลองพระพิมล ไทรน้อย', 'west'],
  5    => ['คลองมหาสวัสดิ์ บางกรวย-สวนผัก', 'west'],
];
$DAMS  = [1, 12, 36, 11];                       // ภูมิพล สิริกิติ์ แควน้อย ป่าสักชลสิทธิ์
$RADAR = ['nkm', 'njk', 'svp120', 'skm240', 'takhli', 'phs240'];

function multiGet(array $urls): array {
  $mh = curl_multi_init(); $hs = [];
  foreach ($urls as $k => $u) {
    $h = curl_init($u);
    curl_setopt_array($h, [CURLOPT_RETURNTRANSFER => 1, CURLOPT_TIMEOUT => 40, CURLOPT_CONNECTTIMEOUT => 10,
      CURLOPT_FOLLOWLOCATION => 1, CURLOPT_ENCODING => '', CURLOPT_USERAGENT => 'bangkho-water/1.0']);
    curl_multi_add_handle($mh, $h); $hs[$k] = $h;
  }
  do { $st = curl_multi_exec($mh, $run); if ($run) curl_multi_select($mh, 1); } while ($run && $st == CURLM_OK);
  $out = [];
  foreach ($hs as $k => $h) {
    $out[$k] = json_decode((string)curl_multi_getcontent($h), true);
    curl_multi_remove_handle($mh, $h); curl_close($h);
    // thailand_main บวมถึง 10MB (rain/warning ~4MB ต่อก้อน, 1ต.ค.69) → เก็บเฉพาะที่ใช้ กันเมมโมรีเต็ม 500
    if ($k === 'main' && is_array($out[$k])) $out[$k] = array_intersect_key($out[$k], array_flip(['dam', 'radar', 'pre_rain', 'pre_rain_sea', 'pre_rain_basin', 'storm']));
  }
  curl_multi_close($mh);
  return $out;
}
function f($v) { return ($v === null || $v === '') ? null : round((float)$v, 2); }
function utc7($s) { return $s ? date('Y-m-d H:i', strtotime($s . ' UTC')) : null; }   // เวลาเรดาร์เป็น UTC

$today = date('Y-m-d'); $from = date('Y-m-d', strtotime('-3 days'));
$urls = [
  'wl'   => TW . 'public/waterlevel_load',
  'main' => TW . 'public/thailand_main',
  'rain' => TW . 'public/rain_24h?province_code=10,12,13,14',
  'road' => TW . 'public/flood_road',
  'wm'   => TW . 'public/weather_img/weather_map_tmd',
  'cloud'=> TW . 'public/weather_img/cloud',
  'gate' => TW . 'public/watergate_load',
  'rid'  => 'https://raw.githubusercontent.com/krubk12-collab/bangkho-watch/status/rid.json',   // C.29B จาก PDF กรมชลฯ (bangkho-watch/rid.mjs)
];
foreach ($KEY as $id => $_) $urls["g$id"] = TW . "public/waterlevel_graph?station_type=tele_waterlevel&station_id=$id&start_date=$from&end_date=$today";
$R = multiGet($urls);

$wl = $R['wl']['waterlevel_data']['data'] ?? null;
if (!$wl) {                                      // ต้นทางล่ม → ส่งแคชเก่าพร้อมธง stale ไม่เขียนทับด้วยค่าว่าง
  if (is_file($CF)) { $o = json_decode(file_get_contents($CF), true); $o['stale'] = true; echo json_encode($o, JSON_UNESCAPED_UNICODE); }
  else { http_response_code(502); echo '{"error":"thaiwater unreachable"}'; }
  exit;
}
$byId = [];
foreach ($wl as $x) $byId[$x['station']['id']] = $x;

$PREV = [];                                      // กราฟรายสถานีจากแคชรอบก่อน
if (is_file($CF)) foreach ((json_decode(file_get_contents($CF), true)['stations'] ?? []) as $p) $PREV[$p['id']] = $p['s'] ?? [];
$stations = [];
foreach ($KEY as $id => [$label, $grp]) {
  $x = $byId[$id] ?? null;
  $g = $R["g$id"]['data'] ?? [];
  $series = [];                                  // ย่อเป็นรายชั่วโมง
  foreach (($g['graph_data'] ?? []) as $p) {
    if ($p['value'] === null) continue;
    $series[substr($p['datetime'], 0, 13)] = round($p['value'], 3);
  }
  // กราฟ สสน. ล่มบ่อย ("too many open files") → ใช้กราฟรอบก่อน + ต่อค่าล่าสุดเข้าไปเอง ไม่ให้กราฟ/ตารางน้ำขึ้นลงหาย
  if (!$series) {
    foreach (($PREV[$id] ?? []) as [$k, $v]) if ($k >= $from) $series[$k] = $v;
    if (isset($x['waterlevel_msl'], $x['waterlevel_datetime']) && $x['waterlevel_msl'] !== null)
      $series[substr($x['waterlevel_datetime'], 0, 13)] = round((float)$x['waterlevel_msl'], 3);
    ksort($series);
  }
  $last = $series ? array_key_last($series) : null;
  $st = $x['station'] ?? [];
  $stations[] = [
    'id' => $id, 'label' => $label, 'grp' => $grp,
    'code' => $st['tele_station_oldcode'] ?? null,
    'river' => $x['river_name'] ?? null,
    'amphoe' => $x['geocode']['amphoe_name']['th'] ?? null,
    'prov' => $x['geocode']['province_name']['th'] ?? null,
    'lat' => $st['tele_station_lat'] ?? null, 'lng' => $st['tele_station_long'] ?? null,
    'dt' => $x['waterlevel_datetime'] ?? ($last ? "$last:00" : null),
    'wl' => f($x['waterlevel_msl'] ?? ($last ? $series[$last] : null)),
    'bank' => f($st['min_bank'] ?? ($g['min_bank'] ?? null)),
    'ground' => f($st['ground_level'] ?? null),   // ท้องคลอง: สสน. คิด pct = (wl-ground)/(bank-ground)
    'pct' => f($x['storage_percent'] ?? null),
    'diff' => f($x['diff_wl_bank'] ?? null), 'diffText' => $x['diff_wl_bank_text'] ?? null,
    'lv' => $x['situation_level'] ?? null,
    'q' => f($x['discharge'] ?? null),
    'agency' => $x['agency']['agency_shortname']['th'] ?? null,
    's' => array_map(fn($k, $v) => [$k, $v], array_keys($series), array_values($series)),
  ];
}

$main = $R['main'] ?? [];
$dams = [];
foreach (($main['dam']['data']['data'] ?? []) as $d) {
  if (!in_array($d['dam']['id'], $DAMS)) continue;
  $dams[array_search($d['dam']['id'], $DAMS)] = [
    'name' => $d['dam']['dam_name']['th'], 'date' => $d['dam_date'],
    'pct' => f($d['dam_storage_percent']), 'storage' => f($d['dam_storage']),
    'inflow' => f($d['dam_inflow']), 'release' => f($d['dam_released']), 'spill' => f($d['dam_spilled']),
    'uses' => f($d['dam_uses_water_percent']),
    'lat' => $d['dam']['dam_lat'] ?? null, 'lng' => $d['dam']['dam_long'] ?? null, 'max' => $d['dam']['max_storage'] ?? null,
  ];
}
ksort($dams); $dams = array_values($dams);
// เขื่อนขนาดใหญ่ทั้งหมด (ความรู้เพิ่มเติม / วางแผนเดินทาง) — ย่อฟิลด์ให้เล็ก
$damsAll = [];
foreach (($main['dam']['data']['data'] ?? []) as $d)
  $damsAll[] = ['id' => $d['dam']['id'], 'name' => $d['dam']['dam_name']['th'], 'date' => $d['dam_date'], 'pct' => f($d['dam_storage_percent']),
    'storage' => f($d['dam_storage']), 'max' => $d['dam']['max_storage'] ?? null, 'inflow' => f($d['dam_inflow']), 'release' => f($d['dam_released']),
    'spill' => f($d['dam_spilled']), 'lat' => $d['dam']['dam_lat'] ?? null, 'lng' => $d['dam']['dam_long'] ?? null];

$radar = [];
foreach (($main['radar']['data']['data'] ?? []) as $r) {
  $i = array_search($r['radar_type'], $RADAR);
  if ($i === false || empty($r['media_path'])) continue;
  $radar[$i] = ['type' => $r['radar_type'], 'name' => $r['radar_name'], 'dt' => utc7($r['media_datetime']), 'img' => IMG . $r['media_path']];
}
ksort($radar); $radar = array_values($radar);

$fc = [];                                        // ภาพพยากรณ์ฝน สสน. (แบบจำลอง WRF)
foreach (['pre_rain' => 'th', 'pre_rain_sea' => 'sea', 'pre_rain_basin' => 'basin'] as $k => $n)
  foreach (($main[$k]['data']['data'] ?? []) as $p)
    if (!empty($p['media_path'])) $fc[$n][] = ['dt' => $p['media_datetime'], 'img' => IMG . $p['media_path']];

$storm = [];
foreach (($main['storm']['data']['data'] ?? []) as $grp => $list)
  if (is_array($list)) foreach ($list as $p) if (!empty($p['media_path'])) $storm[] = ['dt' => $p['media_datetime'] ?? '', 'img' => IMG . $p['media_path']];

$wmap = [];                                      // แผนที่อากาศกรมอุตุฯ: ผิวพื้น (ความกดอากาศ) + ลมชั้นบน
foreach (($R['wm']['data'] ?? []) as $w)
  if (!empty($w['cover_image']['media_path'])) $wmap[] = ['name' => trim($w['description']['description_name']['th'] ?? ''),
    'file' => $w['cover_image']['filename'] ?? '', 'img' => IMG . $w['cover_image']['media_path']];
foreach (($R['cloud']['data']['typhoon'] ?? []) as $c)   // ภาพดาวเทียม Himawari
  if (!empty($c['media_path'])) $wmap[] = ['name' => 'ภาพดาวเทียม Himawari (เมฆ)', 'file' => $c['media_datetime'] ?? '', 'img' => IMG . $c['media_path']];

// ฝน: เก็บ 40 อันดับที่ตกหนักสุด + ทุกสถานีในรัศมี 25 กม. จากโรงเรียน (แม้ฝนเป็น 0 — "ไม่มีฝน" ก็เป็นข้อมูล)
const SCH = [13.851028, 100.403063];
function km($la, $lo) { $t = M_PI / 180; $a = sin(($la - SCH[0]) * $t / 2) ** 2 + cos(SCH[0] * $t) * cos($la * $t) * sin(($lo - SCH[1]) * $t / 2) ** 2; return 12742 * asin(sqrt($a)); }
$rain = [];
foreach (($R['rain']['data'] ?? []) as $r) {
  $la = $r['station']['tele_station_lat'] ?? null; $lo = $r['station']['tele_station_long'] ?? null;
  $d = $la ? round(km($la, $lo), 1) : null;
  if (($r['rain_24h'] ?? 0) <= 0 && ($d === null || $d > 25)) continue;
  if (strtotime($r['rainfall_datetime'] ?? '') < time() - 6 * 3600) continue;   // สถานีค้าง
  $rain[] = ['name' => $r['station']['tele_station_name']['th'] ?? '', 'amphoe' => $r['geocode']['amphoe_name']['th'] ?? '',
    'prov' => $r['geocode']['province_name']['th'] ?? '', 'r24' => f($r['rain_24h'] ?? 0), 'r1' => f($r['rain_1h'] ?? null),
    'dt' => $r['rainfall_datetime'] ?? '', 'lat' => $la, 'lng' => $lo, 'km' => $d];
}
usort($rain, fn($a, $b) => $b['r24'] <=> $a['r24']);
$rain = array_values(array_filter($rain, fn($r, $i) => $i < 40 || ($r['km'] !== null && $r['km'] <= 25), ARRAY_FILTER_USE_BOTH));

$road = []; $cut = time() - 3 * 3600;           // เซนเซอร์น้ำท่วมถนน กทม. เอาเฉพาะค่าที่สดภายใน 3 ชม.
foreach (($R['road']['data'] ?? []) as $r) {
  if (($r['floodroad_value'] ?? 0) <= 0 || strtotime($r['floodroad_datetime']) < $cut) continue;
  $road[] = ['name' => trim(str_replace('*', '', $r['station']['floodroad_name']['th'] ?? '')), 'amphoe' => $r['geocode']['amphoe_name']['th'] ?? '',
    'cm' => f($r['floodroad_value']), 'dt' => $r['floodroad_datetime'], 'lat' => $r['station']['floodroad_lat'] ?? null, 'lng' => $r['station']['floodroad_long'] ?? null];
}
usort($road, fn($a, $b) => $b['cm'] <=> $a['cm']);

// สถานีลุ่มเจ้าพระยาที่ล้นตลิ่ง (ภาพรวมพื้นที่เสี่ยงเหนือนนทบุรี)
$over = [];
foreach ($wl as $x) {
  if (($x['basin']['basin_code'] ?? 0) != 10 || ($x['situation_level'] ?? 0) < 5) continue;
  if (strtotime($x['waterlevel_datetime']) < time() - 12 * 3600) continue;
  $over[] = ['name' => $x['station']['tele_station_name']['th'], 'amphoe' => $x['geocode']['amphoe_name']['th'] ?? '', 'prov' => $x['geocode']['province_name']['th'] ?? '',
    'diff' => f($x['diff_wl_bank']), 'dt' => $x['waterlevel_datetime'], 'lat' => $x['station']['tele_station_lat'], 'lng' => $x['station']['tele_station_long']];
}
usort($over, fn($a, $b) => $b['diff'] <=> $a['diff']);

// ประตูระบายน้ำที่ส่งข้อมูลสด (≤12 ชม.) ลุ่มเจ้าพระยาตอนล่าง — ในนนทบุรีไม่มีประตูที่ส่งข้อมูลสดเข้า สสน.
$gates = [];
foreach (($R['gate']['watergate_data']['data'] ?? []) as $x) {
  $s = $x['station'] ?? []; $la = $s['tele_station_lat'] ?? 0; $lo = $s['tele_station_long'] ?? 0; $dt = $x['watergate_datetime_in'] ?? $x['watergate_datetime_out'] ?? null;
  if ($la < 13.5 || $la > 15.4 || $lo < 99.9 || $lo > 101.0 || !$dt || strtotime($dt) < time() - 12 * 3600) continue;
  if (($x['watergate_in'] ?? null) === null && ($x['watergate_out'] ?? null) === null) continue;
  $gates[] = ['name' => $s['tele_station_name']['th'] ?? '', 'lat' => $la, 'lng' => $lo, 'in' => f($x['watergate_in'] ?? null), 'out' => f($x['watergate_out'] ?? null),
    'dt' => $dt, 'prov' => $x['geocode']['province_name']['th'] ?? '', 'amphoe' => $x['geocode']['amphoe_name']['th'] ?? '', 'agency' => $x['agency']['agency_shortname']['th'] ?? ''];
}

// ประตูสำคัญฝั่งตะวันออก (ลพบุรี/ป่าสัก/ทุ่งรังสิต) ที่ไม่ส่งข้อมูลประตูสด — พิกัด: สสน./กรมชลฯ, บางโฉมศรีจาก Longdo
// wl = ชื่อสถานีวัดระดับน้ำ สสน. ที่อยู่จุดเดียวกัน (ถ้ามี) ดึงค่าสดมาแสดงคู่
$EAST = [
  ['ปตร.มโนรมย์', 15.3277, 100.1091, 'ชัยนาท', 'หัวคลองชัยนาท–ป่าสัก รับน้ำเจ้าพระยาเหนือเขื่อนเจ้าพระยา ส่งไปทางตะวันออกลงแม่น้ำป่าสัก', 'ปตร.มโนรมย์'],
  ['ปตร.บางโฉมศรี', 15.0547, 100.3200, 'อ.อินทร์บุรี จ.สิงห์บุรี', 'ระบายน้ำเจ้าพระยาเข้าคลองบางโฉมศรีไปทุ่งฝั่งลพบุรี · ปี 2554 ประตูพังจนน้ำทะลักท่วมสิงห์บุรี–ลพบุรี', 'สถานีสูบน้ำคลองระบายชัยนาท-ป่าสัก 2 (ทุ่งเชียงราก)'],
  ['แม่น้ำลพบุรี เมืองลพบุรี', 14.7605, 100.5996, 'จ.ลพบุรี', 'จุดวัดน้ำ (ไม่ใช่ประตู) — น้ำจากบางโฉมศรีไหลตามแม่น้ำลพบุรีลงอยุธยา แล้วเข้าเจ้าพระยาเหนือนนทบุรี', 'เมืองลพบุรี', 'wl'],
  ['ปตร.เริงราง', 14.654, 100.742, 'จ.สระบุรี', 'ปลายคลองชัยนาท–ป่าสัก ก่อนลงแม่น้ำป่าสัก', null],
  ['ปตร.พระศรีศิลป์', 14.327, 100.871, 'อ.หนองแค จ.สระบุรี', 'บนคลองระพีพัฒน์ แบ่งน้ำลงคลองระพีพัฒน์แยกใต้ไปทุ่งรังสิต', null],
  ['คลองระพีพัฒน์แยกใต้ หนองเสือ', 14.2206, 100.8917, 'จ.ปทุมธานี', 'จุดวัดน้ำ (ไม่ใช่ประตู) — ทุ่งรังสิตระบายลงคลองหกวา/เจ้าพระยาทางฝั่งตะวันออกของกรุงเทพฯ ไม่ไหลเข้าฝั่งนนทบุรีตะวันตกโดยตรง', 'คลองระพีพัฒน์แยกใต้ หนองเสือ', 'wl'],
  ['คลองระพีพัฒน์แยกตก', 14.2061, 100.7448, 'จ.ปทุมธานี', 'จุดวัดน้ำ (ไม่ใช่ประตู) — ลงคลองรังสิตฯ ทุ่งรังสิตตอนบน', 'คลองระพีพัฒน์แยกตก', 'wl'],
];
$byName = [];
foreach ($wl as $x) $byName[$x['station']['tele_station_name']['th'] ?? ''] = $x;
$east = [];
foreach ($EAST as $e) {
  if (in_array($e[0], array_column($gates, 'name'))) continue;   // วันไหนประตูส่งข้อมูลสดแล้ว ใช้ของชั้นประตูสดแทน
  $x = $e[5] ? ($byName[$e[5]] ?? null) : null;
  if ($x && strtotime($x['waterlevel_datetime'] ?? '') < time() - 12 * 3600) $x = null;   // ค้าง = ไม่แสดงค่า
  $east[] = ['name' => $e[0], 'lat' => $e[1], 'lng' => $e[2], 'where' => $e[3], 'why' => $e[4], 'kind' => $e[6] ?? 'gate',
    'wl' => $x ? f($x['waterlevel_msl'] ?? null) : null, 'bank' => $x ? f($x['station']['min_bank'] ?? null) : null,
    'pct' => $x ? f($x['storage_percent'] ?? null) : null, 'dt' => $x['waterlevel_datetime'] ?? null];
}

$rid = $R['rid'] ?? null;                      // รายงานเกิน 3 วัน = PDF ค้าง/ถอดไม่ได้ ไม่ใช้
if (!is_array($rid) || empty($rid['date']) || strtotime($rid['date']) < time() - 3 * 86400) $rid = null;

require_once __DIR__ . '/dwr.php';             // สถานีกรมทรัพยากรน้ำ (สะพานปทุมธานี 1 ฯลฯ) — พังต้องไม่ลาก api ทั้งก้อน
try { $dwr = dwr_data(); } catch (Throwable $e) { $dwr = null; }
$out = ['updated' => date('Y-m-d H:i:s'), 'rid' => $rid, 'dwr' => $dwr, 'gates' => $gates, 'east' => $east, 'stations' => $stations, 'dams' => $dams, 'damsAll' => $damsAll, 'radar' => $radar,
  'fc' => $fc, 'storm' => array_slice($storm, 0, 4), 'wmap' => $wmap, 'rain' => $rain, 'road' => array_slice($road, 0, 40), 'over' => array_slice($over, 0, 30)];
$js = json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
if ($js === false) { http_response_code(500); echo '{"error":"encode"}'; exit; }
$tmp = "$CF.tmp"; file_put_contents($tmp, $js); rename($tmp, $CF);
echo $js;
