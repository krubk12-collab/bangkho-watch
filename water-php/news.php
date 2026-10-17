<?php
// ข่าวสดสถานการณ์น้ำ ฝน อากาศ — หัวข่าวจาก Google News RSS (เฉพาะหัวข้อ+ลิงก์ไปต้นฉบับ) แคช 15 นาที
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=300');
$DIR = __DIR__ . '/data';
if (!is_dir($DIR)) @mkdir($DIR, 0755, true);
$CF = "$DIR/news.json";
if (empty($_GET['force']) && is_file($CF) && time() - filemtime($CF) < 900) { readfile($CF); exit; }

$TOPICS = [
  'nont'  => 'น้ำท่วม นนทบุรี',
  'west'  => 'บางใหญ่ OR บางบัวทอง OR ไทรน้อย OR บางกรวย น้ำ',
  'river' => 'เจ้าพระยา ระบายน้ำ OR ระดับน้ำ',
  'rain'  => 'กรมอุตุนิยมวิทยา ฝนตกหนัก OR พายุ OR ประกาศเตือน',
];
$mh = curl_multi_init(); $hs = [];
foreach ($TOPICS as $k => $q) {
  $h = curl_init('https://news.google.com/rss/search?q=' . rawurlencode("$q when:3d") . '&hl=th&gl=TH&ceid=TH:th');
  curl_setopt_array($h, [CURLOPT_RETURNTRANSFER => 1, CURLOPT_TIMEOUT => 25, CURLOPT_FOLLOWLOCATION => 1, CURLOPT_USERAGENT => 'Mozilla/5.0 bangkho-water']);
  curl_multi_add_handle($mh, $h); $hs[$k] = $h;
}
do { $st = curl_multi_exec($mh, $run); if ($run) curl_multi_select($mh, 1); } while ($run && $st == CURLM_OK);

$items = []; $seen = [];
foreach ($hs as $k => $h) {
  $xml = @simplexml_load_string((string)curl_multi_getcontent($h));
  curl_multi_remove_handle($mh, $h); curl_close($h);
  if (!$xml) continue;
  foreach ($xml->channel->item as $it) {
    $title = trim((string)$it->title); $src = trim((string)$it->source);
    if ($src && str_ends_with($title, " - $src")) $title = substr($title, 0, -strlen(" - $src"));
    $key = mb_substr(preg_replace('/\s+/u', '', $title), 0, 40);
    if (isset($seen[$key])) continue; $seen[$key] = 1;
    $items[] = ['t' => $title, 'src' => $src, 'url' => (string)$it->link, 'ts' => strtotime((string)$it->pubDate), 'topic' => $k];
  }
}
curl_multi_close($mh);
if (!$items) {                                   // ดึงไม่ได้ → ใช้ของเดิม ไม่เขียนทับด้วยค่าว่าง
  if (is_file($CF)) readfile($CF); else echo '{"items":[]}';
  exit;
}
usort($items, fn($a, $b) => $b['ts'] <=> $a['ts']);
$js = json_encode(['updated' => date('Y-m-d H:i:s'), 'items' => array_slice($items, 0, 80)], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
if ($js === false) { echo '{"items":[]}'; exit; }
file_put_contents("$CF.tmp", $js); rename("$CF.tmp", $CF);
echo $js;
