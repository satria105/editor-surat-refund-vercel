# Editor Surat Refund

Aplikasi Next.js untuk membuat surat refund, menerima pengajuan pelanggan melalui portal publik, dan menyimpan riwayat serta foto bukti di Vercel Blob privat.

## Portal pelanggan

Form publik tersedia di `https://refund.aiorbitlab.me/portal`. Admin dapat membuka atau menyalin link dari toolbar, menu sidebar, dan dashboard. Pelanggan mengisi data pemohon, WhatsApp, rekening, tanggal/nominal, alasan, dan maksimal dua foto bukti. Form meminta persetujuan pemrosesan; pengajuan disimpan sebagai record baru di history privat, lalu dapat ditinjau dan diedit melalui editor admin. Nomor WhatsApp, sumber submission, dan nomor referensi terlihat pada daftar history internal. Endpoint intake hanya menerima POST; tidak menyediakan akses baca daftar atau detail.

## Menjalankan lokal

- Gunakan Node.js `>=22.13.0` lalu jalankan `npm ci`.
- Salin `.env.example` menjadi `.env.local` dan isi `BLOB_READ_WRITE_TOKEN` dari private Blob store. Token diperlukan untuk sesi login, riwayat, submission portal, dan foto.
- Jalankan `npm run dev`.
- `npm test` menjalankan production build serta smoke test halaman, penolakan akses API tanpa sesi, validasi intake, honeypot, password salah, dan login lintas origin.

Jangan commit `.env.local`, token penyimpanan, atau cadangan data pengguna.

## Deploy ke Vercel

Hubungkan repository privat ini ke project Vercel dengan framework Next.js. Pastikan private Blob store terhubung agar `BLOB_READ_WRITE_TOKEN` tersedia pada environment deployment.

Password diperiksa di server menggunakan hash scrypt; password asli tidak lagi dikirim dalam bundle JavaScript klien. Login menerbitkan cookie sesi `HttpOnly`, `Secure` pada production, dan `SameSite=Lax`. Token sesi acak hanya disimpan sebagai hash di private Blob dan kedaluwarsa setelah 24 jam. Riwayat, detail surat, foto, penghapusan, dan penerbitan token upload memerlukan sesi yang valid, termasuk ketika aplikasi dibuka melalui custom domain. SSO Vercel tetap dapat digunakan sebagai lapisan tambahan.

Password lama tetap berlaku sebagai akun Admin. Setelah login sebagai Admin, buka menu **Akun & Audit** untuk membuat satu akun Master pertama kali; verifikasi password Admin dan gunakan password Master minimal 12 karakter. Setelah akun Master dibuat, hanya Master yang dapat mengganti password Master/Admin dan membaca audit. Audit menyimpan keberhasilan/kegagalan login, waktu, akun, IP, dan user-agent di private Blob. Password baru disimpan sebagai hash scrypt bersalt; saat password akun diganti, sesi lama akun tersebut dicabut.

Portal publik hanya menerima data yang tervalidasi dan lampiran JPEG/PNG berukuran terbatas, menerapkan honeypot serta pembatasan percobaan per alamat pada runtime, dan tidak memiliki endpoint untuk membaca submission. Data intake dan foto disimpan di Blob privat; endpoint admin tetap memerlukan sesi password.

Override `@vercel/cli-config@0.3.6` mempertahankan Blob/OIDC pada versi major yang digunakan sambil memperbarui dependency Zod yang ditandai audit. Tinjau override ini ketika memperbarui SDK Blob berikutnya.

Data lama diimpor sebagai operasi sekali jalan, bukan disimpan dalam repository atau disinkronkan otomatis dari situs asal.
