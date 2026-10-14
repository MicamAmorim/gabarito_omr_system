"use client";
import Link from "next/link";
import { useEffect,useState } from "react";
import { Pencil,Plus,Trash2,Users } from "lucide-react";
import { deleteClass,listClasses } from "@/lib/storage/local";
import type { SchoolClass } from "@/lib/types/domain";

export default function ClassesPage(){
 const[c,setC]=useState<SchoolClass[]>([]);
 function refresh(){setC(listClasses())}
 useEffect(()=>refresh(),[]);
 function remove(klass:SchoolClass){const ok=window.confirm(`Excluir a turma “${klass.name}”?\n\nAs correções associadas aos alunos desta turma serão apagadas. As provas NÃO serão apagadas.`);if(!ok)return;deleteClass(klass.id);refresh()}
 return <div className="container"><section className="hero"><div><div className="eyebrow">Turmas</div><h1 className="h1">Alunos organizados.</h1><p className="lead">Use turmas para gerar cartões individualizados e acumular resultados por aluno.</p></div><Link href="/turmas/nova" className="btn btn-primary"><Plus size={17}/>Nova turma</Link></section>{c.length===0?<div className="empty"><Users size={30}/><strong>Nenhuma turma cadastrada</strong>Você pode usar cartões gerais sem turma ou cadastrar os alunos agora.<br/><br/><Link className="btn btn-primary" href="/turmas/nova">Cadastrar turma</Link></div>:<div className="grid grid-2">{c.map(x=><div className="card" key={x.id}><div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"start"}}><div><div className="list-title">{x.name}</div><div className="stat-value">{x.students.length}</div><div className="stat-sub">alunos</div></div><div className="toolbar" style={{gap:6,flexWrap:"nowrap"}}><Link className="btn" style={{padding:8}} href={`/turmas/editar?id=${encodeURIComponent(x.id)}`} aria-label={`Editar ${x.name}`} title="Editar turma"><Pencil size={15}/></Link><button className="btn" style={{padding:8}} onClick={()=>remove(x)} aria-label={`Excluir ${x.name}`} title="Excluir turma"><Trash2 size={15}/></button></div></div><div className="list-meta" style={{marginTop:12}}>{x.students.slice(0,5).map(s=>s.name).join(" · ")}{x.students.length>5?"…":""}</div></div>)}</div>}</div>
}
