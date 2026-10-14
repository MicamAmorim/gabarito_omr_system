"use client";
import Link from "next/link";
import { useEffect,useState } from "react";
import { ArrowRight,FilePlus2,Trash2 } from "lucide-react";
import { deleteExam,listExams } from "@/lib/storage/local";
import type { Exam } from "@/lib/types/domain";

export default function ExamsPage(){
  const[e,setE]=useState<Exam[]>([]);
  useEffect(()=>setE(listExams()),[]);
  function remove(exam:Exam){
    const ok=window.confirm(`Apagar a prova “${exam.name}”?\n\nOs resultados salvos desta prova também serão removidos deste dispositivo.`);
    if(!ok)return;
    deleteExam(exam.id);setE(listExams());
  }
  return <div className="container"><section className="hero"><div><div className="eyebrow">Provas</div><h1 className="h1">Seus cartões.</h1><p className="lead">Cada prova guarda seu layout, gabarito e modalidade de correção.</p></div><Link className="btn btn-primary" href="/provas/nova"><FilePlus2 size={17}/>Nova prova</Link></section>{e.length?<div className="list">{e.map(x=><div className="list-item" key={x.id} style={{gap:10}}><Link href={`/provas/detalhes?id=${encodeURIComponent(x.id)}`} style={{display:"flex",alignItems:"center",gap:12,flex:1,minWidth:0,textDecoration:"none",color:"inherit"}}><div className="list-main"><div className="list-title">{x.name}</div><div className="list-meta">{x.subject} · {x.questions} questões · nota {x.maxScore}</div></div><span className="pill">{x.mode==="student"?"Turma":"Geral"}</span><ArrowRight size={17}/></Link><button className="btn" type="button" aria-label={`Apagar ${x.name}`} title="Apagar prova" onClick={()=>remove(x)} style={{padding:8}}><Trash2 size={16}/></button></div>)}</div>:<div className="empty"><strong>Nenhuma prova cadastrada</strong>Crie a primeira prova e o sistema gera o cartão para impressão.</div>}</div>
}
