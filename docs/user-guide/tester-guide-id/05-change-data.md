# Mengubah data

Anda hanya bisa mengubah data di database **Sandbox**. Testate menyimpan stash lebih dulu, jadi perubahan selalu bisa dibatalkan.

## Mengubah baris secara manual

1. Buka sebuah tabel.
2. Nyalakan **Write mode**.

![Write mode](../images/14-write-mode.png)

| No. | Apa ini | Yang Anda lakukan |
| --- | --- | --- |
| 1 | Pesan write mode | Perubahan Anda langsung masuk ke database live. Testate menyimpan stash tabel sebelum perubahan pertama. |
| 2 | **Insert row** | Tambah baris baru. |
| 3 | **Edit** | Ubah baris ini. |
| 4 | Menu **⋯** | Berisi **Delete row** (hapus baris). Testate langsung menghapusnya tanpa bertanya. |
| 5 | **End write mode** | Klik setelah selesai. |

**Foreign-key checks on** memastikan setiap baris hanya menunjuk ke baris yang ada. Matikan hanya jika pengujian Anda butuh tautan yang rusak.

Untuk menambah baris:

![Menambah baris](../images/15-insert-row.png)

| No. | Apa ini | Yang Anda lakukan |
| --- | --- | --- |
| 1 | Jenis nilai | **Value**: pakai yang Anda ketik. **NULL**: kosongkan. **Default**: biar database yang mengisi. **Function**: buat nilai otomatis, misalnya waktu sekarang. |
| 2 | Nilai | Ketik nilainya. |
| 3 | **Copies** (salinan) | Tambah baris yang sama beberapa kali, maksimal 50. |
| 4 | **Insert** | Simpan baris. **Insert and add another** menyimpan lalu membuka formulir kosong. |

Pakai **Default** untuk kolom ID. Database akan memberi nomor berikutnya.

## Impor file CSV atau Excel

1. Buka database.
2. Klik **Import** pada tabel tujuan.
3. Ikuti langkah di bawah.

![Impor file](../images/18-import.png)

| No. | Apa ini | Yang Anda lakukan |
| --- | --- | --- |
| 1 | **File** | Pilih file `.csv` atau `.xlsx`. Ragu dengan formatnya? Klik **Sample CSV** atau **Sample XLSX**. |
| 2 | **What happens** (yang terjadi) | **Add these rows**: tambah semua baris sebagai baris baru. **Add new rows, update existing ones**: perbarui baris dengan kunci yang sama. **Clear the table, then load this file**: hapus semua baris dulu. |
| 3 | **Reuse a saved normalizer** | Normalizer adalah pasangan kolom yang tersimpan. Pilih untuk memakainya lagi. Ketik nama di **Save this as** untuk menyimpan yang ini. |
| 4 | Pratinjau | Baris pertama file Anda. Klik **columns matched by name** untuk mengatur kolom file mana masuk ke kolom tabel mana. |
| 5 | **Check the file** | Testate memeriksa setiap baris tanpa mengubah apa pun. |
| 6 | Hasil pemeriksaan | Contoh: "All 3 rows look ready to import." (ketiga baris siap diimpor). |
| 7 | **Import** | Masukkan barisnya. Tombol ini aktif hanya setelah pemeriksaan bersih. |

Setelah impor selesai, Testate menampilkan hasilnya.

![Impor selesai](../images/19-import-done.png)

| No. | Apa ini | Yang Anda lakukan |
| --- | --- | --- |
| 1 | Hasil | Jumlah baris yang berhasil diimpor. |

Pemeriksaan tidak bisa menemukan semua masalah. Beberapa aturan, misalnya nilai ganda di kolom unik, baru terlihat saat impor sungguhan. Untuk melihat laporan, buka **Activity**, lalu **Imports**, lalu **Report**. Jika ada baris yang gagal, klik **Rejected rows** untuk mengunduhnya. Perbaiki file, lalu klik **Re-import rejected**.

---

← Sebelumnya: [Melihat data](04-look-at-data.md) · [Daftar isi](README.md) · Berikutnya: [Membandingkan dua titik waktu](06-compare.md) →
