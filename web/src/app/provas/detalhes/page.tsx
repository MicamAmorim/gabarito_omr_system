"use client";
import { useEffect,useState } from "react";
import Link from "next/link";
import { Download,ScanLine,Users } from "lucide-react";
import { getClass,getExam } from "@/lib/storage/local";
import type { Exam,SchoolClass } from "@/lib/types/domain";
import { downloadAnswerSheets } from "@/lib/pdf/answer-sheet";

export default function ExamDetailsPage(){
 const[exam,setExam]=useState<Exam>();
 const[klass,setKlass]=useState<SchoolClass>();
 const[loaded,setLoaded]=useState(false);
 useEffect(()=>{
   const id=new URLSearchParams(window.location.search).get("id")??"";
   const e=id?getExam(id):undefined;
   setExam(e);
   if(e?.classId)setKlass(getClass(e.classId));
   setLoaded(true);
 },[]);
 if(!loaded)return <div className="container"><div className="empty">Carregando prova...</div></div>;
 if(!exam)return <div className="container"><div className="empty"><strong>Prova não encontrada neste dispositivo.</strong>Ela pode ter sido criada em outro navegador ou os dados locais podem ter sido apagados.</div></div>;
 return <div className="container"><div className="steps"><span className="step"><i>1</i>Configurar</span><span>→</span><span className="step active"><i>2</i>Imprimir</span><span>→</span><span className="step"><i>3</i>Corrigir</span></div><section className="hero"><div><div className="eyebrow">Prova criada</div><h1 className="h1">{exam.name}</h1><p className="lead">{exam.subject} · {exam.questions} questões · nota máxima {exam.maxScore}{klass?` · ${klass.name}`:""}</p></div><div className="actions"><button className="btn btn-primary btn-lg" onClick={()=>downloadAnswerSheets(exam,klass)}><Download size={18}/>Baixar cartões PDF</button><Link className="btn btn-lg" href={`/corrigir?exam=${exam.id}`}><ScanLine size={18}/>Corrigir</Link></div></section>
 <div className="grid grid-3"><div className="card card-flat"><div className="stat-label">Modalidade</div><div className="stat-value" style={{fontSize:22}}>{exam.mode==="student"?"Individual":"Geral"}</div><div className="stat-sub">{exam.mode==="student"?"QR por aluno":"um cartão reutilizável"}</div></div><div className="card card-flat"><div className="stat-label">Cartões no PDF</div><div className="stat-value">{exam.mode==="student"?klass?.students.length??0:1}</div><div className="stat-sub">prontos para impressão</div></div><div className="card card-flat"><div className="stat-label">Alternativas</div><div className="stat-value" style={{fontSize:22}}>{exam.alternatives.join(" · ")}</div><div className="stat-sub">leitura OMR calibrada</div></div></div>
 <div className="section-title"><h2>Antes de imprimir</h2></div><div className="card"><div className="callout">Imprima em <b>100% / tamanho real</b>. Não use “ajustar à página”. Os quatro quadrados pretos precisam permanecer inteiros. Fotografias podem ter pequena rotação e perspectiva: o algoritmo corrige isso automaticamente.</div>{exam.mode==="student"&&<p className="list-meta"><Users size={14} style={{verticalAlign:"middle"}}/> Cada página contém o nome do aluno e um QR com identificadores internos, sem depender de OCR.</p>}</div></div>;
}
