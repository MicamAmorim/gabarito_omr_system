import Link from "next/link";
import { ClipboardCheck, Home, ScanLine, Table2, Users } from "lucide-react";
export function AppShell({children}:{children:React.ReactNode}){
 const nav=[["/","Início",Home],["/provas/nova","Nova prova",ClipboardCheck],["/corrigir","Corrigir",ScanLine],["/resultados","Resultados",Table2]] as const;
 return <div className="app"><header className="topbar"><div className="topbar-in"><Link href="/" className="brand"><span className="brand-badge"><ClipboardCheck size={20}/></span><span>Gabarito</span></Link><nav className="nav"><Link href="/">Início</Link><Link href="/provas/nova">Provas</Link><Link href="/turmas">Turmas</Link><Link href="/corrigir">Corrigir</Link><Link href="/resultados">Resultados</Link></nav></div></header><main>{children}</main><nav className="mobile-bottom">{nav.map(([href,label,Icon])=><Link key={label} href={href as string}><Icon/>{label}</Link>)}</nav></div>
}
