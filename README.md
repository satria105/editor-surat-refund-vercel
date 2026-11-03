# Editor Surat Refund

Aplikasi Next.js untuk membuat surat refund dan menyimpan riwayat serta foto bukti di Vercel Blob privat.

## Menjalankan lokal

- Gunakan Node.js `>=22.13.0` lalu jalankan `npm ci`.
- Salin `.env.example` menjadi `.env.local` dan isi `BLOB_READ_WRITE_TOKEN` dari private Blob store. Token diperlukan untuk sesi login, riwayat, dan foto.
- Jalankan `npm run dev`.
- `npm test` menjalankan production build serta smoke test halaman, penolakan akses API tanpa sesi, password salah, dan login lintas origin.

Jangan commit `.env.local`, token penyimpanan, atau cadangan data pengguna.

## Deploy ke Vercel

Hubungkan repository privat ini ke project Vercel dengan framework Next.js. Pastikan private Blob store terhubung agar `BLOB_READ_WRITE_TOKEN` tersedia pada environment deployment.

Password diperiksa di server menggunakan hash scrypt; password asli tidak lagi dikirim dalam bundle JavaScript klien. Login menerbitkan cookie sesi `HttpOnly`, `Secure` pada production, dan `SameSite=Lax`. Token sesi acak hanya disimpan sebagai hash di private Blob dan kedaluwarsa setelah 24 jam. Riwayat, detail surat, foto, penghapusan, dan penerbitan token upload memerlukan sesi yang valid, termasuk ketika aplikasi dibuka melalui custom domain. SSO Vercel tetap dapat digunakan sebagai lapisan tambahan.

Override `@vercel/cli-config@0.3.6` mempertahankan Blob/OIDC pada versi major yang digunakan sambil memperbarui dependency Zod yang ditandai audit. Tinjau override ini ketika memperbarui SDK Blob berikutnya.

Data lama diimpor sebagai operasi sekali jalan, bukan disimpan dalam repository atau disinkronkan otomatis dari situs asal.
