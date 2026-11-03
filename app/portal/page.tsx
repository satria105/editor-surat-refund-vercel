import type { Metadata } from "next";
import CustomerForm from "./customer-form";

export const metadata: Metadata = {
  title: "Portal Pelanggan — Pengajuan Refund",
  description: "Formulir pengajuan refund Aiorbitlab.",
  robots: { index: false, follow: false },
};

export default function CustomerPortalPage() {
  return <CustomerForm />;
}
