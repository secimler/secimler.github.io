# Oy Akışı

Bu dizin, YSK seçim sonuçlarından türetilmiş oy akışı tahminlerini görselleştiren statik web çıktısını içerir. Uygulama, farklı seçimler ve oy türleri arasında parti/aday bloklarının nasıl yer değiştirmiş olabileceğini hiyerarşik ekolojik çıkarım sonuçları üzerinden gösterir.

Görselleştirme doğrudan gözlenen bireysel seçmen davranışını değil, sandık/mahalle düzeyindeki toplulaştırılmış sonuçlardan tahmin edilen geçişleri gösterir. Bu nedenle akışlar yorumlanırken model tahmini oldukları, kesin bireysel transfer kayıtları olmadıkları dikkate alınmalıdır.

## Veri

Veri kaynağı YSK sonuçlarıdır. Bu yayında kullanılan akışlar yerel sandık/mahalle sonuçlarına dayanır; gümrük oyları kullanılmaz.

Uygulamadaki seçim düğümleri 2009-2024 arasındaki yerel seçimler, milletvekili seçimleri, cumhurbaşkanlığı seçimleri ve referandumları kapsar. Akış dosyaları iki düzeyde yayınlanır:

- `data/flows/`: ülke geneli akış tahminleri.
- `data/province_flows/`: il filtresi için kullanılan il bazlı akış tahminleri.

Akış dosyaları `.eif` uzantılı sıkıştırılmış/ikili yayın çıktılarıdır. Tarayıcı tarafında `assets/flow-binary.js` ile okunur.

## Görselleştirme

`index.html` tek sayfalı bir statik uygulamadır. Sayfa, seçimleri yatay aşamalar halinde gösterir ve partiler/adaylar arasındaki tahmini oy akışlarını şeritlerle çizer.

Arayüzde şunlar yapılabilir:

- Seçim sırasına yeni seçimler eklemek veya mevcut sırayı değiştirmek.
- Ülke geneli sonuçlar ile il filtresi arasında geçiş yapmak.
- Küçük kutuları veya küçük akışları minimum oy eşiğiyle gizlemek.
- Parti/aday renklerini değiştirmek.
- Oy sayılarını ve seçmen sayısı farkını açıp kapatmak.
- Görünümü paylaşılabilir URL durumu olarak kopyalamak.

## Dosya Yapısı

- `index.html`: statik sayfa ve gömülü veri manifesti.
- `assets/app.js`: görselleştirme ve kullanıcı etkileşimleri.
- `assets/flow-binary.js`: `.eif` akış dosyalarını çözme kodu.
- `assets/share-state.js`: paylaşılabilir görünüm durumu.
- `assets/site.css`: sayfa stilleri.
- `data/flows/`: ülke geneli model sonuçları.
- `data/province_flows/`: il bazlı model sonuçları.

Ekolojik çıkarım sonuçları özellikle küçük partiler, düşük oy hacimli geçişler ve yerel olarak keskin değişen seçmen kompozisyonları için belirsizlik taşır. Görselleştirme bu sonuçları keşfetmek ve karşılaştırmak için tasarlanmıştır; tek başına nedensel kanıt olarak okunmamalıdır.
