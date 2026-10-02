# Masalah dan bantuan

## Jika terjadi masalah

| Yang Anda lihat | Artinya | Yang Anda lakukan |
| --- | --- | --- |
| HEAD bertuliskan **modified** | Data live berubah setelah snapshot atau checkout terakhir. | Biarkan jika memang diharapkan. Checkout sebuah state untuk mengembalikan. |
| HEAD bertuliskan **unknown** | Checkout berhenti sebelum semua database selesai. | Buka **Activity**, lalu **Checkouts**. Klik **Retry**. |
| Jendela checkout menunjukkan perbedaan skema | Seseorang mengubah susunan tabel, misalnya setelah deploy. Testate menghentikan checkout. | Tanyakan perubahannya ke developer. Nyalakan **Force past schema drift** hanya jika Anda menerima pemulihan sebagian. Testate lalu hanya memulihkan tabel dan kolom yang ada di kedua sisi. |
| Checkout gagal karena lock timeout | Aplikasi sedang mengunci tabel. Testate menunjukkan sesi yang menghalangi. | Hentikan aplikasi, atau selesaikan pekerjaan yang terbuka. Lalu klik **Retry**. |
| **Counters** gagal | Baris baru bisa mendapat ID yang sudah dipakai. | Klik **Counters** pada checkout itu untuk memperbaikinya. |
| **Write mode** tidak muncul | Database Read-only, database MongoDB, atau tabel tidak punya primary key. | Pakai database Sandbox dengan tabel yang punya primary key. |
| **Import** tetap tidak aktif | Pemeriksaan menemukan baris bermasalah. | Baca hasil pemeriksaan. Perbaiki file. Klik **Check the file** lagi. |
| Bar quota penuh | State Anda memakai seluruh ruang proyek. | Hapus state lama yang tidak dilindungi. |
| Pekerjaan berstatus **Failed** | Pekerjaan tidak selesai. | Buka **Jobs** dan baca kolom **Error**. Tunjukkan ke administrator jika kurang jelas. |
| Tidak bisa masuk | Lima kali salah password, atau akun Anda dinonaktifkan. | Tunggu 15 menit, atau hubungi administrator. |

## Hal yang hanya dilakukan administrator

Tester tidak bisa membuka layar berikut. Minta administrator untuk:

- membuat akun baru atau mengatur ulang password,
- token API untuk pipeline atau agen AI,
- catatan audit,
- pengaturan instance, seperti quota dan masa simpan data,
- aturan penyamaran (masking) kolom.

---

← Sebelumnya: [Menyiapkan proyek baru](08-new-project.md) · [Daftar isi](README.md)
