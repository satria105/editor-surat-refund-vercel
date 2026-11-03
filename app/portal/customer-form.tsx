"use client";

import { ChangeEvent, FormEvent, useState } from "react";

type FormValues = {
  name: string;
  ktp: string;
  customerPhone: string;
  accountName: string;
  bank: string;
  accountNumber: string;
  paymentDate: string;
  amount: string;
  reason: string;
};

const initialValues: FormValues = {
  name: "",
  ktp: "",
  customerPhone: "",
  accountName: "",
  bank: "",
  accountNumber: "",
  paymentDate: "",
  amount: "",
  reason: "",
};

const MAX_PHOTOS = 2;
const MAX_IMAGE_BYTES = 1_050_000;

function fileToDataUrl(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Foto tidak dapat dibaca."));
    reader.onerror = () => reject(new Error("Foto tidak dapat dibaca."));
    reader.readAsDataURL(file);
  });
}

async function compressPhoto(file: File) {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Foto tidak dapat dibuka. Pilih file JPG atau PNG.");
  }

  try {
    for (const maxSide of [1600, 1280, 960]) {
      const ratio = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Tidak dapat menyiapkan foto.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      for (const quality of [0.84, 0.76, 0.68, 0.6]) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
        if (blob && blob.size <= MAX_IMAGE_BYTES) return await fileToDataUrl(blob);
      }
    }
  } finally {
    bitmap.close();
  }
  throw new Error("Ukuran foto masih terlalu besar. Pilih foto yang lebih kecil.");
}

export default function CustomerForm() {
  const [values, setValues] = useState(initialValues);
  const [photos, setPhotos] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reference, setReference] = useState("");

  const update = (field: keyof FormValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  const handlePhotos = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    if (photos.length + files.length > MAX_PHOTOS) {
      setError("Maksimal 2 foto bukti transfer.");
      return;
    }
    setError("");
    try {
      const encoded: string[] = [];
      for (const file of files) {
        if (!file.type.startsWith("image/")) throw new Error("Lampiran harus berupa file gambar.");
        encoded.push(await compressPhoto(file));
      }
      setPhotos((current) => [...current, ...encoded].slice(0, MAX_PHOTOS));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Foto tidak dapat diproses.");
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const amount = values.amount.replace(/\D/g, "");
      const response = await fetch("/api/customer-intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ ...values, amount, proofImages: photos, consent, website }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Pengajuan belum dapat dikirim.");
      setReference(typeof result.reference === "string" ? result.reference : "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Koneksi bermasalah. Coba lagi.");
    } finally {
      setBusy(false);
    }
  };

  if (reference) {
    return (
      <main className="portal-shell">
        <section className="portal-card portal-success" aria-live="polite">
          <div className="portal-check" aria-hidden="true">✓</div>
          <p className="portal-eyebrow">Pengajuan diterima</p>
          <h1>Terima kasih</h1>
          <p>Data permohonan refund Anda berhasil dikirim untuk ditinjau tim kami.</p>
          <div className="portal-reference">
            <span>Nomor referensi</span>
            <strong>{reference}</strong>
          </div>
          <p className="portal-note">Simpan nomor referensi ini jika Anda perlu menanyakan pengajuan. Jangan pernah membagikan PIN, OTP, CVV, atau kata sandi.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="portal-shell">
      <section className="portal-card">
        <header className="portal-header">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/aiorbitlab-logo.webp" alt="Aiorbitlab" />
          <p className="portal-eyebrow">Portal pelanggan</p>
          <h1>Form Pengajuan Refund</h1>
          <p>Isi data dengan benar. Pengajuan akan diteruskan kepada tim untuk ditinjau.</p>
        </header>

        <form className="portal-form" onSubmit={submit}>
          <div className="portal-section-heading">
            <span>01</span>
            <div><strong>Data pemohon</strong><small>Masukkan identitas dan nomor WhatsApp aktif.</small></div>
          </div>
          <label className="portal-field">
            <span>Nama lengkap <b>*</b></span>
            <input autoComplete="name" maxLength={100} onChange={(event) => update("name", event.target.value)} required value={values.name} />
          </label>
          <label className="portal-field">
            <span>Nomor KTP <small>(opsional)</small></span>
            <input autoComplete="off" inputMode="numeric" maxLength={16} onChange={(event) => update("ktp", event.target.value.replace(/\D/g, ""))} placeholder="16 digit" value={values.ktp} />
          </label>
          <label className="portal-field">
            <span>Nomor WhatsApp <b>*</b></span>
            <input autoComplete="tel" inputMode="tel" maxLength={24} onChange={(event) => update("customerPhone", event.target.value)} placeholder="Contoh: 081234567890" required value={values.customerPhone} />
          </label>

          <div className="portal-section-heading">
            <span>02</span>
            <div><strong>Rekening pengembalian</strong><small>Pastikan nama pemilik sesuai rekening penerima.</small></div>
          </div>
          <label className="portal-field">
            <span>Nama pemilik rekening <b>*</b></span>
            <input autoComplete="name" maxLength={100} onChange={(event) => update("accountName", event.target.value)} required value={values.accountName} />
          </label>
          <label className="portal-field">
            <span>Nama bank <b>*</b></span>
            <input autoComplete="off" maxLength={100} onChange={(event) => update("bank", event.target.value)} placeholder="Contoh: BCA, BRI, Mandiri" required value={values.bank} />
          </label>
          <label className="portal-field">
            <span>Nomor rekening <b>*</b></span>
            <input autoComplete="off" inputMode="numeric" maxLength={32} onChange={(event) => update("accountNumber", event.target.value.replace(/[^\d -]/g, ""))} required value={values.accountNumber} />
          </label>

          <div className="portal-section-heading">
            <span>03</span>
            <div><strong>Rincian pembayaran</strong><small>Jelaskan pembayaran yang ingin dimohonkan refund.</small></div>
          </div>
          <label className="portal-field">
            <span>Tanggal pembayaran <b>*</b></span>
            <input onChange={(event) => update("paymentDate", event.target.value)} required type="date" value={values.paymentDate} />
          </label>
          <label className="portal-field">
            <span>Nominal pembayaran (rupiah) <b>*</b></span>
            <div className="portal-amount-input"><span>Rp</span><input inputMode="numeric" onChange={(event) => update("amount", event.target.value.replace(/\D/g, ""))} placeholder="0" required value={values.amount ? Number(values.amount).toLocaleString("id-ID") : ""} /></div>
          </label>
          <label className="portal-field">
            <span>Alasan pengajuan <b>*</b></span>
            <textarea maxLength={500} onChange={(event) => update("reason", event.target.value)} placeholder="Contoh: pembayaran lebih dari tagihan" required rows={4} value={values.reason} />
          </label>

          <label className="portal-field">
            <span>Bukti transfer <small>(opsional, maks. 2 foto)</small></span>
            <input accept="image/jpeg,image/png,image/webp" multiple onChange={handlePhotos} type="file" />
            <small>Foto akan dikecilkan otomatis sebelum dikirim. Maksimal 2 foto.</small>
          </label>
          {photos.length > 0 ? (
            <div className="portal-photo-list">
              {photos.map((photo, index) => (
                <div className="portal-photo-item" key={`${index}-${photo.length}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo} alt={`Pratinjau bukti ${index + 1}`} />
                  <span>Bukti {index + 1}</span>
                  <button onClick={() => setPhotos((current) => current.filter((_, photoIndex) => photoIndex !== index))} type="button">Hapus</button>
                </div>
              ))}
            </div>
          ) : null}

          <label className="portal-consent">
            <input checked={consent} onChange={(event) => setConsent(event.target.checked)} required type="checkbox" />
            <span>Saya menyetujui data dan bukti yang saya berikan digunakan untuk memproses permohonan refund serta disimpan dalam penyimpanan privat yang aksesnya dibatasi. Saya memastikan data rekening benar.</span>
          </label>
          <div className="portal-safety">Kami tidak akan meminta PIN ATM, OTP, CVV, atau kata sandi Anda.</div>

          <label className="portal-honeypot" aria-hidden="true">
            Website
            <input autoComplete="off" onChange={(event) => setWebsite(event.target.value)} tabIndex={-1} value={website} />
          </label>
          {error ? <p className="portal-error" role="alert">{error}</p> : null}
          <button className="portal-submit" disabled={busy} type="submit">{busy ? "Mengirim pengajuan…" : "Kirim pengajuan"}</button>
          <p className="portal-footer-note">Tanda * wajib diisi. Pengajuan akan masuk ke sistem tim refund untuk ditinjau.</p>
        </form>
      </section>
    </main>
  );
}
