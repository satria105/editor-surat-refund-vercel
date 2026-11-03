# Editor Surat Refund

Aplikasi Next.js untuk membuat surat refund dan menyimpan riwayat serta foto bukti di Vercel Blob privat.

## Menjalankan lokal

- Node.js `>=22.13.0`
- `npm ci`
- Salin `.env.example` menjadi `.env.local`, lalu isi `BLOB_READ_WRITE_TOKEN` dari Vercel Blob untuk mengaktifkan riwayat dan penyimpanan foto.
- `npm run dev`
- `npm test` menjalankan build production dan smoke test halaman utama.

Jangan commit `.env.local` atau token penyimpanan.

## Deploy ke Vercel

Hubungkan repository privat ini ke project Vercel dengan framework Next.js. Pastikan private Blob store terhubung agar `BLOB_READ_WRITE_TOKEN` tersedia pada environment deployment.

**Perlindungan akses:** API riwayat dan foto mengandalkan perlindungan deployment Vercel. Layar password di aplikasi adalah gate di sisi klien, bukan autentikasi server. Project Vercel saat ini memakai SSO untuk URL deployment, tetapi kebijakan tersebut mengecualikan custom domain. Pertahankan SSO atau pasang autentikasi setara sebelum menambahkan custom domain atau membuka aplikasi ke publik.
