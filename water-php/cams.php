<?php
// ภาพนิ่งกล้องริมน้ำจากหน่วยงานอื่น ส่งต่อให้หน้า /water/ (#cam)
// กรมทรัพยากรน้ำ: GET snapshot/<uuid> ได้ path → POST file/image/cctv ได้ภาพ (2 ขั้น ไม่มี CORS ฝังตรงไม่ได้)
// เทศบาลนครรังสิต: /api/flood/snapshot/<id> ภาพตรง · ย่อเหลือกว้าง 800 px ประหยัดแบนด์วิดท์ · แคช 5 นาที
// ⚠️ รายการกล้องของกรมฯ มีรหัสผ่านกล้องติดมาด้วย — ห้ามใช้ลิงก์กล้องตรง ใช้ snapshot สาธารณะของกรมฯ เท่านั้น
$CAMS = [
  'pt1'   => ['dwr', '67113bac-7195-4acb-8476-a5c746995e26'],   // สะพานปทุมธานี 1
  'pt2'   => ['dwr', '11ab94b3-acd2-41c1-8969-9de1ad240dac'],   // สะพานปทุมธานี 2
  'pom'   => ['dwr', '791b194f-c7a5-4df2-b1d4-a5d10d8801a3'],   // บ้านป้อม อยุธยา
  'pridi' => ['dwr', 'd6ce0ed7-535c-4f9e-8ed5-796c5b096783'],   // สะพานปรีดี-ธำรง อยุธยา
  'pyf'   => ['dwr', '2b0a946b-4381-4f96-bbc6-35ff21294288'],   // สะพานพระพุทธยอดฟ้า
  'rsit'  => ['rs', '151'],                                     // คลองรังสิตฯ สะพานแดง
  // เทศบาลนครนนทบุรี: Milestone ImageService (http) ชื่อกล้องจาก http://182.52.224.70/json.php?app=station → station[].cctv
  'nA1'   => ['nth', 'A1-คลองท่าทราย Cam1'],
  'nA6'   => ['nth', 'A6-คลองบางกระสอ Cam1'],
  'nA7'   => ['nth', 'A7-คลองบางซื่อน้อย Cam1'],
  'nA8'   => ['nth', 'A8-คลองมะขามโพรง Cam1'],
  'nA10'  => ['nth', 'A10-คลองบางแพรก Cam1'],
  // iTIC ถ.กาญจนาภิเษก บางใหญ่ (ช่วงคลองมหาสวัสดิ์) — หาต้นทางตรงไม่ได้ ใช้ภาพนิ่งจาก cctv.maholan.net (เว็บรวมกล้อง) ถ้าเขาปิด ตัวนี้หายตาม
  'kbb'   => ['mh', 'tfc-itic-65'],                             // มุ่งหน้าบางบัวทอง
  'kbk'   => ['mh', 'tfc-itic-165'],                            // มุ่งหน้าบางแค
  'lbl'   => ['mh', 'doh-per_12_013'],                          // กรมทางหลวง ทล.340 ลาดบัวหลวง กม.25+610 (เหนือไทรน้อย เห็นแหล่งน้ำข้างทาง)
];
$id = $_GET['id'] ?? '';
if (!isset($CAMS[$id])) { http_response_code(404); exit; }
$DIR = __DIR__ . '/data'; $CACHE = "$DIR/cams_$id.jpg";
function out($f) { header('Content-Type: image/jpeg'); header('Cache-Control: public, max-age=300'); readfile($f); exit; }
if (is_file($CACHE) && time() - filemtime($CACHE) < 300) out($CACHE);

function get($url, $post = null) {
  $c = curl_init($url);
  curl_setopt_array($c, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 25, CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_USERAGENT => 'Mozilla/5.0 bangkho-water']);
  if ($post !== null) curl_setopt_array($c, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $post, CURLOPT_HTTPHEADER => ['Content-Type: application/json']]);
  $b = curl_exec($c); $code = curl_getinfo($c, CURLINFO_HTTP_CODE); curl_close($c);
  return $code >= 200 && $code < 300 ? $b : false;
}

[$src, $key] = $CAMS[$id];
$img = false;
if ($src === 'dwr') {
  $j = json_decode((string)get("https://telemetry.dwr.go.th/api/public/reportCctv/snapshot/$key"), true);
  if (!empty($j['value'])) $img = get('https://telemetry.dwr.go.th/api/file/image/cctv', json_encode(['path' => $j['value']]));
} elseif ($src === 'nth') {
  $img = get('http://182.52.224.70/MilestoneImageService/ImageService.svc/ImageService/GetImage?width=800&height=450&cameraname=' . rawurlencode($key));
} elseif ($src === 'mh') {
  $img = get("https://cctv.maholan.net/api/snap/$key");
} else {
  $img = get("https://cdp.rangsitcity.go.th/api/flood/snapshot/$key?t=" . time());
}
if (!$img || strlen($img) < 3000 || substr($img, 0, 2) !== "\xFF\xD8") {   // ต้นทางล่ม → ส่งภาพเดิม (ถ้ามี)
  if (is_file($CACHE)) { touch($CACHE, time() - 240); out($CACHE); }    // ลองใหม่ใน ~1 นาที
  http_response_code(502); exit;
}
if (function_exists('imagecreatefromstring') && ($im = @imagecreatefromstring($img)) && imagesx($im) > 800) {
  $s = imagescale($im, 800); ob_start(); imagejpeg($s, null, 72); $img = ob_get_clean();
}
@file_put_contents("$CACHE.tmp", $img) && @rename("$CACHE.tmp", $CACHE);
out($CACHE);
