"use client";
import Link from "next/link";
import { useEffect,useRef,useState } from "react";
import { ArrowRight,FilePlus2,Trash2,Upload } from "lucide-react";
import { deleteExam,listExams } from "@/lib/storage/local";
import { importEclassExam } from "@/lib/import/eclass";
import type { Exam } from "@/lib/types/domain";

export default function ExamsPage(){
  const[e,setE]=useState<Exam[]>([]);
  const importRef=useRef<HTMLInputElement>(null);
  useEffect(()=>setE(listExams()),[]);
  function remove(exam:Exam){
    const ok=window.confirm(`Apagar a prova “${exam.name}”?\n\nOs resultados salvos desta prova também serão removidos deste dispositivo.`);
    if(!ok)return;
    deleteExam(exam.id);setE(listExams());
  }
  async function importFile(file?:File){
    if(!file)return;
    try{
      const r=importEclassExam(await file.text());
      setE(listExams());
      if(r.duplicate){
        window.alert(`Esta prova já foi importada anteriormente: “${r.exam.name}”.\n\nNada foi alterado.`);
      }else{
        const roster=r.studentsAdded||r.classesAdded||r.classesMerged
          ? `\nTurmas novas: ${r.classesAdded}\nTurmas atualizadas: ${r.classesMerged}\nAlunos adicionados: ${r.studentsAdded}`
          : "\nSem lista de alunos no arquivo: prova criada com gabarito geral.";
        const abertas=r.openQuestionsIgnored?`\nQuestões abertas fora do OMR: ${r.openQuestionsIgnored}`:"";
        window.alert(`Prova adicionada: “${r.exam.name}”.\nObjetivas no gabarito: ${r.exam.questions}${roster}${abertas}\n\nNenhum dado existente foi apagado.`);
      }
    }catch(err){
      window.alert(err instanceof Error?err.message:"Não foi possível importar esta prova.");
    }finally{
      if(importRef.current)importRef.current.value="";
    }
  }
  return <div className="container"><section className="hero"><div><div className="eyebrow">Provas</div><h1 className="h1">Seus cartões.</h1><p className="lead">Cada prova guarda seu layout, gabarito e modalidade de correção.</p></div><div style={{display:"flex",gap:8,flexWrap:"wrap"}}><input ref={importRef} type="file" accept=".json,application/json" hidden onChange={ev=>void importFile(ev.target.files?.[0])}/><button className="btn" type="button" onClick={()=>importRef.current?.click()}><Upload size={17}/>Importar prova</button><Link className="btn btn-primary" href="/provas/nova"><FilePlus2 size={17}/>Nova prova</Link></div></section>{e.length?<div className="list">{e.map(x=><div className="list-item" key={x.id} style={{gap:10}}><Link href={`/provas/detalhes?id=${encodeURIComponent(x.id)}`} style={{display:"flex",alignItems:"center",gap:12,flex:1,minWidth:0,textDecoration:"none",color:"inherit"}}><div className="list-main"><div className="list-title">{x.name}</div><div className="list-meta">{x.subject} · {x.questions} questões · nota {x.maxScore}</div></div><span className="pill">{x.mode==="student"?"Turma":"Geral"}</span><ArrowRight size={17}/></Link><button className="btn" type="button" aria-label={`Apagar ${x.name}`} title="Apagar prova" onClick={()=>remove(x)} style={{padding:8}}><Trash2 size={16}/></button></div>)}</div>:<div className="empty"><strong>Nenhuma prova cadastrada</strong>Crie a primeira prova e o sistema gera o cartão para impressão.</div>}</div>
}
