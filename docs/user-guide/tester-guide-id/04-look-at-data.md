# Melihat data

## Database dalam proyek

Buka tab **Databases**.

![Tab Databases](../images/11-databases.png)

| No. | Apa ini | Yang Anda lakukan |
| --- | --- | --- |
| 1 | Pesan starting point | Database baru hanya bisa ditambahkan saat proyek berada di starting point. Klik **Check out the starting point** dulu. |
| 2 | Nama database | Klik untuk membukanya. |
| 3 | **Mode** | **Sandbox** boleh diubah. **Read-only** hanya boleh dilihat. |
| 4 | **Status** | **OK** berarti Testate bisa terhubung. |

## Satu database

![Layar database](../images/12-adapter.png)

| No. | Apa ini | Yang Anda lakukan |
| --- | --- | --- |
| 1 | Nama tabel | Klik untuk melihat barisnya. |
| 2 | **Import** (impor) | Masukkan file CSV atau Excel ke tabel ini. Lihat [Impor file CSV atau Excel](05-change-data.md#impor-file-csv-atau-excel). |
| 3 | **Query console** | Tulis query untuk membaca data. |
| 4 | **List** / **Diagram** | **Diagram** menunjukkan hubungan antartabel. |
| 5 | **Retest connection** | Cek koneksi lagi, misalnya setelah password database diganti. |
| 6 | **Edit adapter** | Ganti nama, tabel yang dikecualikan, atau detail koneksi. Minta detail koneksi ke developer. |

**ROWS (EST.)** adalah perkiraan jumlah baris dari database. Buka tabelnya untuk melihat baris yang sebenarnya.

## Menjelajah tabel

![Isi tabel](../images/13-grid.png)

| No. | Apa ini | Yang Anda lakukan |
| --- | --- | --- |
| 1 | Filter | Pilih kolom dan kondisi, ketik nilai, lalu klik **Add filter**. Anda bisa menambah lebih dari satu filter. |
| 2 | **Export CSV** / **Export JSON** | Unduh baris sebagai file. |
| 3 | **Write mode** (mode ubah) | Nyalakan untuk mengubah baris. Lihat [Mengubah baris secara manual](05-change-data.md#mengubah-baris-secara-manual). |
| 4 | Nama kolom | Klik nama kolom untuk mengurutkan. |
| 5 | Halaman | Pilih jumlah baris per halaman. Klik **Next** dan **Previous** untuk pindah halaman. |

Tombol **Fixture** pada sebuah baris membuat data uji dari baris itu. Hasilnya ikut memuat baris lain yang ditautkan, dalam bentuk SQL atau JSON.

## Query console

Pakai jika Anda sedikit paham SQL. Konsol ini hanya membaca. Konsol ini tidak pernah mengubah data, apa pun yang Anda ketik.

![Query console](../images/16-query.png)

| No. | Apa ini | Yang Anda lakukan |
| --- | --- | --- |
| 1 | Editor SQL | Ketik query. Editor menyarankan nama tabel dan kolom. |
| 2 | **Run (read-only)** | Jalankan query. **Sample** menuliskan contoh query untuk Anda. |
| 3 | Hasil | Baris yang ditemukan query. **Row cap** membatasi jumlah baris yang tampil. |
| 4 | **Export CSV** / **Export JSON** | Unduh semua baris hasil query. |
| 5 | **Saved** / **History** / **Running** | Query tersimpan, query yang pernah dijalankan, dan query yang sedang berjalan. |
| 6 | Kotak "save as..." | Ketik nama lalu klik **Save** untuk menyimpan query. Klik query tersimpan untuk menjalankannya lagi. |

## Dokumen MongoDB

Database MongoDB berisi collection dan dokumen, bukan tabel dan baris.

![Penjelajah dokumen](../images/17-documents.png)

| No. | Apa ini | Yang Anda lakukan |
| --- | --- | --- |
| 1 | Collection | Klik untuk melihat dokumennya. |
| 2 | Dokumen | Klik dokumen untuk melihat field-nya. |
| 3 | Field | Isi dokumen. Klik field yang berisi field lain untuk membukanya. |
| 4 | Filter | Tampilkan hanya dokumen yang cocok. |

---

← Sebelumnya: [Merawat state Anda](03-states.md) · [Daftar isi](README.md) · Berikutnya: [Mengubah data](05-change-data.md) →
