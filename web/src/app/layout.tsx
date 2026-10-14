import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
export const metadata:Metadata={title:"Gabarito — correção rápida",description:"Crie cartões-resposta, fotografe e corrija provas com OMR no navegador."};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="pt-BR"><body><AppShell>{children}</AppShell></body></html>}
