"use client";

import { FormEvent, useEffect, useState } from "react";

type Role = "admin" | "master";
type AuditEvent = {
  id: string;
  timestamp: string;
  action: "login" | "password_change" | "master_setup";
  actor: Role;
  account: Role;
  success: boolean;
  ip: string;
  userAgent: string;
};

type Props = { role: Role; masterExists: boolean; onMasterCreated: () => void };

const actionLabel: Record<AuditEvent["action"], string> = {
  login: "Login",
  password_change: "Ubah password",
  master_setup: "Setup Master",
};

export default function AccountPanel({ role, masterExists, onMasterCreated }: Props) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [targetAccount, setTargetAccount] = useState<Role>("admin");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const loadAudit = async () => {
    if (role !== "master") return;
    setAuditLoading(true);
    try {
      const response = await fetch("/api/auth/audit?limit=100", { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Audit tidak dapat dibaca.");
      setEvents(Array.isArray(result.events) ? result.events as AuditEvent[] : []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Audit tidak dapat dibaca.");
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    if (role === "master") void loadAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    if (newPassword.length < 12) {
      setMessage("Password baru minimal 12 karakter.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage("Konfirmasi password tidak cocok.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const isSetup = role === "admin";
      const response = await fetch(isSetup ? "/api/auth/accounts/master" : "/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          currentPassword,
          account: targetAccount,
          password: newPassword,
          confirmPassword,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Perubahan akun gagal disimpan.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      if (isSetup) {
        setMessage("Akun Master berhasil dibuat. Keluar, lalu masuk kembali dengan memilih Master.");
        onMasterCreated();
      } else {
        setMessage("Password berhasil diperbarui. Sesi akun lain yang memakai password lama telah dicabut.");
        await loadAudit();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Perubahan akun gagal disimpan.");
    } finally {
      setSaving(false);
    }
  };

  const form = (setup: boolean) => (
    <form className="account-form" onSubmit={submit}>
      {!setup ? (
        <label className="field">
          <span>Akun yang password-nya diganti</span>
          <select onChange={(event) => setTargetAccount(event.target.value as Role)} value={targetAccount}>
            <option value="admin">Admin</option>
            <option value="master">Master</option>
          </select>
        </label>
      ) : null}
      <label className="field">
        <span>{setup ? "Password Admin saat ini" : "Password Master saat ini"}</span>
        <input autoComplete="current-password" onChange={(event) => setCurrentPassword(event.target.value)} required type="password" value={currentPassword} />
      </label>
      <label className="field">
        <span>{setup ? "Password baru akun Master" : `Password baru ${targetAccount === "admin" ? "Admin" : "Master"}`}</span>
        <input autoComplete="new-password" minLength={12} onChange={(event) => setNewPassword(event.target.value)} required type="password" value={newPassword} />
      </label>
      <label className="field">
        <span>Ulangi password baru</span>
        <input autoComplete="new-password" minLength={12} onChange={(event) => setConfirmPassword(event.target.value)} required type="password" value={confirmPassword} />
      </label>
      <button className="primary-action" disabled={saving} type="submit">
        {saving ? "Menyimpan..." : setup ? "Buat akun Master" : "Simpan password"}
      </button>
    </form>
  );

  return (
    <div className="account-panel">
      <section className="account-card">
        {role === "admin" ? (
          <>
            <p className="eyebrow">Penyiapan awal</p>
            <h2>{masterExists ? "Akun Master sudah dibuat" : "Buat akun Master"}</h2>
            <p className="intro">
              {masterExists
                ? "Gunakan pilihan Master pada halaman masuk untuk membuka pengelolaan akun dan audit."
                : "Verifikasi dengan password Admin yang saat ini dipakai, lalu buat password Master minimal 12 karakter. Setelah dibuat, hanya Master yang dapat mengubah password dan melihat audit login."}
            </p>
            {!masterExists ? form(true) : null}
          </>
        ) : (
          <>
            <p className="eyebrow">Kontrol Master</p>
            <h2>Kelola password akun</h2>
            <p className="intro">Master dapat mengganti password Master sendiri atau Admin. Perubahan password mencabut sesi aktif akun yang diubah; sesi Master yang sedang dipakai tetap aktif.</p>
            {form(false)}
          </>
        )}
        {message ? <p aria-live="polite" className="account-message">{message}</p> : null}
      </section>

      {role === "master" ? (
        <section className="account-card">
          <div className="audit-heading">
            <div>
              <p className="eyebrow">Keamanan</p>
              <h2>Audit login</h2>
              <p className="intro">Sampai 100 kejadian terbaru, termasuk login gagal, akun, waktu, alamat IP, dan perangkat/browser.</p>
            </div>
            <button className="history-action" disabled={auditLoading} onClick={() => void loadAudit()} type="button">
              {auditLoading ? "Memuat..." : "Muat ulang"}
            </button>
          </div>
          <div className="audit-list" aria-live="polite">
            {events.length ? events.map((item) => (
              <article className="audit-item" key={item.id}>
                <div className="audit-item-top">
                  <strong>{actionLabel[item.action]} · {item.account === "master" ? "Master" : "Admin"}</strong>
                  <span className={item.success ? "audit-success" : "audit-failure"}>{item.success ? "Berhasil" : "Gagal"}</span>
                </div>
                <time dateTime={item.timestamp}>{new Date(item.timestamp).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}</time>
                <small>IP {item.ip} · {item.actor === "master" ? "Master" : "Admin"} · {item.userAgent}</small>
              </article>
            )) : <p className="history-empty">{auditLoading ? "Memuat audit..." : "Belum ada catatan audit."}</p>}
          </div>
        </section>
      ) : null}
    </div>
  );
}
