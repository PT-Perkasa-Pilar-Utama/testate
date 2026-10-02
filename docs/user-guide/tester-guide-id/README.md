# Panduan Testate untuk Tester

Panduan ini untuk pengguna dengan peran **Tester**. Anda tidak perlu paham SQL atau database untuk memakai sebagian besar fiturnya. Semua gambar diambil dari aplikasi asli. Angka oranye pada gambar sama dengan angka pada tabel di bawahnya.

Tampilan Testate memakai bahasa Inggris. Panduan ini menulis nama tombol persis seperti di layar, dengan huruf tebal, agar mudah Anda cari. Contoh: klik **Snapshot** (simpan data).

English version: [tester-guide-en](../tester-guide-en/README.md).

## Daftar isi

1. [Masuk ke Testate](01-sign-in.md)
2. [Rutinitas harian: simpan, uji, kembalikan](02-daily-routine.md)
3. [Merawat state Anda](03-states.md)
4. [Melihat data](04-look-at-data.md)
5. [Mengubah data](05-change-data.md)
6. [Membandingkan dua titik waktu](06-compare.md)
7. [File, Jobs, dan Tools](07-files-jobs-tools.md)
8. [Menyiapkan proyek baru](08-new-project.md)
9. [Masalah dan bantuan](09-troubleshooting.md)

## Apa yang dilakukan Testate

Setiap kali Anda menguji, data di database uji berubah. Sebelum pengujian berikutnya, data harus dikembalikan seperti semula. Testate melakukannya untuk Anda dengan satu klik.

```
  1. Snapshot            2. Uji                 3. Check out
  ┌──────────────┐       ┌──────────────┐       ┌──────────────┐
  │ Simpan data  │ ────▶ │ Jalankan tes │ ────▶ │ Kembalikan   │
  │ jadi "state" │       │ data berubah │       │ data simpanan│
  └──────────────┘       └──────────────┘       └──────────────┘
         ▲                                              │
         └──────────── ulangi sesering yang Anda perlu ─┘
```

### Istilah yang akan Anda temui

| Istilah | Artinya | Contoh |
| --- | --- | --- |
| **Project** (proyek) | Satu sistem yang diuji. Berisi database dan state. | "Payment service SIT" |
| **Database** (juga **adapter**) | Satu koneksi dari Testate ke database atau penyimpanan file yang asli. | `shop-postgres` |
| **State** | Salinan data semua database dalam proyek pada satu waktu. | `before-payment-test` |
| **Snapshot** | Tombol untuk menyimpan state baru. | |
| **Check out** | Mengembalikan data sebuah state ke database yang sedang dipakai (live). | |
| **HEAD** | State yang sama dengan data live saat ini. | `HEAD before-payment-test` |
| **Stash** | State yang disimpan Testate sendiri sebelum mengubah data. Dipakai untuk membatalkan perubahan. | `stash-2026-10-02T13-50-20…` |
| **Starting point** (`init`) | State pertama, disimpan saat database masuk ke proyek. Tidak bisa dihapus. | `init` |
| **Compare** (diff) | Daftar baris yang berbeda antara dua titik waktu. | 4 baris ditambah |
| **Sandbox** / **Read-only** | Sandbox boleh diubah. Read-only hanya boleh dilihat. | |

---

Mulai dari: [Masuk ke Testate](01-sign-in.md) →
