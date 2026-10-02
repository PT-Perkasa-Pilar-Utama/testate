# Membandingkan dua titik waktu

Pakai ini untuk mencari apa saja yang diubah oleh pengujian Anda.

1. Buka tab **States**.
2. Klik **Compare**.

![Jendela Compare](../images/20-compare.png)

| No. | Apa ini | Yang Anda lakukan |
| --- | --- | --- |
| 1 | **From** (dari) | Pilih state yang lebih lama. |
| 2 | **To** (ke) | Pilih state yang lebih baru, atau **the live databases** untuk data saat ini. |
| 3 | **Compare** | Klik. Testate bekerja di latar belakang. |

Buka **Activity**, lalu **Diffs**.

![Daftar diff](../images/21-diffs.png)

| No. | Apa ini | Yang Anda lakukan |
| --- | --- | --- |
| 1 | **Diffs** | Daftar perbandingan. |
| 2 | Compare | Apa yang dibandingkan. |
| 3 | **Status** | Tunggu sampai **Ready** (siap). **Expires** menunjukkan kapan perbandingan ini dihapus. |
| 4 | **Details** | Buka hasilnya. |

![Rincian diff](../images/22-diff.png)

| No. | Apa ini | Yang Anda lakukan |
| --- | --- | --- |
| 1 | Tabel yang berubah | Setiap tabel yang berubah. `+4` berarti empat baris ditambah. `-2` berarti dua dihapus. `~1` berarti satu diubah. |
| 2 | **All** / **Added** / **Removed** / **Changed** | Tampilkan satu jenis perubahan saja: semua, ditambah, dihapus, atau diubah. |
| 3 | Baris | Baris `+` adalah baris baru. Baris `-` sudah hilang. Baris yang diubah tampil dua kali: versi lama (`-`) dan versi baru (`+`). Sel berwarna adalah sel yang berubah. Klik sel untuk membaca isinya lengkap. |

---

← Sebelumnya: [Mengubah data](05-change-data.md) · [Daftar isi](README.md) · Berikutnya: [File, Jobs, dan Tools](07-files-jobs-tools.md) →
