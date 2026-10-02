# Rutinitas harian: simpan, uji, kembalikan

## Membuka proyek

Klik **Projects** di menu samping.

![Daftar proyek](../images/05-projects.png)

| No. | Apa ini | Yang Anda lakukan |
| --- | --- | --- |
| 1 | Nama proyek | Klik untuk membuka proyek. |
| 2 | **Filters** (saring) | Tampilkan sebagian proyek saja. |
| 3 | **New project** (proyek baru) | Buat proyek baru. Lihat [Menyiapkan proyek baru](08-new-project.md). |

## Layar proyek

![Layar proyek](../images/07-project.png)

| No. | Apa ini | Yang Anda lakukan |
| --- | --- | --- |
| 1 | **Snapshot** | Simpan data saat ini sebagai state baru. |
| 2 | **HEAD** dan **Quota** | HEAD adalah state yang sama dengan data live. **modified** berarti data sudah berubah sejak itu. Quota adalah ruang yang dipakai state Anda. |
| 3 | Tab | **States** berisi daftar state. **Databases** berisi koneksi. **Activity** berisi riwayat. |
| 4 | **List** / **Tree** | Dua tampilan dari state yang sama. **Tree** (pohon) menunjukkan asal setiap state. |
| 5 | **Check out** | Kembalikan data state ini. |
| 6 | **Show stashes** | Tampilkan juga state yang disimpan Testate sendiri. |
| 7 | **Compare** (bandingkan) | Cari perubahan antara dua titik waktu. Lihat [Membandingkan dua titik waktu](06-compare.md). |

## Langkah 1: simpan data (Snapshot)

Lakukan ini sebelum mulai menguji.

1. Klik **Snapshot**.
2. Isi formulirnya.
3. Klik **Take** (ambil).

![Form Snapshot](../images/08-snapshot.png)

| No. | Apa ini | Yang Anda lakukan |
| --- | --- | --- |
| 1 | **Name** (nama) | Ketik nama pendek. Nama harus berbeda dalam satu proyek. Contoh: `before-payment-test`. |
| 2 | **Notes** (catatan) | Boleh dikosongkan. Tulis alasan Anda menyimpannya. |
| 3 | **Tags** (label) | Boleh dikosongkan. Label untuk mencari state nanti, misalnya nomor sprint atau nomor bug. |
| 4 | **In the frame** | Database yang ikut disimpan. Testate selalu menyimpan semuanya. |
| 5 | **Take** | Klik. Testate menyimpan state di latar belakang. |

Beberapa detik kemudian, state baru muncul di urutan teratas.

![Daftar state](../images/09-states-list.png)

| No. | Apa ini | Yang Anda lakukan |
| --- | --- | --- |
| 1 | Nama state | Klik untuk melihat isinya. Lihat [Merawat state Anda](03-states.md). |
| 2 | **HEAD** | Data live sekarang sama dengan state ini. |
| 3 | Tag | Label yang Anda ketik. |
| 4 | **Check out** | Kembalikan data state ini. |
| 5 | Menu **⋯** | Aksi lain: **Check for changes**, **Download**, **Edit**, **Protect**, **Delete**. |

## Langkah 2: jalankan pengujian

Pakai aplikasi Anda seperti biasa. Testate tidak melakukan apa-apa di langkah ini.

Saat data berubah, label HEAD menampilkan **modified** (berubah). Contoh: `before-payment-test · modified`. Artinya data live sudah tidak sama dengan state tersebut.

## Langkah 3: kembalikan data (Check out)

1. Buka tab **States**.
2. Cari state yang Anda mau.
3. Klik **Check out**.
4. Baca jendela yang muncul.
5. Klik **Check out** di jendela itu.

![Jendela Check out](../images/23-checkout.png)

| No. | Apa ini | Yang Anda lakukan |
| --- | --- | --- |
| 1 | Pesan stash | Testate menyimpan data saat ini dulu sebagai stash. Anda bisa membatalkan checkout dengan stash itu. |
| 2 | Daftar database | Setiap database dan hasil cek skemanya. **schema matches** berarti susunan tabelnya sama. |
| 3 | **Force past schema drift** | Pakai hanya jika susunan tabel berubah. Baca [Jika terjadi masalah](09-troubleshooting.md#jika-terjadi-masalah) dulu. |
| 4 | **Check out** | Klik untuk mulai. |

> **Perhatian:** Checkout mengganti data live di semua database proyek. Beri tahu rekan yang memakai database uji yang sama sebelum Anda mulai.

**Restore method per database** menunjukkan cara Testate menulis ke setiap database. Bagian ini memberi tahu apakah tabel akan dikunci selama proses. Bagian ini juga memberi tahu apakah pengguna lain bisa melihat data yang baru setengah dipulihkan, seperti pada MongoDB. Baca bagian ini sebelum checkout database yang dipakai orang lain.

## Melihat hasil checkout

Buka tab **Activity**, lalu **Checkouts**.

![Riwayat checkout](../images/24-checkouts.png)

| No. | Apa ini | Yang Anda lakukan |
| --- | --- | --- |
| 1 | **Checkouts** | Daftar semua checkout di proyek ini. |
| 2 | State | State yang dikembalikan. |
| 3 | **Result** (hasil) | **Succeeded** berarti semua database berhasil dikembalikan. **Failed** berarti ada yang gagal. |
| 4 | **Details** (rincian) | Lihat hasil setiap database. |
| 5 | **Counters** (penghitung ID) | Testate mengatur ulang penghitung ID setelah checkout. Klik untuk melihat hasilnya. Jika langkah itu gagal, perbaiki dari sana. |
| 6 | **Retry** (ulangi) | Jalankan lagi checkout untuk database yang gagal. Tombol ini aktif hanya setelah ada kegagalan. |

## Membatalkan checkout (stash)

Sebelum checkout, impor, atau perubahan pertama, Testate menyimpan stash. Untuk kembali:

1. Buka tab **States**.
2. Klik **Show stashes**.
3. Cari stash dengan waktu tepat sebelum perubahan Anda.
4. Klik **Check out** pada stash itu.

![Daftar dengan stash](../images/25-stashes.png)

| No. | Apa ini | Yang Anda lakukan |
| --- | --- | --- |
| 1 | **Show stashes** | Nyalakan untuk menampilkan stash di daftar. |
| 2 | Stash | Namanya berisi tanggal dan jam. Di bawahnya tertulis database yang disimpan. |
| 3 | **Check out** | Kembalikan data stash itu. |

> **Catatan:** Testate hanya menyimpan stash terbaru. Stash lama terhapus otomatis. Untuk data yang Anda perlukan lama, simpan state biasa dengan **Snapshot**.

---

← Sebelumnya: [Masuk ke Testate](01-sign-in.md) · [Daftar isi](README.md) · Berikutnya: [Merawat state Anda](03-states.md) →
