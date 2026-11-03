"use client";

import {
  AlignmentType,
  Document,
  ImageRun,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { jsPDF } from "jspdf";
import { upload } from "@vercel/blob/client";
import { ChangeEvent, FormEvent, MouseEvent, useEffect, useMemo, useState } from "react";

type LetterData = {
  city: string;
  letterDate: string;
  recipientLine: string;
  recipientAddress: string;
  name: string;
  ktp: string;
  accountName: string;
  bank: string;
  accountNumber: string;
  paymentDate: string;
  amount: string;
  reason: string;
  closing: string;
  signerName: string;
};

type HistoryItem = {
  id: string;
  name: string;
  letterDate: string;
  paymentDate: string;
  amount: string;
  createdAt: string;
  updatedAt: string;
};

type StoredLetterData = LetterData & {
  proofImages?: string[];
};

type AppView = "dashboard" | "editor" | "analysis" | "status" | "all-data";

const draftStorageKey = "refund-editor-draft";

const navigationItems: Array<{ id: AppView; label: string; description: string }> = [
  {
    id: "dashboard",
    label: "Dashboard",
    description: "Ringkasan pekerjaan refund.",
  },
  {
    id: "editor",
    label: "Editor Dokumen",
    description: "Edit dan preview surat refund.",
  },
  {
    id: "analysis",
    label: "Analisis Refund",
    description: "Ringkasan nominal dan jumlah data.",
  },
  {
    id: "status",
    label: "Status Refund",
    description: "Pantau status dari data yang tersimpan.",
  },
  {
    id: "all-data",
    label: "Seluruh Data",
    description: "Cari dan buka semua history.",
  },
];

const defaultData: LetterData = {
  city: "Jakarta",
  letterDate: "",
  recipientLine: "PT Blue Star Media",
  recipientAddress:
    "Jl. Tebet Timur Dalam Raya No.76, RT.5/RW.6, Tebet Tim., Kec. Tebet, Kota Jakarta Selatan, Daerah Khusus Ibukota Jakarta 12820",
  name: "",
  ktp: "-",
  accountName: "",
  bank: "Bank Central Asia ( BCA )",
  accountNumber: "",
  paymentDate: "",
  amount: "Rp.93.750",
  reason: "Refund Lebih Bayar",
  closing:
    "Demikian Surat permohonan ini kami buat dengan sebenar-benarnya agar dapat dipergunakan sebagai mana mestinya.",
  signerName: "",
};

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function dataUrlToArrayBuffer(dataUrl: string) {
  const response = await fetch(dataUrl);
  return response.arrayBuffer();
}

async function normalizeDocxImage(dataUrl: string) {
  const match = /^data:image\/(jpeg|jpg|png|gif|bmp);/i.exec(dataUrl);
  if (match) {
    const type = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
    return { dataUrl, type: type as "jpg" | "png" | "gif" | "bmp" };
  }

  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = reject;
    image.src = dataUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Gagal menyiapkan gambar untuk Word.");
  context.drawImage(image, 0, 0);
  return { dataUrl: canvas.toDataURL("image/png"), type: "png" as const };
}

async function publicImageToDataUrl(path: string) {
  const response = await fetch(path);
  const blob = await response.blob();

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function getImageSize(src: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = reject;
    image.src = src;
  });
}

function fitImage(
  size: { width: number; height: number },
  maxWidth: number,
  maxHeight: number,
) {
  const ratio = Math.min(maxWidth / size.width, maxHeight / size.height);
  return {
    width: Math.round(size.width * ratio),
    height: Math.round(size.height * ratio),
  };
}

function formatIndonesianDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function formatRupiahInput(value: string) {
  const digits = value
    .replace(/^rp\.?\s*/i, "")
    .replace(/\D/g, "")
    .trim();

  return digits ? `Rp.${Number(digits).toLocaleString("id-ID")}` : "";
}

function parseRupiah(value: string) {
  return Number(value.replace(/\D/g, "")) || 0;
}

function formatRupiahValue(value: number) {
  return value > 0 ? `Rp.${value.toLocaleString("id-ID")}` : "Rp.0";
}

function cleanFilePart(value: string, fallback: string) {
  const cleaned = value
    .trim()
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ");

  return cleaned || fallback;
}

function getTodayInputDate() {
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
}

function createInitialData() {
  const today = getTodayInputDate();
  return {
    ...defaultData,
    letterDate: today,
    paymentDate: today,
  };
}

export default function Home() {
  const [data, setData] = useState<LetterData>(createInitialData);
  const [proofImages, setProofImages] = useState<string[]>([]);
  const [status, setStatus] = useState("Siap diedit dan diunduh.");
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [historyQuery, setHistoryQuery] = useState("");
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSavingHistory, setIsSavingHistory] = useState(false);
  const [deletingHistoryId, setDeletingHistoryId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<AppView>("editor");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    window.localStorage.removeItem("refund-editor-access");
    window.sessionStorage.removeItem("refund-editor-access");
    fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" })
      .then((response) => setIsUnlocked(response.ok))
      .catch(() => setIsUnlocked(false));
  }, []);

  useEffect(() => {
    if (!isUnlocked) return;

    const savedDraft = window.localStorage.getItem(draftStorageKey);
    if (savedDraft) {
      try {
        setData({ ...createInitialData(), ...JSON.parse(savedDraft) });
      } catch {
        window.localStorage.removeItem(draftStorageKey);
      }
    }

    loadHistoryItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUnlocked]);

  useEffect(() => {
    if (!isUnlocked) return;

    window.localStorage.setItem(draftStorageKey, JSON.stringify(data));
  }, [data, isUnlocked]);

  const fileBaseName = useMemo(() => {
    const cleanName = cleanFilePart(data.name, "Tanpa Nama");
    const cleanDate = cleanFilePart(formatIndonesianDate(data.letterDate), "Tanpa Tanggal");
    return `Permohonan Refund - ${cleanName} - ${cleanDate}`;
  }, [data.letterDate, data.name]);

  const refundSentence = useMemo(
    () =>
      `Atas pembayaran yang telah kami lakukan pada tanggal ${formatIndonesianDate(data.paymentDate)} sebesar ${data.amount} (terlampir bukti transfer). Dengan alasan ${data.reason}.`,
    [data.amount, data.paymentDate, data.reason],
  );

  const personalRows = useMemo(
    () => [
      ["Nama", data.name],
      ["No KTP", data.ktp],
    ],
    [data.ktp, data.name],
  );

  const accountRows = useMemo(
    () => [
      ["Nama Rekening", data.accountName],
      ["Nama Bank/Cabang", data.bank],
      ["No Rekening", data.accountNumber],
    ],
    [data.accountName, data.accountNumber, data.bank],
  );

  const historySummary = useMemo(() => {
    const totalAmount = historyItems.reduce(
      (sum, item) => sum + parseRupiah(item.amount),
      0,
    );
    const pendingCount = historyItems.filter((item) => !item.amount || item.amount === "Rp.0")
      .length;

    return {
      totalAmount,
      totalCount: historyItems.length,
      pendingCount,
      readyCount: Math.max(historyItems.length - pendingCount, 0),
    };
  }, [historyItems]);

  const activeNavigation = navigationItems.find((item) => item.id === activeView);

  const updateField = (key: keyof LetterData, value: string) => {
    setData((current) => ({
      ...current,
      [key]: key === "amount" ? formatRupiahInput(value) : value,
    }));
  };

  const sessionExpired = (response: Response) => {
    if (response.status !== 401) return false;
    setIsUnlocked(false);
    setPasswordError("Sesi telah berakhir. Masukkan password lagi.");
    return true;
  };

  const loadHistoryItems = async (query = historyQuery) => {
    try {
      const response = await fetch(`/api/history?q=${encodeURIComponent(query)}`, {
        cache: "no-store",
      });
      if (sessionExpired(response)) return;
      if (!response.ok) throw new Error("Gagal membaca history.");
      const result = (await response.json()) as { items: HistoryItem[] };
      setHistoryItems(result.items);
    } catch {
      setStatus("History belum bisa dibaca. Coba refresh halaman.");
    }
  };

  const saveHistory = async (message = "History tersimpan.") => {
    if (isSavingHistory) return null;

    const dataSnapshot = { ...data };
    const proofImageSnapshot = [...proofImages];
    setIsSavingHistory(true);
    setStatus("Menyimpan history...");

    try {
      const persistedProofImages: string[] = [];
      for (const image of proofImageSnapshot) {
        if (!image.startsWith("data:")) {
          persistedProofImages.push(image);
          continue;
        }

        const imageBlob = await fetch(image).then((response) => response.blob());
        const contentType = imageBlob.type || "image/png";
        const extension = contentType.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "png";
        const uploaded = await upload(`proof_${crypto.randomUUID()}.${extension}`, imageBlob, {
          access: "private",
          handleUploadUrl: "/api/proof/upload",
          contentType,
        });
        persistedProofImages.push(`/api/proof/${encodeURIComponent(uploaded.pathname)}`);
      }

      const response = await fetch("/api/history", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: selectedHistoryId,
          data: dataSnapshot,
          proofImages: persistedProofImages,
        }),
      });
      if (sessionExpired(response)) return null;
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Gagal menyimpan history.");
      }
      const result = (await response.json()) as { id: string; proofImages?: string[] };
      setSelectedHistoryId(result.id);
      setData(dataSnapshot);
      if (result.proofImages) setProofImages(result.proofImages);
      window.localStorage.setItem(draftStorageKey, JSON.stringify(dataSnapshot));
      await loadHistoryItems();
      setIsHistoryOpen(true);
      setStatus(message);
      return result.id;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "";
      setStatus(`Gagal menyimpan history.${detail ? ` ${detail}` : ""}`);
      return null;
    } finally {
      setIsSavingHistory(false);
    }
  };

  const loadHistoryDetail = async (id: string) => {
    try {
      const response = await fetch(`/api/history/${id}`, { cache: "no-store" });
      if (sessionExpired(response)) return;
      if (!response.ok) throw new Error("History tidak ditemukan.");
      const result = (await response.json()) as { id: string; data: StoredLetterData };
      const loadedData = { ...createInitialData(), ...result.data };
      const { proofImages: loadedProofImages = [], ...loadedLetterData } = loadedData;
      setData(loadedLetterData);
      window.localStorage.setItem(draftStorageKey, JSON.stringify(loadedLetterData));
      setSelectedHistoryId(result.id);
      setProofImages(loadedProofImages);
      setStatus("History dibuka. Revisi data lalu download ulang.");
    } catch {
      setStatus("Gagal membuka history.");
    }
  };

  const deleteHistoryItem = async (id: string) => {
    if (deletingHistoryId) return;

    setDeletingHistoryId(id);
    setStatus("Menghapus history...");

    try {
      const response = await fetch(`/api/history/${id}`, { method: "DELETE" });
      if (sessionExpired(response)) return;
      if (!response.ok) throw new Error("Gagal menghapus history.");
      if (selectedHistoryId === id) setSelectedHistoryId(null);
      await loadHistoryItems();
      setStatus("History dihapus.");
    } catch {
      setStatus("Gagal menghapus history.");
    } finally {
      setDeletingHistoryId(null);
    }
  };

  const handleDeleteHistory = (
    event: MouseEvent<HTMLButtonElement>,
    id: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    deleteHistoryItem(id);
  };

  const openView = (view: AppView) => {
    setActiveView(view);
    setIsSidebarOpen(false);

    if (view === "all-data") {
      setIsHistoryOpen(true);
      loadHistoryItems();
      setStatus("Seluruh data dibuka. Cari nama lalu buka untuk revisi.");
      return;
    }

    if (view === "editor") {
      setStatus("Editor dokumen dibuka.");
      return;
    }

    if (view === "analysis") {
      loadHistoryItems();
      setStatus("Analisis refund dibuka dari history yang tersimpan.");
      return;
    }

    if (view === "status") {
      loadHistoryItems();
      setStatus("Status refund dibuka. Status mengikuti data yang tersimpan.");
      return;
    }

    setStatus("Dashboard refund dibuka.");
  };

  const unlockEditor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isAuthenticating) return;
    setIsAuthenticating(true);
    setPasswordError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        setPasswordError(typeof result.error === "string" ? result.error : "Gagal masuk. Coba lagi.");
        return;
      }
      setIsUnlocked(true);
      setPassword("");
    } catch {
      setPasswordError("Tidak dapat terhubung. Coba lagi.");
    } finally {
      setIsAuthenticating(false);
    }
  };

  const lockEditor = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } finally {
      setIsUnlocked(false);
      setPassword("");
      setPasswordError("");
    }
  };

  const handleProofImage = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;

    Promise.all(
      files.map(
        (file) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = reject;
            reader.readAsDataURL(file);
          }),
      ),
    )
      .then((images) => {
        setProofImages((current) => [...current, ...images]);
        setStatus(`${images.length} foto bukti transfer berhasil ditambahkan.`);
        event.target.value = "";
      })
      .catch(() => {
        setStatus("Gagal membaca foto. Coba upload ulang.");
      });
  };

  const clearProofImages = () => {
    setProofImages([]);
    setStatus("Semua foto bukti transfer dihapus.");
  };

  const buildPdfBlob = async () => {
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const margin = 24;
    const bodyWidth = 162;
    let y = 26;

    pdf.setFont("times", "bold");
    pdf.setFontSize(12);
    pdf.text("SURAT PERMOHONAN REFUND", 105, y, { align: "center" });

    y += 14;
    pdf.text(`${data.city}, ${formatIndonesianDate(data.letterDate)}`, margin, y);

    y += 12;
    pdf.setFont("times", "normal");
    pdf.text("Kepada Yth", margin, y);
    y += 8;
    pdf.text(data.recipientLine, margin, y);
    y += 7;
    const recipientAddressLines = pdf.splitTextToSize(data.recipientAddress, bodyWidth);
    pdf.text(recipientAddressLines, margin, y);
    y += recipientAddressLines.length * 6;

    y += 14;
    pdf.text("Dengan Hormat,", margin, y);

    y += 10;
    pdf.text("Saya yang bertandatangan dibawah ini :", margin, y);
    y += 10;

    personalRows.forEach(([label, value]) => {
      pdf.text(label, margin, y);
      pdf.text(":", margin + 38, y);
      pdf.text(value, margin + 43, y);
      y += label === "Nama" ? 15 : 10;
    });

    y += 2;
    pdf.text(
      pdf.splitTextToSize("Mengajukan permohonan pengembalian pembayaran ke rek :", bodyWidth),
      margin,
      y,
    );

    y += 18;
    accountRows.forEach(([label, value]) => {
      pdf.text(label === "Nama Rekening" ? "Nama" : label, margin, y);
      pdf.text(":", margin + 38, y);
      pdf.text(value, margin + 43, y);
      y += label === "Nama Rekening" ? 13 : 8;
    });

    y += 2;
    const refundParts = [
      { text: "Atas pembayaran yang telah kami lakukan pada tanggal ", bold: false },
      { text: formatIndonesianDate(data.paymentDate), bold: true },
      { text: " sebesar ", bold: false },
      { text: data.amount, bold: true },
      { text: " (terlampir bukti transfer). Dengan alasan ", bold: false },
      { text: data.reason, bold: true },
      { text: ".", bold: false },
    ];
    let inlineX = margin;
    refundParts.forEach((part) => {
      pdf.setFont("times", part.bold ? "bold" : "normal");
      part.text.split(/(\s+)/).forEach((chunk) => {
        if (!chunk) return;
        const chunkWidth = pdf.getTextWidth(chunk);
        if (inlineX > margin && inlineX + chunkWidth > margin + bodyWidth) {
          inlineX = margin;
          y += 7;
        }
        pdf.text(chunk, inlineX, y);
        inlineX += chunkWidth;
      });
    });
    pdf.setFont("times", "normal");

    for (const proofImage of proofImages) {
      const proofData =
        proofImage.startsWith("data:") ? proofImage : await publicImageToDataUrl(proofImage);
      const proofSize = await getImageSize(proofData);
      const proofPdfSize = fitImage(proofSize, 118, 44);

      if (y + proofPdfSize.height + 28 > 282) {
        pdf.addPage();
        y = 24;
      }

      pdf.addImage(
        proofData,
        "PNG",
        margin + 3,
        y + 13,
        proofPdfSize.width,
        proofPdfSize.height,
      );
      y += proofPdfSize.height + 9;
    }

    y += proofImages.length > 0 ? 18 : 16;

    if (y > 265) {
      pdf.addPage();
      y = 24;
    }

    pdf.text(pdf.splitTextToSize(data.closing, bodyWidth), margin, y);

    y += 14;
    const signerText = data.name;
    const signatureCenterX =
      margin + Math.max(pdf.getTextWidth("Hormat Kami"), pdf.getTextWidth(signerText)) / 2;

    pdf.text("Hormat Kami", signatureCenterX, y, { align: "center" });

    y += 26;
    pdf.setFont("times", "bold");
    pdf.setFontSize(13);
    pdf.text(signerText, signatureCenterX, y, { align: "center" });

    return pdf.output("blob");
  };

  const exportPdf = async () => {
    setStatus("Membuat PDF...");
    const blob = await buildPdfBlob();
    downloadBlob(blob, `${fileBaseName}.pdf`);
    await saveHistory("PDF berhasil diunduh dan history tersimpan.");
  };

  const sendWhatsApp = async () => {
    setStatus("Membuat PDF untuk WhatsApp...");
    const blob = await buildPdfBlob();
    const filename = `${fileBaseName}.pdf`;
    const file = new File([blob], filename, { type: "application/pdf" });
    const message = [
      "Permohonan Refund",
      `Nama: ${data.name || "-"}`,
      `Tanggal: ${formatIndonesianDate(data.letterDate) || "-"}`,
      `Nominal: ${data.amount || "-"}`,
    ].join("\n");

    await saveHistory("History tersimpan. Pilih WhatsApp untuk kirim PDF.");

    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({
        files: [file],
        text: message,
        title: "Permohonan Refund",
      });
      setStatus("Share PDF terbuka. Pilih WhatsApp untuk mengirim file.");
      return;
    }

    downloadBlob(blob, filename);
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener");
    setStatus("Browser ini belum bisa share file langsung. PDF terdownload, WhatsApp dibuka.");
  };

  const exportWord = async () => {
    setStatus("Membuat Word editable...");
    const normal = { size: 24, font: "Times New Roman" };
    const bold = { ...normal, bold: true };
    const rowParagraph = (label: string, value: string) =>
      new Paragraph({
        children: [
          new TextRun({ text: label.padEnd(19, " "), ...normal }),
          new TextRun({ text: ": ", ...normal }),
          new TextRun({ text: value, ...normal }),
        ],
      });
    const proofParagraphs: Paragraph[] = [];

    for (const proofImage of proofImages) {
      const proofData =
        proofImage.startsWith("data:") ? proofImage : await publicImageToDataUrl(proofImage);
      const docxImage = await normalizeDocxImage(proofData);
      const proofBuffer = await dataUrlToArrayBuffer(docxImage.dataUrl);
      const proofSize = await getImageSize(docxImage.dataUrl);
      const proofDocSize = fitImage(proofSize, 360, 130);

      proofParagraphs.push(
        new Paragraph({
          children: [
            new ImageRun({
              type: docxImage.type,
              data: proofBuffer,
              transformation: proofDocSize,
            }),
          ],
        }),
        new Paragraph({ text: "" }),
      );
    }

    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
            },
          },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: "SURAT PERMOHONAN REFUND", ...bold })],
            }),
            new Paragraph({ text: "" }),
            new Paragraph({
              children: [
                new TextRun({
                  text: `${data.city}, ${formatIndonesianDate(data.letterDate)}`,
                  ...bold,
                }),
              ],
            }),
            new Paragraph({ text: "" }),
            new Paragraph({ children: [new TextRun({ text: "Kepada Yth ", ...normal })] }),
            new Paragraph({
              children: [new TextRun({ text: data.recipientLine, ...normal })],
            }),
            new Paragraph({
              children: [new TextRun({ text: data.recipientAddress, ...normal })],
            }),
            new Paragraph({ text: "" }),
            new Paragraph({ children: [new TextRun({ text: "Dengan Hormat,", ...normal })] }),
            new Paragraph({ text: "" }),
            new Paragraph({
              children: [
                new TextRun({
                  text: "Saya yang bertandatangan dibawah ini :",
                  ...normal,
                }),
              ],
            }),
            ...personalRows.flatMap(([label, value]) => [
              rowParagraph(label, value),
              ...(label === "Nama" ? [new Paragraph({ text: "" })] : []),
            ]),
            new Paragraph({ text: "" }),
            new Paragraph({
              children: [
                new TextRun({
                  text: "Mengajukan permohonan pengembalian pembayaran ke rek :",
                  ...normal,
                }),
              ],
            }),
            new Paragraph({ text: "" }),
            ...accountRows.flatMap(([label, value]) => [
              rowParagraph(label === "Nama Rekening" ? "Nama" : label, value),
              ...(label === "Nama Rekening" ? [new Paragraph({ text: "" })] : []),
            ]),
            new Paragraph({
              children: [
                new TextRun({
                  text: "Atas pembayaran yang telah kami lakukan pada tanggal ",
                  ...normal,
                }),
                new TextRun({
                  text: formatIndonesianDate(data.paymentDate),
                  ...bold,
                }),
                new TextRun({ text: " sebesar ", ...normal }),
                new TextRun({ text: data.amount, ...bold }),
                new TextRun({
                  text: " (terlampir bukti transfer). Dengan alasan ",
                  ...normal,
                }),
                new TextRun({ text: data.reason, ...bold }),
                new TextRun({ text: ".", ...normal }),
              ],
            }),
            ...proofParagraphs,
            new Paragraph({ children: [new TextRun({ text: data.closing, ...normal })] }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: "Hormat Kami", ...normal })],
            }),
            new Paragraph({ text: "" }),
            new Paragraph({ text: "" }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({
                  text: data.name,
                  size: 26,
                  font: "Times New Roman",
                  bold: true,
                }),
              ],
            }),
          ],
        },
      ],
    });

    const blob = await Packer.toBlob(doc);
    downloadBlob(blob, `${fileBaseName}.docx`);
    await saveHistory("Word editable berhasil diunduh dan history tersimpan.");
  };

  if (!isUnlocked) {
    return (
      <main className="lock-screen">
        <form className="lock-card" onSubmit={unlockEditor}>
          <p className="eyebrow">Akses editor</p>
          <h1>Masukkan Password</h1>
          <p className="intro">
            Editor surat refund dikunci supaya form dan dokumen tidak langsung
            terbuka untuk semua orang.
          </p>

          <label className="field">
            <span>Password</span>
            <input
              autoComplete="current-password"
              autoFocus
              onChange={(event) => {
                setPassword(event.target.value);
                setPasswordError("");
              }}
              type="password"
              value={password}
            />
          </label>

          {passwordError ? <p className="password-error">{passwordError}</p> : null}

          <button className="primary-action" type="submit" disabled={isAuthenticating}>
            {isAuthenticating ? "Memeriksa..." : "Masuk"}
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="app-shell min-h-screen text-[#171a1f]">
      {isSidebarOpen ? (
        <button
          aria-label="Tutup menu"
          className="sidebar-backdrop"
          onClick={() => setIsSidebarOpen(false)}
          type="button"
        />
      ) : null}

      <aside className={`app-sidebar ${isSidebarOpen ? "is-open" : ""}`}>
        <div className="sidebar-top">
          <div className="sidebar-logo-card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/aiorbitlab-logo.webp" alt="Aiorbitlab" />
          </div>
          <button
            aria-label="Tutup sidebar"
            className="sidebar-close"
            onClick={() => setIsSidebarOpen(false)}
            type="button"
          >
            ×
          </button>
        </div>

        <label className="sidebar-search">
          <span>Cari</span>
          <input placeholder="Cari menu..." type="search" />
        </label>

        <div className="sidebar-title-block">
          <p>Refund menu</p>
          <h2>Dashboard</h2>
        </div>

        <nav className="sidebar-nav" aria-label="Menu utama">
          <p className="sidebar-section-title">Utama</p>
          {navigationItems.map((item) => (
            <button
              className={activeView === item.id ? "is-active" : ""}
              key={item.id}
              onClick={() => openView(item.id)}
              type="button"
            >
              <strong>{item.label}</strong>
              <span>{item.description}</span>
            </button>
          ))}
          <p className="sidebar-section-title">Dokumen</p>
          <button onClick={() => setIsSidebarOpen(false)} type="button">
            <strong>Surat Refund</strong>
            <span>Preview dan download dokumen.</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <span>Aiorbitlab System</span>
          <strong>v1.0</strong>
        </div>
      </aside>

      <div className="workspace-layout">
        <section className="document-toolbar" aria-label="Aksi dokumen">
          <div className="brand-heading">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="app-logo"
              src="/aiorbitlab-logo.webp"
              alt="Aiorbitlab"
            />
            <div>
              <p className="eyebrow">Editor dokumen</p>
              <h1>{activeNavigation?.label ?? "Editor Dokumen"}</h1>
              <p className="intro">
                {activeView === "editor"
                  ? "Klik langsung bagian surat yang mau diubah, lalu download sebagai PDF atau Word."
                  : "Pilih menu di sidebar untuk melihat ringkasan, status, dan data refund."}
              </p>
            </div>
          </div>

          {activeView === "editor" ? (
            <div className="actions toolbar-actions">
              <button className="primary-action" onClick={exportPdf} type="button">
                PDF
              </button>
              <button className="secondary-action" onClick={exportWord} type="button">
                Word
              </button>
              <button className="whatsapp-action" onClick={sendWhatsApp} type="button">
                WhatsApp
              </button>
              <button
                className="history-action"
                onClick={() => saveHistory("History tersimpan.")}
                disabled={isSavingHistory}
                type="button"
              >
                {isSavingHistory ? "Menyimpan..." : "Simpan"}
              </button>
              <button
                className="history-action"
                onClick={() => {
                  setIsHistoryOpen((current) => !current);
                  loadHistoryItems();
                }}
                type="button"
              >
                History
              </button>
              <button className="logout-action" onClick={lockEditor} type="button">
                Keluar
              </button>
            </div>
          ) : (
            <div className="actions toolbar-actions">
              <button className="history-action" onClick={() => openView("editor")} type="button">
                Buka Editor
              </button>
              <button className="logout-action" onClick={lockEditor} type="button">
                Keluar
              </button>
            </div>
          )}

          <p className="status">{status}</p>

          {activeView === "analysis" ? (
            <div className="menu-insight-panel" aria-label="Analisis refund">
              <div>
                <span>Total History</span>
                <strong>{historySummary.totalCount}</strong>
              </div>
              <div>
                <span>Total Nominal</span>
                <strong>{formatRupiahValue(historySummary.totalAmount)}</strong>
              </div>
              <div>
                <span>Data Siap</span>
                <strong>{historySummary.readyCount}</strong>
              </div>
            </div>
          ) : null}

          {activeView === "dashboard" ? (
            <div className="menu-insight-panel" aria-label="Dashboard refund">
              <div>
                <span>Total History</span>
                <strong>{historySummary.totalCount}</strong>
              </div>
              <div>
                <span>Nominal Refund</span>
                <strong>{formatRupiahValue(historySummary.totalAmount)}</strong>
              </div>
              <div>
                <span>Editor</span>
                <strong>Siap</strong>
              </div>
            </div>
          ) : null}

          {activeView === "status" ? (
            <div className="menu-insight-panel" aria-label="Status refund">
              <div>
                <span>Status Data</span>
                <strong>{historySummary.totalCount > 0 ? "Ada data" : "Kosong"}</strong>
              </div>
              <div>
                <span>Belum Lengkap</span>
                <strong>{historySummary.pendingCount}</strong>
              </div>
              <div>
                <span>Sumber</span>
                <strong>History</strong>
              </div>
            </div>
          ) : null}

          {isHistoryOpen ? (
            <div className="history-panel">
              <label className="history-search">
                <span>Cari history</span>
                <input
                  onChange={(event) => {
                    setHistoryQuery(event.target.value);
                    loadHistoryItems(event.target.value);
                  }}
                  placeholder="Cari nama, tanggal, nominal"
                  value={historyQuery}
                />
              </label>

              <div className="history-list">
                {historyItems.length > 0 ? (
                  historyItems.map((item) => (
                    <div className="history-item" key={item.id}>
                      <button type="button" onClick={() => loadHistoryDetail(item.id)}>
                        <strong>{item.name}</strong>
                        <span>
                          {formatIndonesianDate(item.letterDate)} - {item.amount || "Tanpa nominal"}
                        </span>
                      </button>
                      <button
                        className="history-delete"
                        disabled={deletingHistoryId === item.id}
                        onClick={(event) => handleDeleteHistory(event, item.id)}
                        type="button"
                      >
                        {deletingHistoryId === item.id ? "..." : "Hapus"}
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="history-empty">Belum ada history.</p>
                )}
              </div>
            </div>
          ) : null}
        </section>

        {activeView !== "editor" ? (
          <section className="dashboard-shell" aria-label="Ringkasan menu">
            <div className="dashboard-card">
              <span>{activeNavigation?.label}</span>
              <h2>
                {activeView === "dashboard"
                  ? "Ringkasan refund"
                  : activeView === "analysis"
                    ? "Analisis dari history"
                    : activeView === "status"
                      ? "Status data refund"
                      : "Seluruh data refund"}
              </h2>
              <p>
                {activeView === "all-data"
                  ? "Gunakan panel history di atas untuk cari nama, buka data, lalu revisi di Editor Dokumen."
                  : "Preview surat disembunyikan di menu ini supaya halaman tidak penuh. Buka Editor Dokumen kalau mau mengedit surat."}
              </p>
            </div>
          </section>
        ) : null}

        {activeView === "editor" ? (
        <section className="preview-shell preview-shell-full" aria-label="Preview surat">
          <div className="preview-toolbar">
            <div>
              <p>Preview dokumen</p>
              <strong>{fileBaseName}</strong>
            </div>
            <span>A4</span>
          </div>

          <article className="paper editable-paper">
            <h2>SURAT PERMOHONAN REFUND</h2>

            <div className="date-edit-line">
              <input
                aria-label="Kota surat"
                className="paper-input city-input"
                onChange={(event) => updateField("city", event.target.value)}
                value={data.city}
              />
              <span>,</span>
              <input
                aria-label="Tanggal surat"
                className="paper-input date-input"
                onChange={(event) => updateField("letterDate", event.target.value)}
                type="date"
                value={data.letterDate}
              />
            </div>

            <div className="address-block">
              <p>Kepada Yth</p>
              <input
                aria-label="Penerima"
                className="paper-input full-line-input"
                onChange={(event) => updateField("recipientLine", event.target.value)}
                value={data.recipientLine}
              />
              <textarea
                aria-label="Alamat penerima"
                className="paper-textarea address-textarea"
                onChange={(event) => updateField("recipientAddress", event.target.value)}
                rows={3}
                value={data.recipientAddress}
              />
            </div>

            <p>Dengan Hormat,</p>
            <p>Saya yang bertandatangan dibawah ini :</p>

            <div className="identity-block">
              <label className="identity-row editable-row">
                <span>Nama</span>
                <span>:</span>
                <input
                  aria-label="Nama pemohon"
                  className="paper-input"
                  onChange={(event) => updateField("name", event.target.value)}
                  placeholder="Isi nama pemohon"
                  value={data.name}
                />
              </label>
              <label className="identity-row editable-row">
                <span>No KTP</span>
                <span>:</span>
                <input
                  aria-label="No KTP"
                  className="paper-input"
                  onChange={(event) => updateField("ktp", event.target.value)}
                  value={data.ktp}
                />
              </label>
            </div>

            <p className="request-line">Mengajukan permohonan pengembalian pembayaran ke rek :</p>

            <div className="account-block">
              <label className="identity-row editable-row">
                <span>Nama</span>
                <span>:</span>
                <input
                  aria-label="Nama rekening"
                  className="paper-input"
                  onChange={(event) => updateField("accountName", event.target.value)}
                  placeholder="Isi nama rekening"
                  value={data.accountName}
                />
              </label>
              <label className="identity-row editable-row">
                <span>Nama Bank/Cabang</span>
                <span>:</span>
                <input
                  aria-label="Nama bank atau cabang"
                  className="paper-input"
                  onChange={(event) => updateField("bank", event.target.value)}
                  value={data.bank}
                />
              </label>
              <label className="identity-row editable-row">
                <span>No Rekening</span>
                <span>:</span>
                <input
                  aria-label="No rekening"
                  className="paper-input"
                  inputMode="numeric"
                  onChange={(event) => updateField("accountNumber", event.target.value)}
                  placeholder="Isi no rekening"
                  value={data.accountNumber}
                />
              </label>
            </div>

            <div className="refund-edit-block">
              <span>Atas pembayaran yang telah kami lakukan pada tanggal</span>
              <input
                aria-label="Tanggal pembayaran"
                className="paper-input compact-date-input"
                onChange={(event) => updateField("paymentDate", event.target.value)}
                type="date"
                value={data.paymentDate}
              />
              <span>sebesar</span>
              <input
                aria-label="Nominal refund"
                className="paper-input amount-input"
                inputMode="numeric"
                onChange={(event) => updateField("amount", event.target.value)}
                placeholder="Rp.0"
                value={data.amount}
              />
              <span>(terlampir bukti transfer). Dengan alasan</span>
              <textarea
                aria-label="Alasan refund"
                className="paper-textarea reason-textarea"
                onChange={(event) => updateField("reason", event.target.value)}
                rows={2}
                value={data.reason}
              />
            </div>

            <div className="paper-proof-tools">
              <label className="paper-upload-button">
                Upload bukti transfer
                <input accept="image/*" multiple onChange={handleProofImage} type="file" />
              </label>
              {proofImages.length > 0 ? (
                <button className="paper-clear-button" onClick={clearProofImages} type="button">
                  Hapus foto
                </button>
              ) : null}
              <span>{proofImages.length} foto</span>
            </div>

            {proofImages.length > 0 ? (
              <div className="proof-gallery">
                {proofImages.map((proofImage, index) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="proof-image"
                    alt={`Bukti transfer ${index + 1}`}
                    key={`${proofImage.slice(0, 40)}-${index}`}
                    src={proofImage}
                  />
                ))}
              </div>
            ) : null}

            <textarea
              aria-label="Kalimat penutup"
              className="paper-textarea closing-textarea"
              onChange={(event) => updateField("closing", event.target.value)}
              rows={3}
              value={data.closing}
            />

            <div className="signature-block">
              <p>Hormat Kami</p>
              <div className="auto-signer-value" aria-label="Nama tanda tangan otomatis">
                {data.name || "Nama otomatis dari atas"}
              </div>
            </div>
          </article>
        </section>
        ) : null}
      </div>
    </main>
  );
}
